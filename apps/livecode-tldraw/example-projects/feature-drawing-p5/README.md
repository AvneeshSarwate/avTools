# feature-drawing-p5

The durable drawing entity end to end: a checked-in drawing document, a canvas
view of it on the tldraw page, a module that writes a circle into it from
code, and a p5 sketch that draws the whole thing in the engine tab from the
baked render data.

The checked-in `data/drawing/drawing-p5_shapes.json` holds one stroke and one
polygon. The writer adds (or moves) a circle with id `code-circle`; the sketch
reads `shapes.render()` every frame.

## Open it

This project is browser-engine only (`engineTarget: "browser"`): the sketch
needs the engine tab's DOM. From the projects index page, open it with
**engine in browser** — or start the server with `--engine remote`, open
`/engine/`, then the UI with this directory as `projectPath`. The writer
alone also runs engine-on-server; only the sketch needs the tab.

## Manual verification

1. Before running anything, the **drawing: drawing-p5_shapes** view shows the
   saved stroke and polygon. Select the stroke: the metadata editor shows
   `{"name": "saved-stroke"}` as raw JSON.
2. In **circle writer**, click the `✏️` just inside `drawing(`. It selects and
   zooms to the existing view rather than creating a second one.
3. Run **circle writer**. An orange circle appears in the view at the right of
   the saved shapes and the module finishes. The topbar reports the drawing as
   unsaved.
4. Run **p5 sketch**. A canvas appears in the ENGINE tab showing the polygon,
   the stroke, and the orange circle, scaled to 60%.
5. Draw a freehand stroke in the view (freehand tool). It appears in the p5
   canvas on the next frame. Drag the circle with the select tool: the p5
   circle follows.
6. Run **circle writer** again. The circle snaps back to its coded position;
   your strokes stay.
7. Click **Save project**, draw another stroke without saving, then reload the
   same URL. The saved circle and earlier stroke return; the later stroke
   disappears.

Manual saves intentionally modify the checked-in data file and its `savedAt`.
Restore the fixture directory with Git when finished.
