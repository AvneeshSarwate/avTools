# Current Client Architecture

Status: checked against `apps/livecode-tldraw` — most recently
`src/syncRuntime.tsx`, `src/livecodeRuntime.tsx`, and `src/runDedupe.ts` — as of
2026-08-13; first audited 2026-07-21.

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
- `src/syncRuntime.tsx`: the one `/sync` socket — subscribe, per-entity-kind
  React contexts, the RAF-coalesced flush, the typed hooks every consumer reads,
  and the HTTP write actions (`setRoll`/`undoRoll`/`redoRoll`/`setParams`).
- `src/livecodeRuntime.tsx`: livecode module records, edit-time analysis,
  prepared builds, run/stop actions, the connect-armed open sequence and
  `/runtime/state` rehydration, Deno LSP lifetime, and project-diagnostics
  polling. It owns no socket of its own; it consumes runs/waits/lookups and
  socket lifecycle edges from the sync provider.
- `src/runDedupe.ts`: the token-keyed terminal-run rule, as a pure module with
  **no imports** — the browser bundle and a Deno unit test both load this exact
  file.
- `src/LivecodeEditorShape.tsx`: `livecode-editor` shape, status UI,
  diagnostics, manifest-to-range joins, and focus-or-create piano-roll actions.
- `src/CodeMirrorEditor.tsx`: CodeMirror construction, Deno LSP extensions,
  wait and piano-roll decoration fields, editable state, and input event
  shielding.
- `src/denoLsp.ts`: VTLSP transport/client setup and LSP feature configuration.
- `src/reconnectingSocket.ts`: shared WebSocket retry controller, used by the
  sync socket and client control.
- `src/PianoRollShape.tsx`: `piano-roll-view` shape, custom-element adapter, and
  the exported `createPianoRollShape` view constructor.
- `src/ParamPaneShape.tsx`: `param-pane` shape, its tweakpane bindings, and the
  exported `createParamPaneShape` view constructor.
- `src/SignalScopeShape.tsx`: `signal-scope` shape, its per-RAF ring buffer and
  canvas polyline, the exported `createSignalScopeShape` view constructor, and
  the debug reader for what one scope has accumulated.
- `src/serverRequests.ts`: the WebSocket-URL, GET, and POST helpers the sync
  provider's write paths use, plus the entity CRUD, project save, and project
  status calls the topbar and the debug surface both use — one home, so those
  two cannot drift apart. `App.tsx` and `livecodeRuntime.tsx` keep their own
  full-URL variants.
- `src/livecodeProtocol.ts`: a re-export of `@avtools/livecode-protocol` plus
  the three client-local view models (`HistoryEntry`, `PreparedBuild`,
  `PreparedFailure`). The wire types are no longer mirrored here; they are
  compiled from the shared package by a vite alias and a tsconfig path. Still
  not runtime validators.
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

`App` mounts `SyncRuntimeProvider`, then `LivecodeRuntimeProvider`, then
`LivecodeTldrawPage`. The sync provider is outermost because everything else
reads from it: the entity shapes take their maps from it directly, and the
livecode runtime takes runs/waits/lookups plus its socket lifecycle from it.
There are no per-entity-kind providers any more.

On a new transient canvas, `onMount` creates:

- one `livecode-editor` shape at `(120, 120)`;
- one `piano-roll-view` for `melody` at `(820, 120)`.

No tldraw `persistenceKey` is configured. The browser does not silently retain
canvas state across reloads.

## Sync provider

`SyncRuntimeProvider` owns the watched-state transport and the server base
URL. The transport has two implementations behind one small `SyncPort` seam
(`isOpen`/`sendMessage`), chosen by the `sync` URL param:

- **ws** (default): the reconnecting `/sync` socket described below.
- **broadcast** (`?sync=broadcast`): the engine tab's BroadcastChannel sync
  host on the same origin — the stage-2 topology where the server serves the
  built client (`--ui-dist`) next to `/engine/`. The channel is "open" the
  moment it exists; an engine restart surfaces as a seq regression, which the
  existing gap path answers by resubscribing, and a mid-stream join (first
  message without resets) resubscribes for its own resets. Entity writes and
  every other route stay HTTP against `serverBaseUrl` in both transports.

