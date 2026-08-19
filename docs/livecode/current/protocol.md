# Current Protocol and Cross-Boundary Contracts

Status: checked against `packages/livecode-protocol`, `visualizer/server.ts`,
and `apps/livecode-tldraw/src/syncRuntime.tsx` as of 2026-08-13; first audited
2026-07-21 against the then-separate hand-mirrored protocol copies.

## Source of types

There is **one** source of wire types, a plain-TypeScript workspace package
compiled from source by both consumers:

```text
packages/livecode-protocol/
  mod.ts              # type-only barrel; re-exports every module below
  analysis.ts         # diagnostics, wait-callsite manifest, /runtime/analyze
  client_control.ts   # /client/command and the /client/control envelopes
  entities.ts         # generic /entities/* CRUD bodies
  params.ts           # ParamsValues/ParamsMeta/ParamsEntity, /params/set
  piano_roll.ts       # NoteData/PianoRollData/PianoRollObject, /piano-roll/set
  project.ts          # manifest, module records, every /project/* body
  runtime.ts          # launch/stop, run lifecycle, /health, /runtime/state
  saved_entities.ts   # the durable data-file formats a project save writes
  signals.ts          # SignalEntity and its anchor
  sync.ts             # the /sync envelope and its entity-kind registry
```

Everything in it is type-only (`export type *`), so importing the package costs
nothing at run time. Types that belong to only one side — server internals,
client view models — deliberately do not live here.

Consumption:

- Deno resolves `@avtools/livecode-protocol` through the root `deno.json`
  workspace entry and import map plus the relative map in
  `apps/deno-notebooks/deno.json`.
- `visualizer/protocol.ts` is now a one-line re-export of the package. It
  survives only so server imports keep reading as `./protocol.ts`; it holds no
  types of its own.
- `apps/livecode-tldraw` resolves the package as **raw TypeScript** through a
  `resolve.alias` in `vite.config.ts` and a matching `paths` entry plus
  `allowImportingTsExtensions` in `tsconfig.json` — the mechanism
  `apps/browser-projections` already uses for `@avtools/core-timing`. This is
  the first *source* alias in that app; the `@avtools/piano-roll` alias next to
  it points at a built dist bundle and predates it.
- `apps/livecode-tldraw/src/livecodeProtocol.ts` re-exports the package and adds
  only client-local view models (`HistoryEntry`, `PreparedBuild`,
  `PreparedFailure`). The old hand-mirrored `pianoRollTypes.ts`,
  `paramsTypes.ts`, and `signalsTypes.ts` are gone.

One deliberate exception remains: `apps/browser-projections`' Vue SketchWrapper
keeps its own narrower local copy of `ActiveWaitSnapshot`. That client is not
modernized by this slice, and its shim is documented below.

There is still no runtime schema validation — the types are compile-time
documentation, and a cross-boundary change must still update serialization,
handling, and tests. What can no longer happen is the two sides describing the
same message differently.

## The sync transport (`WS /sync`)

One socket carries every watched entity kind, per entity, changed-only, scoped
to what that socket subscribed to. It replaced four independent full-snapshot
channels (`/runtime/snapshots` for the tldraw client, `/piano-roll/snapshots`,
`/params/snapshots`, `/signals/snapshots`); the first survives as a deprecated
shim for one un-migrated client and the other three are deleted.

### Entity kinds

| Wire id | Class | Entity name | Value |
| --- | --- | --- | --- |
| `pianoRoll` | durable | roll name | `PianoRollObject` |
| `params` | durable | entity name | `ParamsEntity` |
| `signal` | ephemeral | signal name | `SignalEntity` |
| `run` | ephemeral | module id | `RunEntity` |
| `moduleWaits` | ephemeral | module id | `ModuleWaitsEntity` |
| `moduleLookups` | ephemeral | module id | `ModuleLookupsEntity` |

Durable entities carry their name in a `name` field; the module-keyed ephemeral
kinds carry `moduleId`. A client keys its per-type map on whichever is present.

### Envelope

From `packages/livecode-protocol/sync.ts`:

