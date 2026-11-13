# Animation-Tweakpane Integration Plan

## Context

The plorkSketch (`apps/deno-notebooks/plorkSketch/sketch.ts`) is a GPU visual sketch running in Deno with:
- A flat mutable `params` object that sketch code reads naively (`params.hue`, `params.orbitSpeed`, etc.)
- A **tweakpane** UI in a native wry webview panel for manual param editing (sliders, toggles, dropdowns, buttons)
- An **animation editor** web component (runs in a separate browser window via `@avtools/ui-bridge`) for keyframe editing over WebSocket
- A **timing engine** (`@avtools/core-timing`) for playback scheduling

The goal is a unified system where:
1. A single `paramDefs` definition generates both the tweakpane UI and animation editor tracks
2. Multiple named animations can be created, edited, and switched between
3. Current param values can be "snapshotted" as keyframes at the current playhead position
4. A sync toggle controls whether animation playback pushes values back to the tweakpane UI
5. Playback writes to the `params` object so the sketch uses animated values transparently

---

## 1. New File: `apps/deno-notebooks/tools/paramSystem.ts`

### 1a. ParamDef Types

```typescript
interface NumberParamDef { value: number; min: number; max: number; step?: number }
interface BooleanParamDef { value: boolean }
interface StringParamDef { value: string; options: Record<string, string> }
interface ActionDef { action: () => void; label?: string }
type ParamDef = NumberParamDef | BooleanParamDef | StringParamDef

// Recursive folder structure
// _actions field holds zero-arg functions → tweakpane buttons + func tracks
interface ParamDefFolder {
  _folder: string;
  _actions?: Record<string, ActionDef>;
  [key: string]: ParamDef | ParamDefFolder | string | Record<string, ActionDef> | undefined
}
type ParamDefs = Record<string, ParamDef | ParamDefFolder>
```

Type inference from leaf nodes:
- `typeof value === "number"` → NumberParamDef (must have `min`/`max`)
- `typeof value === "boolean"` → BooleanParamDef
- `typeof value === "string"` with `options` → StringParamDef

Actions generate:
- Tweakpane buttons via `folder.addButton({title}).on("click", action)`
- Func tracks with `funcName = key`, `args = []` (triggerable during animation playback via `updateFunc` callback)

### 1b. Example paramDefs (from current sketch)

```typescript
const paramDefs = {
  launch: {
    _folder: "Launch",
    duration: { value: 2.0, min: 0.1, max: 10, step: 0.1 },
    radius: { value: 20, min: 1, max: 200, step: 1 },
    hue: { value: 180, min: 0, max: 360, step: 1 },
    randomColor: { value: false },
    waveAmp: { value: 80, min: 0, max: 300, step: 1 },
    waveFreq: { value: 2.0, min: 0, max: 10, step: 0.1 },
    _actions: {
      launchRight: { action: () => launchCircle("right"), label: "Right" },
      launchLeft: { action: () => launchCircle("left"), label: "Left" },
      launchDown: { action: () => launchCircle("down"), label: "Down" },
      launchUp: { action: () => launchCircle("up"), label: "Up" },
    },
  },
  animations: {
    _folder: "Animations",
    bwMode: { value: "orbit" as string, options: { Orbit: "orbit", Walk: "walk" } },
    orbit: {
      _folder: "Orbit",
      orbitRadius: { value: 150, min: 0, max: 400, step: 1 },
      orbitSpeed: { value: 1.0, min: -5, max: 5, step: 0.05 },
      orbitPhase: { value: 0, min: 0, max: 1, step: 0.01 },
      orbitCircleRadius: { value: 15, min: 1, max: 100, step: 1 },
    },
    // ... etc
  },
};
```

### 1c. `buildParamSystem(paramDefs)` function

Recursively walks `paramDefs`. Returns:

| Field | Type | Purpose |
|-------|------|---------|
| `params` | flat mutable object | `{ hue: 180, radius: 20, ... }` — sketch reads this |
| `setupPane(pane)` | `(pane) => Map<string, BindingProxy>` | Builds tweakpane folders/bindings, returns bindings map keyed by param name |
| `trackInputs` | `TrackInput[]` | Empty-data tracks for animation editor with correct types/ranges |
| `paramMeta` | `Map<string, ParamDef>` | Key→original def, used by snapshot |
| `actionMap` | `Map<string, () => void>` | Action name→function, used by func track callback |

