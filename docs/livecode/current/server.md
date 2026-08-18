# Current Deno Server Architecture

Status: checked against `apps/deno-notebooks/livecode` and
`packages/livecode-engine` — most recently the execution-plane extraction into
that package — as of 2026-08-18; first audited 2026-07-21.

## The engine package split

The execution plane lives in `packages/livecode-engine` (the first slice of
`docs/livecode/history/browser-engine-plan-2026-08.md`): the entity stores,
sync sources, runtime instrumentation singletons, and
`engine.ts`'s `createLivecodeEngine` — the parent `TimeContext` loop, launch
queue, pending-launch window, active modules, run records, and the one
broadcast timer. The package is portable TypeScript with injected capabilities
(`importModule`, `panicMidi`, the per-tick `onSyncTick` sink) and is gated by
`browser_target_check_test.ts` to stay typecheckable under a browser lib.

`visualizer/server.ts` is its Deno host, and it hosts execution through an
**execution plane** (`visualizer/execution_plane.ts`): one op surface
(`EngineOp` in the protocol package, executed by the package's
`executeEngineOp`) behind two implementations selected by the server's
`engineMode`:

- **local** (default): the plane owns an engine in this process and executes
  ops directly — today's behavior, byte-for-byte on the wire.
- **remote** (`--engine remote`): the server runs **no engine at all**. A
  browser tab opens `GET /engine/` (the engine host page, built lazily by
  `browser_host/build_host_assets.ts` into the session directory), attaches
  over the `WS /engine/uplink`, announces itself with full entity resets, and
  from then on every runtime/entity op forwards to the tab while its 33 ms
  sync feed relays back into the server's `/sync` fan-out. Reads forward too,
  so every HTTP answer is point-in-time engine truth; with no tab attached,
  runtime/entity routes answer with an explicit "No engine attached" error,
  and `/sync` subscribers get empty resets. An engine detach pushes empty
  resets (the watched world is gone); a re-attach pushes its hello resets.
  Analysis, project files, prepared runs, and LSP stay server-side; analyze
  and materialization emit `runtimeImport: "/engine/runtime.js"` and
  browser-served module URIs (`/engine-assets/generated/<id>.ts`,
  `/engine-assets/project/<runtimePath>`), transpile-served with type
  stripping so relative project imports keep their stable URLs. The
  deprecated `/runtime/snapshots` shim is local-mode-only.

With `--ui-dist <path>` the server also serves a **built tldraw client** at
its own origin (static fallback after every API route). Combined with the
remote engine this puts UI tabs and the engine tab on one origin, which is
what enables the client's `sync=broadcast` transport: the UI reads the engine
tab's BroadcastChannel sync host directly — the 33 ms hot path never touches
the network — while writes, analysis, project, and LSP stay HTTP/WS against
the same origin. The full tldraw E2E passes in this topology
(`LIVECODE_E2E_UI=served`), in the relayed remote topology, and locally.

The server keeps everything host-specific either way — HTTP/WS transports,
project files, analysis, prepared-run bookkeeping, LSP, MIDI backend.

There are no re-export shims at the old `visualizer/` paths: helpers, the
server, tests, the `piano-roll-store` alias, and the generated-code runtime
URL (`packages/livecode-engine/runtime.ts` by file URL locally,
`/engine/runtime.js` for a browser engine) all point at the package
directly.

## File map

- `visualizer/main.ts`: CLI parsing, server creation, SIGINT/SIGTERM shutdown.
- `visualizer/server.ts`: HTTP/WebSocket routing, session directories, project
  state, prepared runs, the engine instance and its tick fan-out, LSP server,
  client command forwarding, and cleanup.
- `packages/livecode-engine/engine.ts`: `createLivecodeEngine` — launch queue,
  pending launches, active-module lifecycle, run records, parent loop, root
  clock registration, sync-source registry, and the one broadcast timer.
- `visualizer/protocol.ts`: a one-line re-export of
  `@avtools/livecode-protocol`, so server imports keep reading as
  `./protocol.ts`. It holds no types of its own; wire types go in the package,
  server-only types in the module that owns them.
- `packages/livecode-engine/sync_sources.ts`: the `SyncSource` registry the broadcast timer
  walks — one `collectChanges()`/`snapshotAll()` pair per entity kind, plus the
  shared engine for the module-keyed ephemeral kinds.
- `visualizer/analyze_transform.ts`: per-module parsing, diagnostics,
  instrumentation, manifest generation, and default-export normalization.
- `visualizer/project_shadow_analysis.ts`: project import graph, temporary
  transformed shadow tree, `deno check`, and dependency diagnostics.
- `packages/livecode-engine/runtime.ts` (the module generated code imports
  for its instrumentation helpers): process-global instrumentation
  state imported by generated modules, plus the per-module dirty hints its
  wait/lookup sync sources drain.
- `packages/livecode-engine/piano_roll_store.ts` (the `piano-roll-store` alias target): named
  piano rolls as the third typed wrapper over the entity store — per-roll
  undo/redo in a side structure, compare-and-set, history labels, never-throw
  cloning, deletion with a remembered deleted-defaults set, and demo seeding.
- `packages/livecode-engine/entity_store.ts`: generic
  `(type, name)`-keyed records with revisions, per-name monotonic revision
  floors, no-op caching, never-throw serialization, and the per-type
  **changed-name set** that is the broadcast gate. All three typed stores sit
  on it.
