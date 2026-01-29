---
name: ui-bridge
description: Deno Jupyter-to-iframe communication infrastructure for embedding interactive web components in notebooks. Provides HTTP/WebSocket bridge, session management, and adapter pattern. Use when writing code that uses @avtools/ui-bridge for notebook UI, WebSocket clients, or component adapters.
metadata:
  author: avtools
  version: "0.0.0"
compatibility: Requires Deno runtime with Deno.serve, Deno.upgradeWebSocket, and Deno.jupyter APIs.
---

# @avtools/ui-bridge

## Summary

`@avtools/ui-bridge` is the generic Deno-Jupyter-to-iframe communication infrastructure for building interactive UI components inside Jupyter notebooks. It provides an HTTP/WebSocket server bridge and an adapter pattern that lets you embed arbitrary web components (piano rolls, animation editors, canvas tools, etc.) as iframes in Deno Jupyter notebook cells with full bidirectional communication.

The package lives at `packages/ui-bridge/` in the avTools monorepo and exports two core modules:
- `websocket_client_base.ts` -- abstract base class for type-safe WebSocket clients
- `deno_notebook_bridge.ts` -- the bridge server, session management, adapter interface, and iframe display

**Package location:** `packages/ui-bridge/`
**Entry point:** `packages/ui-bridge/mod.ts`
**Import path:** `@avtools/ui-bridge`
**Runtime:** Deno (requires `Deno.serve`, `Deno.upgradeWebSocket`, `Deno.jupyter`)

---

## Core Concepts

### Architecture Overview

```
Deno Jupyter Notebook (server side)
  |
  +-- DenoNotebookBridge
  |     |-- auto-starts HTTP server on port 0 (random available port)
  |     |-- serves HTML pages, JS bundles, config JSON, and WebSocket upgrades
  |     |-- manages sessions (Map of session ID -> Session)
  |     |-- displays iframes via Deno.jupyter.html
  |     |
  |     +-- ComponentAdapter (interface)
  |           |-- renderHTML()      -> produces the iframe HTML page
  |           |-- handleConnection() -> creates a WebSocketClientBase subclass
  |           |-- createHandle()    -> returns user-facing handle object
  |           |-- getConfig()       -> JSON config endpoint
  |
  +-- WebSocketClientBase<In, Out>
        |-- type-safe send/receive over WebSocket
        |-- request/response with auto-timeout
        |-- connection lifecycle callbacks

Browser iframe (client side)
  |
  +-- Web component (piano-roll-component, animation-editor-component, etc.)
        |-- connects to WebSocket at ws://127.0.0.1:{port}/ws?id={sessionId}
        |-- loads JS bundle from /static/{name}.js
        |-- sends/receives typed JSON messages
```

### Session Lifecycle

1. User calls `bridge.show(data)` or a factory wrapper like `piano.showBound("melody")`
2. Bridge generates a session ID and registers a `Session` object with the provided data
3. Bridge calls `Deno.jupyter.display()` to render an iframe pointing to `/editor?id={sessionId}`
4. The iframe loads HTML from `adapter.renderHTML()`, fetches the JS bundle, and mounts the web component
5. The web component opens a WebSocket to `/ws?id={sessionId}`
6. Bridge calls `adapter.handleConnection()` which creates a `WebSocketClientBase` subclass and stores it as `session.client`
7. The client's `onConnectionReady` callback fires, sending initial state to the component
8. Bidirectional communication continues until disconnect or `bridge.shutdown()`

### Read-Only vs Bound Display Modes

- **Read-only**: Data is passed once at display time. The component renders it but edits do not propagate back. Session data carries `type: 'readonly'` and a snapshot of the data.
- **Bound**: Data lives in a reactive map (ClipMap, TrackMap). Edits in the component flow back to the map, and programmatic updates to the map flow to all bound sessions. Session data carries `type: 'bound'` plus a reference to the reactive map and the key name.

