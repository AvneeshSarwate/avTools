# Multiplexed sync transport plan (2026-08)

Status: active implementation plan. Unifies the four snapshot WebSocket
channels into one subscribed, sequenced sync transport, and absorbs the six
items previous slices explicitly deferred into it. When complete, this file
remains history; `docs/livecode/current/` documents what shipped.

## Goal and absorbed deferrals

One socket carries every watched entity kind, per-entity, changed-only,
subscription-scoped. The slice absorbs, by prior explicit deferral:

1. **Subscription scoping** (unwatched costs nothing — principles contract).
2. **Run token on the wire** (fixes the reused-`generatedRunId` one-snapshot
   status flicker documented in the lifecycle slice).
3. **Wait-decoration retrofit** (waits/lookups become entity kinds on the
   same transport; the lifecycle-fusion blocker dissolves because runs
   become entities too).
4. **Piano-roll store migration onto `entity_store`** (registry facade
   becomes unnecessary indirection; dead exports removed).
5. **Shared protocol package** consumed by Deno and Vite (ends hand-mirrored
   wire types — the repo's oldest documented drift hazard; three mirror
   files plus the runtime-snapshot types collapse to one source).
6. **Client provider unification** (three parallel providers plus the
   livecode snapshot socket become one sync provider with typed hooks).

Explicitly OUT of scope: auth/MCP surface (next tier, builds on this);
per-NAME subscriptions (type-level only in v1); sub-entity diffs (a changed
entity ships whole — note-level patches are a future optimization);
`/client/control` and `/lsp` sockets (unchanged); modernizing the Vue
SketchWrapper client beyond a compatibility shim.

## Design decisions

### D1. Shared protocol package: `packages/livecode-protocol`

Plain-TS package `@avtools/livecode-protocol` (deno.json with name/exports —
`core-timing` shape), a root-workspace member, holding every wire type both
sides use: entity types (`PianoRollObject`/`NoteData`…, `ParamsEntity`/meta,
`SignalEntity`/anchor, the new run/waits/lookups entities), the sync
envelope, saved-entity file formats, HTTP request/response types shared by
client and server (`AnalyzeSuccess`, `RuntimeStateResponse`,
`HealthResponse`, project types, launch/stop bodies…). Consumption:

- Deno: root `deno.json` import map + workspace entry, plus the
  `apps/deno-notebooks/deno.json` relative map (existing `@avtools/*`
  pattern).
- Vite: `apps/livecode-tldraw` gains its FIRST source alias — the
  browser-projections template exactly: `resolve.alias` to
  `../../packages/livecode-protocol/mod.ts`, tsconfig `paths` (bare form),
  `allowImportingTsExtensions: true`, `baseUrl`. (Sweep confirmed
  browser-projections consumes `@avtools/core-timing` as raw TS this way —
  the mechanism is proven; livecode-tldraw simply never wired it.)
- `visualizer/protocol.ts` re-exports from the package during migration so
  server imports change mechanically; client `pianoRollTypes.ts`,
  `paramsTypes.ts`, `signalsTypes.ts` are DELETED and `livecodeProtocol.ts`
  shrinks to client-only view-model types (`HistoryEntry`, `PreparedBuild`,
  `PreparedFailure`) plus re-exports.
- Known divergences this fixes en passant: `HealthResponse
  .runtimeCapabilities` optional-vs-required drift; the untyped inline
  `/piano-roll/set` body gains `SetPianoRollRequest`; the third, narrower
  `ActiveWaitSnapshot` copy in SketchWrapper stays local (legacy shim keeps
  its old wire shape — D6).

### D2. The sync socket and envelope

`GET /sync` (WS). Client→server messages:

```ts
{ type: "subscribe", entityTypes: string[] }   // replaces the set
```

Server→client:

```ts
{ type: "sync", seq: number, timestampMs: number,
  resets?: Record<string, Entity[]>,       // full state per newly subscribed type
  changes?: Array<{ entityType: string; name: string; entity: Entity | null }> }
```

- Per-ENTITY granularity: a changed entity ships whole; `entity: null`
  means deleted. This alone ends the piano-roll full-store rebroadcast (only
  the edited roll ships).
- On subscribe (including the implicit resubscribe after reconnect) the
  server sends `resets` for the newly added types — read-only builds, never
  consuming dirty state owed to other sockets (the forced-snapshot rule all
  channels follow today).
