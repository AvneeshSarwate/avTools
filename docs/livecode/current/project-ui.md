# Current Project UI

Status: checked against `projectUi.ts`, `projectUiApi.ts`, `canvasViews.ts`, and
`feature-project-ui` on 2026-09-29.

A project may carry its own tldraw views: `ui/index.tsx` in the project
directory, exporting `shapeUtils`. The reference instance is
[`feature-project-ui`](../../../apps/livecode-tldraw/example-projects/feature-project-ui/README.md);
to add a view to a piece, follow its `ui/index.tsx`.

## What it is

- **A project library, not a module.** No manifest entry, no `.orig` twin, no
  analyzer pass, no Deno check. It is typechecked with the app (`tsconfig.json`
  includes `example-projects/*/ui`; a project elsewhere extends that config or
  is left to the dev server's errors).
- **Compiled by the UI dev server.** `App.tsx` imports
  `/@fs/<project root>/ui/index.tsx` from the page's origin before `<Tldraw>`
  mounts, so the file uses the app's own React and tldraw instances and gets
  HMR. Projects under the app directory need no configuration; other roots go in
  `LIVECODE_PROJECT_ROOTS` for Vite's `fs.allow`. The served `uiDist` and bakes
  do not serve it (`known-risks.md`).
- **Registered before the editor mounts.** tldraw cannot add shape types later,
  so a project URL waits for its entry (or a 404) first. A component edit
  hot-swaps; a changed shape `type`, size, or props schema needs a tab reload.
  That is free because the engine holds state, and it is why editing UI with
  `?engine=inprocess` is the wrong topology.
- **Contained on failure.** A compile or evaluation error is a banner and
  built-in views only; a saved project shape whose type no loaded util defines
  is skipped and reported (`getProjectUiState().unrestoredTypes`), never thrown.
  Built-in shape types cannot be redefined.

## The one import

`@livecode-ui` (`src/projectUiApi.ts`) is the surface project UI code uses
besides `react` and `tldraw`:

- Facet hooks over a per-entity selector: `useParamsValues`, `useParamsPresets`,
  `useParamsRev`, `useParams`, `useParamsNames`, `useSignal`, `usePianoRoll`,
  plus the raw `useSyncSlice` / `useSyncEntitySelector`. A facet hook keeps its
  result's identity while the entity's other facets change; a preset bank
  ignores a modulated knob.
- `useLivecodeActions()`: `setParams`, `setParamsPreset`, `deleteParamsPreset`,
  `recallParamsPreset` (an ordinary `setParams` with the stored snapshot),
  `emitEvent`.
- `defineEntityShape({type, entityType, component, ...})`: the tldraw
  `ShapeUtil` ceremony for a box bound to one entity. The component receives
  `{shape, entityType, entityName, editor}` and runs inside tldraw's tree.

## Persistence and binding

One codec in `CANVAS_VIEW_CODECS` covers every project-defined type:
`canvas.projectShapes` saves each shape's own props. The binding is the
`entityType`/`entityName` props the factory puts on every shape; that is what
`entityRef` reports and what Duplicate rebinds to the cloned entity. Keep
identity, layout, and presentation in props; domain data belongs in an entity,
or it is unsynced, unreachable from code, and re-posted on every layout change.

## Params presets

`ParamsEntity.presets` is a label-keyed bank of value snapshots kept beside
`values`, never inside it. Store functions, engine ops, HTTP routes, and the
`canvas-params` helpers (`setParamsPreset`, `removeParamsPreset`,
`recallParamsPreset`, `listParamsPresets`) are all name-and-label keyed; recall
is a values set, so fields the declaration has since dropped are ignored with
the usual warning. Presets ride the saved data file and copy with duplicate; a
load without presets clears the bank.

Params now ship whole-entity first, then per-facet patches (`["values"]`,
`["presets"]`); meta and serializability changes ship whole. See
[sync semantics](protocol.md#sync-semantics).
