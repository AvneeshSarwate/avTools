# Project-owned UI and params presets

Status: implemented September 2026. Current contracts live in
`current/project-ui.md`, `current/protocol.md`, and `current/client.md`; the
executable fixture is `feature-project-ui`.

## Why

The goals describe piece-specific UI as part of a piece's identity: trigger
surfaces, monitors, preset switchers, built over composed modules while
re-posing for performance. Until now every canvas view was a platform component:
a closed codec registry, a typed manifest array per kind, and no route that
served project code to the UI tab. A new view meant the entity-kind recipe, even
for a box with four buttons.

The first concrete need is a preset bank for a params entity, with the
expectation of several different UIs over the same data (switchers,
interpolators, sequencer front-ends), each written quickly by an agent.

## Decisions

### Project UI is a project library served by the UI dev server

`ui/index.tsx` in the project directory exports tldraw shape utils. The Vite dev
server already compiles any file under its allowed roots against the app's own
`react` and `tldraw` chunks, with HMR, so nothing new delivers the code: the
page imports `/@fs/<project root>/ui/index.tsx` before `<Tldraw>` mounts. It is
a library by the platform's rules (no manifest entry, no `.orig` twin, no
analyzer, no Deno check; typechecked by the app's `tsc`), which also settles
that a changed shape class needs a tab reload rather than hot-swap. The engine
holds all state, so a UI reload costs nothing; iterating on UI with the engine
in the same tab is documented as the wrong topology.

Considered and rejected: project web components in a host-owned generic shape
(the piano roll's pattern). It avoids nothing this design needs and forces a
second component model on piece code. Also rejected: a server-side bundle route,
which would have produced a second React instance.

### One import: `@livecode-ui`

`src/projectUiApi.ts` re-exports the app's real hooks, actions and a shape
factory. Reads are facet hooks over a per-entity selector
(`useSyncEntitySelector`): `useParamsPresets` retains its result while values
change, so a bank never re-renders for a modulated knob. `defineEntityShape`
owns the tldraw ceremony; the project owns the component.

### Persistence: one generic codec

`canvas.projectShapes` saves each project-defined shape as its own props. The
binding convention (`entityType`, `entityName` props, put there by the factory)
is what Duplicate and `entityRef` use. Props are for identity, layout, and
presentation; domain data belongs in an entity. That rule is stated, not
enforced, per "surfaced rather than prevented".

### Presets are a facet of the params entity, not a kind

A preset is a snapshot of one entity's values and shares its lifetime, so it
lives on the record beside `meta` (never inside the live value tree the sampler
serializes each tick), rides `data/params/<name>.json`, copies with duplicate,
and is addressed by name and label from code, UI, and headless callers alike.
Recall is an ordinary values set. Rejected: a new entity kind (the full recipe
for a facet), and shape props (unsynced, unreachable from code, re-posted on
every layout nudge).

### Params ship per-facet patches

At 60 fps code modulation the sampler already conflates to one whole-entity
delivery per 33 ms tick. A 20-preset bank on that entity would have been re-sent
and deep-cloned 30 times a second. Params therefore move to the
whole-entity-first, then patches form Six Sines and the drawing store use:
`["values"]` for a value generation, `["presets"]` for a bank edit, whole for
meta or serializability changes. Both facets are serialized at collect time, so
several writes in one tick still cost one delivery. The client materializer
already applies patches generically and retains untouched branches, which is
what gives the facet hooks their stable identities. `entity_store` gained a
small facet/full tracker for kinds that serialize a facet at collect time; the
drawing store keeps its literal node-patch list.

## Deferred

- A frame coalescer for UI-to-engine writes (`setParams` at 60 fps from an
  interpolator). Not needed by a switcher; recorded in `known-risks.md`.
- Project UI in a bake or the served `uiDist`: the entry is only served by the
  dev server. Recorded in `known-risks.md`.
- A project opened later through client control (`openProject`) does not load
  that project's UI; reload with `projectPath`.
- Sequencers and interpolators run engine-side and read presets by label; their
  UI defines the sequence and sends it back through events. Whether a persisted
  sequence is an entity or something else is an open question
  (`next-stuff-brainstorm.md`).
