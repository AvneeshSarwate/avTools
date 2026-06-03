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
  type Session,
  getInspectorRegistry,
  getInspectorServer,
} from "@avtools/ui-bridge"
import {
  AnimationEditorWebSocketClient,
  type TrackData,
  type TrackInput,
  type TrackCallbacks,
  type ManagementIncomingMessage,
} from "./animationEditorWebSocketClient.ts"
import { WindowPanel, type GpuWindow } from "../window/mod.ts"
import { join } from "node:path"

// ============================================================================
// Type Definitions
// ============================================================================

export interface AnimationEditorHandle {
  readonly latestTracks: TrackData[] | undefined
  readonly client: AnimationEditorWebSocketClient | undefined
  disconnect(): void
  setLivePlayhead(position: number): void
  scrubToTime(time: number): void
  scrubAndEvaluate(time: number): void
  setCallbacks(callbacks: TrackCallbacks): void
}

export interface AnimationPlaybackState {
  playing: boolean
  currentTime: number
  duration: number
  loop: boolean
  speed: number
}

export interface AnimationEditorManagementOptions {
  readonly trackInputs: TrackInput[]
  readonly syncRef: { enabled: boolean }
  readonly playbackRef?: AnimationPlaybackState
  readonly snapshotCurrentState?: (animationName: string, time: number) => void
}

export interface AnimationEditorWindowOptions {
  readonly title?: string
  readonly panelWidth?: number
  readonly panelHeight?: number
}

interface AnimationExportPayload {
  readonly format: 'avtools-animation-timelines'
  readonly version: 1
  readonly exportedAt: string
  readonly currentAnimation: string
  readonly animations: ReadonlyArray<{
    readonly name: string
    readonly trackOrder: readonly string[]
    readonly tracks: readonly TrackData[]
  }>
}

interface AnimationSessionData {
  type: 'readonly' | 'bound'
  tracks?: TrackData[]
  trackOrder?: string[]
  trackMap?: TrackMap
  animationName?: string
  management?: AnimationEditorManagementOptions
  trackCallbacks?: TrackCallbacks
  nativeWindow?: { destroy: () => void }
}

type AnimationSession = Session<AnimationEditorWebSocketClient, AnimationSessionData>
type AnimationBridge = DenoNotebookBridge<AnimationEditorWebSocketClient, AnimationEditorHandle, AnimationSessionData>

