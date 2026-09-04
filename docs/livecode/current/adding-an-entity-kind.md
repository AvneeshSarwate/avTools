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

A store normally wraps `entity_store.ts` but owns its validation,
normalization, revisions, no-op behavior, and domain operations. Every mutation
must mark the affected name. `snapshotAll()` must be read-only;
`collectChanges()` alone drains pending names. If modules retain/mutate a live
object, the engine tick must adopt drift even with no subscribers.

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

## 5. Add the client slice and view

Add the typed slice to `syncState.ts` and its context/hooks to
`syncRuntime.tsx`; separate contexts keep high-rate kinds isolated. Resets
replace maps and views must tolerate a missing/deleted entity.

For a canvas representation, add one `CANVAS_VIEW_CODECS` entry. Its codec owns
shape registration, collect/restore/change detection, optional entity
reference, and construction. Keep identity/layout/presentation in shape props;
durable domain data stays in the engine. Because `/project/canvas` replaces the
whole object, every post must still collect all codecs.

## 6. Prove the seams

Cover store validation/no-op/revision behavior, registry materialization,
durable round-trip if applicable, real sync reset/change/null-deletion, canvas
codec collect/restore, and browser server-to-view plus view-to-engine flow. A
user-visible kind also needs one checked-in `feature-*` project used by both its
manual README and E2E; copy it before destructive automation.

Update current docs only for a new non-obvious lifetime, asymmetry, or
cross-module constraint. Do not add a route/type/test catalog.
