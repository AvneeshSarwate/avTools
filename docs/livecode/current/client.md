# Current Client Architecture

Status: checked against `apps/livecode-tldraw/src` on 2026-08-26.

Use `apps/livecode-tldraw/architecture.md` for the local file index. This
document explains how the client's state machines and registries meet; component
props and UI details belong in source.

## State layers and provider order

`SyncRuntimeProvider` must wrap `LivecodeRuntimeProvider`:

- `syncRuntime.tsx` owns the server URL, public contexts/hooks, write actions,
  sequence-gap recovery, and lifecycle notifications. `syncState.ts` applies
  sync truth; `syncTransport.ts` adapts WebSocket and `BroadcastChannel`.
- `livecodeRuntime.tsx` consumes run/wait/lookup slices and socket edges. It
  owns Connect, health/LSP/rehydration, module analysis, launch/stop, and the
  mutable coordination record behind each published module view, with build and
  run transitions isolated in `buildLifecycle.ts` and `runCorrelation.ts`.
- `App.tsx` joins those services to the tldraw store. `TopBar.tsx`,
  `projectCanvas.ts`, and `clientControlBridge.ts` own the corresponding UI,
  canvas/project helpers, and automation bridge.

Entity kinds have separate React contexts so high-rate signals do not rerender
every roll or params pane. Incoming messages are accumulated in refs and
published once per animation frame. Do not collapse the slices into one context
or publish directly on every approximately 33 ms engine tick.

Socket open/close edges are also delivered through listeners rather than
inferred from React state. A close and reopen can be batched into one commit;
losing the edge would skip the recovery sequence.

## Connect and recovery

The sync transport opens at provider mount. Connect is a separate armed flag:
when armed on a real socket open, the client performs health, creates a fresh
LSP session, adopts `/runtime/state`, flushes stops queued for shapes deleted
while offline, and reanalyzes registered modules.

A sync sequence gap has no replay. The client resubscribes, and each returned
reset replaces that kind's complete map. On connection loss an armed runtime
marks run/wait/lookup presentation unknown and clears transient decorations;
entity views retain/recover truth through the sync layer.

`?sync=broadcast` and `?actions=broadcast` select the same-origin baked/served
browser-engine paths. They must preserve the WebSocket/HTTP semantics even
though their transport is a `BroadcastChannel`. `serverBaseUrl=none` selects a
baked project boot from `baked.json`.

`?engine=inprocess` makes this tab the engine (`inProcessEngine.ts`). The page
dynamically imports `./engine/engine_host.js` from the served asset tree, never
a Vite-bundled engine, and `index.html` carries the same module import map as
the engine page (kept identical by `browser_host_import_map_test.ts`). Sync is
then a same-realm observer and entity actions call `executeEngineOp` directly;
launch, analysis, project, and LSP stay HTTP. The transport reports "open" only
while the engine has attached to the server over its uplink (or immediately
when `serverBaseUrl=none`), so the runtime's connect sequence and project open
wait for the engine the server will forward to. Entity truth flows regardless
of that link. Boot parameters are read through `bootParams.ts`, which falls
back to `window.livecodeBootDefaults`, the values a bake stamps into its copied
`index.html` so its bare root URL opens in this form. The page renders a
`#livecode-stage` container (off-screen, not `display:none`) that modules draw
into, and the topbar shows an engine pill with the same takeover the engine page
offers. Reloading the page restarts the engine.

## Analysis and launch ordering

Each module has one build lifecycle rather than independent pending flags. A
queued build owns its debounce timer, an analyzing build owns its request and
promise, and a ready build owns its preparation. Work is identified by source
plus server; late callbacks apply only while their request is still current.
Pressing Run follows the freshest buffer rather than whichever build completed
first.

For project modules, buffer write-through and a successful shadow diagnostic
check precede the launch request. Direct server callers do not receive this
guard.

The client begins launch correlation before HTTP returns because a terminal
`run` entity can cross the acknowledgement (instant failure is the important
case). While the request is pending, that terminal remains in the sync store but
is not applied to the module view. After acknowledgement the client reapplies
current sync truth and accepts only the acknowledged `runToken`. Never correlate
by `generatedRunId`: an unchanged build can be launched more than once.

Run and Replace are intentionally different gestures. Run never asks to replace
an occupied module; while one is active, the control reads Replace and sends
`replaceRunning: true`. Edits do not stop an older version automatically.

## Canvas views and domain entities

A tldraw shape is a view, not the entity it displays. Deleting a view never
deletes engine data, and deleting an entity leaves its views in a waiting
state. Duplication creates a new entity and an adjacent view; multiple views may
legitimately point to the same entity.

`CANVAS_VIEW_CODECS` in `canvasViews.ts` is the client extension point. One
codec supplies shape registration, project collection/restoration,
change detection, optional durable-entity reference, and view construction.
This drives project layout, topbar actions, inline entity widgets, and test
helpers. Do not add a parallel switch in `App.tsx` for a new canvas view.