### Global State and Server Singleton

The bridge stores its state (server, sessions, bundle URL) on `globalThis` under a key derived from the adapter name: `__denoNotebookBridge_{name}__`. This ensures that re-running a notebook cell reuses the existing server rather than starting a new one. The server auto-initializes on first access via `getBridgeState()`.

---

## Full API Reference

### WebSocketClientBase\<IncomingMessage, OutgoingMessage\>

Abstract base class for server-side WebSocket clients. Subclass this for each component type.

**File:** `packages/ui-bridge/websocket_client_base.ts`

#### Constructor

```typescript
constructor(ws: WebSocket, options?: WebSocketClientOptions)
```

- `ws` -- a raw WebSocket (from `Deno.upgradeWebSocket`)
- `options.logPrefix` -- prefix for console warnings (default: `'WebSocketClient'`)
- `options.requestTimeoutMs` -- timeout for pending requests in ms (default: `10000`)

#### Abstract Method

```typescript
protected abstract handleMessage(message: IncomingMessage): void
```

Called for every incoming JSON message after parsing. Subclasses implement component-specific dispatch here.

#### Protected Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `send` | `(message: OutgoingMessage): void` | JSON-serializes and sends a message. No-op if socket is not open. |
| `generateRequestId` | `(): string` | Returns a unique ID like `"1706000000000-abc123def"`. |
| `registerPendingRequest` | `<T>(resolve, reject): string` | Registers a pending request with auto-timeout. Returns the request ID. |
| `resolvePendingRequest` | `<T>(requestId: string, value: T): boolean` | Resolves a pending request by ID. Clears its timeout. Returns false if not found. |
| `rejectAllPendingRequests` | `(message: string): void` | Rejects all pending requests (called automatically on socket close). |

#### Lifecycle Callbacks

| Callback | Type | When |
|----------|------|------|
| `onConnectionReady` | `() => void` | Component signals readiness (set by adapter in `handleConnection`) |
| `onDisconnect` | `() => void` | WebSocket closes |
| `onError` | `(error: Error) => void` | WebSocket error |

#### Protected Fields

| Field | Type | Description |
|-------|------|-------------|
| `ws` | `WebSocket` | The underlying WebSocket |
| `logPrefix` | `string` | Logging prefix |
| `pendingRequests` | `Map<string, PendingRequest>` | Active request/response pairs |
| `requestTimeout` | `number` | Timeout in ms |
| `_connected` | `boolean` | Connection state flag |

---

### PendingRequest\<T\>

```typescript
interface PendingRequest<T = unknown> {
  resolve: (value: T) => void
  reject: (error: Error) => void
  timeout: number  // setTimeout handle
}
```

---

### IframeConfig

```typescript
interface IframeConfig {
  width?: number   // default: adapter default or 680
  height?: number  // default: adapter default or 460
  style?: string   // default: adapter default or "border: 1px solid #ccc; ..."
}
```

---

### Session\<TClient, TSessionData\>

```typescript
interface Session<TClient, TSessionData> {
  id: string
  client?: TClient        // set when WebSocket connects
  data: TSessionData      // component-specific session state
}
```

---

### ComponentAdapter\<TClient, THandle, TSessionData\>

Interface that component-specific modules implement. This is the primary extension point.

**File:** `packages/ui-bridge/deno_notebook_bridge.ts`

