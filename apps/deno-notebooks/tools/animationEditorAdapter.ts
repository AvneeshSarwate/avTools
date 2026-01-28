/**
 * Animation Editor Adapter - Component-specific logic for animation editor in Deno notebooks
 *
 * This module contains:
 * - TrackMap (reactive map with sync)
 * - Animation editor adapter implementation
 * - Convenience factory function
 *
 * Usage:
 * ```typescript
 * import { createAnimationEditorBridge } from "./animationEditorAdapter.ts"
 *
 * const anim = createAnimationEditorBridge()
 *
 * // Read-only display
 * anim.show(myTracks)
 *
 * // Reactive binding
 * anim.tracks.setFromInputs("myAnim", trackInputs)
 * const handle = anim.showBound("myAnim")
 * handle.scrubToTime(2.5)
 * ```
 */

import {
  DenoNotebookBridge,
  type ComponentAdapter,
  type Session
} from "@agentcombine/ui-bridge"
import {
  AnimationEditorWebSocketClient,
  type TrackData,
  type TrackInput,
  type TrackCallbacks
} from "./animationEditorWebSocketClient.ts"

// ============================================================================
// Type Definitions
// ============================================================================

export interface AnimationEditorHandle {
  readonly latestTracks: TrackData[] | undefined
  readonly client: AnimationEditorWebSocketClient | undefined
  disconnect(): void
  setLivePlayhead(position: number): void
  scrubToTime(time: number): void
  setCallbacks(callbacks: TrackCallbacks): void
}

interface AnimationSessionData {
  type: 'readonly' | 'bound'
  tracks?: TrackData[]
  trackOrder?: string[]
  trackMap?: TrackMap
  animationName?: string
}

type AnimationSession = Session<AnimationEditorWebSocketClient, AnimationSessionData>
type AnimationBridge = DenoNotebookBridge<AnimationEditorWebSocketClient, AnimationEditorHandle, AnimationSessionData>

// ============================================================================
// Track ID Generation
// ============================================================================

let trackIdCounter = 0
let elemIdCounter = 0

function generateTrackId(): string {
  return `track_${++trackIdCounter}_${Date.now()}`
}

function generateElemId(): string {
  return `elem_${++elemIdCounter}_${Date.now()}`
}

export function trackInputsToData(inputs: TrackInput[]): { tracks: TrackData[]; trackOrder: string[] } {
  const tracks: TrackData[] = []
  const trackOrder: string[] = []

  for (const input of inputs) {
    const trackId = generateTrackId()
    trackOrder.push(trackId)

    const elementData = input.data.map(datum => {
      const elemId = generateElemId()
      if (input.fieldType === 'number') {
        const d = datum as { time: number; value: number }
        return { id: elemId, time: d.time, value: d.value }
      } else if (input.fieldType === 'enum') {
        const d = datum as { time: number; value: string }
        return { id: elemId, time: d.time, value: d.value }
      } else {
        const d = datum as { time: number; funcName: string; args?: readonly unknown[] }
        return { id: elemId, time: d.time, value: { funcName: d.funcName, args: d.args ?? [] } }
      }
    })

    tracks.push({
      id: trackId,
      name: input.name,
      fieldType: input.fieldType,
      elementData,
      low: input.low ?? 0,
      high: input.high ?? 1
    })
  }

  return { tracks, trackOrder }
}

// ============================================================================
// TrackMap - Reactive Map with Animation Editor Sync
// ============================================================================

export class TrackMap {
  private animations = new Map<string, { tracks: TrackData[]; trackOrder: string[] }>()
  private bindings = new Map<string, Set<string>>()
  private bridge?: AnimationBridge

  _setBridge(bridge: AnimationBridge): void {
    this.bridge = bridge
  }

  get(name: string): TrackData[] | undefined {
    return this.animations.get(name)?.tracks
  }

  getFull(name: string): { tracks: TrackData[]; trackOrder: string[] } | undefined {
    return this.animations.get(name)
  }

