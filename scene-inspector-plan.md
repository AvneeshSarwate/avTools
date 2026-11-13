# Scene Inspector -- Implementation Plan

## Overview

The Scene Inspector is a persistent browser window that displays all registered UI objects (piano rolls, animation editors, tweakpane panels) from Deno notebooks in a single unified interface. It works like Unity's Hierarchy/Inspector panel: a sidebar lists all registered objects by name and type, and selecting one displays the corresponding component in a detail panel on the right.

**Key design constraints:**
- Additive: existing notebook iframes continue to work unchanged
- No `<KeepAlive>`: mount/unmount cycle with replay-on-reconnect is the right pattern
- The inspector is a standalone browser page (not a route in the main SPA)
- One inspector server per kernel, hosting all component types

---

## Architecture Diagram

```
Deno Kernel                           Browser
============                          =======

 PianoRollBridge (port A)
   sessions: {s1, s2, ...}       <--- notebook iframes connect here
                                  <--- inspector detail panel also connects here
 AnimationEditorBridge (port B)
   sessions: {s3, s4, ...}       <--- notebook iframes connect here
                                  <--- inspector detail panel also connects here
 TweakpaneServer.bridge (port C)
   sessions: {s5, s6, ...}       <--- notebook iframes connect here
                                  <--- inspector detail panel also connects here

 InspectorServer (port D) ---------> Inspector Vue app
   - Serves built Vue app              - Sidebar: lists all entries
   - /api/registry -> JSON              - Detail: mounts component
   - /ws/registry -> live updates       - WS connects to port A/B/C
   - /ws/proxy/:name -> proxy WS        directly for component data
```

---

## Part 1: Kernel Side (Deno)

### 1.1 InspectorRegistry

**File:** `packages/ui-bridge/inspector_registry.ts` (new)

This is a singleton registry that tracks all registered UI objects across all adapters. Each adapter (piano roll, animation editor, tweakpane) registers entries when bound objects are created, and removes them when destroyed.

```typescript
// === Type Definitions ===

export type ComponentType = 'piano-roll' | 'animation-editor' | 'tweakpane'

export interface RegistryEntry {
  /** Unique name for this entry (e.g. "melody", "My Controls") */
  name: string
  /** Which component type */
  componentType: ComponentType
  /**
   * The WebSocket URL that the inspector detail component should connect to.
   * This is the same WS URL that notebook iframes use, but with a new session ID
   * that the inspector will create on-demand.
   */
  bridgeBaseUrl: string
  /** Timestamp when this entry was registered */
  registeredAt: number
}

// === Registry Messages (sent over inspector WebSocket) ===

export type RegistryMessage =
  | { type: 'registrySnapshot'; entries: RegistryEntry[] }
  | { type: 'entryAdded'; entry: RegistryEntry }
  | { type: 'entryRemoved'; name: string }
  | { type: 'entryUpdated'; entry: RegistryEntry }

// === InspectorRegistry Class ===

export class InspectorRegistry {
  private entries = new Map<string, RegistryEntry>()
  private listeners = new Set<(msg: RegistryMessage) => void>()

  register(entry: RegistryEntry): void {
    const existing = this.entries.has(entry.name)
    this.entries.set(entry.name, entry)
    this.broadcast(existing
      ? { type: 'entryUpdated', entry }
      : { type: 'entryAdded', entry }
    )
  }

  unregister(name: string): void {
    if (this.entries.delete(name)) {
      this.broadcast({ type: 'entryRemoved', name })
    }
  }

  getAll(): RegistryEntry[] {
    return Array.from(this.entries.values())
  }

  get(name: string): RegistryEntry | undefined {
    return this.entries.get(name)
  }

  has(name: string): boolean {
    return this.entries.has(name)
  }

  /** Subscribe to registry changes. Returns unsubscribe function. */
  subscribe(listener: (msg: RegistryMessage) => void): () => void {
    this.listeners.add(listener)
    // Send initial snapshot
    listener({ type: 'registrySnapshot', entries: this.getAll() })
    return () => this.listeners.delete(listener)
  }

  private broadcast(msg: RegistryMessage): void {
    for (const listener of this.listeners) {
      try { listener(msg) } catch (e) {
        console.error('[InspectorRegistry] Listener error:', e)
      }
    }
  }

  clear(): void {
    const names = [...this.entries.keys()]
    this.entries.clear()
    for (const name of names) {
      this.broadcast({ type: 'entryRemoved', name })
    }
  }
}

// === Singleton ===

const GLOBAL_KEY = '__inspectorRegistry__'

export function getInspectorRegistry(): InspectorRegistry {
  const g = globalThis as Record<string, unknown>
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new InspectorRegistry()
  }
  return g[GLOBAL_KEY] as InspectorRegistry
}
```

**Rationale:** Using a global singleton (same pattern as `DenoNotebookBridge`) ensures that all adapters share the same registry, even if the module is imported multiple times. The `subscribe` pattern with immediate snapshot ensures new WebSocket connections get current state.

### 1.2 InspectorServer

**File:** `packages/ui-bridge/inspector_server.ts` (new)

The InspectorServer is an HTTP/WebSocket server that:
1. Serves the built Vue inspector app (static files)
2. Provides a WebSocket endpoint for registry updates
3. Provides a WebSocket proxy endpoint for connecting inspector detail panels to component bridges
4. Provides an HTTP endpoint to create inspector sessions on component bridges