Writes have their own transport axis: `actions=broadcast` routes the
entity/roll/params actions (and the topbar's generic entity CRUD) over the
engine tab's broadcast actions channel as `EngineOp` requests instead of
HTTP — the serverless baked topology, where `serverBaseUrl=none` also
disables the client-control bridge. Without the param, writes stay HTTP even
when watching is broadcast.

`serverBaseUrl=none` also changes the boot: instead of the default transient
canvas, the app fetches `engine/baked.json` (relative to the page, the same
file the engine tab boots from) and builds the project-shaped canvas from it —
one code shape per manifest module at its saved position, rendered from the
baked `sourceText` with the shape-level `readOnly` prop set (a bake's code is
display, not editable source), plus the manifest's canvas views via the same
`createCanvasViewShapes` the project boot uses. The shapes carry no
`projectModulePath`, so no layout or write persistence ever fires; live
overlays still arrive from the sync feed. If the fetch fails the app falls
back to the default canvas. The topbar swaps "Save project" for **Export
data** — decision 5's export-only save: `captureEntities` over the actions
channel, downloaded as one JSON file of the same `{type, name, data}` rows
`baked.json` carries.

In ws mode the provider owns one reconnecting `/sync` socket. On open it clears its sequence memory and sends one subscribe naming every
kind this client watches:

```ts
const SYNC_ENTITY_TYPES = [
  "pianoRoll", "params", "signal", "run", "moduleWaits", "moduleLookups",
] as const;
```

A fresh socket has no subscriptions and is owed nothing, so that one message is
also the client's full rehydration.

**One React context per entity kind.** `PianoRollsContext`, `ParamsContext`,
`SignalsContext`, `RunsContext`, `ModuleWaitsContext`, `ModuleLookupsContext`,
plus three cross-cutting ones (`SyncConnectionContext`, `SyncActionsContext`,
`SyncLifecycleContext`). One context carrying all six maps would re-render every
param pane and roll view on every signal tick. This is a load-bearing shape, not
a style choice: **a future entity kind adds a context, not a field on a shared
value.**

**Per-slice `latestSeq`.** Each kind's context value is
`{ entities, latestSeq }`, where `latestSeq` is the `seq` of the message that
last touched *that* kind. The global "newest message on the socket, whatever it
carried" number is on `useSyncConnection()`. A component showing a sequence
number therefore re-renders on its own traffic, as the four separate channels
behaved.

**One RAF-coalesced flush.** Messages mutate authoritative maps held in a ref
and mark their kind dirty; a single `requestAnimationFrame` callback copies only
the dirty kinds into React state. Nothing downstream needs to see two messages
from one frame separately.

**A reset replaces.** Applying `resets` rebuilds the whole per-type map from
scratch — absence is deletion, so an entity removed while this client was
disconnected does not survive the reconnect. Applying `changes` copies the map
and sets or deletes single names; a `null` entity deletes. Nothing dedupes on
`rev`, because `rev` is not a change key on this transport.

**A `seq` gap resubscribes.** Gap detection runs *after* the message's own
content is applied, so nothing is dropped in the meantime; the resubscribe's
resets replace it wholesale a moment later. There is no replay request, because
there is no replay buffer.

Changing the server URL empties every map immediately rather than letting the
old server's entities linger until the new one's resets land — a different
server is a different world.

### Typed hooks

| Hook | Shape |
| --- | --- |
| `usePianoRollsSync()` | `{ connectionStatus, connectionError, rolls, latestSeq, setRoll, undoRoll, redoRoll }` |
| `useParamsSync()` | `{ connectionStatus, connectionError, params, latestSeq, setParams }` |
| `useSignalsSync()` | `{ connectionStatus, connectionError, signals, latestSeq }` |
| `useRunsSync()` | `{ runs, latestSeq }` |
| `useModuleVizSync()` | `{ moduleWaits, moduleLookups, latestSeq }` |
| `useSyncConnection()` | `{ connectionStatus, connectionError, latestSeq }` |
| `useSyncActions()` | `{ serverBaseUrl, setServerBaseUrl, setRoll, undoRoll, redoRoll, setParams }` |
| `useSyncLifecycle()` | `{ isOpen(), addListener(...) }` |

`rolls`, `params`, and `signals` keep the exact consumer-facing shapes the three
old providers had, so `PianoRollShape`, `ParamPaneShape`, `SignalScopeShape`,
and the topbar were import swaps rather than rewrites. `useSignalsSync` is
read-only by construction: there is no signals write route, so a hook with a
setter would be lying about the tier. `useModuleVizSync` merges the two
module-keyed decoration kinds and reports the max of their two `latestSeq`
values.

`isRunActive(run)` derives active-ness client-side from `run.state` — the
transport has no active-module list.

**Writes did not move.** `setRoll`, `undoRoll`, `redoRoll`, and `setParams` are
ordinary HTTP POSTs through `serverRequests.ts` (`/piano-roll/set`, `/undo`,
`/redo`, `/params/set`). Only *watching* moved to the socket. `setRoll` sends a
typed `SetPianoRollRequest`; panes still never send an `expectedRev`.

`SyncLifecycle` delivers socket open/close/error edges **imperatively**, not
through React state, because the livecode runtime's open sequence must run once
per real socket open: a close and reopen batched into one React commit would
collapse into no state change at all and skip the recovery.

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
for `name`" placeholder listing the names the params map currently holds.
Deleting the entity behind a live pane returns it to that placeholder; the pane
is a view and outlives what it views.

The pane mounts one tweakpane `Pane` per shape and binds a copy of the entity's
values, nesting objects as folders. Bindings are rebuilt only when the value
shape or the meta changes; a rev advance just refreshes values. A `null` leaf
(what a non-finite code write serializes to) has no binding until a real value
is sampled, and an `unserializable` entity shows a badge over the last good
values.

Edits post one minimal leaf patch to `/params/set` with
`originId = "param-pane-" + shape.id` and never an `expectedRev`. Server
entities are applied with the piano-roll echo-suppression scheme: the first
apply after mount always runs, later deliveries whose `updatedBy` is this pane's
origin are skipped, and each binding also refuses a value at or below the rev
the server assigned to its own most recent write. A binding the user is actively
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
sync hook to read, `name` the entity in it, and `path` one field inside that
value. Monitors watch values regardless of class, so a scope over an ephemeral
signal and one over a durable param leaf are the same mechanism; the class
governs persistence, not watchability.

Sampling is per-RAF latest-value: every animation frame the shape appends
`{ t: now, value }` for its source and trims everything older than `windowSec`
(with a hard cap of 4000 samples). There is no rev bookkeeping, so a constant
value draws a continuous line rather than a gap, and transport conflation is
accepted by design — a scope shows what arrived, at the rate the client saw it.
The x-axis is arrival time in v1; the logical-time stamps the signal entity
carries are shipped but unused.

Everything per sample is imperative: the ring buffer is a ref, the polyline is
drawn straight to a 2D canvas context, and nothing per frame touches React state
or the tldraw document. The y-axis auto-scales to the window's own range,
because signals declare no bounds and a fixed range would flatten most traces.

v1 renders numbers only. A missing entity, a non-numeric value, or a path that
does not resolve renders the waiting/unsupported placeholder instead of a
trace. An **ended** source freezes the trace where the run left it and dims the
title — a scope is a history view, so those samples stay worth looking at,
unlike a playhead marker, which would misreport a stopped process as a playing
one. A source whose sync socket is not open also stops appending, for the same
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
- active wait IDs, resolved piano-roll lookup names, and the sync sequence that
  last touched them;
- `runToken`: the token of the last run entity this record actually **applied**.
  A suppressed terminal never sets it, which is how a test tells "the run I
  watched ended" from "some older run's terminal leaked through";
- a private `RunDedupeMemory` (see below);
- current prepared build/failure and in-flight analyze promise.

Edits clear the build, manifest, diagnostics, decorations, and lookups, and
release the run claim, before scheduling a new analysis. This does not stop code
that is already running on the server; the UI can therefore display edited
source while an older run continues. Releasing the claim deliberately keeps the
token memory: that run is still going, and its own terminal still has to be
accepted when it lands.

## Analyze and Run behavior

Analysis is debounced by 100 ms. Run uses a matching prepared build when both
source text and server URL match; it awaits a matching in-flight analysis or
runs analysis immediately otherwise.

For a project module, analysis first writes its source through
`/project/modules/write`, then calls `/runtime/analyze`. Run additionally waits
for `/project/diagnostics` and refuses from the client when `deno check` is not
successful.

The client sets `runStatus` to `running` optimistically while preparing the
build, before `/runtime/launch` has succeeded. Server `run` entities and
`/runtime/state` later reconcile the record.

`runModule(moduleId, options)` takes `{ replaceRunning }`, which it forwards to
the launch body; `replaceModule(moduleId)` is that call with the flag set. While
a module runs, its Run button reads **Replace** and calls it — replacement is an
explicit gesture, and the flag is the server's consent check, so nothing else in
the client ever sets it. Stop is unchanged and stays enabled.

Stop sets `stopping`, posts `/runtime/stop`, and waits for the matching terminal
run entity.

### Applying run entities: the token-keyed dedupe

Run entities arrive per module, changed-only. Two runs of one module can be in
flight at once from this client's point of view — the run being replaced reports
its terminal while the replacement is still `launching` — and applying that
terminal would retire a run that is genuinely alive. `runDedupe.ts` is the rule.

It keys on `runToken`, the identity of the RUN, because `generatedRunId`
identifies a prepared *build* and is reused whenever a relaunch finds an
unchanged one. The client never learns its own launch's token from the POST — it
learns tokens only by watching run entities go active — so the memory is two
token sets plus a flag:

- `activeRunTokens`: tokens watched go active **since** the current claim's POST;
- `supersededRunTokens`: tokens watched go active **before** it;
- `claimActive`: true from a launch POST until a terminal applies or the claim is
  dropped.

The transitions:

- `claimRun(memory)` runs **immediately before** posting `/runtime/launch`.
  Everything watched active up to that instant moves to superseded.
- `observeActiveRun` records a `launching`/`running` entity — but ignores one
  whose token is already superseded, since the run winding down still reports
  itself active for a tick or two.
- `releaseRunClaim` drops the claim without a terminal (an edit, or a launch
  that never reached the server). Token memory survives.
- `seedRehydratedRun` seeds from `/runtime/state`: an active run goes to
  `activeRunTokens`, an already-terminal one to `supersededRunTokens`.

And the rule itself, for every `stopped`/`error` entity that arrives:

1. superseded token → **suppress**. That run is the one being replaced.
2. observed-active token → **apply**. This is the claim's own outcome.
3. unknown token → apply **iff** there is no claim, or the claim has never been
   seen active. The second half is the instant-failure case: tick coalescing
   means a launch and an immediate throw can land inside one 33 ms tick, and the
   only entity that ever ships is a terminal under a token this client never saw
   active. Swallowing it would leave the module reading `running` forever.

Both token sets are insertion-ordered LRUs capped at 64 entries; a token old
enough to fall out has long since delivered its terminal.

An applied terminal sets `record.runToken` and releases the claim; a suppressed
one changes nothing. Active entities set `runToken` too, except that a record in
`stopping` keeps that status rather than flipping back to `running`.

Two orderings matter, and both are pinned in `run_dedupe_test.ts` where they can
be constructed exactly. On top of that, the **straddle** — a replaced run's
terminal arriving while its replacement launches — is asserted in the browser
E2E, because the real Replace button produces it naturally and reliably. The
**instant failure** has a browser case too, but only for its outcome: whether a
launch and a throw actually land inside one tick is a timing coin flip, so the
unit test is the one that proves the rule.

## Connection: the connect-armed state machine

The sync socket and the Connect gesture are deliberately separate.

**The socket opens at mount.** Piano-roll, params, and signals data has always
flowed without pressing Connect, and this socket carries them, so gating it on
Connect would be a regression. Runs and decorations arriving pre-Connect are
harmless: they are server truth.

**Connect arms a flag.** `livecodeRuntime` keeps an `armed` flag, and the
open-sequence — `/health` → new LSP session → `/runtime/state` rehydration →
flush queued stops → re-analyze every registered module — runs only when armed.
Concretely:

| Event | Armed | Unarmed |
| --- | --- | --- |
| Socket opens | run the open sequence | do nothing |
| `connect()` while the socket is already open | run the open sequence now — the open edge is not coming back on its own | n/a |
| `connect()` while the socket is closed | report `connecting`; the sequence runs at the next open | n/a |
| Socket closes | `markModulesUnknown()`, report `connecting` | do nothing |
| Socket errors | record the error, report `error` | do nothing |
| `disconnect()` | disarm, retire LSP, clear diagnostics, report `closed`, `markModulesUnknown()` | n/a |

Every open-sequence start and every `disconnect()` bumps a sequence counter, so
a slow `/health` response cannot land on a session that has since been
superseded.

**An armed close reports `connecting`, not `closed`.** The reconnecting
controller is already retrying with backoff and an armed client is still trying
to be connected; `connecting` is what that is. (Earlier planning prose said
`closed`; the implementation is `connecting` and this is the deliberate
divergence.)

**`markModulesUnknown()`** sets every module's run status to `unknown` and clears
active wait ids, lookups, and the last sync sequence. It runs on an armed close
and on `disconnect()`.

**Disconnect does not close the socket.** It disarms. Rolls, params, and signals
keep flowing, because they were never gated on Connect; what stops is the
runtime domain — no open sequence, no run or wait state applied. The apply
effect is gated on `armed`, so letting server truth quietly overwrite the
`unknown` state a disconnect just published would make Disconnect a lie.

The Connect UI reflects **armed and open**, so pre-Connect the app does not
render "connected" even though the sync socket is already carrying entity data,
and both E2Es' connection-text assertions keep their meaning.

Changing the server URL disconnects, re-points the sync provider (which owns the
URL and the socket), and re-arms afterwards only if it was armed before.

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

The sync provider's `rolls` map is server truth. A shape applies foreign-origin
note updates to the custom element and suppresses its own echoes. Initial mount
always applies the server state. `fitZoomToNotes` currently runs only for
revision 1.

Client edits post undoable writes. Livecode helper writes default to
non-undoable. Undo/redo use a history-specific origin so their confirming
deliveries are not suppressed by the originating shape.

### Playhead markers

The component's single live playhead is untouched. Beside it,
`setPlayheadMarkers(markers)` renders **any number** of labeled lines,
reconciled by id, which is what lets several processes play one melody at once
and stay distinguishable. `getPlayheadMarkers()` reads back what is rendered.

The shape feeds it from `useSignalsSync()`. On each RAF-coalesced flush it
selects every signal anchored `{ type: "pianoRoll", name: rollName }` that has
not ended, and turns each into one marker:

- a numeric value is the position;
- an object with a numeric `position` uses that field;
- anything else (strings, objects without a position, nulls, non-finite
  numbers) renders **nothing** rather than guessing;
- positions are quarter notes, the component's own unit, and `anchor.path` is
  ignored in v1.

Meaning stays in the process: the platform never knows why a position moves.
Ended signals and a sync socket that is not open both render no markers at
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
closes it, and a datalist offers the names the relevant sync map holds without
restricting free text. A failed action leaves the input open with the server's
message in the topbar rather than discarding what was typed.

New params pane creates a view only. **New piano roll is dual-mode**: a name
the piano-roll sync map already carries only creates another view, while a new
name posts `/entities/create` first and then creates the view — the composite
create-entity-plus-view gesture, with view-only reuse for the names that exist.

**New scope** is view-only and never creates anything server-side: a signal is
published by code or it is not, and a param leaf exists or it does not. Its
datalist offers every live signal name plus every numeric param leaf as
`params:<name>.<field>`, and that same syntax is what the input parses — a
`params:` prefix binds a param leaf (first dot-separated segment is the entity
name, the rest is the path), and anything else is a signal name, taken whole
when the signals map already knows it and split at its first dot otherwise, so a
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
