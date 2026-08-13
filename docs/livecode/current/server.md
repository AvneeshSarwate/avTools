# Current Deno Server Architecture

Status: checked against `apps/deno-notebooks/livecode` on 2026-07-21; the
entity/params stores, their routes, the durable-entity registry, and project
data persistence were checked on 2026-08-13; the signals store, its routes, and
the root-clock accessor were added and checked on 2026-08-13; the pending-launch
lifecycle was added and checked on 2026-08-13.

## File map

- `visualizer/main.ts`: CLI parsing, server creation, SIGINT/SIGTERM shutdown.
- `visualizer/server.ts`: HTTP/WebSocket routing, session directories, project
  state, prepared runs, launch queue, lifecycle snapshots, LSP server, client
  command forwarding, and cleanup.
- `visualizer/protocol.ts`: server-side TypeScript message shapes.
- `visualizer/analyze_transform.ts`: per-module parsing, diagnostics,
  instrumentation, manifest generation, and default-export normalization.
- `visualizer/project_shadow_analysis.ts`: project import graph, temporary
  transformed shadow tree, `deno check`, and dependency diagnostics.
- `visualizer/runtime.ts`: process-global instrumentation state imported by
  generated modules.
- `visualizer/piano_roll_store.ts`: process-global named piano-roll records,
  revisions, dirty snapshots, per-roll undo/redo, deletion with a remembered
  deleted-defaults set, and the cached JSON the saved-state compare reads.
- `visualizer/entity_store.ts`: generic `(type, name)`-keyed records with
  revisions, per-name monotonic revision floors, no-op caching, dirty/sequence
  bookkeeping, and never-throw serialization. `piano_roll_store.ts` is
  deliberately not migrated onto it.
- `visualizer/params_store.ts`: params entities as the first typed wrapper over
  the entity store — declaration, recursive reconcile, leaf merges, create /
  duplicate / remove / load, and the sampler that adopts code writes.
- `visualizer/signals_store.ts`: ephemeral signals as the second typed wrapper
  over the entity store — declaration returning a handle, sticky ending,
  ownership stamping, per-module ending, and the sampler that adopts code
  writes and stamps them with logical time. Deliberately **not** registered in
  `entity_registry.ts`; that single omission is the whole ephemeral class.
- `visualizer/entity_registry.ts`: one descriptor interface over both storage
  engines, so generic entity actions and project persistence never have to know
  which engine a name addresses. It also owns the entity-name-to-filename
  encoding.
- `visualizer/lsp_proxy.ts`: per-session proxy process that creates a synthetic
  workspace and runs `deno lsp -q`.
- `visualizer/generated_run_id.ts`: generated-build ID creation.
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
- `helpers/midi_helpers.ts`: eager MIDI enumeration/open, safe send wrappers,
  sounding-note registry, and panic.
- `helpers/midi_math.ts`: side-effect-free MIDI clamping.
- `tests/`: unit, protocol, LSP, project, p5gpu, repro/regression, and CLI
  tests. See `testing-and-operations.md` for the actual task matrix.

## Server instance state

`createLivecodeVisualizerServer` creates one HTTP server and owns:

- one session directory and log file;
- sets of runtime, piano-roll, params, and signals snapshot sockets;
- a map of browser control sockets and pending commands;
- active modules and their `TimeContext` branch handles;
- pending launches: one accepted-but-not-started run per module, with its
  cancellation flag;
- latest lifecycle snapshot per module;
- prepared runs plus a per-module pruning index;
- a FIFO launch-action array drained by one parent `TimeContext` loop;
- one global current project for the server instance, including the compact
  entity JSON its last save or open recorded;
- cached/in-flight project diagnostics;
- an LSP WebSocket process manager with at most four proxy processes.

`visualizer/runtime.ts`, `piano_roll_store.ts`, and `entity_store.ts` (with the
params entities inside it) are Deno module singletons, not fields of this
server object. They are shared by every generated module and would also be
shared by multiple server objects in one isolate.

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
| GET | `/runtime/state` | Rehydration state: active modules with manifests, latest run lifecycle entries, and latest remembered prepared manifest per module. |
| WS | `/runtime/snapshots` | Changed-only snapshots of active wait IDs, lookup names, active module IDs, and lifecycle state. Sends a full current snapshot on open. |

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
| WS | `/piano-roll/snapshots` | Full named-roll snapshots when the store is dirty; force-sends current state on open. |
| GET | `/piano-roll/list` | Force-created full snapshot, despite the route name. Forced snapshots are read-only with respect to the broadcast gate. |
| POST | `/piano-roll/set` | Normalize and set one roll, optionally checking `expectedRev` and recording undo history. |
| POST | `/piano-roll/undo` | Undo one named object's history. |
| POST | `/piano-roll/redo` | Redo one named object's history. |

### Params

| Method | Route | Behavior |
| --- | --- | --- |
| WS | `/params/snapshots` | Full named-entity snapshots on the 100 ms tick when the store changed; sends a read-only forced snapshot on open. |
| GET | `/params/list` | Read-only forced snapshot, despite the route name. |
| POST | `/params/set` | Deep-merge leaf values into one live entity, optionally checking `expectedRev`. Status 404 for an unknown name; a write never creates an entity. |

### Signals

| Method | Route | Behavior |
| --- | --- | --- |
| WS | `/signals/snapshots` | Full ephemeral-signal snapshots on the 100 ms tick when the store changed; sends a read-only forced snapshot on open. |
| GET | `/signals/list` | Read-only forced snapshot, despite the route name. |

There is deliberately no `/signals/set`: signals are code-published only, so
the tier has no write route to secure, rate-limit, or reconcile.

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
errors to a lifecycle error entry/log, clears active waits, and removes itself
only if it is still the active run with the same generated ID.

