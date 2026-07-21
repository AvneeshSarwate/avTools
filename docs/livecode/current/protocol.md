# Current Protocol and Cross-Boundary Contracts

Status: checked against both protocol copies and route callers on 2026-07-21.

## Source of types

The server types live in:

```text
apps/deno-notebooks/livecode/visualizer/protocol.ts
```

The tldraw client manually mirrors subsets in:

```text
apps/livecode-tldraw/src/livecodeProtocol.ts
apps/livecode-tldraw/src/pianoRollTypes.ts
```

There is no shared generated package and no runtime schema validation. A
cross-boundary change must update both sides and tests. Optional fields can hide
drift at compile time, so compare actual serialization and handling.

## HTTP conventions

- Requests and normal responses are JSON.
- CORS permits every origin and `GET, POST, OPTIONS`.
- The outer handler returns `{ ok: false, error: string }` with status 500 when
  a route throws.
- Unknown routes return plain text `Not found` with status 404.
- `/runtime/launch` returns status 409 for synchronous launch refusal.
- `/client/command` can return HTTP 200 with `ok: false` for command selection,
  timeout, disconnect, or browser-side failure.
- `/piano-roll/set` can return a normal `PianoRollObject` with
  `conflict: true`; it is not an HTTP conflict.

The route catalog and side effects are in `server.md`.

## Analysis contract

`POST /runtime/analyze` accepts:

```ts
interface AnalyzeRequest {
  moduleId: string;
  sourceVersion: number;
  sourceUri?: string;
  sourceText?: string;
  projectModuleId?: string;
  projectModulePath?: string;
}
```

For a module found in the server's current project, the server reads canonical
project source and ignores the need for `sourceText`. Otherwise `sourceText` is
required.

Success returns build identity, manifest, runtime URI, and optional project
hash/path metadata. `transformedCode` is defined in the internal analyzer result
but removed from HTTP success responses. Project success may also carry
`projectManifests` for every successfully materialized module.

Failure returns only module/version and positioned visualizer diagnostics.
Failures are normal HTTP 200 responses distinguished by
`type: "analyzeFailure"`.

## Launch and stop contract

`POST /runtime/launch` accepts:

```ts
interface LaunchModuleRequest {
  moduleId: string;
  transformedModuleUri: string;
  generatedRunId: string;
  sourceHash?: string;
  projectSourceHash?: string;
  projectModulePath?: string;
  manifest?: VisualizerManifestMessage | null;
  replaceRunning?: boolean;
}
```

The server does not require the ID/URI to match a remembered prepared run. If a
matching prepared run exists, its project metadata/hash/manifest wins where the
implementation consults it; the requested URI is still the imported URI.

A successful response means the action was appended to the parent loop's launch
queue. Import/start success is reported later through lifecycle snapshots and
logs.

Stop accepts `{ moduleId }`. Missing/inactive IDs are idempotent success.
Stop-all, panic, and restart-all accept an ignored/empty JSON body.

## Runtime snapshots

`/runtime/snapshots` sends:

```ts
interface ActiveWaitSnapshot {
  type: "activeWaitSnapshot";
  seq: number;
  timestampMs: number;
  modules: Record<string, string[]>;
  pianoRollLookups?: Record<string, Record<string, string>>;
  activeModules?: string[];
  moduleRuns?: Record<string, RuntimeModuleRunSnapshotEntry>;
}
```

`modules` is the current active set, not an event delta. IDs are unique in each
array even when the internal count is greater than one.

`pianoRollLookups` is the last string observed at each instrumented callsite.
It can remain after a module stops and is cleared for a module at the start of a
new analysis.

Lifecycle entries have `launching`, `running`, `stopped`, or `error`, one latest
entry per module, and include `generatedRunId` plus optional project/hash/message
metadata. They remain after termination and are required to update modules that
finish without an active wait.

`activeModules` is explicit server truth and can differ temporarily from a
client's optimistic run status.