Algorithm:
1. Walk tree depth-first
2. At `_folder` nodes → creates tweakpane folder, recurses into children
3. At `_actions` nodes → creates tweakpane buttons + func TrackInputs
4. At leaf nodes with `value` → creates BindingProxy + TrackInput
5. Enforces unique flat keys across all folders (throws on duplicate)

TrackInput mapping:
- NumberParamDef → `{ name: key, fieldType: 'number', data: [], low: min, high: max }`
- BooleanParamDef → `{ name: key, fieldType: 'enum', data: [] }` (values "true"/"false")
- StringParamDef → `{ name: key, fieldType: 'enum', data: [] }` (values from options)
- ActionDef → `{ name: key, fieldType: 'func', data: [] }`

### 1d. `createAnimationCallbacks(params, bindings, paramMeta, actionMap, syncRef)`

Returns `TrackCallbacks`:
```typescript
{
  updateNumber(trackName, value) {
    params[trackName] = value;
    if (syncRef.enabled) bindings.get(trackName)?.refresh();
  },
  updateEnum(trackName, value) {
    // Boolean params: convert "true"/"false" back to boolean
    if (typeof params[trackName] === 'boolean') {
      params[trackName] = value === 'true';
    } else {
      params[trackName] = value;
    }
    if (syncRef.enabled) bindings.get(trackName)?.refresh();
  },
  updateFunc(trackName, funcName, ...args) {
    actionMap.get(funcName)?.();
  },
}
```

`syncRef` is `{ enabled: boolean }` — the bidirectional sync toggle. When enabled, every animation callback also pushes to tweakpane. When disabled, params still update (so GPU sketch uses animated values) but tweakpane UI stays at whatever the user set manually.

### 1e. `snapshotToAnimation(params, paramMeta, trackMap, animName, time)`

1. Gets existing tracks for `animName` from `trackMap`
2. For each track, reads `params[track.name]`
3. Inserts a new keyframe element at `time` with the current value
4. Calls `trackMap.set(animName, updatedTracks, trackOrder)` → auto-broadcasts to connected editors

---

## 2. Multi-Animation Store

Uses existing `TrackMap` from `animationEditorAdapter.ts` — already stores `Map<name, {tracks, trackOrder}>`.

- **Create:** `trackMap.setFromInputs(name, trackInputs)` — shared empty trackInputs from paramSystem
- **Switch:** Update `session.data.animationName`, call `client.setTracks()` with new animation's data
- **Delete:** `trackMap.delete(name)`
- **Auto-sync:** `TrackMap.set()` already broadcasts to all bound sessions

No new store class needed.

---

## 3. Animation Management UI (Wrapper HTML)

### Where it lives

The `renderHTML()` method in `createAnimationEditorAdapter()` (in `animationEditorAdapter.ts`) generates the wrapper page that contains the `<animation-editor-component>`. Following the pattern from the demo sketch (`SketchWrapper.vue`), controls live ABOVE the component.

### Controls to add

- Custom div-based dropdown (not native `<select>`) to select current animation — consistent with tweakpane panel styling
- Text input + "New" button to create animations
- "Delete" button for current animation
- "Snapshot" button — inserts current params as keyframes at current playhead time
- "Sync to Tweakpane" checkbox toggle

### Communication

Extend the existing WebSocket protocol with new management message types:

**Wrapper → Server:**
- `{ type: 'createAnimation', name: string }`
- `{ type: 'switchAnimation', name: string }`
- `{ type: 'deleteAnimation', name: string }`
- `{ type: 'snapshot' }` (server reads current params + playhead time)
- `{ type: 'toggleSync', enabled: boolean }`

**Server → Wrapper:**
- `{ type: 'animationList', names: string[], current: string }`
- `{ type: 'syncState', enabled: boolean }`

These piggyback on the existing WS connection. `AnimationEditorWebSocketClient.handleMessage` delegates unrecognized message types to an optional `onManagementMessage` callback set by the adapter.

### Server-side handling (in adapter's `handleConnection`)

- `createAnimation` → `trackMap.setFromInputs(name, trackInputs)`, send updated `animationList`
- `switchAnimation` → update `session.data.animationName`, `client.setTracks(trackMap.get(name))`
- `deleteAnimation` → `trackMap.delete(name)`, send updated `animationList`
- `snapshot` → call `snapshotToAnimation(params, paramMeta, trackMap, currentAnimName, currentTime)`
- `toggleSync` → update `syncRef.enabled`

