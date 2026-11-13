import type { TimeContext } from "@avtools/core-timing";
import { drawing, makeCircleNode, upsertDrawingNode } from "canvas-drawing";

/**
 * Code writing INTO a drawing. `drawing(name)` declares the entity (creating it
 * empty if the project had no saved data) and returns a handle; `update` reads
 * the current document, lets us edit it, and writes it back whole. The circle
 * is upserted by id, so re-running this module moves it rather than piling up
 * copies. Everything else in the drawing (the checked-in polygon and stroke,
 * and anything drawn in the canvas view) is left alone.
 */
export const shapes = drawing("drawing-p5_shapes");

export default async function (_ctx: TimeContext) {
  const result = shapes.update((doc) => {
    upsertDrawingNode(
      doc.circle,
      makeCircleNode({
        id: "code-circle",
        x: 640,
        y: 260,
        radius: 70,
        creationTime: 1,
        metadata: { name: "code-circle", color: "#ffb347" },
      }),
    );
  }, { originId: "drawing-p5/writer" });
  if (!result.ok) throw new Error(result.error);
  console.log(
    `[drawing-p5] placed code-circle in ${shapes.name} (rev ${result.drawing.rev})`,
  );
}
