# Recipe: Adding an Entity Kind

Status: checked against the entity-kind and canvas-view registries on
2026-08-26. Read this only when adding a named engine-owned kind.

The registries consolidate mechanical wiring, not domain semantics. A roll
edit, params merge, animation replacement, and signal publish should not be
forced through one universal patch API.

## 1. Choose lifetime and ownership

A durable kind participates in project save/open, status, generic entity CRUD,
and `data/<type>/`; an ephemeral kind does not. In
`EntityKindRegistration`, durability is exactly the presence of `durable`.
Signals are the store-backed ephemeral example. Runs, waits, and lookups are
registered separately because they are engine/runtime state rather than domain
store entities.

Choose one stable, space-free type ID. It crosses protocol sync, engine
registration, generic CRUD/persistence, and client view references.

## 2. Define the shared boundary

Add the wire types under `packages/livecode-protocol`, export them, and add the
kind to `SYNC_ENTITY_TYPES` plus `SyncEntityByType` in `sync.ts`. A durable kind
also needs its saved-file type; a project-backed view needs a manifest view
record.

Do not mirror these types in either app. TypeScript is still not runtime
validation, so validate at mutation/load boundaries.

## 3. Implement and register the store

A store owns validation, normalization, revisions, no-op behavior, and domain
operations. Use `entity_store.ts` for the existing snapshot/sampling pattern;
for large state with sparse edits, follow
[`six_sines_store.ts`](../../../packages/livecode-engine/six_sines_store.ts)
using [`tracked-state`](../../../packages/tracked-state/README.md). The latter
is an exemplar, not a global switch: it exposes a flat numeric map and explicit
preset replacement, so its gates do not cover every possible object shape.

Keep the integration formulaic:

- Create one tracker per entity lifetime; expose a typed live object. Keep
  validation/revision policy in the store, outside the tracking primitive.
  Retain the same creative-code access pattern when optimizing a kind.
- Let the existing collector drain once, regardless of UI subscriptions. A
  second consumer (including an audio bridge) receives the collected batch;
  it never takes its own drain. Snapshot/save/reset reads must not acknowledge
  pending writes. Published snapshots and patch values must be detached from
  mutable engine state, including in same-realm delivery.
- If structural assignment can expose external raw references, consult the
  tracker's conservative `dirty` gate on collection. An outer changed-name
  set alone cannot catch raw writes; `dirty` may stay true and drain may return
  nothing. Six Sines can use its outer gate because its public sparse surface
  admits only scalar values and its bulk setter reconciles copied input.
- Reconcile bulk input through the kind's explicit setter. Preserve promised
  live-container identities; do not replace a root that running code holds.
  Tracker reconciliation is not params redeclaration/tombstone policy or
  piano-roll history. Translate data-relative patches to entity-relative paths
  and carry metadata changes without assuming all kinds share revision rules.
- Keep error and disposal ownership explicit. Invalid external writes are
  detected at scan time and throw; a new kind must surface that failure without
  acknowledging lost changes. The shared collector is not a per-kind failure
  isolation boundary. Retire tracking and runtime listeners on their owning
  lifetimes; retained detached proxies are not handles to a recreated entity.

Do not add a project-authored dirty API, per-control watcher graph, or second
synchronization loop to obtain the sparse path. Detailed supported values,
array/alias behavior, and external-scan costs belong to the package contract.

Add one `BUILTIN_ENTITY_KINDS` entry in `entity_kinds.ts` with sync collection
and snapshot behavior. Add the durable behavior only when intended. Do not add
another timer, socket, or parallel type list.

When the natural value is a browser component's own scene rather than a plain
domain record, do what the drawing kind does: define a lossless document the
component can serialize and hydrate exactly, store that, and derive the
sketch-facing form with a Konva-free bake in a shared package
(`packages/drawing-document`). Never store the derived form.

## 4. Add explicit operations

Registration covers observation and optional durability, not writes. Add typed
domain requests, `EngineOp`/`executeEngineOp` handling, and host routes or
broadcast actions as needed. Use compare-and-set for whole-entity concurrent
edits. A code-published kind may correctly have no client write operation.

The optional generic patch operation delegates to a registered kind's patch
handler; it is not permission to mutate arbitrary entity paths. Observation
patches may carry engine-owned metadata that the write API must reject.
Route UI edits through ordinary tracked mutation so other views and runtime
bridges receive them. Silent reconciliation is for an already-authoritative
hydration baseline, not suppression of the editing client's echo.

## 5. Add the client slice and view

Add the typed slice to `syncState.ts` and its context/hooks to
`syncRuntime.tsx`; separate contexts keep high-rate kinds isolated. Resets
replace maps and views must tolerate a missing/deleted entity. Use the shared
patch materializer rather than reproducing transport logic per view; keep the
component's hydration silent and its user-edit boundary explicit. The
[client document](client.md#state-layers-and-provider-order) owns this pattern.

For a canvas representation, add one `CANVAS_VIEW_CODECS` entry. Its codec owns
shape registration, collect/restore/change detection, optional entity
reference, and construction. Keep identity/layout/presentation in shape props;
durable domain data stays in the engine. Because `/project/canvas` replaces the
whole object, every post must still collect all codecs.

## 6. Prove the seams

Cover store validation/no-op/revision behavior, registry materialization,
durable round-trip if applicable, real sync reset/change/null-deletion, canvas
codec collect/restore, and browser server-to-view plus view-to-engine flow. A
user-visible kind also needs one checked-in example project used by both its
manual README and E2E; copy it before destructive automation.

For sparse kinds also test initial baseline, ordered patches, snapshot reads
between writes and collection, late/reconnecting views, deletion/recreation,
and multiple consumers of one drain. If the public surface admits external
objects, test raw writes and growth through the actual engine gate, not just
the library. Do not infer separate-tab recovery from a same-tab happy path.

Update current docs only for a new non-obvious lifetime, asymmetry, or
cross-module constraint. Do not add a route/type/test catalog.