function renderNativeWindowHtml(editorUrl: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Animation Editor</title>
  <style>
    html, body {
      width: 100%;
      height: 100%;
      margin: 0;
      background: #091018;
      color: #e8eef8;
      font-family: SFMono-Regular, ui-monospace, Menlo, Monaco, monospace;
    }
    body {
      display: grid;
      place-items: center;
    }
    .launching {
      opacity: 0.8;
      font-size: 12px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
  </style>
</head>
<body>
  <div class="launching">Launching Animation Editor…</div>
  <script>
    window.location.replace(${JSON.stringify(editorUrl)})
  </script>
</body>
</html>`
}

function attachNativePanelToWindow(
  panel: WindowPanel,
  gpuWindow: GpuWindow,
): () => void {
  const previousPollEvents = gpuWindow.pollEvents.bind(gpuWindow)
  const previousClose = gpuWindow.close.bind(gpuWindow)
  let detached = false

  const detach = () => {
    if (detached) return
    detached = true
    gpuWindow.pollEvents = previousPollEvents
    gpuWindow.close = previousClose
    panel.destroy()
  }

  gpuWindow.pollEvents = () => {
    const events = previousPollEvents()
    panel.pollMessages()
    return events
  }

  gpuWindow.close = () => {
    detach()
    previousClose()
  }

  return detach
}

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
      high: input.high ?? 1,
      enumOptions: input.enumOptions,
    })
  }

  return { tracks, trackOrder }
}

function createAnimationExportPayload(
  trackMap: TrackMap,
  currentAnimation: string | undefined,
): AnimationExportPayload {
  return {
    format: 'avtools-animation-timelines',
    version: 1,
    exportedAt: new Date().toISOString(),
    currentAnimation: currentAnimation ?? '',
    animations: Array.from(trackMap.keys()).map((name) => {
      const animation = trackMap.getFull(name)
      return {
        name,
        trackOrder: [...(animation?.trackOrder ?? [])],
        tracks: JSON.parse(JSON.stringify(animation?.tracks ?? [])) as TrackData[],
      }
    }),
  }
}

async function exportTrackMapToTimestampedFile(
  trackMap: TrackMap,
  currentAnimation: string | undefined,
): Promise<string> {
  const payload = createAnimationExportPayload(trackMap, currentAnimation)
  const timestamp = payload.exportedAt.replace(/[:.]/g, '-')
  const exportDir = join(Deno.cwd(), 'animation-editor-exports')
  const exportPath = join(exportDir, `animation-timelines-${timestamp}.json`)
  await Deno.mkdir(exportDir, { recursive: true })
  await Deno.writeTextFile(exportPath, `${JSON.stringify(payload, null, 2)}\n`)
  return exportPath
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

  delete(name: string, options?: { disconnectBoundSessions?: boolean }): boolean {
    const disconnectBoundSessions = options?.disconnectBoundSessions ?? true
    const sessions = this.bindings.get(name)
    if (disconnectBoundSessions && sessions && this.bridge) {
      for (const sessionId of sessions) {
        const session = this.bridge.getSession(sessionId)
        session?.client?.disconnect()
        this.bridge.removeSession(sessionId)
      }
    }
    this.bindings.delete(name)
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
  const getAnimationNames = (trackMap: TrackMap): string[] => Array.from(trackMap.keys())
  const DEFAULT_PLAYBACK_DURATION = 1
  const SCRUB_STEPS = 1200

  const clampPlaybackTime = (playback: AnimationPlaybackState): number => {
    const duration = Number.isFinite(playback.duration) ? Math.max(0, playback.duration) : 0
    const currentTime = Number.isFinite(playback.currentTime) ? playback.currentTime : 0
    const clampedTime = Math.min(Math.max(currentTime, 0), duration)
    playback.duration = duration
    playback.currentTime = clampedTime
    return clampedTime
  }

  const makeUniqueAnimationName = (trackMap: TrackMap, requestedName: string): string | null => {
    const baseName = requestedName.trim()
    if (!baseName) return null
    if (!trackMap.has(baseName)) return baseName

    let suffix = 2
    while (trackMap.has(`${baseName}-${suffix}`)) {
      suffix++
    }
    return `${baseName}-${suffix}`
  }

  const bindSessionToAnimation = (session: AnimationSession, animationName: string): void => {
    if (session.data.type !== 'bound') return

    const trackMap = session.data.trackMap!
    const previousName = session.data.animationName
    if (previousName && previousName !== animationName) {
      trackMap.unbind(previousName, session.id)
    }

    session.data.animationName = animationName
    trackMap.bind(animationName, session.id)

    const currentData = trackMap.getFull(animationName)
    if (currentData && session.client?.connected) {
      session.client.setTracks(currentData.tracks, currentData.trackOrder)
    }
  }

  const sendManagementState = (session: AnimationSession): void => {
    if (session.data.type !== 'bound' || !session.client?.connected) return

    const names = getAnimationNames(session.data.trackMap!)
    const current = session.data.animationName ?? names[0] ?? ''
    session.client.sendManagementMessage({ type: 'animationList', names, current })

    if (!session.data.management) return

    session.client.sendManagementMessage({
      type: 'syncState',
      enabled: session.data.management.syncRef.enabled,
    })
    sendPlaybackState(session)
  }

  const sendPlaybackState = (session: AnimationSession): void => {
    if (session.data.type !== 'bound' || !session.client?.connected) return

    const playback = session.data.management?.playbackRef
    if (!playback) return

    const currentTime = clampPlaybackTime(playback)
    session.client.sendManagementMessage({
      type: 'playbackState',
      playing: playback.playing,
      currentTime,
      duration: playback.duration,
      loop: playback.loop,
      speed: playback.speed,
    })
  }

  const broadcastManagementState = (
    trackMap: TrackMap,
    bridge: AnimationBridge,
  ): void => {
    for (const session of bridge.getSessions().values()) {
      if (session.data.type !== 'bound' || session.data.trackMap !== trackMap) continue
      sendManagementState(session)
    }
  }

  const broadcastPlaybackState = (
    trackMap: TrackMap,
    bridge: AnimationBridge,
  ): void => {
    for (const session of bridge.getSessions().values()) {
      if (session.data.type !== 'bound' || session.data.trackMap !== trackMap) continue
      sendPlaybackState(session)
    }
  }

  const broadcastPlaybackConfig = (
    trackMap: TrackMap,
    bridge: AnimationBridge,
  ): void => {
    for (const session of bridge.getSessions().values()) {
      if (session.data.type !== 'bound' || session.data.trackMap !== trackMap) continue

      const playback = session.data.management?.playbackRef
      if (!playback || !session.client?.connected) continue
      session.client.setConfig({ duration: playback.duration })
    }
  }

  const rebindSessionsAfterDelete = (
    deletedName: string,
    fallbackName: string,
    trackMap: TrackMap,
    bridge: AnimationBridge,
  ): void => {
    for (const session of bridge.getSessions().values()) {
      if (
        session.data.type !== 'bound' ||
        session.data.trackMap !== trackMap ||
        session.data.animationName !== deletedName
      ) {
        continue
      }

      bindSessionToAnimation(session, fallbackName)
    }
  }

  const handleManagementMessage = (
    message: ManagementIncomingMessage,
    session: AnimationSession,
    bridge: AnimationBridge,
  ): void => {
    if (session.data.type !== 'bound') return

    const trackMap = session.data.trackMap!
    const management = session.data.management
    if (!management) return

    switch (message.type) {
      case 'createAnimation': {
        const nextName = makeUniqueAnimationName(trackMap, message.name)
        if (!nextName) {
          sendManagementState(session)
          return
        }

        if (!trackMap.has(nextName)) {
          trackMap.setFromInputs(nextName, management.trackInputs)
        }

        bindSessionToAnimation(session, nextName)
        broadcastManagementState(trackMap, bridge)
        return
      }

      case 'switchAnimation': {
        if (!trackMap.has(message.name)) {
          sendManagementState(session)
          return
        }

        bindSessionToAnimation(session, message.name)
        sendManagementState(session)
        return
      }

      case 'deleteAnimation': {
        const targetName = message.name.trim() || session.data.animationName
        if (!targetName || !trackMap.has(targetName)) {
          sendManagementState(session)
          return
        }

        const remainingNames = getAnimationNames(trackMap).filter((name) => name !== targetName)
        if (remainingNames.length === 0) {
          sendManagementState(session)
          return
        }

        const fallbackName = remainingNames[0]
        rebindSessionsAfterDelete(targetName, fallbackName, trackMap, bridge)
        trackMap.delete(targetName, { disconnectBoundSessions: false })
        broadcastManagementState(trackMap, bridge)
        return
      }

      case 'snapshot': {
        const animationName = session.data.animationName
        if (!animationName || !management.snapshotCurrentState) return

        const snapshotTime = session.client?.state?.currentTime ?? 0
        management.snapshotCurrentState(animationName, snapshotTime)
        return
      }

      case 'exportAnimations':
        void exportTrackMapToTimestampedFile(trackMap, session.data.animationName)
          .then((path) => {
            console.info(`[animation-editor] Exported timelines to ${path}`)
            session.client?.sendManagementMessage({
              type: 'exportStatus',
              ok: true,
              path,
            })
          })
          .catch((error) => {
            const errorMessage = error instanceof Error ? error.message : String(error)
            console.error('[animation-editor] Failed to export timelines:', error)
            session.client?.sendManagementMessage({
              type: 'exportStatus',
              ok: false,
              error: errorMessage,
            })
          })
        return

      case 'toggleSync':
        management.syncRef.enabled = message.enabled
        broadcastManagementState(trackMap, bridge)
        return

      case 'setPlaying': {
        const playback = management.playbackRef
        if (!playback) {
          sendManagementState(session)
          return
        }

        if (message.playing) {
          if (clampPlaybackTime(playback) >= playback.duration) {
            playback.currentTime = 0
          }
        } else {
          playback.playing = false
          clampPlaybackTime(playback)
          broadcastPlaybackState(trackMap, bridge)
          return
        }
        playback.playing = message.playing
        broadcastPlaybackState(trackMap, bridge)
        return
      }

      case 'setCurrentTime': {
        const playback = management.playbackRef
        if (!playback) {
          sendManagementState(session)
          return
        }

        playback.currentTime = message.time
        clampPlaybackTime(playback)
        broadcastPlaybackState(trackMap, bridge)
        return
      }

      case 'setDuration': {
        const playback = management.playbackRef
        if (!playback) {
          sendManagementState(session)
          return
        }

        playback.duration = message.duration
        clampPlaybackTime(playback)
        if (playback.currentTime >= playback.duration) {
          playback.playing = false
        }
        broadcastPlaybackConfig(trackMap, bridge)
        broadcastPlaybackState(trackMap, bridge)
        return
      }

      case 'setLoop': {
        const playback = management.playbackRef
        if (!playback) {
          sendManagementState(session)
          return
        }

        playback.loop = message.loop
        broadcastPlaybackState(trackMap, bridge)
        return
      }

      case 'setSpeed': {
        const playback = management.playbackRef
        if (!playback) {
          sendManagementState(session)
          return
        }

        playback.speed = Number.isFinite(message.speed) ? Math.max(0, message.speed) : 1
        broadcastPlaybackState(trackMap, bridge)
        return
      }
    }
  }

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
      const showManagement = sessionData.type === 'bound' && !!sessionData.management
      const wsUrlLiteral = JSON.stringify(wsUrl)
      const sessionIdLiteral = JSON.stringify(sessionId)
      const initialAnimationName = JSON.stringify(name ?? '')
      const managementVisibleLiteral = showManagement ? 'true' : 'false'

      return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Animation Editor</title>
  <style>
    :root {
      color-scheme: dark;
      --panel-fg: #e8eef8;
      --panel-border: rgba(148, 170, 196, 0.24);
      --panel-surface: rgba(14, 20, 29, 0.82);
      --panel-surface-strong: rgba(9, 14, 22, 0.95);
      --panel-accent: #8fc3ff;
      --panel-accent-strong: #dcedff;
      --panel-muted: rgba(226, 235, 246, 0.72);
      --tp-input-background-color: rgba(10, 16, 24, 0.78);
      --tp-input-background-color-active: rgba(26, 36, 50, 0.96);
      --tp-input-background-color-hover: rgba(16, 24, 35, 0.88);
      --tp-input-foreground-color: #eff6ff;
      --tp-button-background-color: #dce4ef;
      --tp-button-background-color-active: #c1cbda;
      --tp-button-background-color-hover: #edf3fb;
      --tp-button-foreground-color: #101722;
      --tp-container-background-color: rgba(148, 170, 196, 0.18);
      --tp-container-background-color-hover: rgba(148, 170, 196, 0.24);
      --tp-container-foreground-color: #e2ebf6;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      padding: 8px;
      color: var(--panel-fg);
      background:
        radial-gradient(circle at top, rgba(103, 148, 208, 0.2), transparent 36%),
        linear-gradient(180deg, #0f1621 0%, #091018 100%);
      font-family: SFMono-Regular, ui-monospace, Menlo, Monaco, monospace;
    }
    .shell {
      display: flex;
      flex-direction: column;
      gap: 10px;
      width: 100%;
      min-height: calc(100vh - 16px);
      min-width: 0;
      overflow: hidden;
    }
    .toolbar {
      display: flex;
      flex-direction: column;
      gap: 8px;
      border: 1px solid var(--panel-border);
      border-radius: 14px;
      background: linear-gradient(180deg, var(--panel-surface), var(--panel-surface-strong));
      padding: 12px;
    }
    .toolbar[hidden] {
      display: none;
    }
    .toolbar-row {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .toolbar-field {
      min-width: 0;
      flex: 1 1 240px;
    }
    .toolbar-field-compact {
      flex: 0 0 140px;
    }
    .toolbar-label {
      display: block;
      margin-bottom: 6px;
      color: var(--panel-accent-strong);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .toolbar-input,
    .toolbar-button,
    .toolbar-range,
    .toolbar-toggle {
      font: inherit;
      font-size: 12px;
    }
    .toolbar-input {
      width: 100%;
      appearance: none;
      border: 1px solid var(--panel-border);
      border-radius: 10px;
      background: var(--tp-input-background-color);
      color: var(--tp-input-foreground-color);
      outline: none;
      padding: 9px 10px;
    }
    .toolbar-input:focus {
      border-color: rgba(143, 195, 255, 0.6);
      background: var(--tp-input-background-color-active);
    }
    .toolbar-scrub {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
    }
    .toolbar-range {
      flex: 1 1 auto;
      margin: 0;
      accent-color: var(--panel-accent);
    }
    .toolbar-time {
      min-width: 108px;
      color: var(--panel-accent-strong);
      font-size: 11px;
      text-align: right;
      white-space: nowrap;
    }
    .toolbar-button {
      appearance: none;
      border: 1px solid rgba(9, 15, 24, 0.12);
      border-radius: 999px;
      background: linear-gradient(180deg, var(--tp-button-background-color), #c9d4e1);
      color: var(--tp-button-foreground-color);
      cursor: pointer;
      font-weight: 600;
      padding: 9px 14px;
      white-space: nowrap;
    }
    .toolbar-row-playback .toolbar-button {
      align-self: flex-end;
      padding: 6px 10px;
    }
    .toolbar-button:hover {
      background: linear-gradient(180deg, var(--tp-button-background-color-hover), #d8e1ec);
    }
    .toolbar-button:active {
      background: linear-gradient(180deg, var(--tp-button-background-color-active), #b6c2d1);
    }
    .toolbar-button[disabled] {
      cursor: default;
      opacity: 0.55;
    }
    .toolbar-toggle {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 9px 12px;
      border: 1px solid var(--panel-border);
      border-radius: 999px;
      background: var(--tp-container-background-color);
      color: var(--tp-container-foreground-color);
      cursor: pointer;
      user-select: none;
    }
    .toolbar-row-playback .toolbar-toggle {
      align-self: flex-end;
      gap: 6px;
      padding: 6px 10px;
    }
    .toolbar-toggle:hover {
      background: var(--tp-container-background-color-hover);
    }
    .toolbar-toggle input {
      margin: 0;
    }
    .custom-select {
      position: relative;
      width: 100%;
    }
    .custom-select-trigger {
      position: relative;
      width: 100%;
      appearance: none;
      border: 1px solid var(--panel-border);
      border-radius: 10px;
      background: var(--tp-input-background-color);
      color: var(--tp-input-foreground-color);
      cursor: pointer;
      padding: 9px 34px 9px 10px;
      text-align: left;
    }
    .custom-select-trigger::after {
      content: '\\25BE';
      position: absolute;
      right: 12px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--panel-muted);
      font-size: 10px;
    }
    .custom-select-menu {
      position: absolute;
      z-index: 20;
      top: calc(100% + 6px);
      left: 0;
      right: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 6px;
      border: 1px solid var(--panel-border);
      border-radius: 12px;
      background: var(--panel-surface-strong);
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.32);
    }
    .custom-select-menu[hidden] {
      display: none;
    }
    .custom-select-option {
      appearance: none;
      width: 100%;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: var(--panel-fg);
      cursor: pointer;
      font: inherit;
      font-size: 12px;
      padding: 8px 10px;
      text-align: left;
    }
    .custom-select-option:hover,
    .custom-select-option[data-selected='true'] {
      background: rgba(143, 195, 255, 0.16);
      color: var(--panel-accent-strong);
    }
    .toolbar-row-playback .toolbar-input {
      padding: 7px 8px;
    }
    #root {
      flex: 1 1 auto;
      width: 100%;
      min-height: 0;
      min-width: 0;
      display: flex;
      align-items: stretch;
      justify-content: flex-start;
      overflow: hidden;
    }
    animation-editor-component {
      display: block;
      flex: 1 1 auto;
      width: 100%;
      max-width: 100%;
      min-height: 0;
      min-width: 0;
      overflow: hidden;
    }
    @media (max-width: 640px) {
      body {
        padding: 6px;
      }
      .toolbar {
        padding: 10px;
      }
      .toolbar-row {
        align-items: stretch;
      }
      .toolbar-field {
        flex-basis: 100%;
      }
      .toolbar-button {
        flex: 1 1 auto;
        justify-content: center;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <div class="toolbar" id="toolbar" ${showManagement ? '' : 'hidden'}>
      <div class="toolbar-row">
        <div class="toolbar-field">
          <label class="toolbar-label">Animation</label>
          <div class="custom-select" id="animation-select">
            <button type="button" class="custom-select-trigger" id="animation-trigger">${name ?? ''}</button>
            <div class="custom-select-menu" id="animation-menu" hidden></div>
          </div>
        </div>
        <label class="toolbar-toggle">
          <input type="checkbox" id="sync-toggle" />
          <span>Sync to Tweakpane</span>
        </label>
      </div>
      <div class="toolbar-row">
        <div class="toolbar-field">
          <label class="toolbar-label" for="new-animation-name">New Animation</label>
          <input class="toolbar-input" id="new-animation-name" type="text" placeholder="intro" />
        </div>
        <button type="button" class="toolbar-button" id="new-animation-btn">New</button>
        <button type="button" class="toolbar-button" id="snapshot-btn">Snapshot</button>
        <button type="button" class="toolbar-button" id="export-btn">Export</button>
        <button type="button" class="toolbar-button" id="delete-btn">Delete</button>
      </div>
      <div class="toolbar-row toolbar-row-playback">
        <button type="button" class="toolbar-button" id="play-toggle-btn">Play</button>
        <div class="toolbar-field">
          <label class="toolbar-label" for="scrub-slider">Playhead</label>
          <div class="toolbar-scrub">
            <input
              class="toolbar-range"
              id="scrub-slider"
              type="range"
              min="0"
              max="1"
              step="${String(1 / SCRUB_STEPS)}"
              value="0"
            />
            <div class="toolbar-time" id="scrub-readout">0.000 / 1.000</div>
          </div>
        </div>
        <div class="toolbar-field toolbar-field-compact">
          <label class="toolbar-label" for="duration-input">Duration</label>
          <input
            class="toolbar-input"
            id="duration-input"
            type="number"
            min="0.001"
            step="0.001"
            value="${String(DEFAULT_PLAYBACK_DURATION)}"
          />
        </div>
        <div class="toolbar-field toolbar-field-compact">
          <label class="toolbar-label" for="speed-input">Speed</label>
          <input
            class="toolbar-input"
            id="speed-input"
            type="number"
            min="0"
            step="0.01"
            value="1"
          />
        </div>
        <label class="toolbar-toggle">
          <input type="checkbox" id="loop-toggle" />
          <span>Loop</span>
        </label>
      </div>
    </div>
    <div id="root"></div>
  </div>
  <script type="module">
    const wsUrl = ${wsUrlLiteral}
    const sessionId = ${sessionIdLiteral}
    const initialAnimationName = ${initialAnimationName}
    const showManagement = ${managementVisibleLiteral}
    const originalWebSocket = window.WebSocket
    const managementSocketRef = { current: null }
    const managementState = {
      names: initialAnimationName ? [initialAnimationName] : [],
      current: initialAnimationName,
      syncEnabled: true,
      export: {
        pending: false,
        lastOk: null,
        lastPath: '',
        lastError: '',
      },
      playback: {
        playing: false,
        currentTime: 0,
        duration: ${String(DEFAULT_PLAYBACK_DURATION)},
        loop: false,
        speed: 1,
      },
    }
    let exportStatusResetTimer = null

    const parseManagementMessage = (data) => {
      try {
        const message = JSON.parse(data)
        if (
          message?.type === 'animationList' ||
          message?.type === 'syncState' ||
          message?.type === 'playbackState' ||
          message?.type === 'exportStatus'
        ) {
          return message
        }
      } catch {
        return null
      }
      return null
    }

    const updateUiFromManagementState = () => {
      if (!showManagement) return

      if (
        !animationTrigger ||
        !animationMenu ||
        !exportButton ||
        !syncToggle ||
        !deleteButton ||
        !playToggleButton ||
        !scrubSlider ||
        !scrubReadout ||
        !durationInput ||
        !speedInput ||
        !loopToggle
      ) {
        return
      }

      animationTrigger.textContent = managementState.current || '(select animation)'
      animationMenu.replaceChildren(
        ...managementState.names.map((name) => {
          const option = document.createElement('button')
          option.type = 'button'
          option.className = 'custom-select-option'
          option.dataset.selected = String(name === managementState.current)
          option.textContent = name
          option.addEventListener('click', () => {
            animationMenu.hidden = true
            sendManagementMessage({ type: 'switchAnimation', name })
          })
          return option
        }),
      )

      syncToggle.checked = managementState.syncEnabled
      deleteButton.disabled = managementState.names.length <= 1
      exportButton.disabled = !!managementState.export.pending
      exportButton.textContent = managementState.export.pending
        ? 'Exporting...'
        : managementState.export.lastOk === true
          ? 'Exported'
          : managementState.export.lastOk === false
            ? 'Export Failed'
            : 'Export'
      exportButton.title = managementState.export.lastOk === true
        ? managementState.export.lastPath
        : managementState.export.lastOk === false
          ? managementState.export.lastError
          : 'Write all saved timelines to a timestamped JSON file on the Deno side'

      const duration = Math.max(0, Number.isFinite(managementState.playback.duration) ? managementState.playback.duration : 0)
      const currentTime = Math.min(
        Math.max(0, Number.isFinite(managementState.playback.currentTime) ? managementState.playback.currentTime : 0),
        duration,
      )
      const sliderMax = Math.max(duration, ${String(DEFAULT_PLAYBACK_DURATION)})
      const sliderStep = Math.max(sliderMax / ${String(SCRUB_STEPS)}, Number.EPSILON)
      scrubSlider.max = String(sliderMax)
      scrubSlider.step = String(sliderStep)
      scrubSlider.value = String(currentTime)
      durationInput.value = String(duration)
      speedInput.value = String(Number.isFinite(managementState.playback.speed) ? managementState.playback.speed : 1)
      loopToggle.checked = !!managementState.playback.loop
      playToggleButton.textContent = managementState.playback.playing ? 'Stop' : 'Play'
      scrubReadout.textContent = currentTime.toFixed(3) + ' / ' + duration.toFixed(3)
    }

    const handleManagementMessage = (message) => {
      if (message.type === 'animationList') {
        managementState.names = message.names
        managementState.current = message.current
      } else if (message.type === 'syncState') {
        managementState.syncEnabled = !!message.enabled
      } else if (message.type === 'exportStatus') {
        managementState.export.pending = false
        managementState.export.lastOk = !!message.ok
        managementState.export.lastPath = typeof message.path === 'string' ? message.path : ''
        managementState.export.lastError = typeof message.error === 'string' ? message.error : ''
        if (exportStatusResetTimer) {
          clearTimeout(exportStatusResetTimer)
        }
        exportStatusResetTimer = setTimeout(() => {
          managementState.export.lastOk = null
          managementState.export.lastPath = ''
          managementState.export.lastError = ''
          exportStatusResetTimer = null
          updateUiFromManagementState()
        }, 2500)
        if (message.ok && message.path) {
          console.info('[Animation Editor] Exported timelines to', message.path)
        } else if (!message.ok) {
          console.error('[Animation Editor] Export failed:', message.error || 'Unknown error')
        }
      } else if (message.type === 'playbackState') {
        managementState.playback.playing = !!message.playing
        managementState.playback.currentTime = Number(message.currentTime) || 0
        managementState.playback.duration = Number(message.duration) || 0
        managementState.playback.loop = !!message.loop
        managementState.playback.speed = Number.isFinite(message.speed) ? message.speed : 1
      }

      updateUiFromManagementState()
    }

    class ManagedAnimationEditorSocket extends originalWebSocket {
      #onmessageHandler = null
      #interceptsManagement = false

      constructor(url, protocols) {
        super(url, protocols)
        this.#interceptsManagement = String(url) === wsUrl

        if (this.#interceptsManagement) {
          managementSocketRef.current = this
          super.addEventListener('close', () => {
            if (managementSocketRef.current === this) {
              managementSocketRef.current = null
            }
          })
        }

        super.addEventListener('message', (event) => {
          if (this.#interceptsManagement) {
            const managementMessage = parseManagementMessage(event.data)
            if (managementMessage) {
              handleManagementMessage(managementMessage)
              return
            }
          }

          this.#onmessageHandler?.call(this, event)
        })
      }

      set onmessage(handler) {
        this.#onmessageHandler = handler
      }

      get onmessage() {
        return this.#onmessageHandler
      }
    }

    window.WebSocket = ManagedAnimationEditorSocket

    const sendManagementMessage = (message) => {
      const socket = managementSocketRef.current
      if (!socket || socket.readyState !== originalWebSocket.OPEN) return false
      socket.send(JSON.stringify(message))
      return true
    }

    await import('/static/animation-editor.js')
    await customElements.whenDefined('animation-editor-component')

    const rootEl = document.getElementById('root')
    const animationTrigger = document.getElementById('animation-trigger')
    const animationMenu = document.getElementById('animation-menu')
    const newAnimationInput = document.getElementById('new-animation-name')
    const newAnimationButton = document.getElementById('new-animation-btn')
    const snapshotButton = document.getElementById('snapshot-btn')
    const exportButton = document.getElementById('export-btn')
    const deleteButton = document.getElementById('delete-btn')
    const syncToggle = document.getElementById('sync-toggle')
    const playToggleButton = document.getElementById('play-toggle-btn')
    const scrubSlider = document.getElementById('scrub-slider')
    const scrubReadout = document.getElementById('scrub-readout')
    const durationInput = document.getElementById('duration-input')
    const speedInput = document.getElementById('speed-input')
    const loopToggle = document.getElementById('loop-toggle')
    const editor = document.createElement('animation-editor-component')

    editor.setAttribute('ws-address', wsUrl)
    editor.setAttribute('interactive', '${interactive}')

    rootEl.appendChild(editor)
    updateUiFromManagementState()

    if (showManagement) {
      animationTrigger?.addEventListener('click', () => {
        if (!animationMenu) return
        animationMenu.hidden = !animationMenu.hidden
      })

      document.addEventListener('click', (event) => {
        if (animationMenu && !animationMenu.hidden && !document.getElementById('animation-select')?.contains(event.target)) {
          animationMenu.hidden = true
        }
      })

      const createAnimation = () => {
        const name = newAnimationInput.value.trim()
        if (!name) return
        if (sendManagementMessage({ type: 'createAnimation', name })) {
          newAnimationInput.value = ''
        }
      }

      newAnimationButton?.addEventListener('click', createAnimation)
      newAnimationInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          createAnimation()
        }
      })

      snapshotButton?.addEventListener('click', () => {
        sendManagementMessage({ type: 'snapshot' })
      })

      exportButton?.addEventListener('click', () => {
        if (sendManagementMessage({ type: 'exportAnimations' })) {
          managementState.export.pending = true
          managementState.export.lastOk = null
          managementState.export.lastPath = ''
          managementState.export.lastError = ''
          updateUiFromManagementState()
        }
      })

      deleteButton?.addEventListener('click', () => {
        if (managementState.current) {
          sendManagementMessage({ type: 'deleteAnimation', name: managementState.current })
        }
      })

      syncToggle?.addEventListener('change', () => {
        sendManagementMessage({ type: 'toggleSync', enabled: syncToggle.checked })
      })

      playToggleButton?.addEventListener('click', () => {
        sendManagementMessage({ type: 'setPlaying', playing: !managementState.playback.playing })
      })

      scrubSlider?.addEventListener('input', () => {
        const time = Number(scrubSlider.value)
        sendManagementMessage({ type: 'setCurrentTime', time })
      })

      durationInput?.addEventListener('change', () => {
        const duration = Number(durationInput.value)
        if (!Number.isFinite(duration) || duration <= 0) {
          durationInput.value = String(managementState.playback.duration)
          return
        }
        sendManagementMessage({ type: 'setDuration', duration })
      })

      speedInput?.addEventListener('change', () => {
        const speed = Number(speedInput.value)
        if (!Number.isFinite(speed) || speed < 0) {
          speedInput.value = String(managementState.playback.speed)
          return
        }
        sendManagementMessage({ type: 'setSpeed', speed })
      })

      loopToggle?.addEventListener('change', () => {
        sendManagementMessage({ type: 'setLoop', loop: loopToggle.checked })
      })
    }

    console.log('[Animation Editor] Mounted', { sessionId, wsUrl })
  </script>
</body>
</html>`
    },

    getConfig(session: AnimationSession): Record<string, unknown> {
      return {
        interactive: session.data.type === 'bound',
        name: session.data.type === 'bound' ? session.data.animationName : undefined,
        duration: session.data.management?.playbackRef?.duration ?? DEFAULT_PLAYBACK_DURATION,
      }
    },

    handleConnection(
      socket: WebSocket,
      session: AnimationSession,
      _bridge: AnimationBridge
    ): AnimationEditorWebSocketClient {
      const client = new AnimationEditorWebSocketClient(socket)
      if (session.data.trackCallbacks) {
        client.setTrackCallbacks(session.data.trackCallbacks)
      }

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

        const playback = session.data.management?.playbackRef
        client.setConfig({
          interactive: session.data.type === 'bound',
          duration: playback?.duration,
        })
        if (playback) {
          const currentTime = clampPlaybackTime(playback)
          client.scrubToTime(currentTime)
          client.setLivePlayhead(currentTime)
        }
        sendManagementState(session)
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

      client.onManagementMessage = (message) => {
        handleManagementMessage(message, session, _bridge)
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
          session.data.nativeWindow?.destroy()
          session.data.nativeWindow = undefined
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
          const playback = session.data.management?.playbackRef
          if (playback) {
            playback.currentTime = time
            clampPlaybackTime(playback)
            sendPlaybackState(session)
          }
          session.client?.scrubToTime(time)
        },

        scrubAndEvaluate(time: number): void {
          const playback = session.data.management?.playbackRef
          if (playback) {
            playback.currentTime = time
            clampPlaybackTime(playback)
            sendPlaybackState(session)
          }
          session.client?.scrubAndEvaluate(time)
        },

        setCallbacks(callbacks: TrackCallbacks): void {
          session.data.trackCallbacks = callbacks
          session.client?.setTrackCallbacks(callbacks)
        }
      }
    },

    onSessionCleanup(session: AnimationSession): void {
      session.data.nativeWindow?.destroy()
      session.data.nativeWindow = undefined
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
  showBoundInWindow(gpuWindow: GpuWindow, name: string, options?: AnimationEditorWindowOptions): AnimationEditorHandle
  shutdown(): void
}