The server sends an initial full snapshot and then only changed serialized
state. Sequence numbers can skip because the server increments before deciding
whether a tick changed.

## Runtime rehydration

`GET /runtime/state` returns:

- every active module with runtime URI, hashes, project path, and retained
  manifest (possibly null for a client-supplied launch);
- the latest lifecycle entry per module;
- the newest still-retained prepared build per module, reduced to ID, optional
  source hash, and manifest.

It does not return current active wait IDs or lookup names; the snapshot socket
provides those. It also does not return source text.

`GET /runtime/status` is a smaller active-module list used by client-control
state reporting and tests.

## Project contract

Project module locators accept optional `id` and `path`; ID wins when both
match different records. Paths can refer to normalized `path`, `runtimePath`,
or the corresponding source path depending on the operation.

Project status fields have these meanings:

- `diskHash`: current canonical source hash;
- `editorHash`: latest server-known editor write/adoption hash;
- `lastLoadedHash`: source hash last written/materialized/adopted;
- `runHash`: active module's source hash;
- `changedOnDisk`: disk differs from last loaded;
- `dirty`: editor differs from last loaded;
- `conflict`: both dirty and changed on disk;
- `runningStale`: run differs from disk or has a changed transitive dependency.

The current write-through client rarely produces `dirty`/`conflict`; those
fields are forward-compatible concepts rather than active UI states.

Shadow diagnostics return both source offsets for visualizer diagnostics and
line/column for parsed Deno diagnostics. Positions after import rewriting and
instrumentation are not source-mapped back yet.

## Piano-roll contract

A piano-roll object is identified by trimmed string `name` and contains:

- monotonically increasing `rev` for applied changes;
- normalized/cloned `data` with notes and optional viewport/grid;
- `updatedAt`, `updatedBy`, `canUndo`, and `canRedo`;
- optional `conflict` on a stale compare-and-set request.

`POST /piano-roll/set` accepts optional `source`, `originId`, `label`,
`undoable`, and `expectedRev`. Client UI writes use `source: "client"` and
default to undoable. `setPianoRollClip` uses `source: "livecode"` and defaults
to non-undoable.

The piano-roll snapshot is always a full `rolls` map. The sequence advances
only when a snapshot is created; normal broadcast snapshots are created when
the dirty flag is set, while a new socket/list request forces one.

## Client-control contract

An HTTP caller sends:

```ts
{
  clientId?: string;
  command: ClientControlCommand;
  timeoutMs?: number; // clamped to 100..60_000, default 10_000
}
```

Without `clientId`, the server chooses the first open control socket. Commands
are:

- `getState`
- `openProject`
- `addProjectModule`
- `reloadProjectModule`
- `setModuleSource`
- `runModule`
- `stopModule`
- `stopAllModules`

The server creates a command ID, sends a `clientCommand` envelope, and waits for
the same client to send `clientCommandResult`. A disconnect resolves all that
client's pending commands as failures.

The tldraw `getState` result joins local shape/module status with a fresh
`/runtime/status` read so `serverRunning` is explicit. If that fetch fails, the
client currently substitutes an empty active list, so a disconnected server can
look like “nothing running” in this command response.

## LSP contract

The `/lsp` WebSocket carries raw LSP-style framed messages through VTLSP; it is
not JSON messages shaped by `protocol.ts`. The browser chooses a session ID,
and the server process manager assigns/reuses a proxy for that ID.

Runtime diagnostics and Deno LSP diagnostics are independent:

- transform diagnostics can block generated code;
- project shadow diagnostics can block the tldraw project Run path;
- LSP diagnostics are editor feedback and do not block server launch.

## Change checklist

When changing a boundary:

1. update `visualizer/protocol.ts`;
2. update the relevant client mirror;
3. update server serialization and client handling;
4. add a server protocol test;
5. add a tldraw E2E when visible/reconnect behavior changes;
6. update this document and the route table in `server.md`.