---

## 4. Playback Data Routing

### Low-latency path

Add `scrubAndEvaluate(time)` to `AnimationEditorWebSocketClient`:

```typescript
scrubAndEvaluate(time: number): void {
  // Update internal state
  this._state = { ...this._state, currentTime: time };
  // Send to editor for visual playhead update
  this.send({ type: 'scrubToTime', time });
  // Evaluate tracks SERVER-SIDE from cached data (no round-trip)
  this.fireCallbacksFromTracks();
}
```

This avoids the WS round-trip for param updates. The editor component gets the scrub message for visual playhead, and the server evaluates keyframes locally from its cached `_tracks` data.

### Full flow

```
Timing engine (sketch) → handle.scrubAndEvaluate(t)
  ├─ sends scrubToTime to editor component (updates visual playhead)
  ├─ evaluates tracks server-side from cached _tracks data
  └─ fires TrackCallbacks:
       ├─ updateNumber: params[name] = interpolated value
       │   └─ if syncRef.enabled: bindings.get(name).refresh() → tweakpane UI updates
       ├─ updateEnum: params[name] = stepped value (with bool conversion)
       │   └─ if syncRef.enabled: bindings.get(name).refresh()
       └─ updateFunc: actionMap.get(funcName)?.() → fires sketch action

Additionally: handle.setLivePlayhead(t) → updates visual playhead line in editor
```

### In the sketch

```typescript
// Setup
const system = buildParamSystem(paramDefs);
const bindings = system.setupPane(pane);
const syncRef = { enabled: true };
const callbacks = createAnimationCallbacks(
  system.params, bindings, system.paramMeta, system.actionMap, syncRef
);

const anim = createAnimationEditorBridge();
anim.tracks.setFromInputs("default", system.trackInputs);
const handle = anim.showBound("default");
handle.setCallbacks(callbacks);

// Playback (in timing engine branch)
ctx.branch(async (branchCtx) => {
  while (branchCtx.progTime < duration) {
    handle.scrubAndEvaluate(branchCtx.progTime);
    handle.setLivePlayhead(branchCtx.progTime);
    await branchCtx.waitSec(1/60);
  }
});
```

---

## 5. Files to Modify

| File | Change | Scope |
|------|--------|-------|
| `tools/paramSystem.ts` | **NEW** — all paramDef types, buildParamSystem, createAnimationCallbacks, snapshotToAnimation | ~200 lines |
| `tools/animationEditorWebSocketClient.ts` | Add `scrubAndEvaluate()` method, add management message type handling with optional callback | ~30 lines |
| `tools/animationEditorAdapter.ts` | Extend `renderHTML()` with management UI HTML/JS/CSS, extend `handleConnection()` for management messages, accept paramSystem context (params, paramMeta, trackInputs, syncRef, actionMap) | ~150 lines |
| `plorkSketch/sketch.ts` | Refactor to use buildParamSystem, wire animation editor + callbacks + playback | Moderate refactor |

**No changes needed:** `tweakpaneServer.ts` (uses existing `refresh()` and `addBinding` APIs), `animationEditorWebSocket.ts` (browser-side component unchanged), animation editor Vue components (unchanged).

---

## 6. Implementation Order

1. **paramSystem.ts** — types, buildParamSystem, createAnimationCallbacks, snapshotToAnimation
2. **animationEditorWebSocketClient.ts** — add `scrubAndEvaluate()`, management message delegation
3. **animationEditorAdapter.ts** — wrapper HTML with management UI + server-side management handlers
4. **plorkSketch/sketch.ts** — integrate everything, test end-to-end
5. **Rebuild animation-editor webcomponent** — `cd apps/browser-projections && npm run buildAnimationEditor` (only needed if the component itself was changed, e.g., the hide-empty toggle from earlier)

---

## 7. Verification

1. Run sketch — tweakpane should show all params in correct folders with correct ranges
2. Animation editor opens in separate window showing all tracks (empty)
3. Create named animations ("intro", "drop") via wrapper UI dropdown
4. Switch between animations — verify editor shows correct keyframes for each
5. Edit keyframes in one animation, switch to another, verify independent data
6. Snapshot: set params via tweakpane, click snapshot, verify keyframes appear at playhead position
7. Playback: timing engine scrubs, verify `params` updates and tweakpane sliders move (sync on)
8. Toggle sync off: playback still writes to `params` but tweakpane stays at user-set values
9. Func tracks: add action keyframes in animation, verify they fire during playback (e.g., launchCircle triggers)

