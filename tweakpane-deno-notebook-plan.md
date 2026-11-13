# Tweakpane Server for Deno Notebooks — Implementation Plan

## Context

We need tweakpane to work in deno notebooks so the user can livecode with a rich parameter UI. The challenge: tweakpane is DOM-dependent and runs in the browser, but the notebook kernel (Deno) holds the source-of-truth state. Multiple iframe views of the same pane must stay in sync.

**Approach**: Proxy/recorder pattern on the kernel side (no DOM shim). The kernel maintains a proxy API that is 1:1 compatible with tweakpane's public API plus a `show()` method. All API calls are recorded in an operation log and broadcast to connected iframe clients. Each iframe runs a real tweakpane Pane instance. Value changes in any iframe flow back to the kernel, which updates the bound object and fans out to other iframes.

**Type Safety Constraint**: All proxy classes (TweakpaneServer, BindingProxy, FolderProxy, ButtonProxy, TabProxy, TabPageProxy, BladeProxy, and standalone blade proxies) MUST formally extend or implement the corresponding tweakpane types (Pane/FolderApi, BindingApi, ButtonApi, TabApi, TabPageApi, BladeApi, etc.) so that TypeScript enforces 1:1 API compatibility. Any missing methods or wrong signatures will produce type errors that must be resolved before the implementation is considered complete.

---

## Architecture Overview

```
Kernel (Deno)                          Browser (iframe)
─────────────                          ─────────────────
TweakpaneServer (proxy)                TweakpaneClient
  ├─ operation log                       ├─ real Pane instance
  ├─ binding registry                    ├─ idMap: proxyId → real API object
  │   (proxyId → {obj, key})             ├─ WebSocket connection
  ├─ event listeners                     └─ sync logic
  │   (proxyId → callbacks)
  ├─ sessions (WebSocket clients)
  └─ DenoNotebookBridge integration

         ←── WS: valueChange, buttonClick, foldChange, tabSelect ───
         ─── WS: operation, refresh, setProperty, dispose ──→
```

---

## File Structure

```
apps/deno-notebooks/tools/
  tweakpaneServer.ts          — Kernel-side proxy (TweakpaneServer + proxy classes)
  tweakpaneAdapter.ts         — ComponentAdapter + WebSocket client + bridge factory
  tweakpaneProtocol.ts        — Shared message types for WS protocol

webcomponents/tweakpane/
  src/
    tweakpane-client.ts       — Browser-side client (receives ops, runs real Pane)
  dist/
    tweakpane-client.js       — Bundled client + tweakpane library
  package.json
  tsconfig.json
  build.ts                    — esbuild/rollup config
```

---

## Part 1: WebSocket Protocol (`tweakpaneProtocol.ts`)

Shared types imported by both kernel and client.

### Kernel → Client Messages

```typescript
// Replay/live operations
type OpMessage =
  | { type: 'addBinding'; id: string; parentId: string; key: string;
      value: unknown; opts: SerializedBindingParams }
  | { type: 'addFolder'; id: string; parentId: string; opts: FolderParams }
  | { type: 'addButton'; id: string; parentId: string; opts: ButtonParams }
  | { type: 'addTab'; id: string; parentId: string; opts: TabParams;
      pageIds: string[] }
  | { type: 'addTabPage'; id: string; parentId: string; opts: TabPageParams }
  | { type: 'addBlade'; id: string; parentId: string; opts: SerializedBladeParams }
  | { type: 'addSeparator'; id: string; parentId: string }
  | { type: 'remove'; id: string; parentId: string }
  | { type: 'dispose'; id: string }

// Value/property updates
  | { type: 'refresh'; values: Record<string, unknown> }
  | { type: 'setProperty'; id: string; prop: string; value: unknown }
  | { type: 'bladeValue'; id: string; value: unknown }

// Initial replay
  | { type: 'replay'; operations: OpMessage[] }

// Connection setup
  | { type: 'init'; paneConfig: SerializedPaneConfig }
```

