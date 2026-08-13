# Current Client Architecture

Status: checked against `apps/livecode-tldraw` on 2026-07-21; the params
runtime, param-pane shape, and canvas-view persistence were checked on
2026-08-13.

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
- `src/PianoRollShape.tsx`: `piano-roll-view` shape and custom-element adapter.
- `src/paramsRuntime.tsx`: named params snapshot state and `/params/set`
  requests.
- `src/ParamPaneShape.tsx`: `param-pane` shape and its tweakpane bindings.
- `src/serverRequests.ts`: the WebSocket-URL and POST helpers shared by the two
  entity runtime providers. `App.tsx` and `livecodeRuntime.tsx` keep their own
  full-URL variants.
- `src/livecodeProtocol.ts`, `src/pianoRollTypes.ts`, and `src/paramsTypes.ts`:
  manually mirrored Deno protocol types. They are not runtime validators.
- `src/defaultSource.ts`: initial transient module example.
- `src/livecodeTldrawDebug.ts`: tldraw/runtime E2E control API.
- `tests/livecodeTldraw.e2e.mjs`: current tldraw browser E2E, focused on
  piano-roll lookup instrumentation, shape creation/focus, and the params pane
  round trip.
- `public/test-canvases/piano-roll-lookup.tldr`: checked-in manual canvas.
- `example-projects/minimal-p5gpu`: checked-in project structure/example. Its
  current source intentionally or accidentally contains `sped` while consumers
  use `speed`; treat it as a diagnostics fixture until that is resolved.

## Provider and mount order

`App` mounts `LivecodeRuntimeProvider`, then `LivecodeTldrawPage`. Once tldraw
is available, the page wraps it in `PianoRollRuntimeProvider` and then
`ParamsRuntimeProvider`, both using the current server URL. Both entity
providers connect on mount, coalesce snapshots through
`requestAnimationFrame`, and replace their whole entity map from each snapshot.

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
entity. Creating a pane never creates an entity: entities are declared by
running code, so an unknown name renders a "waiting for `name`" placeholder
listing the names in the latest snapshot.

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
is never refreshed; the pane catches it up when the gesture ends, which it
observes through capture-phase `pointerup`/`pointercancel` listeners because the
shape body stops bubbling.

## Tldraw store synchronization

`App.tsx` listens to document changes from every source:

- adding a livecode shape registers its module record;
- removing it unregisters the record and requests a server stop (or queues one
  while disconnected);
- changing its source invalidates and debounces analysis;
- moving/resizing a project module debounces `/project/modules/update` by one
  second;
- adding/removing/moving/resizing/renaming a piano-roll or param-pane shape in
  URL-driven project mode debounces `/project/canvas` by one second.

One collector posts every canvas view kind together. `/project/canvas` replaces
the whole canvas object, so each post carries both `pianoRollViews` and
`paramPaneViews` read from the current page; a post that carried one array
would drop the other kind's saved layout. Nothing is posted until a view shape
event occurs, so a project that has never had one keeps a manifest with no
`canvas` key.

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
while an older run continues.

## Analyze and Run behavior

Analysis is debounced by 100 ms. Run uses a matching prepared build when both
source text and server URL match; it awaits a matching in-flight analysis or
runs analysis immediately otherwise.

For a project module, analysis first writes its source through
`/project/modules/write`, then calls `/runtime/analyze`. Run additionally waits
for `/project/diagnostics` and refuses from the client when `deno check` is not
successful.

The client sets `runStatus` to `running` optimistically while preparing the
build, before `/runtime/launch` has succeeded. The Run button is disabled in
that state. Server lifecycle snapshots and `/runtime/state` later reconcile the
record.

Stop sets `stopping`, posts `/runtime/stop`, and deliberately keeps the active
generated run ID until the matching terminal snapshot arrives.

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

## Event boundaries

Interactive DOM inside shapes must not start tldraw gestures:

- CodeMirror stops pointer, touch, wheel, and keydown propagation.
- Run/Stop and footer controls stop pointerdown.
- the piano-roll body stops pointer/touch/wheel and keydown capture;
- the piano-roll header remains draggable through tldraw;
- the param-pane body does the same, and its header remains draggable;
- piano-roll and params widget buttons stop pointerdown and click propagation.

An embedded widget that relies on document/window bubbling during drag should
use pointer capture or capture-phase global listeners, because the shape body
stops bubbling events.

## Project and canvas loading

`.tldr` files are parsed with tldraw's schema, loaded as a complete snapshot,
removed from undo history, and zoomed to their bounds.

Project loading clears the current canvas, posts `/project/open`, fetches each
module's source sequentially, creates module shapes, then restores persisted
piano-roll views and param panes. Both restore paths reuse the persisted shape
id and skip a view whose id already exists. URL-driven project loading connects
afterward if needed.

The UI toolbar has New/Open/Save for transient `.tldr` canvases, New module, and
New params pane. The params entry opens a non-modal inline input — the canvas
stays interactive — offering the names in the latest snapshot through a
datalist while accepting free text, and creates the pane near the viewport
center. The toolbar does not currently expose human controls for project
create/open/save, module add/remove/reload, panic, stop-all, or restart-all.
Project opening is by URL or client-control command; the richer operations are
server APIs.

## Agent and test surfaces

There are two distinct window APIs:

- `window.__livecodeTldrawRuntimeDebug` exposes runtime modules, tldraw shapes,
  selection, source setting, run/stop/connect, param-pane creation, and `.tldr`
  serialization.
- `window.__livecodeTldrawDebug` is installed by CodeMirror and exposes document
  URIs/text, focus-by-offset, and direct completion requests.

The production bundle installs them unconditionally; they are not gated by a
test flag.

The `/client/control` bridge supports `getState`, `openProject`,
`addProjectModule`, `reloadProjectModule`, `setModuleSource`, `runModule`,
`stopModule`, and `stopAllModules`. Results that finish while the socket is
closed are buffered by command ID and flushed on reconnect for the lifetime of
that bridge effect.