- `packages/livecode-engine/params_store.ts`: params entities as the
  first typed wrapper over the entity store — declaration, recursive
  reconcile, leaf merges, create / duplicate / remove / load, and the sampler
  that adopts code writes.
- `packages/livecode-engine/signals_store.ts`: ephemeral signals as
  the second typed wrapper over the entity store — declaration returning a
  handle, sticky ending, ownership stamping, per-module ending, and the
  sampler that adopts code writes and stamps them with logical time.
  Deliberately **not** registered in `entity_registry.ts`; that single
  omission is the whole ephemeral class.
- `packages/livecode-engine/entity_registry.ts`: one descriptor
  interface over every durable entity type, so generic entity actions and
  project persistence never have to know which type a name addresses. It also
  owns the entity-name-to-filename encoding.
- `visualizer/lsp_proxy.ts`: per-session proxy process that creates a synthetic
  workspace and runs `deno lsp -q`.
- `packages/livecode-engine/generated_run_id.ts`: generated-build ID
  creation.
- `visualizer/fs_utils.ts`: never-throwing best-effort recursive cleanup.
- `helpers/piano_roll_helpers.ts`: livecode-facing clip conversion, named store
  access, and `TimeContext`-scheduled playback.
- `helpers/canvas_params.ts`: the `canvasParams(name, defaults, meta?)`
  declaration helper. It is a thin typed delegate to `registerParams` and has
  no server dependency, so a module using it also runs under a plain
  `deno run`.
- `helpers/canvas_signals.ts`: the `signal(name, { anchor? })` declaration
  helper, a thin typed delegate to `declareSignal`. Like `canvas_params.ts` it
  has no server dependency, so a module using it also runs under a plain
  `deno run` — where its signals simply have no owner and never auto-end.
- `helpers/midi_helpers.ts`: the livecode MIDI surface over the isomorphic
  `@avtools/midi` package — lazy idempotent `initMidi()` (run eagerly at
  import only on the native backend; browser hosts call it from a user
  gesture), safe send wrappers, sounding-note registry, and panic.
- `helpers/midi_math.ts`: side-effect-free MIDI clamping.
- `tests/`: unit, protocol, LSP, project, p5gpu, repro/regression, and CLI
  tests. See `testing-and-operations.md` for the actual task matrix.

## Server instance state

`createLivecodeVisualizerServer` creates one HTTP server and owns:

- one session directory and log file;
- `syncSockets`: a map from each open `/sync` socket to its state
  (`{ socket, subscriptions, seq }`);
- `sockets`: the deprecated `/runtime/snapshots` shim's socket set;
- a map of browser control sockets and pending commands;
- one **engine instance** (`createLivecodeEngine`), which itself owns the
  `SyncSourceRegistry`, the one broadcast timer, active modules and their
  `TimeContext` branch handles, pending launches (one
  accepted-but-not-started run per module, with its run token and
  cancellation flag), `moduleRunSnapshots` plus `dirtyRunModules`, and the
  FIFO launch-action array drained by one parent `TimeContext` loop;
- prepared runs plus a per-module pruning index (build metadata is
  coordination-plane state; the launch route passes the matching prepared
  entry into `engine.launchModule`);
- one global current project for the server instance, including the compact
  entity JSON its last save or open recorded;
- cached/in-flight project diagnostics;
- an LSP WebSocket process manager with at most four proxy processes.

`runtime.ts` and `entity_store.ts` (with the piano-roll, params, and signal
entities inside it) are module singletons in the engine package, not fields of
the server or engine object. They are shared by every generated module and
would also be shared by multiple server objects in one isolate. Run records are
the exception — they live on the engine object created per server, which is
why the run sync source takes its accessors as constructor dependencies
instead of importing a store.

## Session directories

Default persistent server files live under:

```text
apps/deno-notebooks/.avtools-livecode-sessions/
  logs/
    server.log
    lsp/
      proxy-stdout.log
      proxy-stderr.log
  <server-session-id>/
    modules/       # transient editor source mirrors
    generated/     # transient transformed builds
    shadow/        # parent for short-lived project diagnostic dirs
```

LSP workspaces live outside the repository:

```text
$TMPDIR/avtools-livecode-lsp-workspaces/<server-session-id>/<proxy-uuid>/
```

Non-project generated files are retained only for the most recent three
prepared runs per module, except that an active run is not pruned. Session
directories themselves are not deleted on normal server shutdown. Project
runtime files live in the project and are overwritten when their source hash
changes.

## Complete route catalog

