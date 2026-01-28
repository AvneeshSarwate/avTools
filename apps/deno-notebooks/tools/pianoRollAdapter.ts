/**
 * Piano Roll Adapter - Component-specific logic for piano roll in Deno notebooks
 *
 * This module contains:
 * - AbletonClip <-> NoteData conversion
 * - ClipMap (reactive map with sync)
 * - Piano roll adapter implementation
 * - Convenience factory function
 *
 * Usage:
 * ```typescript
 * import { createPianoRollBridge } from "./pianoRollAdapter.ts"
 *
 * const piano = createPianoRollBridge()
 *
 * // Read-only display
 * piano.show(myClip)
 *
 * // Reactive binding
 * piano.clips.set("melody", myClip)
 * const handle = piano.showBound("melody")
 * const edited = handle.latestClip
 * ```
 */

import {
  DenoNotebookBridge,
  type ComponentAdapter,
  type Session
} from "@avtools/ui-bridge"
import {
  PianoRollWebSocketClient,
  type NoteDataInput,
  type NoteData
} from "./pianoRollWebSocketClient.ts"
import { AbletonClip, type AbletonNote } from "@avtools/music-types"

// ============================================================================
// Type Definitions
// ============================================================================

export interface PianoRollHandle {
  readonly latestClip: AbletonClip | undefined
  disconnect(): void
  setLivePlayhead(position: number): void
  fitZoomToNotes(): void
}

interface PianoRollSessionData {
  type: 'readonly' | 'bound'
  clip?: AbletonClip
  clipMap?: ClipMap
  clipName?: string
}

type PianoRollSession = Session<PianoRollWebSocketClient, PianoRollSessionData>
type PianoRollBridge = DenoNotebookBridge<PianoRollWebSocketClient, PianoRollHandle, PianoRollSessionData>

// ============================================================================
// Note Conversion Functions
// ============================================================================

const PIANO_ROLL_ID_KEY = '__pianoRollId'
const PIANO_ROLL_DATA_KEY = '__pianoRollMetadata'

function generatePianoRollId(index: number): string {
  return `note_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 9)}`
}

function normalizeMetadataWithId(metadata: unknown, id: string): Record<string, unknown> {
  if (metadata && typeof metadata === 'object') {
    return { ...(metadata as Record<string, unknown>), [PIANO_ROLL_ID_KEY]: id }
  }
  if (metadata === undefined) {
    return { [PIANO_ROLL_ID_KEY]: id }
  }
  return {
    [PIANO_ROLL_ID_KEY]: id,
    [PIANO_ROLL_DATA_KEY]: metadata
  }
}

function ensureStableNoteId(note: AbletonNote, index: number): string {
  const metadata = note.metadata
  if (metadata && typeof metadata === 'object') {
    const existing = (metadata as Record<string, unknown>)[PIANO_ROLL_ID_KEY]
    if (typeof existing === 'string' && existing.length > 0) {
      return existing
    }
  }

  const id = generatePianoRollId(index)
  if (metadata && typeof metadata === 'object') {
    ;(metadata as Record<string, unknown>)[PIANO_ROLL_ID_KEY] = id
  } else if (metadata === undefined) {
    note.metadata = { [PIANO_ROLL_ID_KEY]: id }
  } else {
    note.metadata = {
      [PIANO_ROLL_ID_KEY]: id,
      [PIANO_ROLL_DATA_KEY]: metadata
    }
  }

  return id
}

function abletonToNoteData(notes: AbletonNote[]): NoteDataInput[] {
  return notes.map((note, index) => ({
    id: ensureStableNoteId(note, index),
    pitch: note.pitch,
    position: note.position,
    duration: note.duration,
    velocity: note.velocity,
    metadata: note.metadata
  }))
}

function noteDataToAbleton(notes: readonly NoteData[]): AbletonNote[] {
  return notes.map(note => ({
    pitch: note.pitch,
    position: note.position,
    duration: note.duration,
    velocity: note.velocity,
    offVelocity: note.velocity,
    probability: 1,
    isEnabled: true,
    metadata: normalizeMetadataWithId(note.metadata, note.id)
  }))
}

