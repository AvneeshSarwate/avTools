# Current Client Architecture

Status: checked against `apps/livecode-tldraw` on 2026-07-21; the params
runtime, param-pane shape, canvas-view persistence, and the topbar's entity and
save actions were checked on 2026-08-13; the signals runtime, playhead markers,
graph rows, and the signal-scope shape were added and checked on 2026-08-13; the
Replace affordance and the terminal-snapshot guard were checked on 2026-08-13.

## Responsibilities

The client is a local React application embedding CodeMirror and the piano-roll
web component inside custom tldraw shapes. It owns:

- canvas interaction and shape layout;
- editor buffers and visual decorations;
- connection UI and client-side recovery orchestration;
- project-shape construction from server manifests;
- forwarding explicit user/agent actions to the server;
- transient `.tldr` import/export.

It does not execute user modules, own canonical run state, or canonically store
piano-roll note data or params values.

## File map

- `src/main.tsx`: React entrypoint and global styles.
- `src/App.tsx`: providers, tldraw mount, toolbar, `.tldr` load/save, project
  loading, store-to-runtime synchronization, project layout persistence, and
  the browser side of `/client/control`.
- `src/livecodeRuntime.tsx`: livecode module records, edit-time analysis,
  prepared builds, run/stop actions, runtime snapshot reconnect/rehydration,
  Deno LSP lifetime, and project-diagnostics polling.
- `src/LivecodeEditorShape.tsx`: `livecode-editor` shape, status UI,
  diagnostics, manifest-to-range joins, and focus-or-create piano-roll actions.
- `src/CodeMirrorEditor.tsx`: CodeMirror construction, Deno LSP extensions,
  wait and piano-roll decoration fields, editable state, and input event
  shielding.
- `src/denoLsp.ts`: VTLSP transport/client setup and LSP feature configuration.
- `src/reconnectingSocket.ts`: shared WebSocket retry controller used by
  runtime snapshots, piano-roll snapshots, and client control.
- `src/pianoRollRuntime.tsx`: named piano-roll snapshot state and set/undo/redo
  requests.
- `src/PianoRollShape.tsx`: `piano-roll-view` shape, custom-element adapter, and
  the exported `createPianoRollShape` view constructor.
- `src/paramsRuntime.tsx`: named params snapshot state and `/params/set`
  requests.
- `src/ParamPaneShape.tsx`: `param-pane` shape, its tweakpane bindings, and the
  exported `createParamPaneShape` view constructor.
- `src/signalsRuntime.tsx`: named ephemeral-signal snapshot state. Read-only by
  construction — there is no set route, so a provider with a setter would be
  lying about the tier.
- `src/SignalScopeShape.tsx`: `signal-scope` shape, its per-RAF ring buffer and
  canvas polyline, the exported `createSignalScopeShape` view constructor, and
  the debug reader for what one scope has accumulated.
- `src/serverRequests.ts`: the WebSocket-URL, GET, and POST helpers shared by
  the two entity runtime providers, plus the entity CRUD, project save, and
  project status calls the topbar and the debug surface both use — one home, so
  those two cannot drift apart. `App.tsx` and `livecodeRuntime.tsx` keep their
  own full-URL variants.
- `src/livecodeProtocol.ts`, `src/pianoRollTypes.ts`, `src/paramsTypes.ts`, and
  `src/signalsTypes.ts`: manually mirrored Deno protocol types. They are not
  runtime validators.
- `src/custom-elements.d.ts`: the `<piano-roll-component>` JSX declaration and
  the element's imperative interface, in one place so the ref type and the tag
  type cannot drift apart.
- `src/defaultSource.ts`: initial transient module example.
- `src/livecodeTldrawDebug.ts`: tldraw/runtime E2E control API.
- `tests/livecodeTldraw.e2e.mjs`: current tldraw browser E2E, focused on
  piano-roll lookup instrumentation, shape creation/focus, the params pane
  round trip, the signal tier (playhead markers from one and two modules,
  scopes over a signal and over a param leaf, and a `meta.graph` row), and — in
  a project-mode block that runs last on its own canvas — entity CRUD and
  project save/open persistence.
- `public/test-canvases/piano-roll-lookup.tldr`: checked-in manual canvas.
- `example-projects/minimal-p5gpu`: checked-in project structure/example. Its
  current source intentionally or accidentally contains `sped` while consumers
  use `speed`; treat it as a diagnostics fixture until that is resolved.

## Provider and mount order