### Health and client control

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/health` | Version, session root, active module IDs, and runtime capability flags. |
| GET | `/client/clients` | Connected tldraw control clients. |
| POST | `/client/command` | Forward one command to a selected/first client and await its result with a bounded timeout. A command-level failure is returned in a JSON body; it is not necessarily an HTTP error. |
| WS | `/client/control?clientId=...` | Browser command channel. A new socket with the same ID replaces the old one. |

### Runtime

| Method | Route | Behavior |
| --- | --- | --- |
| POST | `/runtime/analyze` | Analyze/materialize a transient or current-project module and remember a prepared run. |
| POST | `/runtime/launch` | Enqueue a dynamic import/branch. Reject a module that is already active *or* already launching unless `replaceRunning` is true. Successful HTTP response means queued, not necessarily imported or started. |
| POST | `/runtime/stop` | Gracefully stop one currently active module, or cancel one still-queued launch; a missing module is treated as success. |
| POST | `/runtime/stop-all` | Cancel every pending launch, then gracefully stop all currently active modules in parallel. |
| POST | `/runtime/panic` | Cancel every pending launch, immediately cancel active modules without stop hooks, and panic MIDI. |
| POST | `/runtime/restart-all` | Stop all active modules and rematerialize the current project. It does not relaunch the prior modules despite the route name. |
| GET | `/runtime/status` | Compact list of active module build identities/hashes. |
| GET | `/runtime/state` | Rehydration state: active modules with manifests, latest run rows (each carrying `runToken`), and latest remembered prepared manifest per module. |
| WS | `/runtime/snapshots` | **Deprecated shim.** Full-fidelity `ActiveWaitSnapshot` for the Vue SketchWrapper only: full snapshot on open, then whenever the serialized whole snapshot changes. Token-free rows. No subscribe message. |

### Sync transport

| Method | Route | Behavior |
| --- | --- | --- |
| WS | `/sync` | The one watched-state channel. Sends nothing until the client subscribes; a subscribe replaces the socket's type set and replies with `resets` for every listed type; afterwards the shared 33 ms tick sends only that socket's subscribed types' changed entities. |

### Project

| Method | Route | Behavior |
| --- | --- | --- |
| POST | `/project/create` | Create/select a project, optionally add modules, write the manifest, and materialize runtime files. |
| POST | `/project/open` | Select a manifest/directory, load every manifest `data` entity, read sources, initialize hashes, and materialize runtime files. |
| POST | `/project/save` | Explicit save: rewrite the manifest, write one JSON file per durable entity in memory, rebuild `manifest.data`, and write the manifest again. Returns per-entity results and deliberate skips. |
| GET | `/project/current` | Current global project selection and manifest, or `null`. |
| GET | `/project/status` | Disk/editor/load/run hashes, staleness, dependency graph summaries, active modules, and the per-entity unsaved section. |
| GET | `/project/diagnostics` | Cached, non-mutating shadow transform plus `deno check`. |
| GET | `/project/events` | Currently returns the same one-shot JSON as `/project/status`; it is not SSE or a WebSocket. |
| GET | `/project/modules/source?id=...&path=...` | Source text and normalized module record. |
| POST | `/project/modules/add` | Add/write/materialize a module and update the manifest. |
| POST | `/project/modules/update` | Update metadata/layout, ensure its source exists, write the manifest, and materialize. Path renaming is not implemented; lookup finds the existing record before assigning only metadata fields. |
| POST | `/project/modules/write` | Write canonical source, advance/set source version, write the manifest, and materialize. |
| POST | `/project/modules/reload` | Adopt the current disk source hash as editor/loaded state and materialize. |
| POST | `/project/modules/remove` | Remove the manifest/cache record. It does not delete source/runtime files or stop an active module. |
| POST | `/project/canvas` | Replace the manifest's canvas object; currently used for piano-roll-view layout. |

### Durable entities

| Method | Route | Behavior |
| --- | --- | --- |
| POST | `/entities/create` | Create one entity of a registered type. Status 409 when the name exists. |
| POST | `/entities/duplicate` | Copy `name` to `targetName` within one type. Status 404 for a missing source, 409 for an existing target. |
| POST | `/entities/delete` | Remove one entity from its store. Status 404 when it was not there. Views of it are untouched. |

### Piano roll

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/piano-roll/list` | Full snapshot envelope, despite the route name. Read-only with respect to the broadcast gate. |
| POST | `/piano-roll/set` | Normalize and set one roll, optionally checking `expectedRev` and recording undo history. A missing name is created at rev 1: roll writes are upserts, unlike `/params/set`. |
| POST | `/piano-roll/undo` | Undo one named object's history. |
| POST | `/piano-roll/redo` | Redo one named object's history. |

### Params

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/params/list` | Read-only full snapshot, despite the route name. |
| POST | `/params/set` | Deep-merge leaf values into one live entity, optionally checking `expectedRev`. Status 404 for an unknown name; a write never creates an entity. |

### Signals

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/signals/list` | Read-only full snapshot, despite the route name. |

There is deliberately no `/signals/set`: signals are code-published only, so
the tier has no write route to secure, rate-limit, or reconcile.

The three per-channel entity sockets — `/piano-roll/snapshots`,
`/params/snapshots`, `/signals/snapshots` — are **deleted**. Every entity kind
reaches watchers on `/sync`; the HTTP list routes are unchanged.

### Remote engine mode only

| Method | Route | Behavior |
| --- | --- | --- |
| WS | `/engine/uplink` | The engine host tab's attach point. A new socket replaces the previous engine (same rule as `/client/control`). Carries `engineHello` resets, per-tick `engineSync` changes, and `engineRequest`/`engineResult` op forwarding — see `packages/livecode-protocol/engine_uplink.ts`. |
| GET | `/engine/`, `/engine/<asset>` | The engine host page and its code-split bundles, built lazily into the session directory on first request. |
| GET | `/engine-assets/generated/<file>.ts` | A transient generated module, type-stripped to browser JS at serve time. |
| GET | `/engine-assets/project/<runtimePath>` | A materialized project runtime file, served the same way; relative imports resolve back through this route at stable URLs. |

### LSP