- `seq` is a per-socket monotonic message counter for gap DETECTION only;
  there is no replay buffer — a detected gap or reconnect is handled by
  resubscribing for fresh `resets`. Full rehydration on reconnect matches
  today's semantics.
- Subscriptions are type-level in v1. Per-name scoping is deferred;
  the envelope shape already admits it later without breaking.

### D3. Server internals: sync sources, one timer

A `sync_sources.ts` registry replaces the four hand-copied channel blocks:

```ts
interface SyncSource {
  entityType: string;
  collectChanges(): Array<{ name: string; entity: Entity | null }> | null;
  snapshotAll(): Entity[];                    // read-only, for resets
}
```

ONE timer at `SNAPSHOT_TICK_MS` walks registered sources, gathers changes,
and broadcasts one envelope per socket filtered to its subscriptions
(nothing subscribed or nothing changed → nothing sent). The existing
samplers refactor from build-full-snapshot to return-changed-records
(params/signals already identify changed records internally while
serialize-comparing; the refactor exposes what they compute). HTTP list
routes keep their current full-snapshot responses. Socket set, route,
timer, and shutdown wiring exist ONCE.

### D4. Entity kinds on the transport

- `pianoRoll` (durable) — after D9's store migration.
- `params` (durable) — as today.
- `signal` (ephemeral) — as today.
- `run` (ephemeral, NEW): replaces the `moduleRuns` + `activeModules`
  snapshot fields. Keyed by moduleId; value carries `state`,
  `generatedRunId`, **`runToken`** (now on the wire — the client's terminal
  dedupe keys on it, retiring the `lastTerminalRun {generatedRunId,
  updatedAtMs}` heuristic and the documented flicker), `updatedAt`,
  `projectModulePath?`, `sourceHash?`, `projectSourceHash?`, `message?`.
  Active-module lists derive client-side from `state`. The server's two
  snapshot-identity guards (superseded-launch and stale-teardown paths)
  re-key from object identity to `runToken` comparison — semantics
  preserved, now expressible on a store record.
- `moduleWaits` + `moduleLookups` (ephemeral, NEW — the wait retrofit):
  keyed by moduleId, values are the sorted active-callsite array and the
  lookup map, exactly the per-module shapes the CodeMirror consumers already
  join against manifests. Written by the existing `runtime.ts`
  enter/exit/record functions marking their entity dirty; cleared where
  they are cleared today (analyze, stop, branch-finally). This keeps
  `visualizedAwait`/`visualizedPianoRollLookup` call sites and the
  generated-code contract untouched — only the transport of their state
  changes.

### D5. Client: one sync provider, typed hooks, unchanged consumer APIs

`syncRuntime.tsx`: one reconnecting socket, one subscribe message, per-type
maps, ONE RAF-coalesced flush, `connectionStatus`/`latestSeq`. Typed hooks —
`usePianoRollsSync`, `useParamsSync`, `useSignalsSync`, `useRunsSync`,
`useModuleVizSync` — preserve today's consumer-facing shapes (`rolls`,
`params`, `signals` maps; `setRoll`/`undoRoll`/`redoRoll`/`setParams`
stay as HTTP calls via `serverRequests`), so the shape/pane/scope diffs are
import-swaps, not rewrites. `livecodeRuntime.tsx` keeps analysis, LSP,
module records, and run actions, but consumes runs/waits/lookups from the
sync provider instead of owning a socket; its open-sequence (health → LSP →
`/runtime/state` rehydration → flush pending stops → re-analyze) moves to
the sync socket's open callback, and `markModulesUnknown` to its close.

**Connection-gesture decision (behavior choice, made explicit):** `/sync`
connects on provider mount — preserving today's reality where piano-roll,
params, and signals data flow without pressing Connect — and the Connect
button keeps governing what it actually governs today on top of that: LSP
session, health, rehydration, and analysis scheduling. Runs data arriving
pre-Connect is harmless and matches server truth. Documented in client.md.

### D6. Legacy compatibility

`GET /runtime/snapshots` SURVIVES as a deprecated shim emitting today's
`ActiveWaitSnapshot` envelope, derived from the same sources on the same
tick — because the Vue SketchWrapper client reads exactly `{seq, modules}`
from it (sweep-verified) and its e2e asserts only connection UI text. The
`piano-roll/params/signals` sockets are DELETED (their only consumers are
the tldraw providers this slice migrates). `protocol_smoke_test.ts` — the
one test that opens a snapshot socket — migrates to `/sync`; a small
legacy-shim assertion keeps the shim honest.