### Client → Kernel Messages

```typescript
type ClientMessage =
  | { type: 'valueChange'; id: string; key: string; value: unknown; last: boolean }
  | { type: 'buttonClick'; id: string }
  | { type: 'foldChange'; id: string; expanded: boolean }
  | { type: 'tabSelect'; id: string; index: number }
  | { type: 'bladeValueChange'; id: string; value: unknown; last: boolean }
  | { type: 'connectionReady' }
```

### Serialization of Non-JSON Values

Options containing functions (format, parse, etc.) require special handling:

```typescript
interface SerializedBindingParams {
  // JSON-safe options copied as-is
  label?: string; min?: number; max?: number; step?: number;
  // ...all other JSON-safe options

  // Functions serialized as source strings (evaluated in iframe via new Function)
  _functions?: Record<string, string>;  // e.g. { format: "(v) => v.toFixed(2)" }
}
```

When serializing `addBinding` / `addBlade` opts:
1. Walk the options object
2. JSON-safe values → copy directly
3. Functions → store as `fn.toString()` in `_functions` map
4. On iframe side: reconstruct functions from source strings

This is safe in a notebook context (user's own code). Document that closures over external variables won't work — only pure functions.

---

## Part 2: Kernel-Side Proxy (`tweakpaneServer.ts`)

### Core Classes

#### `TweakpaneServer` (replaces `Pane`)

```typescript
class TweakpaneServer {
  private id = 'root'
  private operations: OpMessage[] = []
  private bindings = new Map<string, { obj: any; key: string }>()
  private bladeValues = new Map<string, { value: unknown }>()  // for standalone blades
  private listeners = new Map<string, Map<string, Function[]>>()  // id → event → handlers
  private sessions = new Set<string>()  // active session IDs
  private bridge: DenoNotebookBridge | null = null
  private paneConfig: PaneConfig

  constructor(config?: { title?: string; expanded?: boolean }) {}

  // Container methods (delegated to ContainerMixin)
  addBinding(obj, key, opts?): BindingProxy
  addFolder(opts): FolderProxy
  addButton(opts): ButtonProxy
  addTab(opts): TabProxy
  addBlade(opts): BladeProxy  // returns specific subtype based on opts.view

  // Events
  on(event, handler): this
  off(event, handler): this

  // State sync
  refresh(): void      // push all binding values to all iframes
  show(config?): void  // create new synced iframe

  // Lifecycle
  dispose(): void
  shutdown(): void

  // State import/export
  exportState(): BladeState
  importState(state: BladeState): void

  // Plugin registration
  registerPlugin(bundle): void  // NOTE: see limitations section

  // Properties
  get/set title: string | undefined
  get/set expanded: boolean
  get/set disabled: boolean
  get/set hidden: boolean
  get children: BladeProxy[]

  // Internal
  _recordOp(op: OpMessage): void       // append to log + broadcast to live iframes
  _broadcastToIframes(msg, excludeSessionId?): void
  _handleClientMessage(sessionId, msg: ClientMessage): void
}
```

#### Proxy Base: `BladeProxy`

```typescript
class BladeProxy {
  readonly proxyId: string
  protected server: TweakpaneServer

  get/set disabled: boolean
  get/set hidden: boolean
  get element(): never  // throws — no DOM on kernel

  dispose(): void
  exportState(): BladeState
  importState(state): boolean
}
```

#### `BindingProxy` extends `BladeProxy`

```typescript
class BindingProxy extends BladeProxy {
  readonly key: string
  readonly boundObj: any

  get/set label: string | undefined
  get/set tag: string | undefined

  on(event: 'change', handler): this
  off(event: 'change', handler): this
  refresh(): void  // re-read from bound object, push to iframes
}
```

Specialized subtypes for bindings that have extra properties:
- `SliderBindingProxy` — adds `get/set min`, `get/set max`
- `ListBindingProxy` — adds `get/set options`

#### `FolderProxy` extends `BladeProxy`

```typescript
class FolderProxy extends BladeProxy {
  get/set title: string | undefined
  get/set expanded: boolean
  get children: BladeProxy[]

  // Container methods (same as TweakpaneServer)
  addBinding(obj, key, opts?): BindingProxy
  addFolder(opts): FolderProxy
  addButton(opts): ButtonProxy
  addTab(opts): TabProxy
  addBlade(opts): BladeProxy

  on(event: 'change' | 'fold', handler): this
  off(event, handler): this
  refresh(): void
}
```

#### `ButtonProxy` extends `BladeProxy`

```typescript
class ButtonProxy extends BladeProxy {
  get/set title: string
  get/set label: string | undefined

  on(event: 'click', handler): this
  off(event: 'click', handler): this
}
```

#### `TabProxy` extends `BladeProxy`

```typescript
class TabProxy extends BladeProxy {
  get pages: TabPageProxy[]

  addPage(opts): TabPageProxy
  removePage(index): void

  on(event: 'change' | 'select', handler): this
  off(event, handler): this
  refresh(): void
}
```

#### `TabPageProxy` extends `BladeProxy`

```typescript
class TabPageProxy extends BladeProxy {
  get/set title: string
  get/set selected: boolean
  get children: BladeProxy[]

  // Container methods (same as FolderProxy)
  addBinding, addFolder, addButton, addTab, addBlade
  refresh(): void
}
```

#### Standalone Blade Proxies

For `addBlade({view: 'slider'})`, `addBlade({view: 'list'})`, `addBlade({view: 'text'})`:

```typescript
class SliderBladeProxy extends BladeProxy {
  get/set value: number
  get/set min: number
  get/set max: number
  get/set label: string | undefined
  on(event: 'change', handler): this
  off(event, handler): this
}

class ListBladeProxy extends BladeProxy {
  get/set value: unknown
  get/set options: ListItem[]
  get/set label: string | undefined
  on(event: 'change', handler): this
  off(event, handler): this
}

class TextBladeProxy extends BladeProxy {
  get/set value: unknown
  get/set label: string | undefined
  on(event: 'change', handler): this
  off(event, handler): this
}

class SeparatorBladeProxy extends BladeProxy {
  // No additional members
}
```

### Container Mixin

Since `TweakpaneServer`, `FolderProxy`, `TabPageProxy` all share container methods, extract a mixin/helper:

```typescript
function addContainerMethods(target, server, parentId) {
  target.addBinding = (obj, key, opts?) => {
    const id = generateId()
    const value = obj[key]
    const serializedOpts = serializeOpts(opts)
    server._registerBinding(id, obj, key)
    server._recordOp({ type: 'addBinding', id, parentId, key, value, opts: serializedOpts })
    return new BindingProxy(id, key, obj, server)
  }
  // ... addFolder, addButton, addTab, addBlade similarly
}
```

### Property Setter Broadcasting

When a property is set on a proxy (e.g. `folder.expanded = false`), it:
1. Stores the new value locally on the proxy
2. Broadcasts `{ type: 'setProperty', id: proxyId, prop: 'expanded', value: false }` to all iframes
3. Updates the operation log (for replay to new iframes)

For the operation log update: rather than modifying past operations, append a `setProperty` op. On replay, operations are applied in order, so the final state is correct.

### Event Handling

When kernel code does `pane.on('change', handler)`:
1. Store `handler` in `listeners.get(proxyId).get('change')`
2. When a `valueChange` message arrives from any iframe, construct a `TpChangeEvent`-like object and call all registered handlers

For `buttonClick`, `foldChange`, `tabSelect` — same pattern.

### refresh() Implementation

```typescript
refresh(): void {
  const values: Record<string, unknown> = {}
  for (const [id, { obj, key }] of this.bindings) {
    values[id] = obj[key]
  }
  for (const [id, { value }] of this.bladeValues) {
    values[id] = value
  }
  this._broadcastToIframes({ type: 'refresh', values })
}
```

---

## Part 3: Adapter & Bridge (`tweakpaneAdapter.ts`)

Follows the exact pattern of `pianoRollAdapter.ts`.

### TweakpaneWebSocketClient (extends WebSocketClientBase)

```typescript
class TweakpaneWebSocketClient extends WebSocketClientBase<ClientMessage, OpMessage> {
  // Outgoing commands (kernel → iframe)
  sendOperation(op: OpMessage): void
  sendReplay(ops: OpMessage[], paneConfig): void
  sendRefresh(values: Record<string, unknown>): void
  sendSetProperty(id, prop, value): void

  // Incoming event callbacks (set by adapter.handleConnection)
  onValueChange?: (id, key, value, last, sessionId) => void
  onButtonClick?: (id, sessionId) => void
  onFoldChange?: (id, expanded, sessionId) => void
  onTabSelect?: (id, index, sessionId) => void
  onBladeValueChange?: (id, value, last, sessionId) => void

  protected handleMessage(msg: ClientMessage): void {
    switch (msg.type) {
      case 'valueChange': this.onValueChange?.(msg.id, msg.key, msg.value, msg.last, this.sessionId); break;
      case 'buttonClick': this.onButtonClick?.(msg.id, this.sessionId); break;
      // ...etc
    }
  }
}
```

### ComponentAdapter Implementation

```typescript
function createTweakpaneAdapter(): ComponentAdapter<TweakpaneWebSocketClient, TweakpaneHandle, TweakpaneSessionData> {
  return {
    name: 'tweakpane',
    bundleUrl: new URL('../../../webcomponents/tweakpane/dist/tweakpane-client.js', import.meta.url),
    defaultIframeConfig: { width: 340, height: 500, style: '...' },

    renderHTML(wsUrl, sessionId, sessionData) {
      return `<!DOCTYPE html>
        <html><head>
          <style>body { margin: 0; background: #2b2b2b; }</style>
        </head><body>
          <div id="root"></div>
          <script type="module">
            import { TweakpaneClient } from '/static/tweakpane.js'
            const client = new TweakpaneClient('${wsUrl}', document.getElementById('root'))
          </script>
        </body></html>`
    },

    handleConnection(socket, session, bridge) {
      const client = new TweakpaneWebSocketClient(socket, session.id)
      const server = session.data.server

      client.onConnectionReady = () => {
        // Send full operation log to build the pane
        client.sendReplay(server.operations, server.paneConfig)
      }

      // Wire up all event callbacks to route through TweakpaneServer
      client.onValueChange = (id, key, value, last, sessionId) => {
        server._handleValueChange(id, key, value, last, sessionId)
      }
      client.onButtonClick = (id, sessionId) => {
        server._handleButtonClick(id, sessionId)
      }
      client.onFoldChange = (id, expanded, sessionId) => {
        server._handleFoldChange(id, expanded, sessionId)
      }
      client.onTabSelect = (id, index, sessionId) => {
        server._handleTabSelect(id, index, sessionId)
      }
      client.onBladeValueChange = (id, value, last, sessionId) => {
        server._handleBladeValueChange(id, value, last, sessionId)
      }

      return client
    },

    createHandle(session, bridge) {
      return { disconnect() { bridge.removeSession(session.id) } }
    },

    getConfig(session) { return {} }
  }
}
```

### Factory Function

```typescript
export function createTweakpaneBridge(): TweakpaneServer {
  const adapter = createTweakpaneAdapter()
  const bridge = new DenoNotebookBridge(adapter)
  const server = new TweakpaneServer()
  server._setBridge(bridge)
  return server
}
```

Wait — the user wants `new TweakpaneServer()` to just work. The bridge setup should be lazy (on first `show()` call), or the factory should be the entry point.

**Revised**: `TweakpaneServer` lazily initializes the bridge on the first `show()` call:

```typescript
class TweakpaneServer {
  private bridge: DenoNotebookBridge | null = null

  show(config?: IframeConfig): void {
    if (!this.bridge) {
      const adapter = createTweakpaneAdapter(this)
      this.bridge = new DenoNotebookBridge(adapter)
    }
    const sessionId = this.bridge.generateSessionId()
    this.bridge.registerSession(sessionId, { server: this })
    this.sessions.add(sessionId)
    this.bridge.displayIframe(sessionId, config)
  }
}
```

This way the user just does:
```typescript
const pane = new TweakpaneServer()
pane.addBinding(params, 'speed')
pane.show()
```

---

## Part 4: Browser Client (`tweakpane-client.ts`)

Runs in the iframe. Builds and manages a real tweakpane Pane.

```typescript
class TweakpaneClient {
  private pane: Pane
  private ws: WebSocket
  private idMap = new Map<string, any>()  // proxyId → real tweakpane API object
  private localObjects = new Map<string, any>()  // proxyId → local {key: value} object
  private suppressSync = false

  constructor(wsUrl: string, container: HTMLElement) {
    this.ws = new WebSocket(wsUrl)
    this.ws.onopen = () => this.ws.send(JSON.stringify({ type: 'connectionReady' }))
    this.ws.onmessage = (e) => this.handleMessage(JSON.parse(e.data))
  }

  private handleMessage(msg) {
    switch (msg.type) {
      case 'init':
        this.pane = new Pane({ container: this.container, ...msg.paneConfig })
        this.idMap.set('root', this.pane)
        break

      case 'replay':
        // Create pane first
        this.pane = new Pane({ container: this.container, ...msg.paneConfig })
        this.idMap.set('root', this.pane)
        for (const op of msg.operations) this.applyOperation(op)
        break

      case 'addBinding':
      case 'addFolder':
      case 'addButton':
      case 'addTab':
      case 'addBlade':
      case 'remove':
      case 'dispose':
        this.applyOperation(msg)
        break

      case 'refresh':
        this.suppressSync = true
        for (const [id, value] of Object.entries(msg.values)) {
          const entry = this.localObjects.get(id)
          if (entry) {
            entry.obj[entry.key] = value
          }
          const api = this.idMap.get(id)
          if (api?.refresh) api.refresh()
          // For standalone blades (slider, list, text), set value directly
          if (api && 'value' in api && !entry) {
            api.value = value
          }
        }
        this.suppressSync = false
        break

      case 'setProperty':
        const target = this.idMap.get(msg.id)
        if (target) {
          this.suppressSync = true
          target[msg.prop] = msg.value
          this.suppressSync = false
        }
        break
    }
  }

  private applyOperation(op) {
    const parent = this.idMap.get(op.parentId)
    if (!parent) return

    switch (op.type) {
      case 'addBinding': {
        const localObj = { [op.key]: op.value }
        const opts = deserializeOpts(op.opts)
        const binding = parent.addBinding(localObj, op.key, opts)
        this.idMap.set(op.id, binding)
        this.localObjects.set(op.id, { obj: localObj, key: op.key })

        binding.on('change', (ev) => {
          if (this.suppressSync) return
          this.ws.send(JSON.stringify({
            type: 'valueChange', id: op.id, key: op.key,
            value: ev.value, last: ev.last
          }))
        })
        break
      }

      case 'addFolder': {
        const folder = parent.addFolder(op.opts)
        this.idMap.set(op.id, folder)

        folder.on('fold', (ev) => {
          if (this.suppressSync) return
          this.ws.send(JSON.stringify({
            type: 'foldChange', id: op.id, expanded: ev.expanded
          }))
        })
        break
      }

      case 'addButton': {
        const btn = parent.addButton(op.opts)
        this.idMap.set(op.id, btn)

        btn.on('click', () => {
          this.ws.send(JSON.stringify({ type: 'buttonClick', id: op.id }))
        })
        break
      }

      case 'addTab': {
        const tab = parent.addTab(op.opts)
        this.idMap.set(op.id, tab)
        // Map each page to its ID
        tab.pages.forEach((page, i) => {
          this.idMap.set(op.pageIds[i], page)
        })

        tab.on('select', (ev) => {
          if (this.suppressSync) return
          this.ws.send(JSON.stringify({
            type: 'tabSelect', id: op.id, index: ev.index
          }))
        })
        break
      }

      case 'addBlade': {
        const blade = parent.addBlade(op.opts)
        this.idMap.set(op.id, blade)

        // If the blade has a value (slider, list, text), listen for changes
        if ('on' in blade) {
          blade.on('change', (ev) => {
            if (this.suppressSync) return
            this.ws.send(JSON.stringify({
              type: 'bladeValueChange', id: op.id, value: ev.value, last: ev.last
            }))
          })
        }
        break
      }

      case 'remove': {
        const child = this.idMap.get(op.id)
        if (child && parent.remove) parent.remove(child)
        this.idMap.delete(op.id)
        this.localObjects.delete(op.id)
        break
      }

      case 'dispose': {
        const target = this.idMap.get(op.id)
        if (target?.dispose) target.dispose()
        this.idMap.delete(op.id)
        break
      }
    }
  }
}
```

### Function Deserialization

```typescript
function deserializeOpts(opts: SerializedBindingParams): any {
  const result = { ...opts }
  if (opts._functions) {
    for (const [key, source] of Object.entries(opts._functions)) {
      try {
        result[key] = new Function('return ' + source)()
      } catch (e) {
        console.warn(`Failed to deserialize function '${key}':`, e)
      }
    }
    delete result._functions
  }
  return result
}
```

---

## Part 5: Build Setup (`webcomponents/tweakpane/`)

### package.json
```json
{
  "name": "tweakpane-client",
  "private": true,
  "scripts": {
    "build": "node build.js"
  },
  "dependencies": {
    "tweakpane": "^4.0.5"
  },
  "devDependencies": {
    "esbuild": "^0.20.0"
  }
}
```

### build.ts (esbuild)
Bundle `tweakpane-client.ts` + `tweakpane` into a single ESM file:
```typescript
import * as esbuild from 'esbuild'
esbuild.build({
  entryPoints: ['src/tweakpane-client.ts'],
  bundle: true,
  format: 'esm',
  outfile: 'dist/tweakpane-client.js',
  external: [],  // bundle everything including tweakpane
})
```

---

## Part 6: Multi-Instance Sync

The sync pattern follows the existing ClipMap/TrackMap approach:

### Value Change Flow (iframe A edits → sync to B, C)

1. User drags slider in iframe A
2. Tweakpane fires `binding.on('change')` in iframe A
3. Client sends `{ type: 'valueChange', id: 'b1', key: 'speed', value: 5.0, last: false }`
4. Kernel `_handleValueChange()`:
   a. Looks up binding: `bindings.get('b1')` → `{ obj: params, key: 'speed' }`
   b. Updates kernel object: `params.speed = 5.0`
   c. Fires kernel-side listeners: `pane.on('change')` handlers
   d. Broadcasts to all OTHER sessions: `{ type: 'refresh', values: { b1: 5.0 } }`
   e. (Uses targeted single-binding refresh, not full refresh, for efficiency)
5. Iframe B receives refresh → updates local object → calls `binding.refresh()`
6. Iframe B's `suppressSync` flag prevents echo back to kernel

### Targeted Refresh (optimization)

Instead of always sending ALL values, value changes from iframes trigger a targeted update:

```typescript
_handleValueChange(id, key, value, last, originSessionId) {
  const binding = this.bindings.get(id)
  if (binding) binding.obj[binding.key] = value

  // Fire kernel listeners
  this._fireListeners(id, 'change', { value, last, key })
  this._fireListeners('root', 'change', { value, last, key })  // bubble to pane

  // Fan out to other iframes (skip originator)
  this._broadcastToIframes(
    { type: 'refresh', values: { [id]: value } },
    originSessionId
  )
}
```

### Button/Fold/Tab Sync

Buttons: click → kernel callback only (no state to sync between iframes)
Fold: expanded change → broadcast `setProperty` to other iframes
Tab select: index change → broadcast `setProperty` to other iframes

---

## Part 7: Known Limitations & Future Work

### registerPlugin()

Custom plugins contain executable code (controllers, views) that must run in the browser. Current plan:
- **Built-in plugins work automatically** (they're bundled with tweakpane in the client bundle)
- **Custom plugins**: Provide a `registerPlugin(bundle, importUrl)` variant where `importUrl` points to a browser-loadable module. The iframe will dynamically import it.
- Alternative: allow pre-registering plugin URLs in the TweakpaneServer constructor that get loaded in every iframe.

### Function serialization

`Function.toString()` + `new Function()` works for pure functions but not closures. Document this limitation. Most tweakpane `format`/`parse` options are pure functions.

### Monitor bindings (readonly: true)

Monitor bindings poll the bound object on an interval. In our architecture:
- Kernel-side: the bound object is the source of truth
- The polling happens in the iframe, but the iframe's local object won't change automatically
- Solution: when a monitor binding is created, the kernel sets up a `setInterval` that pushes the current value to all iframes at the configured interval

### exportState() / importState()

- `exportState()`: Collect all proxy states (values, disabled, hidden, expanded, etc.) into a BladeState tree. This is kernel-side only (no need to query iframes).
- `importState()`: Apply state to kernel proxies, then broadcast changes to all iframes.

---

## Implementation Order

1. **`tweakpaneProtocol.ts`** — Message types (small, dependency-free)
2. **`tweakpaneServer.ts`** — Kernel proxy classes (largest piece, ~600-800 lines)
   - Start with TweakpaneServer + BladeProxy base
   - Add BindingProxy, FolderProxy, ButtonProxy
   - Add TabProxy, TabPageProxy
   - Add standalone blade proxies (Slider, List, Text, Separator)
   - Add event system + refresh
   - Add exportState/importState
3. **`webcomponents/tweakpane/src/tweakpane-client.ts`** — Browser client (~300-400 lines)
   - Operation replay engine
   - Real Pane management
   - Change detection + WS send
   - Incoming refresh/setProperty handling
4. **`webcomponents/tweakpane/build.ts`** — Bundle client + tweakpane
5. **`tweakpaneAdapter.ts`** — Bridge integration (~200 lines)
   - TweakpaneWebSocketClient
   - ComponentAdapter implementation
   - Bridge wiring into TweakpaneServer
6. **Test in notebook** — Create example notebook exercising all features

---

## Verification

1. **Basic test**: Create a pane with addBinding for number, string, boolean, color, point2d. Call show(). Verify UI renders and values sync bidirectionally.
2. **Multi-instance test**: Call show() twice. Change a value in one iframe, verify the other updates. Change on kernel with refresh(), verify both update.
3. **Folder/Tab test**: Create nested folders and tabs. Verify structure renders correctly in iframe. Test fold/expand sync.
4. **Button test**: Add button with kernel callback. Click in iframe, verify kernel callback fires.
5. **Standalone blade test**: addBlade with slider, list, text views. Verify value changes sync.
6. **Property sync test**: Set disabled/hidden/expanded/title from kernel, verify iframes update.
7. **Late connection test**: Call show() after all bindings are set up. Then call show() again. Verify both have identical state.
8. **Post-show modification test**: Call addBinding after show(). Verify open iframes get the new binding dynamically.