| Method | Route | Behavior |
| --- | --- | --- |
| WS | `/lsp?session=...` | Attach a browser VTLSP transport to a managed `lsp_proxy.ts` process. |

All routes accept permissive CORS. The outer HTTP handler converts thrown route
errors into `{ ok: false, error }` JSON with status 500. `/runtime/launch`
separately maps synchronous launch refusal to status 409. There is no request
schema validation; TypeScript interfaces are compile-time documentation only.

## Analysis and prepared runs

Transient analysis writes source to `session/modules`, writes transformed code
to a unique generated file, hashes the source, and remembers the manifest.

Project analysis finds a module in the current project, materializes every
changed project source (reusing successful results by source hash), and returns
the selected runtime file URL. All results from one materialization call share
one newly created `generatedRunId`, even when their cached transform result was
created earlier.

Prepared runs are keyed only by `generatedRunId`. Up to three IDs are indexed
per module, with active IDs retained. A launch request is allowed even when no
prepared entry exists; in that case request-provided URI/hash/manifest data is
used.

## Launch queue and module lifecycle

The parent context loops at roughly 30 ms, splices all queued actions, and
awaits them sequentially. Each launch action:

1. adds a fresh `launch=<uuid>` query to the requested module URI;
2. dynamically imports it in the server isolate;
3. selects `runFunc` or the default export and optional `stop`;
4. creates a child `TimeContext` branch;
5. records the active module and its manifest/hash identity.

The child marks itself running, awaits user code, converts non-cancellation
errors to a run-record error entry/log, clears active waits, and removes itself
only if it is still the active run under the same **run token**.

The HTTP launch response happens after enqueueing, before import. Import or
top-level evaluation failures therefore arrive through logs/snapshots rather
than the original HTTP response.

### Pending launches

Acceptance means queued, so the window between the response and the action's
turn has its own identity: `pendingLaunches` maps a module ID to its
`{ generatedRunId, runToken, cancelled }` entry, registered before the action is
pushed and deleted only after ownership transfers to `activeModules`. A module
is therefore never absent from both maps while it is startable.

The `runToken` is minted **at accept time**, on `PendingLaunch`, not after the
import. That is what lets the `launching` run record this request publishes
already carry the run's identity, and what lets a cancellation tell whether the
record it is about to overwrite is still the one it owns.

At request time a pending launch is treated exactly like a running one: refused
unless `replaceRunning` is set, and marked cancelled by the request that
supersedes it. A pending entry that is already cancelled counts as absent, so a
relaunch immediately after a Stop is not refused by the doomed action it is
replacing. An `activeModules` hit with `replaceRunning` still stops the old run
at request time, so an explicit replacement silences it when the user asked
rather than when the queue gets around to it; that stop suspends past the point
where it empties `activeModules`, so whatever holds the pending slot when it
returns is cancelled before this request registers its own entry.

The queued action then re-applies every decision taken since acceptance:

- **cancelled before start** — publish the terminal `stopped` entry the accepted
  request's `launching` entry owed, log `launchCancelled`, and return;
- **a run appeared meanwhile** — with `replaceRunning`, stop it again (a second
  stop is idempotent); without it, log `launchAborted` and return *without*
  writing any run record, because the run that genuinely won owns that module's
  record and its own entity changes keep clients converged;
- **cancelled during the import** — the import is the action's one long await,
  so the flag is checked once more after it resolves, before `ctx.branch`.

`stopModule` for a module that is not active cancels a pending launch, emits its
terminal record, and reports success. `stopAllModules` and `panicRuntime`
cancel every pending entry first, so a panic cannot be followed by a queued
launch starting.

`publishCancelledLaunch` is the one guard this slice re-keyed. It writes the
terminal a cancelled launch owes only when **both** halves hold:

```ts
if (current.runToken !== pending.runToken) return;
if (current.state !== "launching") return;
```

Both are load-bearing. The token rules out a *successor's* record, which
`generatedRunId` could not: a relaunch of an unchanged build reuses the ID. The
state check rules out this launch's OWN terminal — a stop cancels the pending
launch and publishes `stopped` under the same token, and the queued action then
arrives and must not reopen it. A bare token compare would let the queued action
clobber a stop's terminal.

### Run identity versus build identity

`generatedRunId` identifies a prepared build, not a run: the client reuses a
matching prepared build, so Replace without an edit relaunches under the same
ID. Three places therefore need a stronger identity than the ID:

- each started run gets a `runToken`, stored on its `ActiveModule`. The branch's
  terminal bookkeeping — removing itself, ending its signals, publishing its
  terminal — happens only while the slot still holds that token, so a slow-dying
  older branch cannot retire the run that replaced it;
- `publishCancelledLaunch` uses the token-plus-state predicate above;
- `teardownActiveModule` always cancels the handle it was given, because that is
  the run the caller asked to stop, but everything slot-scoped runs only while
  `activeModules` still holds that exact record. This one keeps its **object
  identity** check, unchanged: `stopModule` captures the record before awaiting a
  `stop()` hook for up to two seconds, and a replacement can win the slot inside
  that window; the superseded teardown logs `supersededTeardown` and returns.

The token is also on the wire. It reaches clients on the `run` entity and on
`/runtime/state`'s rows, which is what lets a client dedupe terminals correctly
during a replacement (see `client.md`). The deprecated `/runtime/snapshots`
envelope keeps its token-free rows.