```typescript
import { InspectorRegistry, getInspectorRegistry, type RegistryMessage, type RegistryEntry } from './inspector_registry.ts'

// === Type Definitions ===

export interface InspectorServerOptions {
  /** Port to listen on (0 = auto-assign) */
  port?: number
  /** Path to the built Vue inspector app directory */
  staticDir?: string
  /** Whether to auto-open the browser */
  openBrowser?: boolean
}

/** Message from inspector browser to create a session for viewing a component */
interface CreateSessionRequest {
  type: 'createSession'
  name: string   // registry entry name
  requestId: string
}

/** Response with the WS URL to connect to for the component */
interface CreateSessionResponse {
  type: 'sessionCreated'
  name: string
  wsUrl: string       // full ws:// URL with session ID
  sessionId: string
  requestId: string
}

/** Message to destroy a session */
interface DestroySessionRequest {
  type: 'destroySession'
  name: string
  sessionId: string
}

type InspectorClientMessage = CreateSessionRequest | DestroySessionRequest
type InspectorServerMessage = RegistryMessage | CreateSessionResponse

// === InspectorServer Class ===

const GLOBAL_KEY = '__inspectorServer__'

export class InspectorServer {
  private server: Deno.HttpServer | null = null
  private registry: InspectorRegistry
  private registryClients = new Set<WebSocket>()
  private baseUrl = ''
  private unsubscribe: (() => void) | null = null

  // Map of entry name -> session creation function
  // Each adapter registers a factory that creates sessions on its bridge
  private sessionFactories = new Map<string, {
    createSession: () => { sessionId: string; wsUrl: string }
    destroySession: (sessionId: string) => void
  }>()

  constructor(private options: InspectorServerOptions = {}) {
    this.registry = getInspectorRegistry()
  }

  /** Register a session factory for a named entry.
   *  Called by adapters when they register with the inspector. */
  registerSessionFactory(name: string, factory: {
    createSession: () => { sessionId: string; wsUrl: string }
    destroySession: (sessionId: string) => void
  }): void {
    this.sessionFactories.set(name, factory)
  }

  unregisterSessionFactory(name: string): void {
    this.sessionFactories.delete(name)
  }

  async start(): Promise<string> {
    if (this.server) return this.baseUrl

    const staticDir = this.options.staticDir

    this.server = Deno.serve(
      { port: this.options.port ?? 0, onListen: ({ port }) => {
        this.baseUrl = `http://127.0.0.1:${port}`
        console.log(`[Inspector] Server running at ${this.baseUrl}`)
      }},
      async (req) => {
        const url = new URL(req.url)

        // WebSocket: registry updates
        if (url.pathname === '/ws/registry' && req.headers.get('upgrade') === 'websocket') {
          return this.handleRegistryWs(req)
        }

        // REST: get registry snapshot
        if (url.pathname === '/api/registry') {
          return new Response(JSON.stringify(this.registry.getAll()), {
            headers: { 'Content-Type': 'application/json' }
          })
        }

        // Static files for inspector app
        if (staticDir) {
          return await this.serveStatic(url.pathname, staticDir)
        }

        return new Response('Not found', { status: 404 })
      }
    )

    // Subscribe to registry changes and broadcast to all WS clients
    this.unsubscribe = this.registry.subscribe((msg) => {
      this.broadcastRegistryMessage(msg)
    })

    if (this.options.openBrowser) {
      this.openInBrowser()
    }

    return this.baseUrl
  }

  private handleRegistryWs(req: Request): Response {
    const { socket, response } = Deno.upgradeWebSocket(req)

    socket.onopen = () => {
      this.registryClients.add(socket)
      // Send current snapshot
      const snapshot: RegistryMessage = {
        type: 'registrySnapshot',
        entries: this.registry.getAll()
      }
      socket.send(JSON.stringify(snapshot))
    }

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as InspectorClientMessage
        this.handleClientMessage(socket, msg)
      } catch (e) {
        console.warn('[Inspector] Error handling client message:', e)
      }
    }

    socket.onclose = () => {
      this.registryClients.delete(socket)
    }

    return response
  }

  private handleClientMessage(socket: WebSocket, msg: InspectorClientMessage): void {
    switch (msg.type) {
      case 'createSession': {
        const factory = this.sessionFactories.get(msg.name)
        if (!factory) {
          console.warn(`[Inspector] No session factory for "${msg.name}"`)
          return
        }
        const { sessionId, wsUrl } = factory.createSession()
        const response: CreateSessionResponse = {
          type: 'sessionCreated',
          name: msg.name,
          wsUrl,
          sessionId,
          requestId: msg.requestId,
        }
        socket.send(JSON.stringify(response))
        break
      }
      case 'destroySession': {
        const factory = this.sessionFactories.get(msg.name)
        if (factory) {
          factory.destroySession(msg.sessionId)
        }
        break
      }
    }
  }

  private broadcastRegistryMessage(msg: RegistryMessage): void {
    const data = JSON.stringify(msg)
    for (const ws of this.registryClients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data)
      }
    }
  }

  private async serveStatic(pathname: string, dir: string): Promise<Response> {
    let filePath = pathname === '/' ? '/index.html' : pathname
    const fullPath = `${dir}${filePath}`
    try {
      const file = await Deno.readFile(fullPath)
      const ext = fullPath.split('.').pop() ?? ''
      const mimeTypes: Record<string, string> = {
        html: 'text/html', js: 'application/javascript', css: 'text/css',
        json: 'application/json', svg: 'image/svg+xml', png: 'image/png',
        woff2: 'font/woff2', woff: 'font/woff',
      }
      return new Response(file, {
        headers: { 'Content-Type': mimeTypes[ext] ?? 'application/octet-stream' }
      })
    } catch {
      // SPA fallback: serve index.html for any non-file path
      try {
        const file = await Deno.readFile(`${dir}/index.html`)
        return new Response(file, {
          headers: { 'Content-Type': 'text/html' }
        })
      } catch {
        return new Response('Not found', { status: 404 })
      }
    }
  }

  private async openInBrowser(): Promise<void> {
    try {
      const command = Deno.build.os === 'darwin' ? 'open'
        : Deno.build.os === 'windows' ? 'start'
        : 'xdg-open'
      const process = new Deno.Command(command, { args: [this.baseUrl] })
      await process.output()
    } catch (e) {
      console.warn('[Inspector] Could not open browser:', e)
    }
  }

  get url(): string {
    return this.baseUrl
  }

  shutdown(): void {
    this.unsubscribe?.()
    for (const ws of this.registryClients) {
      ws.close()
    }
    this.registryClients.clear()
    this.server?.shutdown()
    this.server = null

    const g = globalThis as Record<string, unknown>
    delete g[GLOBAL_KEY]
  }
}

// === Singleton getter ===

export function getInspectorServer(options?: InspectorServerOptions): InspectorServer {
  const g = globalThis as Record<string, unknown>
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new InspectorServer(options)
  }
  return g[GLOBAL_KEY] as InspectorServer
}
```

**Key design decision -- session creation over the registry WebSocket:**

Rather than having the inspector browser connect directly to component bridge WebSocket URLs (which would require the browser to know ports and create sessions), the inspector requests session creation through the registry WebSocket. The kernel-side `InspectorServer` delegates to the adapter's session factory to create a proper session on the component's bridge, then returns the WS URL. This keeps session lifecycle management on the kernel side.

### 1.3 Modifications to Existing Adapters

#### 1.3.1 PianoRollAdapter Changes

**File:** `apps/deno-notebooks/tools/pianoRollAdapter.ts` (modify)

The `createPianoRollBridge()` factory gains inspector integration:

```typescript
// New import
import { getInspectorRegistry, getInspectorServer } from "@avtools/ui-bridge"