  has(name: string): boolean {
    return this.animations.has(name)
  }

  setFromInputs(name: string, inputs: TrackInput[], options?: { excludeSession?: string }): this {
    const { tracks, trackOrder } = trackInputsToData(inputs)
    return this.set(name, tracks, trackOrder, options)
  }

  set(
    name: string,
    tracks: TrackData[],
    trackOrder?: string[],
    options?: { excludeSession?: string }
  ): this {
    const order = trackOrder ?? tracks.map(t => t.id)
    this.animations.set(name, { tracks, trackOrder: order })

    const sessions = this.bindings.get(name)
    if (sessions && this.bridge) {
      for (const sessionId of sessions) {
        if (sessionId === options?.excludeSession) continue

        const session = this.bridge.getSession(sessionId)
        if (session?.client?.connected) {
          session.client.setTracks(tracks, order)
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
    return this.animations.delete(name)
  }

  keys(): IterableIterator<string> {
    return this.animations.keys()
  }

  *values(): IterableIterator<TrackData[]> {
    for (const anim of this.animations.values()) {
      yield anim.tracks
    }
  }

  *entries(): IterableIterator<[string, TrackData[]]> {
    for (const [name, anim] of this.animations.entries()) {
      yield [name, anim.tracks]
    }
  }

  [Symbol.iterator](): IterableIterator<[string, TrackData[]]> {
    return this.entries()
  }

  get size(): number {
    return this.animations.size
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
    this.animations.clear()
  }

  bind(animationName: string, sessionId: string): void {
    if (!this.bindings.has(animationName)) {
      this.bindings.set(animationName, new Set())
    }
    this.bindings.get(animationName)!.add(sessionId)
  }

  unbind(animationName: string, sessionId: string): void {
    const sessions = this.bindings.get(animationName)
    if (sessions) {
      sessions.delete(sessionId)
      if (sessions.size === 0) {
        this.bindings.delete(animationName)
      }
    }
  }
}

// ============================================================================
// Animation Editor Adapter Implementation
// ============================================================================

function createAnimationEditorAdapter(): ComponentAdapter<
  AnimationEditorWebSocketClient,
  AnimationEditorHandle,
  AnimationSessionData
> {
  return {
    name: "animation-editor",
    bundleUrl: new URL("../../../webcomponents/animation-editor/dist/animation-editor.js", import.meta.url),
    defaultIframeConfig: {
      width: 800,
      height: 500,
      style: "border: 1px solid #2a2d30; border-radius: 8px; background: #121416;"
    },

    renderHTML(wsUrl: string, sessionId: string, sessionData: AnimationSessionData): string {
      const interactive = sessionData.type === 'bound'
      const name = sessionData.type === 'bound' ? sessionData.animationName : undefined

      return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Animation Editor</title>
  <style>
    body {
      margin: 0;
      padding: 8px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #121416;
    }
    #name-label {
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 8px;
      color: #e0e0e0;
      padding: 4px 8px;
      background: #1e2124;
      border-radius: 4px;
      display: inline-block;
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    }
    #name-label:empty { display: none; }
    #root { display: flex; justify-content: center; }
  </style>
</head>
<body>
  <div id="name-label">${name ?? ''}</div>
  <div id="root"></div>
  <script type="module">
    await import('/static/animation-editor.js')
    await customElements.whenDefined('animation-editor-component')

    const rootEl = document.getElementById('root')
    const editor = document.createElement('animation-editor-component')

    editor.setAttribute('ws-address', '${wsUrl}')
    editor.setAttribute('interactive', '${interactive}')

    rootEl.appendChild(editor)
    console.log('[Animation Editor] Mounted', { sessionId: '${sessionId}', wsUrl: '${wsUrl}' })
  </script>
</body>
</html>`
    },

    getConfig(session: AnimationSession): Record<string, unknown> {
      return {
        interactive: session.data.type === 'bound',
        name: session.data.type === 'bound' ? session.data.animationName : undefined,
        duration: 16
      }
    },

    handleConnection(
      socket: WebSocket,
      session: AnimationSession,
      _bridge: AnimationBridge
    ): AnimationEditorWebSocketClient {
      const client = new AnimationEditorWebSocketClient(socket)

      client.onConnectionReady = () => {
        let tracks: TrackData[] | undefined
        let trackOrder: string[] | undefined

        if (session.data.type === 'readonly') {
          tracks = session.data.tracks
          trackOrder = session.data.trackOrder
        } else if (session.data.type === 'bound') {
          const data = session.data.trackMap!.getFull(session.data.animationName!)
          tracks = data?.tracks
          trackOrder = data?.trackOrder
        }

        if (tracks && trackOrder) {
          client.setTracks(tracks, trackOrder)
        }

        client.setConfig({ interactive: session.data.type === 'bound' })
      }

      client.onTracksUpdate = (tracks, trackOrder, source) => {
        if (source && source !== 'tracks') return

        if (session.data.type === 'bound') {
          session.data.trackMap!.set(session.data.animationName!, [...tracks], [...trackOrder], {
            excludeSession: session.id
          })
        }
      }

      client.onDisconnect = () => {
        if (session.data.type === 'bound') {
          session.data.trackMap!.unbind(session.data.animationName!, session.id)
        }
      }

      return client
    },

    createHandle(session: AnimationSession, bridge: AnimationBridge): AnimationEditorHandle {
      return {
        get latestTracks(): TrackData[] | undefined {
          if (session.data.type === 'readonly') {
            return session.data.tracks
          }
          return session.data.trackMap?.get(session.data.animationName!)
        },

        get client(): AnimationEditorWebSocketClient | undefined {
          return session.client
        },

        disconnect(): void {
          if (session.data.type === 'bound') {
            session.data.trackMap!.unbind(session.data.animationName!, session.id)
          }
          session.client?.disconnect()
          bridge.removeSession(session.id)
        },

        setLivePlayhead(position: number): void {
          session.client?.setLivePlayhead(position)
        },

        scrubToTime(time: number): void {
          session.client?.scrubToTime(time)
        },

        setCallbacks(callbacks: TrackCallbacks): void {
          session.client?.setTrackCallbacks(callbacks)
        }
      }
    },

    onSessionCleanup(session: AnimationSession): void {
      session.client?.disconnect()
    }
  }
}

// ============================================================================
// Factory Function (Main Export)
// ============================================================================

export interface AnimationEditorBridgeAPI {
  readonly tracks: TrackMap
  show(tracks: TrackData[], trackOrder?: string[]): void
  showFromInputs(inputs: TrackInput[]): void
  showBound(name: string): AnimationEditorHandle
  shutdown(): void
}

export function createAnimationEditorBridge(): AnimationEditorBridgeAPI {
  const adapter = createAnimationEditorAdapter()
  const bridge = new DenoNotebookBridge(adapter)
  const tracks = new TrackMap()
  tracks._setBridge(bridge)

  return {
    tracks,

    show(trackData: TrackData[], trackOrder?: string[]): void {
      const order = trackOrder ?? trackData.map(t => t.id)
      bridge.show({ type: 'readonly', tracks: trackData, trackOrder: order })
    },

    showFromInputs(inputs: TrackInput[]): void {
      const { tracks: trackData, trackOrder } = trackInputsToData(inputs)
      bridge.show({ type: 'readonly', tracks: trackData, trackOrder })
    },

    showBound(name: string): AnimationEditorHandle {
      const sessionId = bridge.generateSessionId()
      const sessionData: AnimationSessionData = {
        type: 'bound',
        trackMap: tracks,
        animationName: name
      }

      bridge.registerSession(sessionId, sessionData)
      tracks.bind(name, sessionId)
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

export type {
  TrackData,
  TrackInput,
  TrackCallbacks,
  TrackType,
  NumberElement,
  EnumElement,
  FuncElementData,
  FuncElement
} from "./animationEditorWebSocketClient.ts"