### Run, waits, and lookups as entities

The three ephemeral runtime kinds are written and cleared at exactly the sites
that already owned that state:

| Kind | Written by | Cleared / deleted by |
| --- | --- | --- |
| `run` | `setModuleRunSnapshot` — every lifecycle write: `launching` at accept, `running` inside the branch, `stopped`/`error` in the branch's `finally`, the cancelled-launch terminal, and `teardownActiveModule` | never removed; a module's latest run record persists for the life of the server |
| `moduleWaits` | `enterWait` / `exitWait`, from the instrumented `visualizedAwait` wrapper | `clearModuleWaits` in the branch `finally`, in `stopModule` for an inactive module, and in `teardownActiveModule`; a module with no active callsites deletes |
| `moduleLookups` | `recordPianoRollLookup`, from the instrumented `visualizedPianoRollLookup` wrapper | `clearModulePianoRollLookups` at the start of each `/runtime/analyze` for that module, since new callsite ids invalidate the old names |

`setModuleRunSnapshot` adds the module id to `dirtyRunModules`; the wait and
lookup mutators add to their own dirty sets in `runtime.ts`. All three are hints
only — the module-keyed source compares serialized values before shipping — so
the marking itself stays a bare `Set.add` on a hot path.

None of this changed the `visualizedAwait` / `visualizedPianoRollLookup`
callsites or the generated-code contract. Only the transport of their state
moved.

## Sync sources and the one broadcast tick

There is exactly **one** timer per engine, at 33 ms, and exactly one walk over
the sources per tick. The timer lives in `createLivecodeEngine`; the host's
sink receives the single collect and fans it out:

```ts
// engine.ts
const broadcastTimer = setInterval(() => {
  try {
    deps.onSyncTick(syncSources.collectAll());
  } catch (error) { /* logged as broadcastTickError */ }
}, deps.snapshotTickMs ?? 33);

// server.ts, the Deno host's sink
onSyncTick: (collected) => {
  broadcastSyncChanges(collected);
  broadcastLegacyRuntimeSnapshot();
},
```

A thrown error inside the tick is caught and logged as `broadcastTickError`, so
one hostile entity cannot kill the shared timer.

### The `SyncSource` contract

```ts
interface SyncSource<E> {
  readonly entityType: string;
  /** Drains this kind's gate. Null when the tick found nothing to ship. */
  collectChanges(): EntityChange<E>[] | null;
  /** Read-only full state, for a subscribe reset. */
  snapshotAll(): E[];
}
```

The difference between the two methods is the whole discipline:

- `collectChanges()` **drains** that kind's change gate, so it has exactly one
  caller per tick. `SyncSourceRegistry.collectAll()` is it, and both the `/sync`
  fan-out and the legacy shim read its result rather than draining anything a
  second time. Two independent timers would double-consume the gates and starve
  one side.
- `snapshotAll()` is **strictly read-only**. It answers one `/sync` subscribe
  and nothing else, so it must never consume a generation the open sockets are
  still owed and must never seed, adopt, or stamp anything. (This is why demo
  roll seeding moved to server construction: a read path must not create an
  entity.)

Six sources are registered at construction: `pianoRoll`, `params`, `signal`,
`moduleWaits`, `moduleLookups`, `run`. An unregistered type named in a subscribe
resets to an empty list rather than 404ing.

### Change tracking is per name, not a boolean

`entity_store.ts`'s gate is a per-type **set of changed names**, written by
every mutator: value writes, meta writes, `ended`/anchor/owner flips,
`unserializable` transitions, creates, and deletes. `consumeEntityTypeChanges`
resolves that set against the live records at collect time and returns
`{ changed, deleted }`, both sorted — so a name created and deleted inside one
tick reports as a deletion, and one deleted then recreated reports as a change.

A serialize-compare over live values could not do this job: it cannot see a
deletion, and it cannot see a change that does not alter the value (a signal's
`ended` flip, a params meta replacement). A scope that never learns `ended`
silently freezes, which is a principle violation, not a nuisance.

### Sampler split: adopt always, ship what changed

The params and signals stores each expose two functions:

- `adoptParamsCodeWrites()` / `adoptSignalCodeWrites()` — the sampler half.
  Safe-stringify every live value, set/clear `unserializable` with one warning
  per transition, and adopt a changed serialization as a store write
  (`rev` bumps, `updatedBy: "code"`; the signals version also stamps root-clock
  logical time).
- `sampleParamsChanges()` / `sampleSignalChanges()` — the tick. Run the adopt
  pass, then drain the gate and return one `EntityChange` per changed name,
  `entity: null` for a deleted one.

**The adopt pass runs on every tick regardless of subscriptions.** "Unwatched
costs nothing" is a transport property; an unwatched run has to behave
identically to a watched one, and `rev` has to stay a monotonic generation
counter whether or not a pane is open.

The `pianoRoll` source has no sampler half at all: nothing outside
`piano_roll_store.ts` writes a roll, so there is no code drift to adopt, and
`collectPianoRollChanges()` is pure write-time tracking. An idle store costs one
set-size check rather than a per-tick serialize of every note array.

### Module-keyed ephemeral sources

`run`, `moduleWaits`, and `moduleLookups` share one engine
(`createModuleKeyedSource`) because their mutators live on hot paths —
`enterWait` runs at every awaited callsite — so marking dirty must be a bare
`Set.add`. The real filter is in the source: it keeps the last serialized value
per name and skips a name whose value is byte-identical. A steady wait loop
re-entering the same callsite set therefore never rebroadcasts an identical
array, which is the silence the natural-completion E2E depends on.