`App` mounts `LivecodeRuntimeProvider`, then `LivecodeTldrawPage`. Once tldraw
is available, the page wraps it in `PianoRollRuntimeProvider`,
`ParamsRuntimeProvider`, and `SignalsRuntimeProvider`, all using the current
server URL. All three providers connect on mount, coalesce snapshots through
`requestAnimationFrame`, and replace their whole entity map from each snapshot.
The signals provider exposes `connectionStatus` for the same reason the others
do, and its consumers act on it: a dropped signals socket is not the same as a
signal that stopped moving.

On a new transient canvas, `onMount` creates:

- one `livecode-editor` shape at `(120, 120)`;
- one `piano-roll-view` for `melody` at `(820, 120)`.

No tldraw `persistenceKey` is configured. The browser does not silently retain
canvas state across reloads.

## Shape schemas

### `livecode-editor`

Shape props contain:

```ts
{
  w: number;
  h: number;
  moduleId: string;
  projectModulePath?: string;
  projectModuleKind?: "runnable";
  projectSourceUri?: string;
  title: string;
  source: string;
}
```

`source` is the visible CodeMirror text and the transient canvas persistence
form. For a project shape, `projectModulePath` selects the server module and
`projectSourceUri` gives Deno LSP the real `*.orig.ts` URI.

### `piano-roll-view`

Shape props contain viewport/presentation metadata:

```ts
{
  w: number;
  h: number;
  rollName: string;
  title: string;
  showControlPanel: boolean;
  interactive: boolean;
}
```

Notes are deliberately absent. `rollName` selects a server-owned piano-roll
object. Multiple shapes may view the same object.

### `param-pane`

Shape props contain:

```ts
{
  w: number;
  h: number;
  paramsName: string;
  title: string;
}
```

Values are deliberately absent. `paramsName` selects a server-owned params
entity. Creating a pane never creates an entity — a declaration, an explicit
entity action, or a project load does — so an unknown name renders a "waiting
for `name`" placeholder listing the names in the latest snapshot. Deleting the
entity behind a live pane returns it to that placeholder; the pane is a view
and outlives what it views.

The pane mounts one tweakpane `Pane` per shape and binds a copy of the entity's
values, nesting objects as folders. Bindings are rebuilt only when the value
shape or the meta changes; a rev advance just refreshes values. A `null` leaf
(what a non-finite code write serializes to) has no binding until a real value
is sampled, and an `unserializable` entity shows a badge over the last good
values.

Edits post one minimal leaf patch to `/params/set` with
`originId = "param-pane-" + shape.id` and never an `expectedRev`. Snapshots are
applied with the piano-roll echo-suppression scheme: the first apply after
mount always runs, later snapshots whose `updatedBy` is this pane's origin are
skipped, and each binding also refuses a snapshot at or below the rev the
server assigned to its own most recent write. A binding the user is actively
editing — focused, under an active pointer gesture, or with a write in flight —
is never refreshed; the pane catches it up when the editing session ends, which
it observes through capture-phase `pointerup`/`pointercancel` listeners because
the shape body stops bubbling. Pressing Enter in a focused field ends a
keyboard editing session the same way: after tweakpane's own commit handler
runs, the pane blurs the field and catches it up, so a committed field resumes
following server truth instead of holding the monitor stale while it keeps
focus.

A numeric leaf whose meta carries `graph: true` also gets a **second, readonly
binding** on the same draft key, added immediately after the editable one, with
`{ readonly: true, view: "graph", min, max, rows }`. Bounds come from the
field's own `min`/`max`; without them tweakpane falls back to its default range,
so a declaration that wants a readable graph should declare bounds. The graph
row is deliberately not a binding entry: it has no change handler, takes no part
in the busy guard, and is never refreshed by the apply path, because a tweakpane
monitor polls the draft object on its own interval (200 ms by default). The
existing write and refresh machinery therefore needed no change at all — the
history view is pure display over samples that were already arriving.

### `signal-scope`

Shape props contain:

```ts
{
  w: number;
  h: number;
  sourceType: "signal" | "params";
  name: string;
  path: string;      // dot-joined field path; empty for whole values
  windowSec: number;
  title: string;
}
```

A scope binds to a **value**, not to an entity: `sourceType` selects which
provider to read, `name` the entity in it, and `path` one field inside that
value. Monitors watch values regardless of class, so a scope over an ephemeral
signal and one over a durable param leaf are the same mechanism; the class
governs persistence, not watchability.

Sampling is per-RAF latest-value: every animation frame the shape appends
`{ t: now, value }` for its source and trims everything older than `windowSec`
(with a hard cap of 4000 samples). There is no rev bookkeeping, so a constant
value draws a continuous line rather than a gap, and transport conflation is
accepted by design — a scope shows what arrived, at the rate the client saw it.
The x-axis is arrival time in v1; the logical-time stamps the snapshot carries
are shipped but unused.