| Member | Type | Description |
|--------|------|-------------|
| `name` | `string` | Unique component name (e.g., `"piano-roll"`, `"animation-editor"`). Used for global key, static route path. |
| `bundleUrl` | `URL` | Absolute URL to the pre-built JS bundle file on disk. |
| `defaultIframeConfig?` | `IframeConfig` | Default dimensions/style for the iframe. |
| `renderHTML(wsUrl, sessionId, sessionData)` | `=> string` | Returns full HTML document string for the iframe. Receives the WebSocket URL, session ID, and session data. |
| `handleConnection(socket, session, bridge)` | `=> TClient` | Called on WebSocket upgrade. Must create and return a `WebSocketClientBase` subclass instance. Sets up `onConnectionReady`, `onNotesUpdate`/`onTracksUpdate`, and `onDisconnect` callbacks. |
| `createHandle(session, bridge)` | `=> THandle` | Creates the user-facing handle object returned by `show()`. Typically a plain object with getters for latest state, `disconnect()`, and component-specific commands. |
| `getConfig(session)` | `=> Record<string, unknown>` | Returns JSON config served at `/config?id={sessionId}`. |
| `onSessionCleanup?(session)` | `=> void` | Optional. Called when a session is removed or bridge shuts down. Should close the client WebSocket. |

---

### DenoNotebookBridge\<TClient, THandle, TSessionData\>

The main bridge class. Manages the HTTP server, sessions, and iframe display.

**File:** `packages/ui-bridge/deno_notebook_bridge.ts`

#### Constructor

```typescript
constructor(adapter: ComponentAdapter<TClient, THandle, TSessionData>)
```

The server does not start until the first call that triggers `getBridgeState()` (lazy initialization).

#### Public Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `generateSessionId()` | `(): string` | Returns `"session_{timestamp}_{random}"`. |
| `getSession(id)` | `(id: string): Session \| undefined` | Look up a session by ID. |
| `getSessions()` | `(): Map<string, Session>` | Get the full sessions map. |
| `registerSession(id, data)` | `(id: string, data: TSessionData): Session` | Create and store a new session. |
| `removeSession(id)` | `(id: string): void` | Remove a session, calling `onSessionCleanup` if defined. |
| `displayIframe(sessionId, config?)` | `(sessionId: string, config?: IframeConfig): void` | Renders an iframe in the notebook cell via `Deno.jupyter.display()`. |
| `show(data, config?)` | `(data: TSessionData, config?: IframeConfig): THandle` | All-in-one: generates session ID, registers session, displays iframe, creates and returns the handle. |
| `getBaseUrl()` | `(): string` | Returns `"http://127.0.0.1:{port}"`. |
| `shutdown()` | `(): void` | Cleans up all sessions, shuts down the HTTP server, removes global state. |

#### HTTP Routes

The auto-initialized `Deno.serve` handles these routes:

| Route | Method | Description |
|-------|--------|-------------|
| `/editor?id={sessionId}` | GET | Serves the HTML page from `adapter.renderHTML()` |
| `/static/{adapter.name}.js` | GET | Serves the component JS bundle from `adapter.bundleUrl` |
| `/config?id={sessionId}` | GET | Serves JSON from `adapter.getConfig()` |
| `/ws?id={sessionId}` | GET (upgrade) | WebSocket upgrade, calls `adapter.handleConnection()` |

---

## Patterns and Usage

### Pattern 1: Implementing a WebSocket Client

Extend `WebSocketClientBase` with typed incoming/outgoing message unions.

```typescript
import { WebSocketClientBase } from "@avtools/ui-bridge"

// Define message types
type IncomingMessage =
  | { type: 'dataUpdate'; items: Item[] }
  | { type: 'connectionReady' }

type OutgoingMessage =
  | { type: 'setItems'; items: Item[] }
  | { type: 'setConfig'; interactive: boolean }

class MyComponentClient extends WebSocketClientBase<IncomingMessage, OutgoingMessage> {
  private _items: Item[] = []

  // Custom callbacks
  onItemsUpdate?: (items: Item[]) => void

  constructor(ws: WebSocket) {
    super(ws, { logPrefix: 'MyComponent' })
  }

  protected handleMessage(message: IncomingMessage): void {
    switch (message.type) {
      case 'dataUpdate':
        this._items = message.items
        this.onItemsUpdate?.(this._items)
        break
      case 'connectionReady':
        this._connected = true
        this.onConnectionReady?.()
        break
    }
  }

  // Public command methods
  setItems(items: Item[]): void {
    this.send({ type: 'setItems', items })
  }

  setConfig(config: { interactive: boolean }): void {
    this.send({ type: 'setConfig', ...config })
  }

  get items(): Item[] { return this._items }
  get connected(): boolean { return this._connected }

  disconnect(): void { this.ws.close() }
}
```