`snapshotAll()` deliberately does not touch that cache: a read must not decide
what a later tick ships.

Deletion is how "nothing to report" is expressed. `getModuleWaitCallsites`
returns null for a module awaiting nothing, `getModuleLookups` returns null for
a module with no recorded lookups, and `runEntityFor` returns null for a module
that has never run — each becomes `entity: null`. A name that never shipped
anything is skipped entirely, so its absence is not announced as news.

### Fan-out

`broadcastSyncChanges` walks the collected map once per open socket, filters to
that socket's subscriptions, and sends one envelope; a socket with no
subscriptions or no matching changes gets nothing. `sendSyncMessage` advances
that socket's `seq` **only after a successful send**, so a serialization failure
(logged `syncSerializeFailed`) cannot manufacture a gap the client would chase.

`broadcastLegacyRuntimeSnapshot` then builds the deprecated `ActiveWaitSnapshot`
from the same singletons at full fidelity — `modules`, `pianoRollLookups`,
sorted `activeModules`, and `moduleRuns` with `updatedAtMs` and **without**
`runToken` — and compares the concatenated JSON of those four sections against
the previous tick's. That comparison is pure: it is not a gate anything else
consumes, so keeping it costs the sync path nothing.

### Shutdown

`close()` closes the shim sockets, the `/sync` sockets, and the control
sockets, fails every pending client command, then calls `engine.close()` —
which clears the one broadcast timer, unregisters the root time context (a
cancelled clock must not keep stamping samples), stops all modules, panics
MIDI, and cancels the parent context — and finally shuts down the LSP proxies
and the HTTP server.

## Project diagnostics

`/project/diagnostics` reads every project source using an mtime+size content
cache, hashes the aggregate, and returns the cached response for the same hash.
Only one shadow analysis runs at a time; callers for a different hash wait and
then start a new pass.

The shadow analyzer:

1. parses static imports, re-exports, and string-literal dynamic imports;
2. builds direct dependencies/dependents and transitive changed dependencies;
3. creates a unique temporary shadow subtree;
4. rewrites relative imports that leave the project to absolute file URLs;
5. transforms each current `*.orig.ts` buffer into its runtime path;
6. runs `deno check` with the repo root `deno.json`;
7. parses textual Deno diagnostics and maps shadow file paths to modules;
8. removes the unique shadow subtree best-effort.

The current `diagnostics` and `dependencyDiagnostics` arrays on each module are
populated with the same diagnostics attributed to that module. The name
`dependencyDiagnostics` does not represent a separately propagated diagnostic
set.

## LSP proxy

The proxy builds a synthetic workspace `deno.json` by merging and absolutizing
imports from the root and `apps/deno-notebooks` configs. It symlinks the repo
root into the same absolute-looking location below the workspace so repository
file URIs remain resolvable.

Repo-backed open documents are not written through that symlink; Deno LSP owns
their in-memory buffer. Other virtual documents are written into the temp
workspace. The proxy adds document versions to diagnostics when Deno omits
them, answers workspace configuration requests, and converts URIs in both
directions.

Signal/finally cleanup disposes the RPC connection, sends SIGTERM to the real
`deno lsp` child, and removes the proxy workspace best-effort.

## Piano-roll and MIDI stores

`piano_roll_store.ts` is the **third typed wrapper over `entity_store.ts`**. A
roll is a `(type: "pianoRoll", name)` record whose value is its `PianoRollData`;
identity, revisions, revision floors, the no-op cache, and the changed-name gate
all come from the shared substrate, and the public function signatures are
unchanged, so routes, helpers, the registry descriptor, and user modules
importing `"piano-roll-store"` see the same API they always did.

What the wrapper still owns, because each earns its keep:

- **Undo/redo stacks in a side structure.** They are keyed by entity name in a
  module-level `histories` map rather than living on the record, because they
  are never serialized. `deletePianoRoll` drops the entry, so a recreated name
  cannot undo into a state it never held. `clearPianoRollHistory` drops one
  roll's stacks, which a project load uses because opening a project adopts disk
  truth and the pre-load stacks would undo into a state the file never
  contained. At most 100 entries per stack.
- **Compare-and-set.** `expectedRev` is optional; a mismatch returns the current
  object with `conflict: true`, and callers that omit it retain last-write-wins.
- **Never-throw cloning.** Non-cloneable metadata is dropped through guarded
  fallbacks rather than throwing into user timing code. Note IDs and velocity
  are normalized, every entry point trims its name, and a JSON-equal write is a
  no-op with no revision churn.
- **Upsert semantics.** `setPianoRoll` on a missing name creates it at rev 1, so
  module write-back (`setPianoRollClip`) needs no prior `/entities/create` — the
  params store's write-never-creates rule deliberately does not apply here.
- **Demo-seed semantics.** The seed write is stamped `updatedBy: "demo-seed"`,
  which is how a save recognizes an untouched seed and leaves it out (any real
  write bumps rev past 1 and captures it from then on). `deletePianoRoll`
  records the name in a `deletedDefaults` set so it cannot be re-seeded.