---

## 8. Resolved Design Decisions

- **Button actions** → Included as func tracks via `_actions` field in ParamDefFolder. They generate both tweakpane buttons AND func tracks in the animation editor.
- **Animation management dropdown** → Custom div-based dropdown (consistent with tweakpane panel styling) even though the wrapper runs in a regular browser context.
- **Flat params keys must be unique** across all folders (enforced at build time).
- **Boolean params become enum tracks** with values `"true"/"false"`. Callback converts back to boolean.
- **Sync toggle** is a simple `{ enabled: boolean }` object ref, toggled from wrapper UI via WS message.
- **Snapshot inserts keyframes** (does not replace all data). If a keyframe exists at the exact time, it gets updated.
- **Server-side track evaluation** for low-latency playback via `scrubAndEvaluate()` using cached track data.

---

## Appendix: Key File Reference

### Sketch & Params
- **`apps/deno-notebooks/plorkSketch/sketch.ts`** — Main sketch file. Currently has a hand-written `params` object, manual `setupPane()`, manual action queue, orbit/walk animations, flood-fill shader chain. Will be refactored to use `buildParamSystem()`.

### Tweakpane (Server-Side)
- **`apps/deno-notebooks/tools/tweakpaneServer.ts`** — Core tweakpane server. Key classes:
  - `TweakpaneServer` — manages operation log, iframe broadcast, binding registry
  - `BindingProxy` (line ~399) — holds `boundObj` + `key` refs. `refresh()` reads value and broadcasts to iframes. Does NOT store min/max.
  - `FolderProxy` — supports `addBinding()`, `addFolder()`, `addButton()`
  - `TweakpaneServer.refresh()` (line ~1105) — bulk-refreshes ALL bindings in one message
  - `_handleValueChange` (line ~1367) — client→server value sync, updates bound object, fires listeners, fans out to other iframes
- **`apps/deno-notebooks/tools/tweakpaneAdapter.ts`** — Bridge adapter for tweakpane. Creates `WindowTweakpane` instances.
- **`apps/deno-notebooks/window/tweakpane_panel.ts`** — Integrates tweakpane with the native wry webview panel. `_attachPanel()` wraps `pollEvents()` to call `processMessages()`.

### Tweakpane (Client-Side)
- **`apps/deno-notebooks/tools/tweakpane_shell_html.ts`** — HTML template for the tweakpane webview. Contains custom `<select>` replacement CSS/JS to avoid macOS native dropdown freeze.
- **`webcomponents/tweakpane/`** — Bundled tweakpane client JS.

### Animation Editor (Component)
- **`apps/browser-projections/src/animationEditor/core.ts`** — `Core` class: non-reactive state machine for tracks, keyframes, undo/redo, evaluation. Deliberately framework-agnostic for WebSocket serialization. Key methods: `addTrack()`, `scrubToTime()`, `evaluateNumberTrack()`, `evaluateEnumTrack()`, `fireFuncHits()`, `createSnapshot()`/`restoreSnapshot()`.
- **`apps/browser-projections/src/animationEditor/types.ts`** — All TypeScript types: `TrackType` (`'number'|'enum'|'func'`), `TrackDef`, `TrackRuntime`, `TrackDatum`, `TrackElement`, `NumberElement`, `EnumElement`, `FuncElementData`, `EditorAction`, `WorldSnapshot`.
- **`apps/browser-projections/src/animationEditor/components/AnimationEditorView.vue`** — Main Vue component. Non-reactive `Core` bridged to Vue via manual refs (`trackIds`, `currentTime`, etc.) and `scheduler.invalidate()`. Recently added: `hideEmptyTracks` toggle with `trackDataVersion` counter for reactivity.
- **`apps/browser-projections/src/animationEditor/web-component.ts`** — Wraps Vue component as `<animation-editor-component>` custom element.
- **`apps/browser-projections/src/animationEditor/animationEditorWebSocket.ts`** — Browser-side WebSocket controller. Handles incoming messages (setTracks, scrubToTime, setLivePlayhead, setConfig, getState) and outgoing messages (tracksUpdate, stateUpdate, connectionReady).
- **`apps/browser-projections/src/sketches/animationEditorDemo/SketchWrapper.vue`** — Demo showing the pattern: controls (scrub slider, display values) live OUTSIDE the animation editor component, in the wrapper.