### Pattern 2: Implementing a Component Adapter

```typescript
import {
  DenoNotebookBridge,
  type ComponentAdapter,
  type Session
} from "@avtools/ui-bridge"

interface MySessionData {
  type: 'readonly' | 'bound'
  items?: Item[]
}

interface MyHandle {
  readonly latestItems: Item[] | undefined
  disconnect(): void
}

function createMyAdapter(): ComponentAdapter<MyComponentClient, MyHandle, MySessionData> {
  return {
    name: "my-component",
    bundleUrl: new URL("../path/to/dist/my-component.js", import.meta.url),
    defaultIframeConfig: { width: 800, height: 500 },

    renderHTML(wsUrl, sessionId, _sessionData) {
      return `<!DOCTYPE html>
<html><head><title>My Component</title></head>
<body>
  <div id="root"></div>
  <script type="module">
    await import('/static/my-component.js')
    const el = document.createElement('my-component')
    el.setAttribute('ws-address', '${wsUrl}')
    document.getElementById('root').appendChild(el)
  </script>
</body></html>`
    },

    handleConnection(socket, session, _bridge) {
      const client = new MyComponentClient(socket)

      client.onConnectionReady = () => {
        if (session.data.items) {
          client.setItems(session.data.items)
        }
        client.setConfig({ interactive: session.data.type === 'bound' })
      }

      client.onDisconnect = () => {
        // cleanup bindings if needed
      }

      return client
    },

    createHandle(session, bridge) {
      return {
        get latestItems() { return session.data.items },
        disconnect() {
          session.client?.disconnect()
          bridge.removeSession(session.id)
        }
      }
    },

    getConfig(session) {
      return { interactive: session.data.type === 'bound' }
    },

    onSessionCleanup(session) {
      session.client?.disconnect()
    }
  }
}
```

### Pattern 3: Creating a Factory with Reactive Map

The standard pattern wraps the bridge and adapter in a factory function that provides a user-friendly API with a reactive map for bound mode.

```typescript
interface MyBridgeAPI {
  readonly items: MyReactiveMap
  show(items: Item[]): void
  showBound(name: string): MyHandle
  shutdown(): void
}

function createMyBridge(): MyBridgeAPI {
  const adapter = createMyAdapter()
  const bridge = new DenoNotebookBridge(adapter)
  const items = new MyReactiveMap()
  items._setBridge(bridge)

  return {
    items,

    show(itemData: Item[]): void {
      bridge.show({ type: 'readonly', items: itemData })
    },

    showBound(name: string): MyHandle {
      const sessionId = bridge.generateSessionId()
      bridge.registerSession(sessionId, {
        type: 'bound',
        reactiveMap: items,
        name
      })
      items.bind(name, sessionId)
      bridge.displayIframe(sessionId)
      const session = bridge.getSession(sessionId)!
      return adapter.createHandle(session, bridge)
    },

    shutdown(): void {
      bridge.shutdown()
    }
  }
}
```

### Pattern 4: Request/Response with Auto-Timeout

Use `registerPendingRequest` and `resolvePendingRequest` for async queries to the component.

```typescript
// In your WebSocketClientBase subclass:

getPlayStartPosition(): Promise<number> {
  return new Promise((resolve, reject) => {
    const requestId = this.registerPendingRequest(resolve, reject)
    this.send({ type: 'getPlayStartPosition', requestId })
  })
}

// In handleMessage:
case 'playStartPositionResponse': {
  if (message.requestId) {
    this.resolvePendingRequest(message.requestId, message.position)
  }
  break
}
```