export interface AnimationEditorBridgeOptions {
  readonly management?: AnimationEditorManagementOptions
}

export function createAnimationEditorBridge(options?: AnimationEditorBridgeOptions): AnimationEditorBridgeAPI {
  const adapter = createAnimationEditorAdapter()
  const bridge = new DenoNotebookBridge(adapter)
  const tracks = new TrackMap()
  tracks._setBridge(bridge)

  // Helper to register with inspector (idempotent)
  const registerInspectorEntry = (name: string) => {
    const registry = getInspectorRegistry()
    const server = getInspectorServer()
    const baseUrl = bridge.getBaseUrl()

    registry.register({
      name,
      componentType: 'animation-editor',
      bridgeBaseUrl: baseUrl,
      registeredAt: Date.now(),
    })

    server.registerSessionFactory(name, {
      createSession: () => {
        const sessionId = bridge.generateSessionId()
        const sessionData: AnimationSessionData = {
          type: 'bound',
          trackMap: tracks,
          animationName: name,
          management: options?.management,
        }
        bridge.registerSession(sessionId, sessionData)
        tracks.bind(name, sessionId)
        const addr = new URL(baseUrl)
        const wsUrl = `ws://127.0.0.1:${addr.port}/ws?id=${sessionId}`
        return { sessionId, wsUrl }
      },
      destroySession: (sessionId: string) => {
        tracks.unbind(name, sessionId)
        bridge.removeSession(sessionId)
      },
    })
  }

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
        animationName: name,
        management: options?.management,
      }

      bridge.registerSession(sessionId, sessionData)
      tracks.bind(name, sessionId)
      bridge.displayIframe(sessionId)

      // Register with inspector
      registerInspectorEntry(name)

      const session = bridge.getSession(sessionId)!
      return adapter.createHandle(session, bridge)
    },

    showBoundInWindow(gpuWindow: GpuWindow, name: string, windowOptions?: AnimationEditorWindowOptions): AnimationEditorHandle {
      const sessionId = bridge.generateSessionId()
      const sessionData: AnimationSessionData = {
        type: 'bound',
        trackMap: tracks,
        animationName: name,
        management: options?.management,
      }

      bridge.registerSession(sessionId, sessionData)
      tracks.bind(name, sessionId)

      const editorUrl = bridge.buildEditorUrl(sessionId, 'loopback')
      if (!editorUrl) {
        throw new Error(`Could not build animation editor URL for session ${sessionId}`)
      }

      const panel = new WindowPanel({
        lib: gpuWindow._lib,
        parentState: gpuWindow._state,
        options: {
          panelWidth: windowOptions?.panelWidth ?? 1100,
          panelHeight: windowOptions?.panelHeight ?? 760,
          title: windowOptions?.title ?? 'Animation Editor',
          toggleKey: '__animation_editor_unused_toggle__',
        },
      })
      panel.init(renderNativeWindowHtml(editorUrl))

      const session = bridge.getSession(sessionId)!
      session.data.nativeWindow = {
        destroy: attachNativePanelToWindow(panel, gpuWindow),
      }

      registerInspectorEntry(name)

      return adapter.createHandle(session, bridge)
    },

    shutdown(): void {
      // Unregister all entries from inspector
      const registry = getInspectorRegistry()
      const server = getInspectorServer()
      for (const name of tracks.keys()) {
        registry.unregister(name)
        server.unregisterSessionFactory(name)
      }
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
