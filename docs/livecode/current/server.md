# Current Deno Server Architecture

Status: checked against `apps/deno-notebooks/livecode` on 2026-07-21; the
entity/params stores and their routes were checked on 2026-08-13.

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
  revisions, dirty snapshots, and per-roll undo/redo.
- `visualizer/entity_store.ts`: generic `(type, name)`-keyed records with
  revisions, no-op caching, dirty/sequence bookkeeping, and never-throw
  serialization. `piano_roll_store.ts` is deliberately not migrated onto it.
- `visualizer/params_store.ts`: params entities as the first typed wrapper over
  the entity store — declaration, recursive reconcile, leaf merges, and the
  sampler that adopts code writes.
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
- `helpers/midi_helpers.ts`: eager MIDI enumeration/open, safe send wrappers,
  sounding-note registry, and panic.
- `helpers/midi_math.ts`: side-effect-free MIDI clamping.
- `tests/`: unit, protocol, LSP, project, p5gpu, repro/regression, and CLI
  tests. See `testing-and-operations.md` for the actual task matrix.

## Server instance state

`createLivecodeVisualizerServer` creates one HTTP server and owns:

- one session directory and log file;
- sets of runtime, piano-roll, and params snapshot sockets;
- a map of browser control sockets and pending commands;
- active modules and their `TimeContext` branch handles;
- latest lifecycle snapshot per module;
- prepared runs plus a per-module pruning index;
- a FIFO launch-action array drained by one parent `TimeContext` loop;
- one global current project for the server instance;
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
| POST | `/runtime/launch` | Enqueue a dynamic import/branch. Reject an already active module unless `replaceRunning` is true. Successful HTTP response means queued, not necessarily imported or started. |
| POST | `/runtime/stop` | Gracefully stop one currently active module; a missing module is treated as success. |
| POST | `/runtime/stop-all` | Gracefully stop all currently active modules in parallel. |
| POST | `/runtime/panic` | Immediately cancel active modules without stop hooks and panic MIDI. |
| POST | `/runtime/restart-all` | Stop all active modules and rematerialize the current project. It does not relaunch the prior modules despite the route name. |
| GET | `/runtime/status` | Compact list of active module build identities/hashes. |
| GET | `/runtime/state` | Rehydration state: active modules with manifests, latest run lifecycle entries, and latest remembered prepared manifest per module. |
| WS | `/runtime/snapshots` | Changed-only snapshots of active wait IDs, lookup names, active module IDs, and lifecycle state. Sends a full current snapshot on open. |

### Project

| Method | Route | Behavior |
| --- | --- | --- |
| POST | `/project/create` | Create/select a project, optionally add modules, write the manifest, and materialize runtime files. |
| POST | `/project/open` | Select a manifest/directory, read sources, initialize hashes, and materialize runtime files. |
| POST | `/project/save` | Rewrite the current in-memory manifest. |
| GET | `/project/current` | Current global project selection and manifest, or `null`. |
| GET | `/project/status` | Disk/editor/load/run hashes, staleness, dependency graph summaries, and active modules. |
| GET | `/project/diagnostics` | Cached, non-mutating shadow transform plus `deno check`. |
| GET | `/project/events` | Currently returns the same one-shot JSON as `/project/status`; it is not SSE or a WebSocket. |
| GET | `/project/modules/source?id=...&path=...` | Source text and normalized module record. |
| POST | `/project/modules/add` | Add/write/materialize a module and update the manifest. |
| POST | `/project/modules/update` | Update metadata/layout, ensure its source exists, write the manifest, and materialize. Path renaming is not implemented; lookup finds the existing record before assigning only metadata fields. |
| POST | `/project/modules/write` | Write canonical source, advance/set source version, write the manifest, and materialize. |
| POST | `/project/modules/reload` | Adopt the current disk source hash as editor/loaded state and materialize. |
| POST | `/project/modules/remove` | Remove the manifest/cache record. It does not delete source/runtime files or stop an active module. |
| POST | `/project/canvas` | Replace the manifest's canvas object; currently used for piano-roll-view layout. |

### Piano roll

| Method | Route | Behavior |
| --- | --- | --- |
| WS | `/piano-roll/snapshots` | Full named-roll snapshots when the store is dirty; force-sends current state on open. |
| GET | `/piano-roll/list` | Force-created full snapshot, despite the route name. |
| POST | `/piano-roll/set` | Normalize and set one roll, optionally checking `expectedRev` and recording undo history. |
| POST | `/piano-roll/undo` | Undo one named object's history. |
| POST | `/piano-roll/redo` | Redo one named object's history. |

### Params

| Method | Route | Behavior |
| --- | --- | --- |
| WS | `/params/snapshots` | Full named-entity snapshots on the 100 ms tick when the store changed; sends a read-only forced snapshot on open. |
| GET | `/params/list` | Read-only forced snapshot, despite the route name. |
| POST | `/params/set` | Deep-merge leaf values into one live entity, optionally checking `expectedRev`. Status 404 when the name has not been declared by running code. |

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
rather than throwing into user timing code.

`expectedRev` is optional. A mismatch returns the current object with
`conflict: true`; callers that omit it retain last-write-wins behavior.

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

Shutdown clears the params timer and closes the params socket set next to their
piano-roll counterparts. Entities themselves are process-global and in memory
only; they are neither persisted nor evicted (see `known-risks.md`).