Seeding now happens **once, at server construction**, not lazily from read
paths. That is a requirement of the transport, not a tidy-up: `snapshotAll()`
answers a `/sync` subscribe and has to be genuinely read-only, so nothing may
create an entity on the way to answering one.

Two exports went away with the migration: `markPianoRollStoreDirty` (no in-tree
caller once the gate became per-name) and `getAllPianoRolls` (now internal to
the full-snapshot envelope `/piano-roll/list` returns). `pianoRollExists` was
added, so the registry descriptor can answer existence without the deep clone
`getPianoRoll` owes its callers.

MIDI devices are enumerated and opened when `midi_helpers.ts` is first imported.
Send failures are logged rather than thrown. `panicMidi` silences tracked notes
but does not close ports; `closeMidiDevices` exists for full teardown and is not
called by the server shutdown path.

## Entity store and params entities

`entity_store.ts` owns identity, revisions, the no-op cache, the per-type
changed-name set and snapshot sequence, and never-throw serialization. Per-type
semantics live in the wrappers beside it: `params_store.ts`, `signals_store.ts`,
and `piano_roll_store.ts`.

`registerParams(name, defaults, meta?)` is create-or-reattach and returns the
**live value object**:

- absent: the defaults are structured-cloned into a new record at rev 1 with
  `updatedBy: "declare"`;
- present: the live object is reconciled in place, recursively, at every depth.
  Existing values survive, new fields arrive at their default, a field whose
  declared type changed takes the new default, and a dropped field's value is
  kept in an in-memory tombstone so re-declaring it later restores the tweaked
  value. A reconcile that changed anything bumps rev once with
  `updatedBy: "reconcile"`. The declaration always replaces `meta`; a
  meta-only change marks the type dirty without bumping rev, because rev counts
  value generations and panes rebuild bindings from shape and meta.

Object identity is the contract: the same object is returned to every
declaration of one name and is mutated in place by HTTP writes, so a module
that kept a reference across a relaunch keeps observing live truth. Declaration
validates JSON-simple values and throws on anything else — including arrays,
which have no tweakpane binding in v1. Throwing is acceptable there and only
there, because declaration runs at module init rather than inside timing loops.

On every 33 ms tick `adoptParamsCodeWrites()` runs — whether or not anything is
subscribed. Per entity it safe-stringifies the live value, then:

- on failure, sets `unserializable: true` once and warns, keeping the last good
  serialization in payloads instead of freezing the loop;
- on success, clears that flag if it was set, and when the string differs from
  the cached one **adopts the drift** as a store write: rev bumps,
  `updatedBy` becomes `code`, and the cache is refreshed.

Adoption is the whole mechanism behind plain property writes: user code never
calls the store, so this sampler is where a code-authored generation is
recorded, and it is what keeps rev a monotonic generation counter that client
echo suppression can rely on. `NaN`/`Infinity` serialize to null and
`undefined` drops the key, which reads as a shape change. `sampleParamsChanges()`
then drains the changed-name gate; an idle store returns null and sends nothing.

`/params/set` merges leaves in place and detects no-ops against a fresh
serialization of the pre-merge value rather than the cache, which a code write
can have invalidated since the last tick. `GET /params/list` builds its snapshot
read-only.

Around that core, `createEmptyParams`, `duplicateParams`, `removeParams`, and
`loadParams` serve the generic entity actions. Duplicate deep-copies values and
meta but deliberately not tombstones: a copy starts with no memory of fields
its source once dropped. `loadParams` is reconcile-grade — it mutates any live
object in place at every depth, preserving nested object identity, clears the
entity's tombstones so a stale pre-load value cannot resurrect into a
re-declared field, and always bumps rev with `updatedBy: "load"`. Revisions are
also floored per name in `entity_store.ts`, so a recreated or re-loaded entity
can never be silently echo-suppressed by a pane whose `localRev` outlived the
old record.

There is nothing per-type left to shut down: one timer covers every kind, and
`close()` clears it once. Entities themselves are process-global and in memory
only; they are never evicted, and durable ones reach disk only through an
explicit project save (see below and `known-risks.md`). Signals never reach disk
at all.

## Ephemeral signals

`signals_store.ts` is the second wrapper over `entity_store.ts` and the first
entity type that is **not** registered in `entity_registry.ts`. That omission is
the entire ephemeral class: `/project/save`, `/project/status` data rows,
project open, and `/entities/*` all iterate `listDurableEntityTypes()`, so
signals are invisible to persistence and to generic CRUD by construction rather
than by a filter someone has to remember to keep in sync.

`declareSignal(name, { anchor? })` is create-or-reattach and returns a **handle
closed over the record**:

- absent: a new record at `value: null` with `updatedBy: "declare"`;
- present: the record survives (a handle another module still holds keeps
  writing to live truth), the anchor is replaced, and `ended` is cleared. That
  is a value-free change, so it marks the type dirty without bumping rev.

`handle.set(value)` is a **pure field assignment** — no store lookup, no
serialization, no dirty flag. Publishing an unwatched signal costs the same as a
property write, which is what makes "unwatched ≡ watched" true rather than
aspirational. A dirty flag here would also broadcast byte-identical snapshots
under a loop that re-sets the same value.

On every 33 ms tick `adoptSignalCodeWrites()` runs, exactly like its params
counterpart: safe-stringify each live value, set/clear `unserializable` with one
warning per transition, and on a changed serialization adopt the drift as a
store write (`rev` bumps, `updatedBy: "code"`). Adoption is also where the
record is stamped with root-clock logical time. It runs regardless of
subscriptions — an unwatched signal must still become an observed generation.
`sampleSignalChanges()` then drains the gate; an idle store sends nothing.