```ts
/** Client → server. Every subscribe REPLACES the socket's set. */
interface SyncSubscribeMessage {
  type: "subscribe";
  entityTypes: string[];
}

interface SyncEntityChange<E = SyncEntity> {
  entityType: string;
  name: string;
  /** `null` means the entity was deleted. */
  entity: E | null;
}

interface SyncMessage<E = SyncEntity> {
  type: "sync";
  /** Per-socket monotonic message counter. Gap detection only; never replayed. */
  seq: number;
  timestampMs: number;
  /**
   * Full current state per entity type, sent in reply to a subscribe. A reset
   * REPLACES the client's whole per-type map: absence means deleted, so
   * entities removed while disconnected do not survive a reconnect.
   */
  resets?: Record<string, E[]>;
  changes?: Array<SyncEntityChange<E>>;
}
```

`subscribe` is the only client→server message. Anything else, and any malformed
JSON, is logged (`syncMalformedMessage`) and dropped rather than closing the
socket.

### Rules

- **Subscribe replaces the set, and resets ALL listed types.** Not just newly
  added ones — so gap recovery and reconnect recovery are the same action:
  resubscribe the same set and take the fresh `resets`. A subscribe naming an
  unregistered type resets it to an empty array rather than erroring.
- **A reset replaces the whole per-type map.** Absence means deleted. An entity
  removed while a client was disconnected therefore does not survive its
  reconnect.
- **Delivery is per entity and changed-only.** A changed entity ships whole;
  there are no sub-entity diffs in v1, so editing one note re-sends that roll
  and nothing else. Nothing is sent to a socket that subscribed to nothing, and
  a tick with no changes for a socket's types sends that socket nothing at all.
- **`entity: null` is a deletion**, and it is the only way a client learns one:
  a serialize-compare over live values cannot see a record that is gone.
- **`seq` is per socket, monotonic, and for gap DETECTION only.** It advances
  only on a message that actually went out, so a serialization failure cannot
  manufacture a phantom gap. There is no replay buffer and there never will be
  one: this is a single TCP connection, so an observed gap means a **server
  bug**, not transport loss. Do not build replay logic on it — the client's only
  correct reaction is to resubscribe.
- **Ticks coalesce.** The broadcast timer runs at 33 ms, so intermediate states
  can be skipped entirely: a module that launches and fails inside one tick
  ships one `run` entity in its terminal state and never a `launching` one.
  Consumers must be correct over the states they actually receive, not over an
  assumed sequence.
- **`rev` is not a change key.** Several real changes ship with an unchanged
  `rev` — a signal's `ended` flip, a params meta-only write, an
  `unserializable` transition — because `rev` counts *value* generations.
  Nothing on the receiving side may dedupe or order on it.
- **Ordering within a message is stable**: changed names are sorted per type,
  as are wait callsite ids and lookup keys, so an unchanged value serializes
  identically tick after tick and stays silent.

### Owner resolution: samplers always run

"An unwatched entity costs nothing" is a **transport** property only. The
server's samplers — the params and signals code-write adoption passes, the
signal logical-time stamping, the run/wait/lookup bookkeeping — run on every
tick regardless of whether any socket subscribed to them. The principle that an
unwatched run behaves identically to a watched one requires identical server
work; only the bytes on the wire are subscription-scoped. Concretely, `rev`
stays a monotonic generation counter and `GET /params/list` stays current
whether or not a pane is open.

### Reads that are not the transport

`GET /piano-roll/list`, `/params/list`, and `/signals/list` still answer with
their full legacy snapshot envelopes, and a `/sync` subscribe reset is built by
a separate read-only path. Neither ever drains the broadcast gate: one caller
listing entities cannot swallow a generation the open sockets are still owed.

## HTTP conventions

- Requests and normal responses are JSON.
- CORS permits every origin and `GET, POST, OPTIONS`.
- The outer handler returns `{ ok: false, error: string }` with status 500 when
  a route throws.