// ============================================================================
// ClipMap - Reactive Map with Piano Roll Sync
// ============================================================================

export class ClipMap {
  private clips = new Map<string, AbletonClip>()
  private bindings = new Map<string, Set<string>>()
  private bridge?: PianoRollBridge

  /** @internal Set by createPianoRollBridge */
  _setBridge(bridge: PianoRollBridge): void {
    this.bridge = bridge
  }

  get(name: string): AbletonClip | undefined {
    return this.clips.get(name)
  }

  has(name: string): boolean {
    return this.clips.has(name)
  }

  set(name: string, clip: AbletonClip, options?: { excludeSession?: string }): this {
    this.clips.set(name, clip)

    const sessions = this.bindings.get(name)
    if (sessions && this.bridge) {
      for (const sessionId of sessions) {
        if (sessionId === options?.excludeSession) continue

        const session = this.bridge.getSession(sessionId)
        if (session?.client?.connected) {
          const notes = abletonToNoteData(clip.notes)
          session.client.setNotes(notes)
        }
      }
    }

    return this
  }

  delete(name: string): boolean {
    const sessions = this.bindings.get(name)
    if (sessions && this.bridge) {
      for (const sessionId of sessions) {
        const session = this.bridge.getSession(sessionId)
        session?.client?.disconnect()
        this.bridge.removeSession(sessionId)
      }
      this.bindings.delete(name)
    }
    return this.clips.delete(name)
  }

  keys(): IterableIterator<string> {
    return this.clips.keys()
  }

  values(): IterableIterator<AbletonClip> {
    return this.clips.values()
  }

  entries(): IterableIterator<[string, AbletonClip]> {
    return this.clips.entries()
  }

  [Symbol.iterator](): IterableIterator<[string, AbletonClip]> {
    return this.clips[Symbol.iterator]()
  }

  get size(): number {
    return this.clips.size
  }

  clear(): void {
    if (this.bridge) {
      for (const sessions of this.bindings.values()) {
        for (const sessionId of sessions) {
          const session = this.bridge.getSession(sessionId)
          session?.client?.disconnect()
          this.bridge.removeSession(sessionId)
        }
      }
    }
    this.bindings.clear()
    this.clips.clear()
  }

  bind(clipName: string, sessionId: string): void {
    if (!this.bindings.has(clipName)) {
      this.bindings.set(clipName, new Set())
    }
    this.bindings.get(clipName)!.add(sessionId)
  }

  unbind(clipName: string, sessionId: string): void {
    const sessions = this.bindings.get(clipName)
    if (sessions) {
      sessions.delete(sessionId)
      if (sessions.size === 0) {
        this.bindings.delete(clipName)
      }
    }
  }
}

// ============================================================================
// Piano Roll Adapter Implementation
// ============================================================================

function createPianoRollAdapter(): ComponentAdapter<
  PianoRollWebSocketClient,
  PianoRollHandle,
  PianoRollSessionData