The server's `/project/canvas` operation replaces the whole object, so every
post must collect all registered view kinds together. Restores reuse saved
shape IDs and skip an already-present ID. Only module and registered-view
layout is project-persisted; arbitrary tldraw shapes require a `.tldr` save.

## Shape boundaries

`LivecodeEditorShape` keeps source and module identity in tldraw props while the
runtime record mirrors coordination state. `projectSourceUri` makes CodeMirror
and Deno LSP address the real `*.orig.ts`, not a synthetic transient document.
Manifest offsets are joined with runtime waits/lookups to create CodeMirror
effects; editor decorations do not own runtime state.

Entity-call widgets are derived from manifest entries. Piano-roll names may be
resolved at runtime, with a literal fallback marked tentative; params,
animation-timeline, drawing, and signal declarations need a static literal
name. The
widget focuses an existing registered view or creates one. Computed declaration
names deliberately have no widget because there is no runtime declaration-name
stream.

Domain bridges retain distinct semantics:

- Piano-roll and animation-editor custom elements receive accepted engine
  truth. Writes are serialized; animation replaces a whole timeline with
  compare-and-set. A component must not treat its optimistic edit as canonical.
- Params panes edit a live declared object through leaf merges. Creating a pane
  does not create a schema; a not-yet-declared entity can correctly render
  empty/unavailable.
- The drawing view hydrates the handwriting-canvas element from the entity's
  lossless document and writes committed edits back whole with compare-and-set.
  The element must not emit `document-update` while a document is being pushed
  in, and the view must not write before its first hydration; either breaks the
  loop (an echo, or a fresh view erasing the entity). The element's baked
  `state-update` snapshot is not the entity value.
- Signal playhead markers are derived by `signalPlayheadMarkers.ts` from signal
  anchors. Piano-roll anchors interpret position in beats; animation anchors
  interpret it in seconds. One signal sent to both must choose compatible units.
- Signal scopes keep local numeric histories. They can also resolve a params
  leaf by path. Rebind, unmount, or reload discards history; an ended source
  freezes/dims rather than fabricating samples.
- Canvas views (`CanvasSurfaceShape.tsx`) mirror a module's named canvas
  (`canvasSurface(name)` from the `canvas-surface` helper) with one
  `drawImage` per animation frame. The source is found by DOM lookup under
  `#livecode-stage`, never through sync, so a view only shows pixels when the
  engine runs in this tab; elsewhere it says so. The source keeps its own
  resolution and the view letterboxes it. Nothing about the view reaches the
  module.

After changing the Vue piano-roll, animation-editor, or handwriting-canvas
component, rebuild its checked-in/ignored bundle before testing this app.
`setupLivecode` is the one-shot path that prepares all component bundles.

## DOM event boundary

Interactive DOM inside a tldraw shape must stop pointer/touch/wheel propagation
before tldraw interprets the gesture; text inputs must also shield relevant key
events. Headers remain draggable while component bodies are interactive.
Widgets stop pointerdown and click. Components needing document-wide drag
tracking should use pointer capture or capture-phase listeners, because the
shape boundary intentionally blocks normal bubbling.

## Projects index page

`projects.html` (`src/projectsIndex.ts`) is a standalone page beside the app,
not part of the provider tree: it probes candidate hosts for `/health`,
lists `/projects/list`, and opens a project by navigating to the app with
`serverBaseUrl` and `projectPath` query params. For "engine in browser" it
may `POST /server/engine-mode` (dropping every live connection) and opens the
`/engine/` tab itself; it does not check a project's library compatibility
with the chosen world — an incompatible project fails at run time.

The open operation is a small explicit workflow: request a mode switch, wait
for `/health` to confirm the restarted server, then open the engine/UI, or end
in a retryable failure. Health polling and manual server selection cannot race
that workflow; stale discovery and project-list responses carry generations
and are ignored.

Three behaviors exist for the served-UI/remote-dev deployment (the
Cloudflare plan in `history/`): the page's own origin outranks every
remembered or default candidate, and plain-`http` candidates are skipped on
an `https` page; health polling pauses while the tab is hidden, so a
background tab cannot hold a wake-on-request container awake; and a
same-origin "engine in browser" open appends `sync=broadcast` (toggleable)
so sync rides the engine tab's BroadcastChannel instead of a WAN round trip,
while writes, analysis, and LSP stay HTTP.

## Project and control caveats

URL-driven project load suppresses per-shape registration churn while restoring
the canvas, then synchronizes modules and connects. Client-command project open
does not currently share every one of those guards, and project save/layout UI
is keyed from the initial `projectPath` URL rather than a live project
selection. Those human-facing gaps are tracked in `known-risks.md`.

The client-control bridge is an automation surface, not a second state owner.
Its `getState` joins local shapes with a fresh server status read; if that read
fails, the current implementation reports no server-running modules, which is
unknown disguised as empty.
