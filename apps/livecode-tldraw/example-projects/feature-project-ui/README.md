# feature-project-ui

A project that carries its own tldraw UI: `ui/index.tsx` defines a four-bank
preset switcher for the `project-ui/look` params entity that a p5 sketch reads
every frame. The switcher is ordinary project code, compiled by the UI dev
server against the app's own React and tldraw, and registered when the project
opens. Presets are saved on the entity, so they ride project save and Duplicate.

## Opening it

Open it from the projects index with **engine in browser** (the sketch needs the
engine tab's DOM; the preset bank works in every topology). Do not use **engine
in same tab** while editing `ui/`: a changed shape class needs a tab reload,
which would also restart a same-tab engine.

## Flow

1. The canvas restores the sketch module, a params pane on `project-ui/look`,
   and the **preset bank** shape from `canvas.projectShapes`. Banks A and B are
   filled from `data/params/project-ui%2Flook.json`; C and D are empty.
2. **Run `p5 ring`.** A ring of circles appears in the engine tab.
3. Press **B**: the pane and the ring take preset B (warm hue, 36 small,
   faster). Press **A** to go back.
4. Turn a knob in the pane, choose **save**, press **C**: the current values
   become preset C. **clear** then a bank empties it.
5. **Save project**: the presets are written into the params data file. Reopen
   the project: the bank shape, its position, and the presets return.

## Editing the UI

Edit `ui/index.tsx` and the component hot-reloads in place. Changing the shape's
`type`, `defaultSize`, or extra props needs a tab reload. A compile error shows
as a banner and the project opens with built-in views only.

The component uses only `@livecode-ui`: `useParamsPresets` (re-renders for the
bank, not for modulated values), `useParamsValues`, and `useLivecodeActions`
(`setParamsPreset`, `deleteParamsPreset`, `recallParamsPreset`).
`defineEntityShape` turns it into a shape bound to one entity by
`entityType`/`entityName` props, which is what persistence and Duplicate use.

## Verification

`npm run test:e2e` covers this project: the UI entry loads, the saved bank shape
restores, recall writes preset values into the entity, save-mode fills an empty
bank, and project save writes the presets to disk.