> {
  return {
    name: "piano-roll",
    bundleUrl: new URL("../../../webcomponents/piano-roll/dist/piano-roll.js", import.meta.url),
    defaultIframeConfig: {
      width: 680,
      height: 460,
      style: "border: 1px solid #ccc; border-radius: 8px; background: white;"
    },

    renderHTML(wsUrl: string, sessionId: string, sessionData: PianoRollSessionData): string {
      const interactive = sessionData.type === 'bound'
      const name = sessionData.type === 'bound' ? sessionData.clipName : undefined

      return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Piano Roll</title>
  <style>
    body {
      margin: 0;
      padding: 8px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #f5f5f5;
    }
    #name-label {
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 8px;
      color: #333;
      padding: 4px 8px;
      background: white;
      border-radius: 4px;
      display: inline-block;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    #name-label:empty { display: none; }
    #root { display: flex; justify-content: center; }
  </style>
</head>
<body>
  <div id="name-label">${name ?? ''}</div>
  <div id="root"></div>
  <script type="module">
    await import('/static/piano-roll.js')
    await customElements.whenDefined('piano-roll-component')

    const rootEl = document.getElementById('root')
    const pianoRoll = document.createElement('piano-roll-component')

    pianoRoll.setAttribute('ws-address', '${wsUrl}')
    pianoRoll.setAttribute('interactive', '${interactive}')
    pianoRoll.setAttribute('show-control-panel', 'true')
    pianoRoll.setAttribute('width', '640')
    pianoRoll.setAttribute('height', '360')

    rootEl.appendChild(pianoRoll)
    console.log('[Piano Roll] Mounted', { sessionId: '${sessionId}', wsUrl: '${wsUrl}' })
  </script>
</body>
</html>`
    },

    getConfig(session: PianoRollSession): Record<string, unknown> {
      return {
        interactive: session.data.type === 'bound',
        name: session.data.type === 'bound' ? session.data.clipName : undefined
      }
    },

    handleConnection(
      socket: WebSocket,
      session: PianoRollSession,
      _bridge: PianoRollBridge
    ): PianoRollWebSocketClient {
      const client = new PianoRollWebSocketClient(socket)

      client.onConnectionReady = () => {
        let clip: AbletonClip | undefined

        if (session.data.type === 'readonly') {
          clip = session.data.clip
        } else if (session.data.type === 'bound') {
          clip = session.data.clipMap!.get(session.data.clipName!)
        }

        if (clip) {
          const notes = abletonToNoteData(clip.notes)
          client.setNotes(notes)
          client.fitZoomToNotes()
        }

        client.setConfig({ interactive: session.data.type === 'bound' })
      }

      client.onNotesUpdate = (notesMap, source) => {
        if (source && source !== 'notes') return

        if (session.data.type === 'bound') {
          const notes = Array.from(notesMap.values())
          const abletonNotes = noteDataToAbleton(notes)

          const clip = session.data.clipMap!.get(session.data.clipName!)
          if (clip) {
            clip.notes = abletonNotes
            session.data.clipMap!.set(session.data.clipName!, clip, {
              excludeSession: session.id
            })
          }
        }
      }

      client.onDisconnect = () => {
        if (session.data.type === 'bound') {
          session.data.clipMap!.unbind(session.data.clipName!, session.id)
        }
      }

      return client
    },

    createHandle(session: PianoRollSession, bridge: PianoRollBridge): PianoRollHandle {
      return {
        get latestClip(): AbletonClip | undefined {
          if (session.data.type === 'readonly') {
            return session.data.clip
          }
          return session.data.clipMap?.get(session.data.clipName!)
        },

        disconnect(): void {
          if (session.data.type === 'bound') {
            session.data.clipMap!.unbind(session.data.clipName!, session.id)
          }
          session.client?.disconnect()
          bridge.removeSession(session.id)
        },

        setLivePlayhead(position: number): void {
          session.client?.setLivePlayhead(position)
        },

        fitZoomToNotes(): void {
          session.client?.fitZoomToNotes()
        }
      }
    },

    onSessionCleanup(session: PianoRollSession): void {
      session.client?.disconnect()
    }
  }
}

// ============================================================================
// Factory Function (Main Export)
// ============================================================================

export interface PianoRollBridgeAPI {
  readonly clips: ClipMap
  show(clip: AbletonClip): void
  showBound(name: string): PianoRollHandle
  shutdown(): void
}

export function createPianoRollBridge(): PianoRollBridgeAPI {
  const adapter = createPianoRollAdapter()
  const bridge = new DenoNotebookBridge(adapter)
  const clips = new ClipMap()
  clips._setBridge(bridge)

  return {
    clips,

    show(clip: AbletonClip): void {
      bridge.show({ type: 'readonly', clip })
    },

    showBound(name: string): PianoRollHandle {
      const sessionId = bridge.generateSessionId()
      const sessionData: PianoRollSessionData = {
        type: 'bound',
        clipMap: clips,
        clipName: name
      }

      bridge.registerSession(sessionId, sessionData)
      clips.bind(name, sessionId)
      bridge.displayIframe(sessionId)

      const session = bridge.getSession(sessionId)!
      return adapter.createHandle(session, bridge)
    },

    shutdown(): void {
      bridge.shutdown()
    }
  }
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export { AbletonClip, type AbletonNote, quickNote } from "@avtools/music-types"