- Unknown routes return plain text `Not found` with status 404.
- `/runtime/launch` returns status 409 for synchronous launch refusal.
- Mutating runtime routes (`/runtime/launch`, `/runtime/stop`,
  `/runtime/stop-all`, `/runtime/panic`, `/runtime/restart-all`) acknowledge
  success with `{ ok: true }`; the launch refusal body is
  `{ ok: false, error }`.
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
hash/path metadata:

```ts
interface AnalyzeSuccess {
  type: "analyzeSuccess";
  moduleId: string;
  sourceVersion: number;
  generatedRunId: string;
  manifest: VisualizerManifestMessage;
  projectManifests?: VisualizerManifestMessage[];
  transformedModuleUri: string;
  transformedCode?: string;
  sourceHash?: string;
  projectSourceHash?: string;
  projectModulePath?: string;
  projectSourcePath?: string;
  projectRuntimePath?: string;
}
```

`transformedCode` is defined in the internal analyzer result
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
queue. Import/start success is reported later through `run` entities and logs. A
launch can still end without ever starting: a stop or panic that lands before the
action runs cancels it, and the module's run entity goes `launching` → `stopped`
with no `running` in between. Because ticks coalesce, a watcher may see only the
terminal.

Stop accepts `{ moduleId }`. Missing/inactive IDs are idempotent success; an ID
whose launch is still queued is cancelled rather than ignored. Stop-all, panic,
and restart-all accept an ignored/empty JSON body.

## Run, waits, and lookups as sync entities

Runtime observation state is carried by three entity kinds on `/sync`, all keyed
by module id.

```ts
interface RunEntity {
  moduleId: string;
  state: "launching" | "running" | "stopped" | "error";
  generatedRunId: string;
  runToken: string;
  updatedAt: number;
  projectModulePath?: string;
  sourceHash?: string;
  projectSourceHash?: string;
  message?: string;
}

interface ModuleWaitsEntity {
  moduleId: string;
  /** Sorted ids of the callsites this module is currently awaiting. */
  callsiteIds: string[];
}

interface ModuleLookupsEntity {
  moduleId: string;
  /** callsiteId → the roll name that callsite last resolved to. */
  lookups: Record<string, string>;
}
```

`RunEntity` replaces the legacy snapshot's `moduleRuns` **and** `activeModules`
fields: there is exactly one run entity per module id, and the active-module
list is derived client-side from `state` (`launching` or `running` is active).
A terminal run entity stays live until that module runs again.

**`runToken` is the identity of the RUN**, minted server-side when a launch is
accepted. `generatedRunId` identifies a prepared *build* and is reused whenever
a relaunch finds an unchanged one — which is exactly what Replace-without-an-edit
does — so it cannot distinguish a run from the run that replaced it. A client
deduping terminal states must key on the token; see `client.md` for the rule.

`callsiteIds` is the current active set, not an event delta, and ids are unique
in it even when the internal wait count is greater than one. `lookups` is the
last string observed at each instrumented callsite; it survives the run that
produced it and is cleared for a module at the start of a new analysis.

Both ephemeral kinds **delete rather than empty**: a module with no active waits
ships `entity: null` for `moduleWaits`, not an entity with an empty array. A
client therefore learns "this module is awaiting nothing" by the name leaving
its map.

## Legacy shim: `WS /runtime/snapshots`

Deprecated, and kept for exactly one consumer: the Vue SketchWrapper in
`apps/browser-projections`, which this slice does not modernize. It sends the
unchanged envelope, at full fidelity:

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

Differences from `/sync`, all deliberate:

- there is no subscribe message. A full snapshot is sent on open, then only
  when the serialized whole snapshot changes;