export function createPianoRollBridge(): PianoRollBridgeAPI {
  const adapter = createPianoRollAdapter()
  const bridge = new DenoNotebookBridge(adapter)
  const clips = new ClipMap()
  clips._setBridge(bridge)

  // NEW: helper to register with inspector
  const registerInspectorEntry = (name: string) => {
    const registry = getInspectorRegistry()
    const server = getInspectorServer()
    const baseUrl = bridge.getBaseUrl()

    registry.register({
      name,
      componentType: 'piano-roll',
      bridgeBaseUrl: baseUrl,
      registeredAt: Date.now(),
    })

    server.registerSessionFactory(name, {
      createSession: () => {
        const sessionId = bridge.generateSessionId()
        const sessionData: PianoRollSessionData = {
          type: 'bound',
          clipMap: clips,
          clipName: name,
        }
        bridge.registerSession(sessionId, sessionData)
        clips.bind(name, sessionId)
        const addr = new URL(baseUrl)
        const wsUrl = `ws://127.0.0.1:${addr.port}/ws?id=${sessionId}`
        return { sessionId, wsUrl }
      },
      destroySession: (sessionId: string) => {
        clips.unbind(name, sessionId)
        bridge.removeSession(sessionId)
      },
    })
  }

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
        clipName: name,
      }
      bridge.registerSession(sessionId, sessionData)
      clips.bind(name, sessionId)
      bridge.displayIframe(sessionId)

      // NEW: Register with inspector
      registerInspectorEntry(name)

      const session = bridge.getSession(sessionId)!
      return adapter.createHandle(session, bridge)
    },

    shutdown(): void {
      // NEW: Unregister all entries from inspector
      const registry = getInspectorRegistry()
      const server = getInspectorServer()
      for (const name of clips.keys()) {
        registry.unregister(name)
        server.unregisterSessionFactory(name)
      }
      bridge.shutdown()
    },
  }
}
```

**Important nuance:** The `registerInspectorEntry` function is idempotent -- if `showBound("melody")` is called multiple times, it updates the existing entry. The session factory is also replaced, which is fine since it's stateless (it creates new sessions on demand).

#### 1.3.2 AnimationEditorAdapter Changes

**File:** `apps/deno-notebooks/tools/animationEditorAdapter.ts` (modify)

Same pattern as piano roll. The `showBound` method registers entries:

```typescript
// New import
import { getInspectorRegistry, getInspectorServer } from "@avtools/ui-bridge"

// In createAnimationEditorBridge():

showBound(name: string): AnimationEditorHandle {
  const sessionId = bridge.generateSessionId()
  const sessionData: AnimationSessionData = {
    type: 'bound',
    trackMap: tracks,
    animationName: name,
  }
  bridge.registerSession(sessionId, sessionData)
  tracks.bind(name, sessionId)
  bridge.displayIframe(sessionId)

  // NEW: Register with inspector
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
      const sid = bridge.generateSessionId()
      const sd: AnimationSessionData = {
        type: 'bound',
        trackMap: tracks,
        animationName: name,
      }
      bridge.registerSession(sid, sd)
      tracks.bind(name, sid)
      const addr = new URL(baseUrl)
      const wsUrl = `ws://127.0.0.1:${addr.port}/ws?id=${sid}`
      return { sessionId: sid, wsUrl }
    },
    destroySession: (sid: string) => {
      tracks.unbind(name, sid)
      bridge.removeSession(sid)
    },
  })

  const session = bridge.getSession(sessionId)!
  return adapter.createHandle(session, bridge)
},
```

#### 1.3.3 TweakpaneAdapter Changes

**File:** `apps/deno-notebooks/tools/tweakpaneAdapter.ts` (modify)
**File:** `apps/deno-notebooks/tools/tweakpaneServer.ts` (modify)

Tweakpane is slightly different because:
- The name comes from the pane's `title` (with optional `name` override)
- There's no ClipMap/TrackMap equivalent -- each `TweakpaneServer` is a self-contained pane
- The bridge is lazily created in `show()`

**Changes to `TweakpaneServer`:**

Add an optional `name` parameter to the constructor and a registration method:

```typescript
// In tweakpaneServer.ts, add to constructor:
private _inspectorName: string | undefined

constructor(config?: { title?: string; expanded?: boolean; name?: string }) {
  this._title = config?.title
  this._expanded = config?.expanded ?? true
  this._inspectorName = config?.name
  this._paneConfig = { title: config?.title, expanded: config?.expanded }
  addContainerMethods(this)
}

/** The name used for the inspector registry. Defaults to title. */
get inspectorName(): string {
  return this._inspectorName ?? this._title ?? 'Tweakpane'
}

set inspectorName(name: string) {
  this._inspectorName = name
}
```

**Changes to `TweakpaneAdapter` / `createTweakpane`:**

Registration happens in `show()`:

```typescript
// In tweakpaneAdapter.ts, after the lazy bridge creation in show():

show(config?: IframeConfig): void {
  if (!this._bridge) {
    if (!_createAdapterAndBridge) {
      throw new Error(...)
    }
    this._bridge = _createAdapterAndBridge(this)
  }

  const sessionId = this._bridge.generateSessionId()
  this._bridge.registerSession(sessionId, { server: this })
  this._sessions.add(sessionId)
  this._bridge.displayIframe(sessionId, config)

  // NEW: Register with inspector
  this._registerWithInspector()
}

private _registerWithInspector(): void {
  if (!this._bridge) return
  const registry = getInspectorRegistry()
  const server = getInspectorServer()
  const baseUrl = this._bridge.getBaseUrl()
  const name = this.inspectorName

  registry.register({
    name,
    componentType: 'tweakpane',
    bridgeBaseUrl: baseUrl,
    registeredAt: Date.now(),
  })

  server.registerSessionFactory(name, {
    createSession: () => {
      const sessionId = this._bridge!.generateSessionId()
      this._bridge!.registerSession(sessionId, { server: this })
      this._sessions.add(sessionId)
      const addr = new URL(baseUrl)
      const wsUrl = `ws://127.0.0.1:${addr.port}/ws?id=${sessionId}`
      return { sessionId, wsUrl }
    },
    destroySession: (sessionId: string) => {
      this._removeSession(sessionId)
      this._bridge?.removeSession(sessionId)
    },
  })
}
```

### 1.4 Public API: `openInspector()`

**File:** `apps/deno-notebooks/tools/inspector.ts` (new)

Simple convenience function for notebooks:

```typescript
import { getInspectorServer, type InspectorServerOptions } from "@avtools/ui-bridge"

/**
 * Open the Scene Inspector in a browser window.
 *
 * Usage:
 * ```typescript
 * import { openInspector } from "./inspector.ts"
 * await openInspector()
 * ```
 */
export async function openInspector(options?: InspectorServerOptions): Promise<string> {
  const server = getInspectorServer({
    openBrowser: true,
    // Default staticDir points to built inspector app
    staticDir: new URL("../../../apps/scene-inspector/dist", import.meta.url).pathname,
    ...options,
  })
  return await server.start()
}