The request automatically rejects with `"Request timed out"` after `requestTimeoutMs` (default 10s). All pending requests reject with `"WebSocket connection closed"` if the socket closes.

### Pattern 5: Reactive Map with Multi-Session Sync

The ClipMap and TrackMap patterns show how to build a reactive container that:
- Stores named data entries
- Tracks which sessions are bound to which entries
- On `set()`, pushes updates to all bound sessions (except the originating one via `excludeSession`)
- On `delete()` or `clear()`, disconnects and removes all bound sessions

Key design:
```typescript
class ReactiveMap {
  private data = new Map<string, DataType>()
  private bindings = new Map<string, Set<string>>()  // name -> Set<sessionId>
  private bridge?: BridgeType

  set(name: string, value: DataType, options?: { excludeSession?: string }): this {
    this.data.set(name, value)
    const sessions = this.bindings.get(name)
    if (sessions && this.bridge) {
      for (const sessionId of sessions) {
        if (sessionId === options?.excludeSession) continue
        const session = this.bridge.getSession(sessionId)
        if (session?.client?.connected) {
          session.client.sendUpdate(value)
        }
      }
    }
    return this
  }

  bind(name: string, sessionId: string): void { /* ... */ }
  unbind(name: string, sessionId: string): void { /* ... */ }
}
```

### Pattern 6: End-User Notebook Usage

```typescript
// In a Deno Jupyter notebook cell:
import { createPianoRollBridge } from "./tools/pianoRollAdapter.ts"
import { AbletonClip, quickNote } from "@avtools/music-types"

const piano = createPianoRollBridge()

// Read-only display (snapshot, no sync)
const clip = new AbletonClip()
clip.notes = [quickNote(60, 0, 1), quickNote(64, 1, 1), quickNote(67, 2, 1)]
piano.show(clip)

// Bound display (edits sync back)
piano.clips.set("melody", clip)
const handle = piano.showBound("melody")

// Later: read back edits from the UI
const editedClip = handle.latestClip

// Control the component programmatically
handle.setLivePlayhead(2.5)
handle.fitZoomToNotes()

// Clean up
handle.disconnect()
piano.shutdown()
```

---

## Existing Implementations

### Piano Roll (`apps/deno-notebooks/tools/pianoRollAdapter.ts`)

- **Client:** `PianoRollWebSocketClient` extends `WebSocketClientBase`
- **Adapter:** `createPianoRollAdapter()` returns a `ComponentAdapter`
- **Reactive Map:** `ClipMap` -- stores `AbletonClip` objects by name
- **Handle:** `PianoRollHandle` -- `latestClip`, `disconnect()`, `setLivePlayhead()`, `fitZoomToNotes()`
- **Factory:** `createPianoRollBridge()` returns `PianoRollBridgeAPI` with `show()`, `showBound()`, `clips`, `shutdown()`
- **Bundle:** `webcomponents/piano-roll/dist/piano-roll.js`
- **Data conversion:** `AbletonNote` <-> `NoteData` with stable ID tracking via metadata

### Animation Editor (`apps/deno-notebooks/tools/animationEditorAdapter.ts`)

- **Client:** `AnimationEditorWebSocketClient` extends `WebSocketClientBase`
- **Adapter:** `createAnimationEditorAdapter()` returns a `ComponentAdapter`
- **Reactive Map:** `TrackMap` -- stores `TrackData[]` arrays by animation name
- **Handle:** `AnimationEditorHandle` -- `latestTracks`, `disconnect()`, `setLivePlayhead()`, `scrubToTime()`, `setCallbacks()`
- **Factory:** `createAnimationEditorBridge()` returns `AnimationEditorBridgeAPI` with `show()`, `showFromInputs()`, `showBound()`, `tracks`, `shutdown()`
- **Bundle:** `webcomponents/animation-editor/dist/animation-editor.js`
- **Track types:** `number` (interpolated), `enum` (stepped), `func` (callable)
- **Extra feature:** `TrackCallbacks` for server-side evaluation of track values at a given time