- its `seq` comes from the runtime singleton's own counter, which advances every
  time a snapshot is *built* — including on ticks whose content turned out to be
  unchanged and was not sent. Treat it as an ordering marker, not a contiguous
  count. (`/sync`'s per-socket `seq` is the opposite: gap-free by construction.)
- its `moduleRuns` rows are **token-free**. `RuntimeModuleRunSnapshotEntry` has
  no `runToken`, and the server strips it when building this envelope. That
  asymmetry is the point: the shim's remaining consumer must not grow a
  dependency on an identity introduced for a client it does not share code with,
  and freezing this envelope is what makes the shim cheap to keep and cheap to
  eventually delete.

Nothing in the tldraw client reads this route.

## Runtime rehydration

`GET /runtime/state` returns:

- every active module with runtime URI, hashes, project path, and retained
  manifest (possibly null for a client-supplied launch);
- the latest run row per module;
- the newest still-retained prepared build per module, reduced to ID, optional
  source hash, and manifest.

Its run rows are `RuntimeStateModuleRun` — the legacy
`RuntimeModuleRunSnapshotEntry` (including `updatedAtMs`) **plus `runToken`**:

```ts
interface RuntimeStateModuleRun extends RuntimeModuleRunSnapshotEntry {
  runToken: string;
}
```

Rehydration is where a client that has watched nothing go active — after a
reload, a reconnect, or a first Connect — seeds the token-keyed terminal dedupe
it will apply to every later `run` entity. That is the whole reason this route
carries the token while the `/runtime/snapshots` shim does not.

It does not return current active wait IDs or lookup names; the `moduleWaits`
and `moduleLookups` entities carry those. It also does not return source text.

`GET /runtime/status` is a smaller active-module list used by client-control
state reporting and tests.

## Project contract

Project module locators accept optional `id` and `path`; ID wins when both
match different records. Paths can refer to normalized `path`, `runtimePath`,
or the corresponding source path depending on the operation.

Request and response bodies are the `protocol.ts` interfaces:

- `POST /project/create` takes `CreateProjectRequest`
  (`{ projectPath?, name?, modules? }`) and `POST /project/open` takes
  `OpenProjectRequest` (`{ projectPath }`). Both return
  `ProjectCurrentResponse` — `{ ok: true, project }`, where `project` is
  `{ root, manifestPath, manifest }` or `null`. `POST /project/canvas` also
  returns it; its request body is `{ canvas }`, the manifest's whole optional
  canvas object.
- The `/project/modules/*` mutations take `AddProjectModuleRequest`,
  `UpdateProjectModuleRequest`, `WriteProjectModuleRequest`,
  `ReloadProjectModuleRequest`, and `RemoveProjectModuleRequest`, and all
  return `ProjectStatusResponse`.
- `GET /project/status` and `GET /project/events` return
  `ProjectStatusResponse`. `GET /project/diagnostics` returns
  `ProjectShadowCheckResponse`, whose `denoCheck` is
  `{ success, code, output }`. `GET /project/modules/source` returns
  `ProjectModuleSourceResponse` (`{ ok: true, module, sourceText }`).

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

Rolls reach watchers as `pianoRoll` entities on `/sync`: only the edited roll
ships, not the store. `GET /piano-roll/list` still answers with the full
`PianoRollSnapshot` envelope (`{ type, seq, timestampMs, rolls }`) for HTTP and
agent callers; it is read-only with respect to the broadcast gate, so one caller
listing rolls cannot swallow the generation the open sockets are still owed.
That envelope's `seq` advances whenever a snapshot is built and is unrelated to
a `/sync` socket's `seq`.

## Params contract

A params entity is identified by trimmed string `name` and contains:

- monotonically increasing `rev` for observed value generations;
- `values`: a point-in-time clone of the live object. Values are JSON-simple —
  finite numbers, strings, booleans, and nested plain objects. Arrays are
  rejected at declaration;
- optional `meta`, keyed like the value tree, whose leaves carry
  `label`/`min`/`max`/`step` for one binding, plus `graph`/`rows`:
  `graph: true` opts a numeric leaf into the pane's readonly time-series row
  and `rows` sets its height (see `client.md`);
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

Params entities reach watchers as `params` entities on `/sync`, one changed
entity at a time on the shared 33 ms tick. `GET /params/list` still answers with
the full snapshot envelope:

```ts
interface ParamsSnapshot {
  type: "paramsSnapshot";
  seq: number;
  timestampMs: number;
  params: Record<string, ParamsEntity>;
}
```

That read is read-only: it neither consumes the broadcast gate nor updates
per-entity caches, so one caller listing params cannot swallow a pending update
for the open sockets. The piano-roll and signals stores hold the same property.

A meta-only write and an `unserializable` transition are real changes that ship
with an **unchanged `rev`**, because `rev` counts value generations. The
transport ships them because every mutator records the name it touched, not
because anything compares serialized values.

The manifest kind `canvasParams` is part of this boundary: `WaitCallsiteKind`
carries it in the shared package, and its entries use the same optional
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
| `WS /sync` (`signal` kind) | per-signal, changed-only, subscription-scoped |

`GET /signals/list` answers with the full envelope:

```ts
interface SignalsSnapshot {
  type: "signalsSnapshot";
  seq: number;
  timestampMs: number;
  signals: Record<string, SignalEntity>;
}
```

Watching is now the `signal` kind on `/sync`, so a canvas that subscribes gets
only the signals that changed, and a client that never subscribes pays nothing
on the wire. The sampler still runs every tick regardless — see the owner
resolution above.

A signal's sticky `ended` flip does **not** bump `rev`, so it is one of the
changes that would be invisible to any serialize-compare. It reaches watchers
because the store records the touched name; a scope that never learned `ended`
would silently freeze, which the ephemeral-entity principle forbids.

`timeSec`/`beats` are the root clock's logical time **at the tick that adopted
the value**, not at the moment code assigned it. They are quantized twice over
— by the ~30 ms parent-loop tick that advances the root context and by the
33 ms sampler tick — so they order samples musically rather than measuring them.
Treat them as an ordering key with tick-level granularity; anyone building a
musical x-axis on them must account for that before trusting spacing. They are
absent entirely when no root context is registered (a plain `deno run` of a
module, or before the parent loop starts).

The manifest kind `canvasSignal` is part of this boundary: `WaitCallsiteKind`
carries it in the shared package, with the same optional
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
newline, one per entity. Their formats are declared in
`packages/livecode-protocol/saved_entities.ts`:

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

## Engine uplink contract (remote engine mode)

`packages/livecode-protocol/engine_uplink.ts` declares the wire contract
between a coordination server started with `--engine remote` and the browser
engine host tab attached on `WS /engine/uplink`:

- `EngineOp` is the whole execution-plane op surface — launch/stop/stop-all/
  panic, runtime status/state, piano-roll/params/signals reads and writes,
  generic entity CRUD, the project save capture (`captureEntities`),
  `entitySaveState`, `loadEntities`, and `snapshotAll`. The server's routes
  execute the same ops in local mode via `executeEngineOp`, so both modes are
  one implementation.
- Engine -> server: `engineHello` (engine kind plus full per-type resets),
  `engineSync` (one tick's changed entities, relayed to `/sync`), and
  `engineResult` (op replies). Server -> engine: `engineRequest`.
- Failure semantics ride the same shapes as HTTP: an op that throws
  engine-side becomes `engineResult { ok: false, error }` and the route
  answers as it would have locally (launch refusals stay 409); entity CRUD
  returns `EngineEntityActionResult` with its own `status`.

The same file declares `BakedProjectFile`, the shape of a bake's
`engine/baked.json`: durable-entity seeds (`EngineEntityLoadEntry[]`) and the
prebuilt module launch list for the engine tab, plus the full project manifest
and per-module `sourceText` for the UI tab's project-shaped read-only boot.
Both tabs of a served bake read the one file.

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
- `runModule`, which accepts `replaceRunning?: boolean` and forwards it to the
  launch route as the same explicit consent the Replace button gives
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

1. change the type in `packages/livecode-protocol` — there is no second copy to
   update, and adding a wire type anywhere else re-creates the drift the
   package removed;
2. update server serialization and client handling; both compile against the
   package, so a mismatch is a type error rather than a runtime surprise;
3. add a server test — `sync_transport_test.ts` for transport behavior,
   `protocol_smoke_test.ts` for the route-level contract and the legacy shim;
4. add a tldraw E2E when visible/reconnect behavior changes;
5. update this document and the route table in `server.md`.

For a whole new entity kind, follow `adding-an-entity-kind.md`, which walks the
same list end to end.