export { getInspectorRegistry, getInspectorServer } from "@avtools/ui-bridge"
```

### 1.5 Updates to `packages/ui-bridge/mod.ts`

**File:** `packages/ui-bridge/mod.ts` (modify)

```typescript
export * from "./deno_notebook_bridge.ts";
export * from "./websocket_client_base.ts";
export * from "./inspector_registry.ts";    // NEW
export * from "./inspector_server.ts";      // NEW
```

---

## Part 2: Browser Side (Vue Inspector App)

### 2.1 Build Configuration

The inspector is its own top-level Vue+Vite app at `apps/scene-inspector/`. It is a local dev tool, not part of the web-facing browser-projections app. It imports Vue component sources from `apps/browser-projections/src/` for piano-roll and animation-editor detail views.

**File:** `apps/scene-inspector/vite.config.ts` (new)

```typescript
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@browser': fileURLToPath(new URL('../browser-projections/src', import.meta.url)),
    },
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    emptyOutDir: true,
  },
})
```

**File:** `apps/scene-inspector/index.html` (new)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Scene Inspector</title>
</head>
<body>
  <div id="inspector-app"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

**File:** `apps/scene-inspector/package.json` (new)

```json
{
  "name": "@avtools/scene-inspector",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "vue": "^3.5.0",
    "tweakpane": "^4.0.5"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.0.0",
    "vite": "^6.0.0",
    "typescript": "^5.6.0"
  }
}
```

### 2.2 Inspector Entry Point

**File:** `apps/scene-inspector/src/main.ts` (new)

```typescript
import { createApp } from 'vue'
import InspectorApp from './InspectorApp.vue'

const app = createApp(InspectorApp)
app.mount('#inspector-app')
```

### 2.3 Inspector WebSocket Client

**File:** `apps/scene-inspector/src/inspectorClient.ts` (new)

This manages the WebSocket connection to the InspectorServer for registry updates and session management.

```typescript
// === Type Definitions (mirrors kernel-side types) ===

export type ComponentType = 'piano-roll' | 'animation-editor' | 'tweakpane'

export interface RegistryEntry {
  name: string
  componentType: ComponentType
  bridgeBaseUrl: string
  registeredAt: number
}

export type RegistryMessage =
  | { type: 'registrySnapshot'; entries: RegistryEntry[] }
  | { type: 'entryAdded'; entry: RegistryEntry }
  | { type: 'entryRemoved'; name: string }
  | { type: 'entryUpdated'; entry: RegistryEntry }

interface CreateSessionRequest {
  type: 'createSession'
  name: string
  requestId: string
}

interface DestroySessionRequest {
  type: 'destroySession'
  name: string
  sessionId: string
}

interface CreateSessionResponse {
  type: 'sessionCreated'
  name: string
  wsUrl: string
  sessionId: string
  requestId: string
}

type ServerMessage = RegistryMessage | CreateSessionResponse

// === InspectorClient Class ===

export class InspectorClient {
  private ws: WebSocket | null = null
  private pendingRequests = new Map<string, {
    resolve: (value: { wsUrl: string; sessionId: string }) => void
    reject: (error: Error) => void
  }>()

  onRegistryUpdate?: (entries: RegistryEntry[]) => void
  onConnectionChange?: (connected: boolean) => void

  private entries = new Map<string, RegistryEntry>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0

  constructor(private serverUrl: string) {}

  connect(): void {
    const wsUrl = this.serverUrl.replace(/^http/, 'ws') + '/ws/registry'
    this.ws = new WebSocket(wsUrl)

    this.ws.onopen = () => {
      this.reconnectAttempts = 0
      this.onConnectionChange?.(true)
    }

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data) as ServerMessage
      this.handleMessage(msg)
    }

    this.ws.onclose = () => {
      this.onConnectionChange?.(false)
      this.scheduleReconnect()
    }

    this.ws.onerror = () => {
      // will trigger onclose
    }
  }

  private handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'registrySnapshot':
        this.entries.clear()
        for (const entry of msg.entries) {
          this.entries.set(entry.name, entry)
        }
        this.notifyUpdate()
        break

      case 'entryAdded':
      case 'entryUpdated':
        this.entries.set(msg.entry.name, msg.entry)
        this.notifyUpdate()
        break

      case 'entryRemoved':
        this.entries.delete(msg.name)
        this.notifyUpdate()
        break

      case 'sessionCreated': {
        const pending = this.pendingRequests.get(msg.requestId)
        if (pending) {
          this.pendingRequests.delete(msg.requestId)
          pending.resolve({ wsUrl: msg.wsUrl, sessionId: msg.sessionId })
        }
        break
      }
    }
  }

  private notifyUpdate(): void {
    this.onRegistryUpdate?.(Array.from(this.entries.values()))
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= 10) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++
      this.connect()
    }, 1000 * Math.pow(2, Math.min(this.reconnectAttempts, 5)))
  }

  /** Request a new session for viewing a component in the inspector */
  createSession(name: string): Promise<{ wsUrl: string; sessionId: string }> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected'))
        return
      }
      const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2)}`
      this.pendingRequests.set(requestId, { resolve, reject })
      this.ws.send(JSON.stringify({
        type: 'createSession',
        name,
        requestId,
      } satisfies CreateSessionRequest))

      // Timeout after 10 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId)
          reject(new Error('Session creation timed out'))
        }
      }, 10000)
    })
  }

  /** Notify the server that we're done viewing a component */
  destroySession(name: string, sessionId: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'destroySession',
        name,
        sessionId,
      } satisfies DestroySessionRequest))
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
    }
    this.ws?.close()
    this.ws = null
  }
}
```

### 2.4 Inspector Vue Components

#### 2.4.1 InspectorApp.vue (root)

**File:** `apps/scene-inspector/src/InspectorApp.vue` (new)

```vue
<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { InspectorClient, type RegistryEntry } from './inspectorClient'
import InspectorSidebar from './InspectorSidebar.vue'
import InspectorDetail from './InspectorDetail.vue'

// The inspector connects to the same server that served it
const serverUrl = window.location.origin

const client = new InspectorClient(serverUrl)
const entries = ref<RegistryEntry[]>([])
const connected = ref(false)
const selectedName = ref<string | null>(null)

client.onRegistryUpdate = (newEntries) => {
  entries.value = newEntries
  // If selected entry was removed, deselect
  if (selectedName.value && !newEntries.find(e => e.name === selectedName.value)) {
    selectedName.value = null
  }
}

client.onConnectionChange = (isConnected) => {
  connected.value = isConnected
}

const selectedEntry = computed(() =>
  entries.value.find(e => e.name === selectedName.value) ?? null
)

function selectEntry(name: string) {
  selectedName.value = name
}

onMounted(() => {
  client.connect()
})

onUnmounted(() => {
  client.disconnect()
})
</script>

<template>
  <div class="inspector-app">
    <div class="inspector-header">
      <h1>Scene Inspector</h1>
      <span class="connection-status" :class="{ connected }">
        {{ connected ? 'Connected' : 'Disconnected' }}
      </span>
    </div>
    <div class="inspector-body">
      <InspectorSidebar
        :entries="entries"
        :selected-name="selectedName"
        @select="selectEntry"
      />
      <InspectorDetail
        :entry="selectedEntry"
        :client="client"
      />
    </div>
  </div>
</template>

<style>
/* Global reset for inspector */
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  background: #1a1a2e;
  color: #e0e0e0;
  overflow: hidden;
  height: 100vh;
}
</style>

<style scoped>
.inspector-app {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.inspector-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: #16213e;
  border-bottom: 1px solid #0f3460;
}

.inspector-header h1 {
  font-size: 16px;
  font-weight: 600;
  color: #e0e0e0;
}

.connection-status {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 10px;
  background: #e74c3c;
  color: white;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.connection-status.connected {
  background: #27ae60;
}

.inspector-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}
</style>
```

