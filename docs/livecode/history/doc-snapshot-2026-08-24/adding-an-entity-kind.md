# Recipe: Adding an Entity Kind

Status: checked against the entity-kind and canvas-view registries on
2026-08-23.

This is the end-to-end list for a new named thing owned by the engine and
watched by clients. The registries consolidate mechanical wiring; they do not
make domain behavior generic. Piano-roll history, params reconciliation,
animation evaluation, and signal lifetime remain in their own stores.

## 1. Choose the lifetime

| Question | Durable | Ephemeral |
| --- | --- | --- |
| Included in project save/open? | yes | no |
| Available through `/entities/*` CRUD? | yes | no |
| May have domain-specific undo or reconciliation? | yes | yes |

Durability is the presence of `durable` on an `EntityKindRegistration`.
Persistence, status rows, project load, and generic CRUD iterate durable
descriptors. Do not add per-type filters to those paths.

Signals are the named ephemeral example. Runs, waits, and lookups are also
ephemeral, but are registered separately because their state belongs to an
engine instance or the runtime rather than a store-backed named entity.

## 2. Define the shared contract

Create a module under `packages/livecode-protocol`, export it from `mod.ts`, and
add the entity to both `SYNC_ENTITY_TYPES` and `SyncEntityByType` in `sync.ts`.
For a durable type, add its saved-file interface to `saved_entities.ts`. If it
has a canvas view, add the view record to `ProjectCanvasState` in `project.ts`.

Use one stable, space-free type ID. The same ID names sync messages, the engine
registration, generic CRUD, saved-state keys, and `data/<type>/` directories.

## 3. Implement domain storage

A store-backed kind normally wraps `entity_store.ts`. Its store owns:

- validation and normalization;
- create, get, list, duplicate, and delete semantics;
- revisions and no-op behavior;
- snapshot and changed-name collection;
- any domain operations such as roll undo or animation sampling.

Every mutation must mark the affected name, while snapshot reads must not drain
the change gate. If caller code mutates a live object directly, adopt that drift
on every engine tick even when nobody subscribes. Keep hot, caller-owned timing
paths non-throwing; declaration, routes, and save/load boundaries may reject bad
input.

## 4. Register the engine kind once

Add one entry to `BUILTIN_ENTITY_KINDS` in
`packages/livecode-engine/entity_kinds.ts`:

```ts
{
  typeId: MARKER_ENTITY_TYPE,
  sync: {
    collectChanges: () => collectMarkerChanges(),
    snapshotAll: () => listMarkers(),
  },
  durable: markerEntityType, // omit for an ephemeral kind
}
```

`registerEntityKinds` materializes the sync source and, when present, the
durable descriptor from that one type ID. A durable behavior still supplies
its own create/duplicate/remove/serialize/deserialize/latestJson functions in
`entity_registry.ts`.

The engine timer already walks every registered sync source. Do not add a
socket, timer, broadcast block, or second type list. Runtime-only sources such
as `run`, `moduleWaits`, and `moduleLookups` remain explicit engine wiring
because they need per-engine accessors.

## 5. Add domain operations explicitly

The registry covers observation and generic durability, not mutation semantics.
If the kind needs its own write operation, add its typed request/result, engine
op, host-op case, and HTTP route. Use compare-and-set when concurrent editors
can overwrite a whole entity. A code-published type may correctly have no write
route.

Keep this explicit switch small. Do not invent a universal patch language to
hide meaningful differences between a roll edit, a params merge, and an
animation timeline replacement.

## 6. Add the client slice

In `syncRuntime.tsx`, add a typed slice, context, provider entry, reducer case,
and consumer hook. Per-kind contexts are intentional: frequent signal traffic
must not rerender every durable editor. Add domain write actions only when the
kind has them.

A view must handle an absent entity. Deleting an entity does not delete its
views, and reconnect resets replace the complete per-kind map.

## 7. Register a canvas view, if there is one

Create the tldraw shape and add one codec to `CANVAS_VIEW_CODECS` in
`canvasViews.ts`. A codec provides:

- the shape util and shape guard;
- project collection and restoration;
- persisted-change detection;
- for entity-backed views, the entity reference and view constructor.

That entry drives tldraw shape registration, project canvas collection and
restore, selection-to-entity actions, adjacent duplicate views, default/topbar
creation, and the test/debug creation surface. Keep the shape props to identity,
layout, and presentation; durable domain data belongs in the engine entity.

`/project/canvas` replaces the whole canvas object, so the collector always
posts every registered view kind together. Explicit project save flushes that
current projection before saving entity files.

## 8. Test the seams and the domain

| Layer | Required evidence |
| --- | --- |
| Store | validation, create/reattach, no-op/revision behavior, domain evaluation, atomic rejection |
| Entity-kind registry | a fake registration materializes matching sync and durability artifacts |
| Durable registry | generic CRUD and serialize/deserialize round trip |
| Sync | reset, changed entity, and `entity: null` deletion over the real socket |
| Canvas registry | collect, restore dispatch, change detection, and entity reference |
| Browser | mounted view, server-to-component apply, component-to-engine write, save file, and saved-truth restore |

Add focused unit files to `test:livecode:unit`; route and sync cases belong in
the server task. Keep domain tests concrete rather than forcing unlike entity
kinds through one behavioral base class.

## 9. Save a shared feature fixture

Add a checked-in project under `apps/livecode-tldraw/example-projects/` for a
new user-visible feature. It should contain canonical `*.orig.ts` source, the
smallest useful manifest/canvas layout, representative durable `data/`, and a
README with expected state and a manual edit/save/reopen checklist.

An automated end-to-end test must open that same project. Copy it to a temporary
directory before tests that save, delete, or rewrite layout; do not reconstruct
its entity payloads in the test or mutate the checked-in project. Focused unit
fixtures still own invalid inputs and edge cases. The long-lived project owns a
coherent workflow a person can open and recognize.

`feature-animation-timeline` is the reference: the browser E2E copies it,
asserts its restored entity/editor/scope, and then performs destructive cases
only on the copy. `verify-feature-projects.ts` also opens the canonical project
headlessly.

## 10. Update the current docs

Update `protocol.md`, `server.md`, `client.md`, `system-architecture.md`, and,
for durable or canvas-backed kinds, `project-model.md`. The maintenance contract
in `docs/livecode/README.md` still applies.
