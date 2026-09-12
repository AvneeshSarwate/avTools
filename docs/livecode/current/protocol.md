# Current Cross-Boundary Contracts

Status: checked against `packages/livecode-protocol` and both consumers on
2026-08-24.

## One type source, no runtime schema

All JSON wire and saved-data interfaces live in
`packages/livecode-protocol`. The Deno host imports them through its workspace
map; the tldraw app compiles the same raw TypeScript through Vite/tsconfig
aliases. `apps/deno-notebooks/livecode/visualizer/protocol.ts` is a re-export,
and `apps/livecode-tldraw/src/livecodeProtocol.ts` adds client-only view models.

The package is type-only except for `SYNC_ENTITY_TYPES`. It does not validate
untrusted JSON. A boundary change must update parsing/handling and tests, not
only an interface.

| Contract | Type owner | Main producers/consumers |
| --- | --- | --- |
| analysis/manifest | `analysis.ts` | analyzer, server analyze route, runtime/editor |
| launch/run/waits/lookups/health | `runtime.ts` | engine, server, livecode runtime |
| multiplexed observation | `sync.ts` | engine sync sources, server/uplink, sync provider |
| project and saved entities | `project.ts`, `saved_entities.ts` | project server, App/canvas registry, bake |
| domain entities | `piano_roll.ts`, `params.ts`, `animation_timeline.ts`, `drawing.ts`, `signals.ts` | stores, host ops/routes, per-kind client slices/views |
| local/remote engine ops | `engine_uplink.ts` | execution plane, engine host, bake |
| in-process engine host | `engine_host.ts` | browser engine host, tldraw `inProcessEngine.ts` (not JSON: a same-realm function contract, still the one type source) |
| browser automation | `client_control.ts` | HTTP caller, server bridge, mounted client |

## Sync semantics

`/sync` is one subscribed channel for the registered entity kinds. In
served/baked browser-engine topologies the equivalent envelopes may use `BroadcastChannel`.

`drawing.ts` is the one file here that imports another package: the document
type, its validation, and its Konva-free bake are owned by
`packages/drawing-document` so the canvas element and the engine share them.
The wire carries the lossless document, never the baked render data.

The invariants in `sync.ts` matter more than the transport:

- A subscribe replaces the socket's type set and replies with a complete reset
  for each requested type. A reset replaces the client's map.
- `seq` is per connection and exists only to detect gaps. There is no replay;
  recovery is resubscription.
- Each named change is either a full entity, a null deletion, or a patch batch
  against the current entity. Full resets establish the baseline; new entities
  need a full value before patches. Paths are segment arrays relative to the
  entity, not to the kind's inner data value.
  [`patch.ts`](../../../packages/livecode-protocol/patch.ts) owns the exact shape.