#### 2.4.2 InspectorSidebar.vue

**File:** `apps/scene-inspector/src/InspectorSidebar.vue` (new)

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'
import type { RegistryEntry, ComponentType } from './inspectorClient'

const props = defineProps<{
  entries: RegistryEntry[]
  selectedName: string | null
}>()

const emit = defineEmits<{
  (e: 'select', name: string): void
}>()

const searchFilter = ref('')

const filteredEntries = computed(() => {
  const filter = searchFilter.value.toLowerCase().trim()
  if (!filter) return props.entries
  return props.entries.filter(e =>
    e.name.toLowerCase().includes(filter) ||
    e.componentType.toLowerCase().includes(filter)
  )
})

// Group by type
const groupedEntries = computed(() => {
  const groups: Record<ComponentType, RegistryEntry[]> = {
    'piano-roll': [],
    'animation-editor': [],
    'tweakpane': [],
  }
  for (const entry of filteredEntries.value) {
    groups[entry.componentType]?.push(entry)
  }
  return groups
})

const typeLabels: Record<ComponentType, string> = {
  'piano-roll': 'Piano Rolls',
  'animation-editor': 'Animation Editors',
  'tweakpane': 'Tweakpane Panels',
}

const typeIcons: Record<ComponentType, string> = {
  'piano-roll': 'PR',
  'animation-editor': 'AE',
  'tweakpane': 'TP',
}
</script>

<template>
  <div class="sidebar">
    <div class="sidebar-search">
      <input
        v-model="searchFilter"
        type="text"
        placeholder="Filter..."
        class="search-input"
      />
    </div>
    <div class="sidebar-content">
      <div v-if="entries.length === 0" class="empty-state">
        No objects registered yet.
        Create bound objects in your notebook to see them here.
      </div>
      <template v-for="(typeEntries, type) in groupedEntries" :key="type">
        <div v-if="typeEntries.length > 0" class="type-group">
          <div class="type-header">{{ typeLabels[type] }}</div>
          <div
            v-for="entry in typeEntries"
            :key="entry.name"
            class="entry-item"
            :class="{ selected: entry.name === selectedName }"
            @click="emit('select', entry.name)"
          >
            <span class="entry-badge" :class="type">{{ typeIcons[type] }}</span>
            <span class="entry-name">{{ entry.name }}</span>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.sidebar {
  width: 260px;
  min-width: 260px;
  display: flex;
  flex-direction: column;
  background: #16213e;
  border-right: 1px solid #0f3460;
}

.sidebar-search {
  padding: 8px;
  border-bottom: 1px solid #0f3460;
}

.search-input {
  width: 100%;
  padding: 6px 10px;
  background: #1a1a2e;
  border: 1px solid #0f3460;
  border-radius: 4px;
  color: #e0e0e0;
  font-size: 12px;
}

.search-input:focus {
  outline: none;
  border-color: #533483;
}

.search-input::placeholder {
  color: #555;
}

.sidebar-content {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.empty-state {
  padding: 20px 16px;
  color: #666;
  font-size: 12px;
  text-align: center;
  line-height: 1.5;
}

.type-group {
  margin-bottom: 4px;
}

.type-header {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: #888;
  padding: 8px 12px 4px;
}

.entry-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  cursor: pointer;
  transition: background 0.1s;
}

.entry-item:hover {
  background: rgba(255, 255, 255, 0.05);
}

.entry-item.selected {
  background: #0f3460;
}

.entry-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  font-size: 9px;
  font-weight: 700;
  flex-shrink: 0;
}