The HTTP launch response happens after enqueueing, before import. Import or
top-level evaluation failures therefore arrive through logs/snapshots rather
than the original HTTP response.

### Pending launches

Acceptance means queued, so the window between the response and the action's
turn has its own identity: `pendingLaunches` maps a module ID to its
`{ generatedRunId, cancelled }` entry, registered before the action is pushed
and deleted only after ownership transfers to `activeModules`. A module is
therefore never absent from both maps while it is startable.

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
  writing any lifecycle snapshot, because the run that genuinely won owns
  `moduleRuns` and its own snapshots keep clients converged;
- **cancelled during the import** — the import is the action's one long await,
  so the flag is checked once more after it resolves, before `ctx.branch`.

`stopModule` for a module that is not active cancels a pending launch, emits its
terminal snapshot, and reports success. `stopAllModules` and `panicRuntime`
cancel every pending entry first, so a panic cannot be followed by a queued
launch starting. A cancelled launch publishes that terminal only while the
`launching` entry it wrote is still the latest one, so it cannot clobber a
successor's.

### Run identity versus build identity

`generatedRunId` identifies a prepared build, not a run: the client reuses a
matching prepared build, so Replace without an edit relaunches under the same
ID. Two places therefore need a stronger identity than the ID:

- each started run gets a `runToken`, stored on its `ActiveModule`. The branch's
  terminal bookkeeping — removing itself, ending its signals, publishing its
  terminal — happens only while the slot still holds that token, so a slow-dying
  older branch cannot retire the run that replaced it;
- `teardownActiveModule` always cancels the handle it was given, because that is
  the run the caller asked to stop, but everything slot-scoped runs only while
  `activeModules` still holds that exact record. `stopModule` captures the
  record before awaiting a `stop()` hook for up to two seconds, and a
  replacement can win the slot inside that window; the superseded teardown logs
  `supersededTeardown` and returns.

## Runtime snapshots

Every 33 ms the server builds a snapshot from:

- the runtime singleton's active wait counts;
- the runtime singleton's last resolved piano-roll name per callsite;
- sorted active module IDs;
- the latest lifecycle entry per module.

The snapshot sequence increments even on ticks whose content is unchanged and
not sent. Consumers must treat it as an ordering marker, not a contiguous event
count. The diff is a concatenation of JSON serializations of the four state
sections.

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

The piano-roll store seeds `melody`, normalizes IDs/velocity, deep-clones data,
keeps at most 100 undo/redo entries per object, and avoids revision churn for
JSON-equal writes. Non-cloneable metadata is dropped through guarded fallbacks
rather than throwing into user timing code. Every entry point normalizes its
name by trimming.

`expectedRev` is optional. A mismatch returns the current object with
`conflict: true`; callers that omit it retain last-write-wins behavior.

The seed write is stamped `updatedBy: "demo-seed"`, which is how a save
recognizes an untouched seed and leaves it out (any real write bumps rev past 1
and captures it from then on). Seeding is also lazy — every list/get/snapshot
re-ensures the default — so `deletePianoRoll` records a deleted default name in
a per-process set that suppresses future re-seeding; otherwise a deleted
`melody` would resurrect within one snapshot tick. `clearPianoRollHistory`
drops one roll's undo/redo stacks, which a project load uses because opening a
project adopts disk truth and the pre-load stacks would undo into a state the
file never contained.

MIDI devices are enumerated and opened when `midi_helpers.ts` is first imported.
Send failures are logged rather than thrown. `panicMidi` silences tracked notes
but does not close ports; `closeMidiDevices` exists for full teardown and is not
called by the server shutdown path.

## Entity store and params entities

`entity_store.ts` owns identity, revisions, the no-op cache, the per-type dirty
flag and snapshot sequence, and never-throw serialization. Per-type semantics
live in the wrapper beside it. `params_store.ts` is the only wrapper today.

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

Every 100 ms the params timer samples and broadcasts. Per entity per tick it
safe-stringifies the live value, then:

- on failure, sets `unserializable: true` once and warns, keeping the last good
  serialization in snapshots instead of freezing the loop;
- on success, clears that flag if it was set, and when the string differs from
  the cached one **adopts the drift** as a store write: rev bumps,
  `updatedBy` becomes `code`, and the cache is refreshed.

Adoption is the whole mechanism behind plain property writes: user code never
calls the store, so this sampler is where a code-authored generation is
recorded, and it is what keeps rev a monotonic generation counter that client
echo suppression can rely on. `NaN`/`Infinity` serialize to null and
`undefined` drops the key, which reads as a shape change. A snapshot is
broadcast only when the tick found something changed.

`/params/set` merges leaves in place and detects no-ops against a fresh
serialization of the pre-merge value rather than the cache, which a code write
can have invalidated since the last tick. Forced snapshots for `/params/list`
and socket open are read-only.

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

Shutdown clears the params and signals timers and closes both socket sets next
to their piano-roll counterparts. Entities themselves are process-global and in
memory only; they are never evicted, and durable ones reach disk only through an
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

Every 100 ms the signals timer samples and broadcasts, exactly like the params
sampler: safe-stringify each live value, set/clear `unserializable` with one
warning per transition, and on a changed serialization adopt the drift as a
store write (`rev` bumps, `updatedBy: "code"`). Adoption is also where the
record is stamped with root-clock logical time. A snapshot is broadcast only
when the tick found a change.

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
quantized by the ~30 ms parent tick and the 100 ms sampler; `protocol.md` says
so before anyone builds a musical x-axis on them.

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

Both descriptors are registered at server construction. It is deliberately a
facade, not a migration: each engine keeps its own proven implementation and
only the interface divergence goes away. Type ids are assumed space-free
because the saved-state map is keyed `"<type> <name>"`.

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