### D9. Piano-roll store migration

`piano_roll_store.ts` is rewritten over `entity_store` (params_store
pattern): records become `(type "pianoRoll", name)` entities whose value is
the roll data; undo/redo stacks, CAS, labels, never-throw clone discipline,
demo-seed semantics (`DEMO_SEED_ORIGIN`, `deletedDefaults`), and the
public function signatures all survive in the type module — routes,
helpers, registry descriptor, and user modules importing
`"piano-roll-store"` see identical APIs. Dead exports go
(`markPianoRollStoreDirty` — no in-tree caller; `getAllPianoRolls`
internalized). The registry descriptor simplifies since it now shares the
substrate it fronts.

## Phases (each ends green; suites named per phase)

**Phase A — shared protocol package (pure refactor).** Create
`packages/livecode-protocol`, move shared types, wire both consumers
(root/deno-notebooks import maps + workspace; tldraw vite alias + tsconfig
paths), delete the three mirror files, shrink `livecodeProtocol.ts`, fix the
`HealthResponse` divergence, type the piano-roll set body. NO behavior
change. Gates: `deno check` server, full `test:livecode:unit` +
`test:livecode:server`, tldraw `type-check` + full e2e.

**Phase B — server sync core alongside old sockets.** `sync_sources.ts` +
`/sync` route/timer/subscriptions; sampler refactors to changed-records;
run entities with `runToken` (guards re-keyed); waits/lookups entities;
piano-roll store migration (D9); legacy `/runtime/snapshots` shim rebuilt
over the new sources. The three entity sockets KEEP RUNNING in B so the
un-migrated client stays green. Tests: new `sync_transport_test.ts`
(subscribe/reset/changed-only/deletion/seq/gap-resubscribe, run entity
lifecycle incl. token supersede, waits/lookups parity), piano-roll store
tests adapted, smoke-test migration, full unit + server suites.

**Phase C — client migration and old-socket deletion.** `syncRuntime` +
hooks; consumer import-swaps (App, three shapes, editor shape via
livecodeRuntime); livecodeRuntime socket removal and open-sequence move;
delete the three entity sockets and their server wiring; tldraw e2e updated
where its text/timing assumptions referenced old channels. Gates: full
tldraw e2e, Vue e2e (`test:livecode:e2e` — proves the shim), all Deno
suites, `verify-feature-projects.ts` (92 checks — pure HTTP, should pass
untouched).

**Phase D — docs and cleanup.** protocol.md gains the sync contract
(envelope, subscribe, seq/gap semantics, reset rules) and retires the
per-channel sections; server.md (sources registry, one timer, run/waits
entities, shim); client.md (sync provider, hooks, connection-gesture
decision); system-architecture.md (connection domains: sync + control + lsp
+ legacy shim; state-ownership rows); known-risks.md (hand-mirroring hazard
RESOLVED for wire types via the package; run-token flicker residual
RESOLVED; SketchWrapper's unbounded `receivedSnapshots` array noted;
dual-socket phase-B state is transitional and gone); testing-and-operations
(new tests, task contents); both architecture.md maps; **the deferred
"adding an entity kind" recipe, written against the NEW shape** (register a
sync source + type module + hook; the honest version of the recipe this
slice made short); delete the stale `diff_copy.txt` at repo root if
tracked, else tell the owner it exists.

## Risks

- **Connection-gesture semantics** are a real behavior surface — D5 states
  the choice; the e2e pins it.
- **Sampler refactors touch tested code** — the store-level tests assert
  snapshot functions; they adapt in the same commits, and HTTP list routes
  keep full snapshots so the e2e's polling helpers are unaffected.
- **Run-guard re-keying** (object identity → runToken) touches the
  lifecycle slice's most adversarially-reviewed code; the launch-race suite
  (11 tests) is the net and must stay green unmodified in intent (assertions
  may re-key).
- **tsconfig changes in tldraw** (paths/allowImportingTsExtensions under
  Bundler resolution) follow the working browser-projections template; the
  type-check gate catches misfires.
- **Phase-B dual transport** briefly duplicates broadcast work —
  deliberate, deleted in C, and cheap at changed-only cadence.
- **SketchWrapper** keeps working via the shim but is NOT modernized; its
  local narrow types and unbounded debug array are noted in known-risks,
  not fixed here.