.entry-badge.piano-roll { background: #2ecc71; color: #000; }
.entry-badge.animation-editor { background: #3498db; color: #000; }
.entry-badge.tweakpane { background: #e67e22; color: #000; }

.entry-name {
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
```

#### 2.4.3 InspectorDetail.vue

**File:** `apps/scene-inspector/src/InspectorDetail.vue` (new)

This is the detail panel that dynamically mounts the appropriate component based on the selected entry's type.

```vue
<script setup lang="ts">
import { ref, watch, onUnmounted, markRaw } from 'vue'
import type { RegistryEntry } from './inspectorClient'
import type { InspectorClient } from './inspectorClient'
import PianoRollDetail from './details/PianoRollDetail.vue'
import AnimationEditorDetail from './details/AnimationEditorDetail.vue'
import TweakpaneDetail from './details/TweakpaneDetail.vue'

const props = defineProps<{
  entry: RegistryEntry | null
  client: InspectorClient
}>()

// Active session state
const activeWsUrl = ref<string | null>(null)
const activeSessionId = ref<string | null>(null)
const activeName = ref<string | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

// Map component types to Vue components
const componentMap: Record<string, ReturnType<typeof markRaw>> = {
  'piano-roll': markRaw(PianoRollDetail),
  'animation-editor': markRaw(AnimationEditorDetail),
  'tweakpane': markRaw(TweakpaneDetail),
}

async function connectToEntry(entry: RegistryEntry) {
  // Destroy previous session if any
  await disconnectCurrent()

  loading.value = true
  error.value = null

  try {
    const result = await props.client.createSession(entry.name)
    activeWsUrl.value = result.wsUrl
    activeSessionId.value = result.sessionId
    activeName.value = entry.name
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to create session'
  } finally {
    loading.value = false
  }
}

function disconnectCurrent() {
  if (activeName.value && activeSessionId.value) {
    props.client.destroySession(activeName.value, activeSessionId.value)
  }
  activeWsUrl.value = null
  activeSessionId.value = null
  activeName.value = null
  error.value = null
}

// Watch for entry changes
watch(() => props.entry, (newEntry, oldEntry) => {
  if (newEntry && newEntry.name !== oldEntry?.name) {
    connectToEntry(newEntry)
  } else if (!newEntry) {
    disconnectCurrent()
  }
})

onUnmounted(() => {
  disconnectCurrent()
})
</script>

<template>
  <div class="detail-panel">
    <!-- Empty state -->
    <div v-if="!entry" class="detail-empty">
      <p>Select an object from the sidebar to inspect it.</p>
    </div>

    <!-- Loading state -->
    <div v-else-if="loading" class="detail-loading">
      <p>Connecting to {{ entry.name }}...</p>
    </div>

    <!-- Error state -->
    <div v-else-if="error" class="detail-error">
      <p>Error: {{ error }}</p>
      <button @click="connectToEntry(entry!)">Retry</button>
    </div>

    <!-- Active component -->
    <template v-else-if="activeWsUrl && entry">
      <div class="detail-header">
        <span class="detail-name">{{ entry.name }}</span>
        <span class="detail-type">{{ entry.componentType }}</span>
      </div>
      <div class="detail-content">
        <component
          :is="componentMap[entry.componentType]"
          :ws-address="activeWsUrl"
          :key="activeWsUrl"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.detail-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.detail-empty,
.detail-loading,
.detail-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: #666;
  font-size: 14px;
}

.detail-error {
  color: #e74c3c;
}

.detail-error button {
  margin-top: 12px;
  padding: 6px 16px;
  background: #533483;
  border: none;
  border-radius: 4px;
  color: white;
  cursor: pointer;
}

.detail-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: #1a1a2e;
  border-bottom: 1px solid #0f3460;
}

.detail-name {
  font-size: 14px;
  font-weight: 600;
}

.detail-type {
  font-size: 11px;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.detail-content {
  flex: 1;
  overflow: auto;
  padding: 0;
}
</style>
```

**Key pattern:** The `:key="activeWsUrl"` on the dynamic `<component>` ensures Vue fully destroys and remounts the component when the WS address changes (i.e., when switching between entries). This triggers the proper unmount lifecycle which disconnects the old WebSocket, and the mount lifecycle which establishes a new connection.

#### 2.4.4 PianoRollDetail.vue

**File:** `apps/scene-inspector/src/details/PianoRollDetail.vue` (new)

This is a thin wrapper around the existing `PianoRollRoot.vue`:

```vue
<script setup lang="ts">
defineProps<{
  wsAddress: string
}>()
</script>

<template>
  <div class="piano-roll-detail">
    <PianoRollRoot
      :ws-address="wsAddress"
      :interactive="true"
      :show-control-panel="true"
      :width="800"
      :height="500"
    />
  </div>
</template>

<script lang="ts">
// Separate script block for the import (can't use defineComponent with setup)
import PianoRollRoot from '@browser/pianoRoll/PianoRollRoot.vue'
export default {
  components: { PianoRollRoot },
}
</script>

<style scoped>
.piano-roll-detail {
  padding: 16px;
  display: flex;
  justify-content: center;
}
</style>
```

**Note:** This works because `PianoRollRoot.vue` already accepts a `wsAddress` prop and handles WebSocket connection/disconnection in its `onMounted`/`onUnmounted` lifecycle hooks. When the inspector switches entries, the old `PianoRollDetail` is unmounted (which calls `PianoRollRoot`'s `onUnmounted`, disconnecting the WS), and a new one is mounted with the new `wsAddress` (which calls `onMounted`, establishing a new WS connection and receiving the replay data).

#### 2.4.5 AnimationEditorDetail.vue

**File:** `apps/scene-inspector/src/details/AnimationEditorDetail.vue` (new)

```vue
<script setup lang="ts">
defineProps<{
  wsAddress: string
}>()
</script>

<template>
  <div class="animation-editor-detail">
    <AnimationEditorView
      :ws-address="wsAddress"
      :interactive="true"
    />
  </div>
</template>

<script lang="ts">
import AnimationEditorView from '@browser/animationEditor/components/AnimationEditorView.vue'
export default {
  components: { AnimationEditorView },
}
</script>

<style scoped>
.animation-editor-detail {
  height: 100%;
  display: flex;
  flex-direction: column;
}
</style>
```

#### 2.4.6 TweakpaneDetail.vue

**File:** `apps/scene-inspector/src/details/TweakpaneDetail.vue` (new)

This wraps the existing `TweakpaneClient` class (which is not a Vue component, but a vanilla JS class that manages a tweakpane `Pane` instance).

```vue
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { TweakpaneClient } from '../../../../webcomponents/tweakpane/src/tweakpane-client'

const props = defineProps<{
  wsAddress: string
}>()

const containerRef = ref<HTMLElement | null>(null)
let client: TweakpaneClient | null = null

onMounted(() => {
  if (containerRef.value) {
    client = new TweakpaneClient(props.wsAddress, containerRef.value)
  }
})

onUnmounted(() => {
  // TweakpaneClient cleanup:
  // The WebSocket onclose is handled by the client internally.
  // The tweakpane Pane instance will be garbage collected when the container is removed.
  // However, we should explicitly clean up if possible.
  client = null
})
</script>

<template>
  <div class="tweakpane-detail">
    <div ref="containerRef" class="tweakpane-container"></div>
  </div>
</template>

<style scoped>
.tweakpane-detail {
  padding: 16px;
}

.tweakpane-container {
  display: inline-block;
}
</style>
```

**Note:** The `TweakpaneClient` constructor takes a WS URL and a container element. It creates a WebSocket, sends `connectionReady`, receives the `replay` message with full pane config + operations, and builds the tweakpane Pane. When the Vue component is unmounted, the container element is removed from the DOM, which disposes the Pane's DOM. The WebSocket will eventually close due to the server detecting disconnection.

**Consideration:** If `TweakpaneClient` needs explicit disposal, we should add a `dispose()` method to it:

```typescript
// In webcomponents/tweakpane/src/tweakpane-client.ts, add:
dispose(): void {
  this.ws.close()
  if (this.pane) {
    this.pane.dispose()
    this.pane = null
  }
  this.idMap.clear()
  this.localObjects.clear()
}
```

And call it in `onUnmounted`:

```typescript
onUnmounted(() => {
  client?.dispose()
  client = null
})
```

---

## Part 3: Protocol Specification

### 3.1 Inspector Registry WebSocket Protocol

**Endpoint:** `ws://{inspector-server}/ws/registry`

**Server -> Client Messages:**

| Message | Fields | Description |
|---------|--------|-------------|
| `registrySnapshot` | `entries: RegistryEntry[]` | Full state, sent on connect |
| `entryAdded` | `entry: RegistryEntry` | New entry registered |
| `entryRemoved` | `name: string` | Entry unregistered |
| `entryUpdated` | `entry: RegistryEntry` | Entry metadata changed |

**Client -> Server Messages:**

| Message | Fields | Description |
|---------|--------|-------------|
| `createSession` | `name: string, requestId: string` | Request session for viewing a component |
| `destroySession` | `name: string, sessionId: string` | Release a viewing session |

**Server -> Client Responses:**

| Message | Fields | Description |
|---------|--------|-------------|
| `sessionCreated` | `name, wsUrl, sessionId, requestId` | Session ready, connect to wsUrl |

### 3.2 Component WebSocket Connections

Once the inspector has a `wsUrl` from `sessionCreated`, the detail component connects directly to the component's bridge server. The protocol is identical to the existing notebook iframe protocol:

- **Piano Roll:** `PianoRollWebSocketController` connects to the bridge WS URL, sends `connectionReady`, receives `setNotes`/`setConfig` commands, sends `notesUpdate`/`stateUpdate` events.
- **Animation Editor:** `AnimationEditorWebSocketController` connects to the bridge WS URL, sends `connectionReady`, receives `setTracks`/`setConfig` commands.
- **Tweakpane:** `TweakpaneClient` connects to the bridge WS URL, sends `connectionReady`, receives `replay` message with full pane state.

No protocol changes needed for the components themselves -- the inspector uses the same protocol as notebook iframes.

---

## Part 4: Complete File-by-File Breakdown

### New Files

| File | Description |
|------|-------------|
| `packages/ui-bridge/inspector_registry.ts` | `InspectorRegistry` class, `RegistryEntry` type, `getInspectorRegistry()` singleton |
| `packages/ui-bridge/inspector_server.ts` | `InspectorServer` class, HTTP server, WS handling, static file serving, `getInspectorServer()` singleton |
| `apps/deno-notebooks/tools/inspector.ts` | `openInspector()` convenience function |
| `apps/scene-inspector/index.html` | HTML entry point for the inspector SPA |
| `apps/scene-inspector/package.json` | Package with Vue, Vite, tweakpane deps |
| `apps/scene-inspector/vite.config.ts` | Vite build config for inspector |
| `apps/scene-inspector/src/main.ts` | Vue app entry point |
| `apps/scene-inspector/src/InspectorApp.vue` | Root Vue component |
| `apps/scene-inspector/src/InspectorSidebar.vue` | Sidebar with entry list |
| `apps/scene-inspector/src/InspectorDetail.vue` | Detail panel with dynamic component |
| `apps/scene-inspector/src/inspectorClient.ts` | Browser-side WS client for registry |
| `apps/scene-inspector/src/details/PianoRollDetail.vue` | Wrapper around PianoRollRoot |
| `apps/scene-inspector/src/details/AnimationEditorDetail.vue` | Wrapper around AnimationEditorView |
| `apps/scene-inspector/src/details/TweakpaneDetail.vue` | Wrapper around TweakpaneClient |

### Modified Files

| File | Changes |
|------|---------|
| `packages/ui-bridge/mod.ts` | Add exports for `inspector_registry.ts` and `inspector_server.ts` |
| `apps/deno-notebooks/tools/pianoRollAdapter.ts` | Add inspector registration in `showBound()`, add cleanup in `shutdown()` |
| `apps/deno-notebooks/tools/animationEditorAdapter.ts` | Add inspector registration in `showBound()`, add cleanup in `shutdown()` |
| `apps/deno-notebooks/tools/tweakpaneServer.ts` | Add `inspectorName` property, add `_registerWithInspector()` method |
| `apps/deno-notebooks/tools/tweakpaneAdapter.ts` | Wire inspector registration into `show()` path |
| `webcomponents/tweakpane/src/tweakpane-client.ts` | Add `dispose()` method for proper cleanup |

---

## Part 5: Edge Cases

### 5.1 Inspector opened before any objects exist

The sidebar shows an empty state message: "No objects registered yet. Create bound objects in your notebook to see them here." As objects are created in the notebook, the registry WebSocket sends `entryAdded` messages and the sidebar updates in real time.

### 5.2 Object destroyed while being viewed

When an adapter's `shutdown()` or `ClipMap.delete()` / `TrackMap.delete()` is called:
1. The adapter calls `registry.unregister(name)` and `server.unregisterSessionFactory(name)`
2. The registry broadcasts `entryRemoved` to the inspector
3. The sidebar removes the entry
4. If the entry was selected, `InspectorDetail` sees `entry` become `null` via the computed property
5. The watcher calls `disconnectCurrent()` which sends `destroySession` and clears the active state
6. The detail component is unmounted, triggering WS disconnect
7. The kernel-side session cleanup happens via the bridge's `onSessionCleanup`

**Additionally**, the component's bridge server may close the WS connection from the kernel side if the session is removed. The detail component should handle this gracefully (the existing `PianoRollWebSocketController` and `AnimationEditorWebSocketController` already have reconnection logic, but for the inspector we should NOT reconnect -- instead show a "disconnected" state).

**Implementation note:** The detail wrapper components should detect WS disconnection and surface it in the UI. For the initial implementation, the component simply unmounts when the entry is removed from the sidebar, which naturally handles this case.

### 5.3 Notebook kernel restarts

When the Deno kernel restarts:
1. All Deno.serve instances are killed, including the InspectorServer
2. The inspector browser's registry WebSocket disconnects
3. `InspectorClient.onConnectionChange(false)` fires, UI shows "Disconnected" status
4. The reconnect logic kicks in (exponential backoff, up to 10 attempts)
5. When the user re-runs notebook cells, new bridges and the inspector server are re-created
6. The inspector's WebSocket reconnects to the new server
7. The registry is empty (fresh kernel), so the sidebar clears
8. As the user re-creates objects, entries appear in the sidebar

**Key consideration:** The InspectorServer's port changes on kernel restart. The inspector browser page's `window.location.origin` still points to the old port. The inspector needs to handle this.

**Solution:** The inspector client should detect that the WS URL is unreachable (all reconnect attempts failed) and display a clear message: "Kernel connection lost. Re-run `openInspector()` to get a new URL." Alternatively, the `openInspector()` function could always use the same port by passing `port: FIXED_PORT` in options, but that risks port conflicts. The simplest approach for v1 is to just re-run `openInspector()` after kernel restart.

### 5.4 Multiple notebooks sharing objects

The `InspectorRegistry` is a global singleton keyed on `globalThis`. In the Deno kernel, there's only one `globalThis` per kernel process. Multiple notebooks running in the same kernel share the same registry. This is actually the desired behavior -- all objects from all notebooks appear in the same inspector.

If two notebooks register objects with the same name (e.g., both call `piano.showBound("melody")`), the second registration overwrites the first in the registry. The session factory is also replaced. This could be confusing.

**Mitigation:** Documentation should advise using unique names. The registry could optionally warn on name collision:

```typescript
register(entry: RegistryEntry): void {
  const existing = this.entries.has(entry.name)
  if (existing) {
    console.warn(
      `[InspectorRegistry] Overwriting existing entry "${entry.name}". ` +
      `Use unique names to avoid conflicts.`
    )
  }
  // ...
}
```

### 5.5 Inspector session cleanup on inspector window close

When the inspector browser window/tab is closed:
1. All WebSockets from that browser disconnect
2. The registry WS `onclose` fires, removing the client from `registryClients`
3. Any active component sessions remain on the kernel side as zombie sessions

**Solution:** Track inspector-created sessions and clean them up when the registry WS disconnects:

```typescript
// In InspectorServer, track sessions per registry client:
private clientSessions = new Map<WebSocket, Set<{ name: string; sessionId: string }>>()

// On createSession, record the association:
// this.clientSessions.get(socket)!.add({ name, sessionId })

// On socket.onclose, clean up all sessions for that client:
socket.onclose = () => {
  this.registryClients.delete(socket)
  const sessions = this.clientSessions.get(socket)
  if (sessions) {
    for (const { name, sessionId } of sessions) {
      const factory = this.sessionFactories.get(name)
      factory?.destroySession(sessionId)
    }
    this.clientSessions.delete(socket)
  }
}
```

---

## Part 6: Step-by-Step Implementation Order

### Phase 1: Core Infrastructure (kernel side)

1. **Create `packages/ui-bridge/inspector_registry.ts`**
   - Implement `InspectorRegistry` class with register/unregister/subscribe
   - Implement `getInspectorRegistry()` singleton
   - Export all types

2. **Create `packages/ui-bridge/inspector_server.ts`**
   - Implement `InspectorServer` class with HTTP + WS handling
   - Implement session factory registration
   - Implement static file serving
   - Implement browser opening
   - Implement `getInspectorServer()` singleton
   - Handle session cleanup on WS disconnect

3. **Update `packages/ui-bridge/mod.ts`**
   - Add exports for both new modules

4. **Test the registry and server in isolation**
   - Create a simple test that registers entries and connects via WS
   - Verify snapshot delivery, add/remove broadcasts

### Phase 2: Adapter Integration (kernel side)

5. **Modify `apps/deno-notebooks/tools/pianoRollAdapter.ts`**
   - Add imports for registry + server
   - Add `registerInspectorEntry()` helper in `createPianoRollBridge()`
   - Call it from `showBound()`
   - Add cleanup in `shutdown()`

6. **Modify `apps/deno-notebooks/tools/animationEditorAdapter.ts`**
   - Same pattern as piano roll

7. **Modify `apps/deno-notebooks/tools/tweakpaneServer.ts`**
   - Add `inspectorName` property
   - Add `_registerWithInspector()` method
   - Call from `show()`
   - Add cleanup in `dispose()` and `shutdown()`

8. **Modify `webcomponents/tweakpane/src/tweakpane-client.ts`**
   - Add `dispose()` method

9. **Create `apps/deno-notebooks/tools/inspector.ts`**
   - Implement `openInspector()` convenience function

10. **Test end-to-end kernel side**
    - In a notebook, create piano roll, animation editor, tweakpane
    - Call `openInspector()`
    - Verify registry contains all entries
    - Verify session creation returns valid WS URLs

### Phase 3: Inspector UI (browser side)

11. **Create `apps/scene-inspector/` package**
    - `package.json`, `index.html`, `vite.config.ts`, `tsconfig.json`
    - `npm install` to get Vue, Vite, tweakpane deps

12. **Create `apps/scene-inspector/src/inspectorClient.ts`**
    - WebSocket client for registry
    - Session creation/destruction requests

13. **Create `apps/scene-inspector/src/main.ts`**
    - Vue app bootstrap

14. **Create `apps/scene-inspector/src/InspectorApp.vue`**
    - Root layout with header, sidebar, detail panel
    - Connection status indicator

15. **Create `apps/scene-inspector/src/InspectorSidebar.vue`**
    - Entry list grouped by type
    - Search filter
    - Selection highlighting

17. **Create detail wrapper components:**
    - `src/details/PianoRollDetail.vue` -- wraps `PianoRollRoot` (via `@browser` alias)
    - `src/details/AnimationEditorDetail.vue` -- wraps `AnimationEditorView` (via `@browser` alias)
    - `src/details/TweakpaneDetail.vue` -- wraps `TweakpaneClient`

18. **Create `apps/scene-inspector/src/InspectorDetail.vue`**
    - Dynamic component switching based on selected entry type
    - Session lifecycle management (create on select, destroy on deselect)
    - Loading/error/empty states

### Phase 4: Build & Integration Test

19. **Build the inspector**
    - Run `npm run build` in `apps/scene-inspector/`
    - Verify output in `apps/scene-inspector/dist/`

21. **End-to-end test**
    - Open a Deno notebook
    - Create some bound objects (piano rolls, animation editors, tweakpanes)
    - Call `openInspector()`
    - Verify browser opens with the inspector
    - Click entries in the sidebar
    - Verify components mount with correct state
    - Edit values and verify they sync back to the notebook
    - Destroy objects in the notebook, verify sidebar updates

### Phase 5: Polish

22. **Add dev mode support**
    - When running `npm run dev`, the inspector should be accessible at a route
    - Consider adding `/inspector` route to the main dev server for development convenience
    - In production, the built inspector is served by InspectorServer

23. **Handle edge cases**
    - Session cleanup on inspector window close
    - Graceful handling of kernel restart
    - Name collision warnings

---

## Part 7: Development Workflow

### During development of the inspector UI

Use the Vite dev server for hot module replacement:

```bash
cd apps/scene-inspector
npm run dev
# Inspector available at http://localhost:5173/
```

The inspector's `InspectorClient` needs to connect to the Deno kernel's InspectorServer (different port). During development, you can either:

1. **Hardcode the port:** Set `serverUrl` to the InspectorServer's URL during development
2. **Use Vite proxy:** Add a proxy config in `vite.config.ts` that forwards `/ws/registry` and `/api/registry` to the Deno server

For production, the inspector is served by the InspectorServer itself, so `window.location.origin` works.

**Vite dev proxy approach (recommended for development):**

```typescript
// In vite.inspector.config.ts, add:
server: {
  proxy: {
    '/ws/registry': {
      target: 'ws://127.0.0.1:INSPECTOR_PORT',
      ws: true,
    },
    '/api/registry': {
      target: 'http://127.0.0.1:INSPECTOR_PORT',
    },
  },
}
```

Since the port is dynamic, a simpler approach for development is to pass the InspectorServer URL as a query parameter:

```typescript
// In InspectorApp.vue:
const params = new URLSearchParams(window.location.search)
const serverUrl = params.get('server') ?? window.location.origin
```

Then during development: `http://localhost:5173/inspector.html?server=http://127.0.0.1:DYNAMIC_PORT`

---

## Part 8: Summary of Type Definitions

```typescript
// RegistryEntry -- a registered UI object
interface RegistryEntry {
  name: string                        // unique name (e.g., "melody", "My Controls")
  componentType: ComponentType        // "piano-roll" | "animation-editor" | "tweakpane"
  bridgeBaseUrl: string               // base URL of the component's bridge server
  registeredAt: number                // Date.now() when registered
}

// Registry messages (WS protocol)
type RegistryMessage =
  | { type: 'registrySnapshot'; entries: RegistryEntry[] }
  | { type: 'entryAdded'; entry: RegistryEntry }
  | { type: 'entryRemoved'; name: string }
  | { type: 'entryUpdated'; entry: RegistryEntry }

// Inspector client messages (browser -> server)
type InspectorClientMessage =
  | { type: 'createSession'; name: string; requestId: string }
  | { type: 'destroySession'; name: string; sessionId: string }

// Inspector server response
interface CreateSessionResponse {
  type: 'sessionCreated'
  name: string
  wsUrl: string         // full ws:// URL to connect to the component's bridge
  sessionId: string     // session ID to use for cleanup
  requestId: string     // matches the request
}

// Session factory (registered by each adapter)
interface SessionFactory {
  createSession: () => { sessionId: string; wsUrl: string }
  destroySession: (sessionId: string) => void
}
```
