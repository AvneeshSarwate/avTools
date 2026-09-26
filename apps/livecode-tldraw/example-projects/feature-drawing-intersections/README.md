# feature-drawing-intersections

The drawing entity's in-gesture stream, seen from code: a canvas view of a
checked-in drawing, and a p5 sketch that repaints on every revision of it,
including the ~30 revisions a second the view streams while a shape is being
dragged, transformed, or drawn. The sketch paints nothing but the overlaps:
every pixel covered by two or more polygons or circles gets the average of
their colors. A shape's color is `metadata.color`, an `[r, g, b]` array
0-255; a shape without one counts as white. Strokes have no area and are
ignored. An open polygon is filled as if closed.

The checked-in `data/drawing/drawing-intersections_shapes.json` holds a red
quad, a curved blue blob, an uncolored triangle, and green and yellow circles,
arranged so most of them overlap.

## Open it

The sketch draws into a `canvasSurface`, mirrored by the **canvas** view next
to the drawing view, which works when the engine runs in the UI's own tab:

```
http://localhost:5173/?serverBaseUrl=http://localhost:7777&projectPath=<abs path>&engine=inprocess
```

(server in `--engine remote` mode, `npm run dev` in `apps/livecode-tldraw`).
With a separate `/engine/` tab instead, the sketch's canvas appears in that
tab and the canvas view stays empty.

## Manual verification

1. Run **p5 sketch**. The canvas view fills with the overlap regions only:
   a three-way blend where the red quad, the blue blob, and the green circle
   meet, and a pale yellow where the yellow circle crosses the uncolored
   (white) triangle. Nothing is drawn where a single shape stands alone.
2. With the select tool, drag the green circle slowly across the quad. The
   overlap region moves with it *during* the drag, not on release, and the
   colors blend as soon as it enters or leaves another shape.
3. Select the triangle and, in the metadata editor, set
   `{"name": "uncolored-triangle", "color": [255, 0, 255]}`. The yellow
   crossing turns to the yellow/magenta average on the next revision.
4. Select the blue blob and move the select toolbar's **Curve** slider: the
   curved edge of every overlap it takes part in follows, since the sketch
   fills the baked Bézier `segments` rather than the vertices.
5. Draw a new closed polygon over the yellow circle with the polygon tool. The
   overlap appears as you place the points; the polygon's own color is white
   until you give it one in the metadata editor.
6. Undo the metadata edit and the polygon; the overlaps revert with them.

Manual saves modify the checked-in data file and its `savedAt`. Restore the
fixture directory with Git when finished.