Everything per sample is imperative: the ring buffer is a ref, the polyline is
drawn straight to a 2D canvas context, and nothing per frame touches React state
or the tldraw document. The y-axis auto-scales to the window's own range,
because signals declare no bounds and a fixed range would flatten most traces.

v1 renders numbers only. A missing entity, a non-numeric value, or a path that
does not resolve renders the waiting/unsupported placeholder instead of a
trace. An **ended** source freezes the trace where the run left it and dims the
title — a scope is a history view, so those samples stay worth looking at,
unlike a playhead marker, which would misreport a stopped process as a playing
one. A source whose socket is not open also stops appending, for the same
reason.

## Tldraw store synchronization

`App.tsx` listens to document changes from every source:

- adding a livecode shape registers its module record;
- removing it unregisters the record and requests a server stop (or queues one
  while disconnected);
- changing its source invalidates and debounces analysis;
- moving/resizing a project module debounces `/project/modules/update` by one
  second;
- adding/removing/moving/resizing/rebinding a piano-roll, param-pane, or
  signal-scope shape in URL-driven project mode debounces `/project/canvas` by
  one second.

One collector posts every canvas view kind together. `/project/canvas` replaces
the whole canvas object, so each post carries `pianoRollViews`,
`paramPaneViews`, and `scopeViews` read from the current page; a post that
carried one array would drop the other kinds' saved layout. Nothing is posted
until a view shape event occurs, so a project that has never had one keeps a
manifest with no `canvas` key.

A scope view persists only its binding — source type, name, path, window, and
layout — never any of the samples it drew.

Programmatic `.tldr` and URL-driven project loads suppress the per-record
listener and perform one explicit synchronization pass afterward. The
`openProject` client-control command calls the lower-level project loader
directly and currently does not use that suppression wrapper; see known risks.

`registerModule` does not update an already registered record. Load paths rely
on removal/synchronization ordering when reusing a module ID.

## Livecode runtime record

Each registered module has published view state plus private coordination:

- source/version and optional project path;
- build status: `idle`, `queued`, `analyzing`, `ready`, `error`, or
  `not-connected`;
- run status: `idle`, `running`, `stopping`, `stopped`, `error`, or `unknown`;
- transform diagnostics and current manifest;
- the latest 50 successful build-history entries;
- active wait IDs, resolved piano-roll lookup names, and snapshot sequence;
- current active generated run ID and most recent terminal run marker;
- current prepared build/failure and in-flight analyze promise.

Edits clear the build, manifest, diagnostics, decorations, lookups, and active
run correlation before scheduling a new analysis. This does not stop code that
is already running on the server; the UI can therefore display edited source
while an older run continues. Dropping the run correlation is why a terminal
snapshot applies with no active-run claim (see below): that older run still
ends, and its end is still this module's.

## Analyze and Run behavior

Analysis is debounced by 100 ms. Run uses a matching prepared build when both
source text and server URL match; it awaits a matching in-flight analysis or
runs analysis immediately otherwise.

For a project module, analysis first writes its source through
`/project/modules/write`, then calls `/runtime/analyze`. Run additionally waits
for `/project/diagnostics` and refuses from the client when `deno check` is not
successful.

The client sets `runStatus` to `running` optimistically while preparing the
build, before `/runtime/launch` has succeeded. Server lifecycle snapshots and
`/runtime/state` later reconcile the record.

`runModule(moduleId, options)` takes `{ replaceRunning }`, which it forwards to
the launch body; `replaceModule(moduleId)` is that call with the flag set. While
a module runs, its Run button reads **Replace** and calls it — replacement is an
explicit gesture, and the flag is the server's consent check, so nothing else in
the client ever sets it. Stop is unchanged and stays enabled.

Stop sets `stopping`, posts `/runtime/stop`, and deliberately keeps the active
generated run ID until the matching terminal snapshot arrives.

### Applying terminal run snapshots

A terminal lifecycle entry is first deduped exactly as an active one is: an
entry whose generated run ID matches the last terminal this record saw, with no
newer timestamp, is ignored. A terminal stays in `moduleRuns` for the life of
the server, so every later snapshot re-delivers it, and without the dedupe it
would retire the run started after it during the window where Run has set
`running` optimistically but not yet claimed the new run ID.