Ending is sticky and lifecycle-driven:

- `assignSignalOwner(name, moduleId)` is called by the analyzer-injected
  `__tcvOwnedSignal` wrapper, so ownership is established by the run that
  executed the declaration;
- `endSignalsForModule(moduleId)` runs from the two cleanup sites that already
  run `clearModuleWaits` — the launch branch's `finally` and
  `teardownActiveModule` — so a graceful stop, a panic, and a module that
  terminates on its own all end their signals rather than leaving a frozen
  reading behind;
- in the branch `finally` it is **inside** the `generatedRunId` guard, unlike
  `clearModuleWaits`. A slow-dying old branch would otherwise mark the next
  run's freshly redeclared signals ended after a `replaceRunning` or a
  stop-then-relaunch, and unlike a wait count, `ended` sticks;
- later writes keep updating `value` while `ended` stays set. Only a
  redeclaration clears it. Nothing polices a user timer that outlived
  cooperative cancellation; the contradiction is a surfaced finding.

Nothing reachable from user timing — `set`, `end`, ownership stamping, the
sampler — throws. Ended signals stay listed until their name is redeclared or
the server restarts (see `known-risks.md`).

## Root clock

`runtime.ts` owns a module-level `setRootTimeContext(ctx)` /
`sampleRootTime()`. The server's parent-loop launch registers its own
`TimeContext` as the process root clock, and observation code reads logical time
from it. Today the signals sampler is the only reader: it stamps each adopted
value with `timeSec`/`beats`.

`sampleRootTime` never throws and returns null when no context is registered or
a reading is not finite, so a plain `deno run` of a module (or a sample taken
before the parent loop starts) simply produces unstamped values. Stamps are
quantized by the ~30 ms parent tick and the 33 ms sampler tick; `protocol.md`
says so before anyone builds a musical x-axis on them.

## Durable entity registry

`entity_registry.ts` gives every durable entity type one descriptor:

```ts
interface DurableEntityTypeDescriptor {
  typeId: string;                                   // "pianoRoll" | "params"
  listNames(): string[];
  exists(name: string): boolean;
  create(name: string): void;                       // rejects existing
  duplicate(sourceName: string, targetName: string): void;
  remove(name: string): boolean;
  serialize(name: string): unknown | null;          // JSON-ready, null = skip
  deserialize(name: string, data: unknown): void;   // validate + apply
  latestJson(name: string): string | null;          // cached, for dirty check
}
```

Both descriptors are registered at server construction. Now that the piano-roll
store also sits on `entity_store.ts`, this is a thin naming/validation layer
over one substrate rather than a facade bridging two engines. Type ids are
assumed space-free because the saved-state map is keyed `"<type> <name>"`.

Everything here runs at route or save/load time, never inside caller-owned
livecode timing, so throwing on a bad name or a malformed saved file is the
right shape; the HTTP layer turns those into `{ ok: false, error }`.

`serialize` returns null to mean *skip this entity*, which is how a save stays
non-fatal: a params value that no longer serializes, a piano roll whose
metadata does not, and a pristine demo seed all return null and are reported in
the response's `skipped` list instead of failing the pass.

Entity names are established as slash-containing (`e2e/params`,
`kinaree/rects`), so `encodeEntityName` percent-encodes every byte outside
`[a-zA-Z0-9._-]`, `%` included. That is collision-free by construction and
needs no decoder, since the manifest entry carries the true name. Encoded names
longer than 100 characters are truncated (never mid-escape) and disambiguated
with a short FNV-1a hash of the full name. `allocateEntityDataPath` then
resolves case-insensitive collisions within one save with a numeric suffix,
because macOS filesystems would otherwise let two names overwrite one file.

## Project save and load of entity data

`POST /project/save` is the only path that writes entity data; the
write-through `writeProjectManifest` callers in the module and canvas routes
never do.

A save is point-in-time. Every registered type × every name serializes
synchronously into memory first, so one save captures one coherent instant of
the store, and only then do the awaited file writes happen. Each entity is
written to `data/<type>/<encoded-name>.json` (recursive `mkdir`, two-space JSON
with a trailing newline, matching the manifest precedent). The manifest is
written before the data files and again afterwards with the entries that
actually reached disk, so a crash mid-save can leave an orphan file but never a
manifest entry pointing at a missing one. Each written entity's compact store
JSON — not the pretty-printed file bytes — is recorded as its saved state, so
key order and formatting can never produce a false permanent "unsaved".

`openProject` loads that list immediately after it assigns `currentProject` and
before materialization, so every durable entity exists before any module could
run and read one. Each entry's path is validated with the `.json` variant of
the project-relative path checker (relative, lexically inside the project, no
NUL); a bad row is logged as `projectDataLoadSkipped` and skipped, because one
missing or broken file must not fail the whole open. Loading writes with
`undoable: false` and records the saved state per entity.

Save captures every durable entity currently in memory, not only the ones this
project introduced — the stores are process-global. Deleting an entity and
saving removes its manifest entry but leaves the old file on disk, matching the
manifest-only module-remove precedent. Both behaviors are covered in
`project-model.md` and `known-risks.md`.