### Animation Editor (Deno/Server-Side)
- **`apps/deno-notebooks/tools/animationEditorWebSocketClient.ts`** — Server-side WS client. Key types:
  - `TrackInput` — input for creating tracks: `{ name, fieldType, data[], low?, high? }`
  - `TrackData` — internal representation with IDs: `{ id, name, fieldType, elementData[], low, high }`
  - `TrackCallbacks` — `{ updateNumber?(name, value), updateEnum?(name, value), updateFunc?(name, funcName, ...args) }`
  - Key methods: `setTracks()`, `scrubToTime()`, `setLivePlayhead()`, `setTrackCallbacks()`, `fireCallbacksFromTracks()`, `evaluateTrackAt()`, `interpolateNumber()`, `stepValue()`, `stepFuncValue()`
- **`apps/deno-notebooks/tools/animationEditorAdapter.ts`** — Bridge adapter. Key exports:
  - `createAnimationEditorBridge()` → returns `{ tracks: TrackMap, show(), showFromInputs(), showBound(name), shutdown() }`
  - `TrackMap` — stores `Map<name, {tracks, trackOrder}>`. `set()` auto-broadcasts to bound sessions. `bind()/unbind()` manage session-to-animation bindings.
  - `AnimationEditorHandle` — `{ latestTracks, client, disconnect(), setLivePlayhead(pos), scrubToTime(time), setCallbacks(cb) }`
  - `trackInputsToData(inputs)` — converts `TrackInput[]` to `TrackData[]` with generated IDs
  - `renderHTML()` — generates wrapper page with `<animation-editor-component>` web component

### UI Bridge (Framework)
- **`packages/ui-bridge/deno_notebook_bridge.ts`** — `DenoNotebookBridge<TClient, THandle, TData>`: generic session-based WS bridge. Manages HTTP server, WS upgrade, session registry, iframe display. Key methods: `registerSession()`, `getSession()`, `removeSession()`, `displayIframe()`, `show()`, `generateSessionId()`.
- **`packages/ui-bridge/mod.ts`** — Re-exports bridge, adapters, inspector registry.

### Native Window System
- **`apps/deno-notebooks/window/panel.ts`** — `WindowPanel`: manages wry webview in its own native window. `pollMessages()` calls `webview_pump()` (synchronous FFI) + `webview_poll_ipc()`. The `webview_pump()` call can block during native modal UIs (like `<select>` dropdowns) — custom div-based dropdowns avoid this.
- **`apps/deno-notebooks/window/window_render_manager.ts`** — Main render loop: `pollEvents()` → `frame()` → `present()`. Integrates tweakpane panel via `processMessages()`.
- **`apps/deno-notebooks/native/deno_window/src/lib.rs`** — Rust FFI layer. `webview_pump()` calls `pump_for_webview()` + `CFRunLoopRunInMode()`. WKWebView and winit EventLoop are main-thread-bound.

### Build
- **`apps/browser-projections/vite.animation-editor.config.ts`** — Vite config for building the animation-editor web component bundle (IIFE format).
- **`webcomponents/animation-editor/dist/animation-editor.js`** — Built bundle, served as static file by the ui-bridge HTTP server.
- Build command: `cd apps/browser-projections && npm run buildAnimationEditor`

### Shader FX (Referenced by sketch)
- **`packages/shader-fx/raw/shaderFXRaw.ts`** — Raw WebGPU shader effect framework. `CustomShaderEffect`, `PassthruEffect`, `FeedbackNode`, `ShaderEffect` base class.
- **`packages/shader-fx/generated-raw/shaders/`** — Generated effect classes: `AlphaTimeTagEffect`, `FloodFillStepEffect` (recently modified with `diskRadius`/`useDisk` uniforms), `FloodFillDisplayEffect`.
- **`apps/deno-notebooks/shaders/floodFillStep.fragFunc.wgsl`** — WGSL source for flood fill with disk stencil option.

### Timing Engine
- **`packages/core-timing/`** — `launch()`, `DateTimeContext` with `branch()`, `waitSec()`, `progTime`, `isCanceled`. Used by the sketch's action queue and animation playback.