A new terminal then applies when it matches the record's active generated run
ID, **or** when the record holds no active-run claim at all. The second case is
ordinary rather than exceptional: an edit calls `setModuleSource`, which drops
the claim, so a module edited while it ran would otherwise never see its own
natural completion and would sit at `running` until a reload with nothing
running on the server.

The guard exists for one job only — an older run's terminal must not retire a
newer client-initiated launch — and it still does it, because `runModule`
claims the new generated run ID before it posts. That is also what makes
Replace safe: the run being replaced reports its terminal under the previous ID,
which no longer matches and is correctly ignored.

## LSP behavior

Every runtime reconnect creates a new random LSP session. All CodeMirror
instances share that one `LSClient`; each supplies its own document URI.

Enabled editor features are diagnostics, hover, completion, and window message
rendering. Signature help, references, rename, context menu, and inlay hints are
currently disabled in the CodeMirror extension even though inlay-hint options
are present in LSP initialization.

Transient document URIs use `file:///modules/<moduleId>.ts`. Project documents
use their real source file URL.

## Decorations

Wait decorations are derived by joining `moduleState.activeIds` to manifest
entries and applying a line class plus an exact-range mark.

Piano-roll widgets are derived only from manifest entries with kind
`pianoRollLookup` and a `nameArgRange`:

- runtime-resolved names render as `🎹 open <name>`;
- a static literal fallback renders as `🎹 open <name>?`;
- unresolved nonliteral names render no button until executed.

Clicking a widget selects and zooms to an existing piano-roll shape with the
same name, or creates one immediately to the right of the code shape.

Params widgets are derived from manifest entries with kind `canvasParams`, a
`nameArgRange`, and a `staticName`. They render as `🎛 open <name>` and behave
the same way, focusing an existing `param-pane` for that name or creating one
to the right of the code shape. There is no runtime name resolution for params,
so a declaration whose name is not a string literal renders no widget at all.

The `canvasSignal` kind renders **no gutter widget in v1**. The decoration
builders filter by kind, so an unknown-to-them kind is skipped safely; scopes
are created from the topbar or the debug surface instead.

## Piano-roll web component bridge

The tldraw app imports `@avtools/piano-roll`, aliased by Vite to
`webcomponents/piano-roll/dist/piano-roll.js`. Rebuild that bundle after
changing `apps/browser-projections/src/pianoRoll`.

The internal stage is fixed at 640 by 320. tldraw resizing changes the outer
scroll viewport rather than the note-grid coordinate system.

Server snapshots replace the client `rolls` map. A shape applies foreign-origin
note updates to the custom element and suppresses its own echoes. Initial mount
always applies the server state. `fitZoomToNotes` currently runs only for
revision 1.

Client edits post undoable writes. Livecode helper writes default to
non-undoable. Undo/redo use a history-specific origin so their confirming
snapshots are not suppressed by the originating shape.

### Playhead markers

The component's single live playhead is untouched. Beside it,
`setPlayheadMarkers(markers)` renders **any number** of labeled lines,
reconciled by id, which is what lets several processes play one melody at once
and stay distinguishable. `getPlayheadMarkers()` reads back what is rendered.

The shape feeds it from the signals provider. On each RAF-coalesced snapshot it
selects every signal anchored `{ type: "pianoRoll", name: rollName }` that has
not ended, and turns each into one marker:

- a numeric value is the position;
- an object with a numeric `position` uses that field;
- anything else (strings, objects without a position, nulls, non-finite
  numbers) renders **nothing** rather than guessing;
- positions are quarter notes, the component's own unit, and `anchor.path` is
  ignored in v1.

Meaning stays in the process: the platform never knows why a position moves.
Ended signals and a signals socket that is not open both render no markers at
all — a line frozen where a stopped run left it reads as a playing one, which is
exactly the "silently freezing" impression the ephemeral-entity principle
forbids. Identical marker sets are not re-pushed, so an idle roll costs nothing.

## Event boundaries

Interactive DOM inside shapes must not start tldraw gestures:

- CodeMirror stops pointer, touch, wheel, and keydown propagation.
- the header action buttons (Run/Replace, Stop) and footer controls stop
  pointerdown.
- the piano-roll body stops pointer/touch/wheel and keydown capture;
- the piano-roll header remains draggable through tldraw;
- the param-pane body does the same, and its header remains draggable;
- the scope body stops pointerdown and wheel; its header remains draggable;
- piano-roll and params widget buttons stop pointerdown and click propagation.

An embedded widget that relies on document/window bubbling during drag should
use pointer capture or capture-phase global listeners, because the shape body
stops bubbling events.

## Project and canvas loading

`.tldr` files are parsed with tldraw's schema, loaded as a complete snapshot,
removed from undo history, and zoomed to their bounds.

