# Current Protocol and Cross-Boundary Contracts

Status: checked against both protocol copies and route callers on 2026-07-21;
the params routes and types, the entity CRUD routes, and the project data
persistence types were checked on 2026-08-13; the signals routes and types were
added and checked on 2026-08-13; `replaceRunning` and launch cancellation were
checked on 2026-08-13.

## Source of types

The server types live in:

```text
apps/deno-notebooks/livecode/visualizer/protocol.ts
```

The tldraw client manually mirrors subsets in:

```text
apps/livecode-tldraw/src/livecodeProtocol.ts
apps/livecode-tldraw/src/pianoRollTypes.ts
apps/livecode-tldraw/src/paramsTypes.ts
apps/livecode-tldraw/src/signalsTypes.ts
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
- `/params/set` can also return a normal `ParamsEntity` with `conflict: true`.
  It returns status 404 with `{ ok: false, error }` for an unknown name: a
  write never creates an entity. Declaration, `/entities/create`, and a project
  load do.
- `/entities/*` return status 400 for a missing type/name, 404 for an unknown
  type or a missing entity, and 409 for a name that already exists, all with
  `{ ok: false, error }`.

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

`replaceRunning` is the caller's explicit consent to end this module's current
run. Without it, launching over a module that is already running — or over one
whose launch is accepted but not yet started — fails with HTTP 409 and an
`already running` / `already launching` message. With it, the running run is
stopped at request time, a pending one is superseded, and the replacement
decision is re-checked when the queued action runs. The tldraw client sets the
flag only from the Replace button.

A successful response means the action was appended to the parent loop's launch
queue. Import/start success is reported later through lifecycle snapshots and
logs. A launch can still end without ever starting: a stop or panic that lands
before the action runs cancels it, and the module's lifecycle entry goes
`launching` → `stopped` with no `running` in between.

Stop accepts `{ moduleId }`. Missing/inactive IDs are idempotent success; an ID
whose launch is still queued is cancelled rather than ignored. Stop-all, panic,
and restart-all accept an ignored/empty JSON body.

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
the dirty flag is set, while a new socket/list request forces one. A forced
snapshot is read-only with respect to that flag: only the broadcast tick
clears it, so one caller listing rolls cannot swallow the generation the other
open sockets are still waiting for.

## Params contract

A params entity is identified by trimmed string `name` and contains:

- monotonically increasing `rev` for observed value generations;
- `values`: a point-in-time clone of the live object. Values are JSON-simple —
  finite numbers, strings, booleans, and nested plain objects. Arrays are
  rejected at declaration;
- optional `meta`, keyed like the value tree, whose leaves carry
  `label`/`min`/`max`/`step` for one binding;
- `updatedAt` and `updatedBy`, where `updatedBy` is `declare`, `reconcile`,
  `code` for a drift the sampler adopted, or a write's `originId` (`client`
  when the caller omits one);
- optional `unserializable: true` when the live value can no longer be
  serialized, in which case `values` is the last good serialization;
- optional `conflict` on a stale compare-and-set request.

```ts
interface SetParamsRequest {
  name: string;
  values: ParamsValues; // nested partial: only the leaves present are merged
  originId?: string;
  expectedRev?: number;
}
```

`POST /params/set` deep-merges leaves into the live object in place. Panes
never send `expectedRev`; compare-and-set is for agent and HTTP callers. A
leaf that is not declared, has a different type, or is a non-finite number is
ignored with a server-side warning rather than failing the request. No-op
detection compares a fresh serialization of the pre-merge value, never the
cached one, because code writes bypass the store and invalidate that cache.

`/params/snapshots` sends a full `params` map:

```ts
interface ParamsSnapshot {
  type: "paramsSnapshot";
  seq: number;
  timestampMs: number;
  params: Record<string, ParamsEntity>;
}
```

The sequence advances whenever a snapshot is created. Broadcast snapshots are
created on a 100 ms tick when the store changed; `GET /params/list` and a new
socket force one. A forced params snapshot is read-only: it neither consumes
the broadcast gate nor updates per-entity caches, so one client connecting
cannot swallow a pending update for the others. The piano-roll store now holds
the same property.

The manifest kind `canvasParams` is part of this boundary: `WaitCallsiteKind`
carries it in both protocol copies, and its entries use the same optional
`nameArgRange`/`staticName` fields as `pianoRollLookup`. It is an observation
only — no generated code, no runtime message, and no client action beyond the
editor's open-pane widget. See `analyzer-and-generated-code.md`.

## Signals contract

Signals are the **ephemeral** tier: named latest-value samples that running
code publishes purely so monitors can watch them. They are never persisted,
never undoable, and end with the run that published them.

A signal is identified by trimmed string `name` and contains:

```ts
interface SignalAnchor {
  type: string;    // entity type wire id, e.g. "pianoRoll" or "params"
  name: string;
  path?: string[]; // carried on the wire; no v1 consumer reads it
}

interface SignalEntity {
  name: string;
  value: unknown;  // user-shaped; null until the first set
  anchor?: SignalAnchor;
  ownerModuleId?: string;
  ended?: boolean;
  rev: number;
  updatedAt: number;
  updatedBy: string;
  unserializable?: boolean;
  timeSec?: number;
  beats?: number;
}
```

Differences from a params entity, all deliberate:

- `value` is whatever the piece wants — a bare number, a string, an object.
  There is no declared shape, no meta, and no field-level merge.
- `anchor` is an entity reference, so a view can bind to a signal without the
  producer knowing any view exists. `path` is carried for a future consumer;
  the roll's marker feed ignores it today.
- `ended` marks that the owning run stopped. It is **sticky**: later writes keep
  updating `value` while `ended` stays set, and only a redeclaration of the name
  clears it. A moving-but-ended signal is a surfaced finding, not something the
  platform polices inside caller-owned timing.
- `rev` counts observed value generations, as it does for params. A redeclare
  changes the anchor and the ended flag without bumping it.
- `updatedBy` is `declare` or `code`; there is no client origin, because there
  is no client write.

**There is no set route.** Signals are code-published only:

| Route | Meaning |
| --- | --- |
| `GET /signals/list` | forced read-only snapshot |
| `WS /signals/snapshots` | full snapshot on open, then changed-only ticks |

```ts
interface SignalsSnapshot {
  type: "signalsSnapshot";
  seq: number;
  timestampMs: number;
  signals: Record<string, SignalEntity>;
}
```

The transport is the params pattern byte for byte: a 100 ms changed-only
sampler tick, a full map per message, sequence numbers advancing whenever a
snapshot is created, and a forced snapshot (list request or new socket) that
neither consumes the broadcast gate nor touches per-entity caches. Every open
socket receives every changed signal; subscription scoping is deferred to the
planned multiplexed transport (see `known-risks.md`).

`timeSec`/`beats` are the root clock's logical time **at the tick that adopted
the value**, not at the moment code assigned it. They are quantized twice over
— by the ~30 ms parent-loop tick that advances the root context and by the
100 ms sampler — so they order samples musically rather than measuring them.
Treat them as an ordering key with ~100 ms granularity; anyone building a
musical x-axis on them must account for that before trusting spacing. They are
absent entirely when no root context is registered (a plain `deno run` of a
module, or before the parent loop starts).

The manifest kind `canvasSignal` is part of this boundary: `WaitCallsiteKind`
carries it in both protocol copies, with the same optional
`nameArgRange`/`staticName` fields as `pianoRollLookup` and `canvasParams`.
Unlike those two it does generate code — a whole-call ownership wrap — but it
produces no editor widget in v1, and kind-filtered client code skips it safely.
See `analyzer-and-generated-code.md`.

## Durable entity contract

Piano rolls and params entities are the two registered **durable entity
types**, addressed generically by `{ type, name }` where `type` is the wire id
`"pianoRoll"` or `"params"`. Three routes act on any registered type:

```ts
interface EntityCreateRequest { type: string; name: string }
interface EntityDeleteRequest { type: string; name: string }
interface EntityDuplicateRequest {
  type: string;
  name: string;
  targetName: string;
}

type EntityMutationResponse =
  | { ok: true; entity: { type: string; name: string } }
  | { ok: false; error: string };
```

`name` and `targetName` are trimmed. Create rejects an existing name, duplicate
rejects a missing source or an existing target, and delete reports 404 for a
name that was not there. The success body always describes the **affected**
entity, so duplicate returns the target. These are ordinary serialized actions:
an agent can call them with no browser attached.

Per-type semantics are in `server.md`. Notably a created piano roll is an empty
roll, a created params entity has no fields until a declaration or a load fills
them, and a duplicated params entity copies values and meta but not tombstones.

## Project data persistence contract

The manifest gains an optional top-level list of saved entity files:

```ts
interface ProjectDataEntry {
  type: string;   // entity type wire id
  name: string;   // the true entity name
  path: string;   // project-relative, ends in .json
}
```

It is top-level rather than inside `canvas`, which `/project/canvas`
whole-replaces. The entry carries the real name, so the percent-encoded
filename never has to be decoded. Unknown top-level manifest fields already
round-trip, so an older server or client simply ignores `data`.

`POST /project/save` ignores its request body and returns the
`/project/current` body plus per-entity results:

```ts
interface ProjectSaveResponse extends ProjectCurrentResponse {
  data: Array<{
    type: string;
    name: string;
    path: string;
    ok: boolean;
    error?: string;
  }>;
  skipped: Array<{ type: string; name: string; reason: string }>;
}
```

`data` lists every entity the save attempted, in registry order; `skipped`
lists the ones it deliberately did not write, with the operator-facing reason
(a value that could not be serialized, or an unmodified auto-created entity
such as an untouched demo roll). One failed or hostile entity never fails the
whole save, and the response's manifest already contains the rebuilt `data`
list. A save that wrote nothing into a project that never had a `data` key
leaves the manifest without one rather than adding an empty list. Saving with
no project open is status 400.

`GET /project/status` always carries a warning-tier dirty section:

```ts
interface ProjectDataEntityStatus {
  type: string;
  name: string;
  unsaved: boolean;
}
```

It covers the union of live entities and the ones the last save or open
recorded, so a saved-but-deleted entity appears with `unsaved: true`. An entity
a save would skip anyway is not an unsaved change. Nothing auto-saves off the
back of this; the client renders it as a count.

Data files are human-readable JSON, two-space indented with a trailing
newline, one per entity:

```ts
interface SavedPianoRollEntity {
  type: "pianoRoll";
  name: string;
  savedAt: string;   // ISO timestamp of the serialize pass
  data: PianoRollData;
}

interface SavedParamsEntity {
  type: "params";
  name: string;
  savedAt: string;
  values: ParamsValues;
  meta?: ParamsMeta;
}
```

Saved params carry `meta` so a freshly opened project renders correct panes
before any module runs; a later `canvasParams` declaration still wins through
the normal reconcile. Undo/redo history is never serialized. File layout and
name encoding are in `project-model.md`.

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