---

## Caveats and Gotchas

### Deno.jupyter Requirement
`displayIframe()` uses `Deno.jupyter.html` and `Deno.jupyter.display()`. These APIs only exist inside a Deno Jupyter kernel. Code that calls `displayIframe()` or `show()` will fail outside of a notebook context. The bridge uses `@ts-ignore` to suppress TypeScript errors for this API.

### Port 0 and Ephemeral Ports
The server starts with `port: 0`, which tells the OS to assign a random available port. The actual port is read from `server.addr.port` after the server starts. All URLs (iframe src, WebSocket address) use `127.0.0.1:{port}`.

### Global State Singleton
Bridge state is stored on `globalThis[`__denoNotebookBridge_{name}__`]`. If you create two `DenoNotebookBridge` instances with the same adapter name, they will share the same server and session map. This is intentional -- it prevents orphaned servers when re-running notebook cells. Call `shutdown()` to fully clean up.

### WebSocket Client is Server-Side
Despite the name, `WebSocketClientBase` runs on the Deno (server) side. The browser web component is the WebSocket client that connects. The naming reflects the API contract: the `WebSocketClientBase` subclass is the Deno-side handle for talking to one connected browser component.

### Bundle URL Must Be Pre-Built
The `bundleUrl` in the adapter must point to a pre-built JavaScript file on disk. The bridge serves it as a static file. The web component source must be compiled/bundled before the notebook can use it.

### Request Timeout
`registerPendingRequest` sets a `setTimeout`. If the component does not respond within `requestTimeoutMs` (default 10000ms), the promise rejects with `"Request timed out"`. All pending requests reject on socket close.

### No Authentication
The HTTP server has no authentication or CORS restrictions. It binds to `127.0.0.1` so it is only accessible locally, but any local process can connect.

### Session Cleanup
Sessions are not automatically cleaned up when an iframe is closed or the browser tab navigates away. The `onDisconnect` callback on the WebSocket client handles unbinding from reactive maps. Call `removeSession()` or `shutdown()` for explicit cleanup.

---

## Monorepo Relationships

```
@avtools/ui-bridge (this package)
  |
  +-- NO dependencies on other @avtools packages
  |   (pure infrastructure, depends only on Deno runtime APIs)
  |
  +-- Used by:
  |     apps/deno-notebooks/tools/pianoRollAdapter.ts
  |     apps/deno-notebooks/tools/pianoRollWebSocketClient.ts
  |     apps/deno-notebooks/tools/animationEditorAdapter.ts
  |     apps/deno-notebooks/tools/animationEditorWebSocketClient.ts
  |
  +-- Adapter implementations depend on:
  |     @avtools/music-types (pianoRollAdapter uses AbletonClip, AbletonNote)
  |     webcomponents/piano-roll/dist/piano-roll.js (pre-built bundle)
  |     webcomponents/animation-editor/dist/animation-editor.js (pre-built bundle)
  |
  +-- Workspace config in root deno.json:
        "@avtools/ui-bridge": "./packages/ui-bridge/mod.ts"
```

---

## File Inventory

| File | Description |
|------|-------------|
| `packages/ui-bridge/mod.ts` | Re-exports everything from the two source files |
| `packages/ui-bridge/websocket_client_base.ts` | `WebSocketClientBase`, `PendingRequest`, `WebSocketClientOptions` |
| `packages/ui-bridge/deno_notebook_bridge.ts` | `DenoNotebookBridge`, `ComponentAdapter`, `Session`, `IframeConfig` |
| `packages/ui-bridge/deno.json` | Package manifest (`@avtools/ui-bridge`, version `0.0.0`) |