- Patch batches depend on earlier accepted state. Preserve their order and
  apply every batch before coalescing a UI render. Dropping an earlier batch
  because a newer one mentions the same name loses unrelated edits. A gap or
  missing baseline requires a full reset, not guessed parents or replay of
  the last delta. Current recovery has a documented
  [apply-before-gap limitation](known-risks.md#p1-sparse-sync-recovery-still-applies-before-checking-the-baseline).
- Subscriptions are type-level, not name-level.
- Snapshot reads must not consume the engine's pending changed-name gates.

The engine collects changes once per tick, then fans that same result to
subscribers. Do not let a socket or HTTP read independently drain a store.
These are latest-state deltas, not an edit history, trigger stream, or promise
that every intermediate assignment is delivered. Transport selection does not
change these rules: WebSocket, BroadcastChannel, and same-realm observers must
all respect payload ownership and baseline ordering. Tracking is currently
used by Six Sines; the other kinds retain their existing snapshot behavior.

## Run and observation identities

`generatedRunId` identifies a prepared build and can be reused. `runToken`
identifies one accepted launch and is returned by launch, carried by `run`
entities, and repeated by runtime rehydration. The client must use the token to
reject a replaced run's late terminal state.

A successful launch response means queued. `executionCount` increments only
when user code begins and persists on the latest terminal entity within that
engine process. Waits are active-callsite counts, not booleans. Piano-roll
lookup entries map callsite IDs to the last resolved string and persist after a
run until the next analysis clears that module.

`/runtime/state` is lifecycle rehydration, not a complete sync snapshot: watched
wait/lookup/entity truth still comes from sync.

## Domain asymmetries

These differences are deliberate; a generic entity layer must not erase them:

| Kind | Mutation | Lifetime/persistence |
| --- | --- | --- |
| Piano roll | Whole normalized set is an upsert; optional compare-and-set and bounded undo/redo. | Durable; explicit project save. |
| Params | Leaf merge into an existing declared/live object; unknown/type-mismatched leaves are ignored and logged. | Durable values plus meta; explicit save. |
| Animation timeline | Whole validated replacement of an existing entity, normally compare-and-set. Sampling/callback execution is not stored. | Durable data only; explicit save. |
| Six Sines | Live numeric parameter assignments or validated small UI sets; explicit bulk preset reconciliation preserves the held values container. Observation is sparse after the initial full entity. | Durable base preset XML plus current numeric values; explicit save. |
| Signal | Code publishes a latest value and anchors; there is no client set operation. | Ephemeral, no history/save/CRUD; ends with its owner run. |

Params and signal revisions count observed value generations. Meta, anchors,
availability, redeclaration, or sticky `ended` transitions may ship without a
revision bump, which is why transport change tracking cannot be revision-only.
An unserializable current value is represented explicitly as unavailable/null;
stale cached data is never substituted.

Signal anchors are `{type, name, path?}` references. Current playhead consumers
ignore `path`. Signal logical timestamps are assigned when the sampler adopts a
value, so they are tick-granularity ordering keys, not exact write-time clocks.
A redeclaration clears `ended`; later writes alone do not.

An incoming generic entity patch is opt-in per kind, not the inverse of every
outgoing patch. Six Sines accepts parameter sets, not arbitrary metadata edits;
its revision advances on accepted mutations, not on display frames. Its store
validates numeric ID shape and finite values; native parameter membership,
ranges, and preset-format compatibility belong to the editor/engine boundary.
Use the paired schema when making a custom control.

Generic create/duplicate/delete addresses registered durable types by
`{type,name}`. It does not rename entities or manipulate views. A view and its
entity have independent lifetimes.

## Project persistence and engine forwarding

Manifest `data` entries point to saved entity files and retain the true entity
name. Save captures all durable entities before writing; an unserializable
capture aborts before file mutation. Individual later filesystem failures are
reported per entity. Open skips bad/unknown entries and continues. File layouts
and non-atomic/global-store implications are in `project-model.md` and
`known-risks.md`.

`EngineOp` is the one execution-plane surface used both directly and through
the remote uplink. Engine hello carries full resets; detach produces empty
resets; op failures cross back and are mapped to the same route semantics as
local execution. Adding an HTTP operation without an engine op usually creates
a local/remote behavior fork.

Client control is request/result correlation with a bounded timeout. A command
failure may be a successful HTTP response containing `ok: false`. LSP does not
use these JSON contracts; `/lsp` carries framed LSP traffic through VTLSP.

## Change discipline

Start a boundary change in the owning protocol module, then follow its imports
into the server/engine and client. Add transport/route coverage where data
crosses the seam and browser coverage where recovery or visible behavior
changes. Document only a new non-obvious invariant or asymmetry; do not copy the
new interface or route into Markdown. For a new named kind, use
`adding-an-entity-kind.md`.

Global input events use explicit engine ops, never the conflating sync channel.
Bodies are validated as JSON data even in same-tab mode, and each handler receives
an isolated copy. A result reports synchronous dispatch count, not playback or
async-handler completion. No entity address, revision bump, persistence, or replay
is implied. Params metadata may contain static button messages; only the gesture
adds `body.state`. Saving/duplicating preserves that literal metadata without
rewriting payload names or firing messages.