Project loading clears the current canvas, posts `/project/open`, fetches each
module's source sequentially, creates module shapes, then restores persisted
piano-roll views, param panes, and signal scopes. Every restore path reuses the
persisted shape id and skips a view whose id already exists. URL-driven project
loading connects afterward if needed.

The UI toolbar has New/Open/Save for transient `.tldr` canvases, New module,
New piano roll, New params pane, and New scope. Every name entry uses the same
non-modal inline input — the canvas stays interactive while it is open, Escape
closes it, and a datalist offers the names in the latest snapshot without
restricting free text. A failed action leaves the input open with the server's
message in the topbar rather than discarding what was typed.

New params pane creates a view only. **New piano roll is dual-mode**: a name
the piano-roll snapshot already carries only creates another view, while a new
name posts `/entities/create` first and then creates the view — the composite
create-entity-plus-view gesture, with view-only reuse for the names that exist.

**New scope** is view-only and never creates anything server-side: a signal is
published by code or it is not, and a param leaf exists or it does not. Its
datalist offers every live signal name plus every numeric param leaf as
`params:<name>.<field>`, and that same syntax is what the input parses — a
`params:` prefix binds a param leaf (first dot-separated segment is the entity
name, the rest is the path), and anything else is a signal name, taken whole
when the snapshot already knows it and split at its first dot otherwise, so a
field of an object-valued signal can be bound before it is ever published.
Ended signals stay in the list, suffixed `(ended)`, because a stopped run's
last trace is still worth watching; the suffix is stripped back off when the
input is submitted.

Two more actions appear only while exactly one selected shape is a
`piano-roll-view` or a `param-pane`, because that is when the entity being
acted on is unambiguous. The selection is read reactively with tldraw's
`useValue` over `editor.getOnlySelectedShape()`; both halves of the entity
reference are primitives, so dragging an unrelated shape does not re-render the
topbar.

- **Duplicate entity** opens the inline input prefilled `<name>-copy`, posts
  `/entities/duplicate`, and creates a view of the copy beside the source. The
  new view becomes the selection, so the actions then address the copy.
- **Delete entity** is a two-step confirm: the button rearms to
  `Really delete <name>?`, disarms itself after about four seconds, and disarms
  immediately if the selection changes, so a confirm can never land on an
  entity the operator was not looking at. It posts `/entities/delete` and
  leaves every view in place; a view returns to its waiting placeholder.

**Save project** and the unsaved pill render only when the page URL carried a
`projectPath` — the same gate as the canvas collector, and the same gap: a
project opened later through client control shows neither (see
`known-risks.md`). The button posts `/project/save` and reports the result as a
short `saved N | M failed | K skipped` line, with the per-entity details on the
console. The pill comes from a two-second `/project/status` poll that runs only
while a `projectPath` is present, and shows how many entities that response
reports as unsaved. It is purely informational; nothing in the client ever
auto-saves.

The toolbar still does not expose human controls for project create/open,
module add/remove/reload, panic, stop-all, or restart-all. Project opening is by
URL or client-control command; the richer operations are server APIs.

## Agent and test surfaces

There are two distinct window APIs:

- `window.__livecodeTldrawRuntimeDebug` exposes runtime modules, tldraw shapes,
  selection, source setting, run/replace/stop/connect, module / param-pane /
  piano-roll-view / signal-scope creation, the three entity actions,
  `saveProject()`, and `.tldr` serialization. The entity actions are thin
  wrappers over the same `serverRequests.ts` calls the topbar uses, so agents
  and the E2E drive the real path without the topbar DOM; a rejected action
  rejects with the server's message. It also exposes two readers for state that
  deliberately lives outside the tldraw store: `getPlayheadMarkers(rollName)` /
  `getPlayheadMarkerViews()` read markers back out of the web component, and
  `getScopeState(shapeId)` / `getScopeStates()` report what a scope's ring
  buffer has accumulated (sample count, latest, min/max, distinct count, ended,
  waiting).
- `window.__livecodeTldrawDebug` is installed by CodeMirror and exposes document
  URIs/text, focus-by-offset, and direct completion requests.

The production bundle installs them unconditionally; they are not gated by a
test flag.

The `/client/control` bridge supports `getState`, `openProject`,
`addProjectModule`, `reloadProjectModule`, `setModuleSource`, `runModule`
(which takes the same `replaceRunning` option the Replace button uses),
`stopModule`, and `stopAllModules`. Results that finish while the socket is
closed are buffered by command ID and flushed on reconnect for the lifetime of
that bridge effect.
