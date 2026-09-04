import type { TimeContext } from "@avtools/core-timing";
import p5 from "p5";
import { drawing } from "canvas-drawing";

/**
 * Code reading FROM a drawing. Every frame the sketch asks the handle for its
 * baked render data (world-space points, transforms already applied, cached per
 * revision) and draws it with p5 in the engine tab's `#livecode-stage`. Run the
 * writer to see its circle appear; draw in the canvas view on the tldraw page
 * to see strokes appear here on the next frame.
 */
const shapes = drawing("drawing-p5_shapes");

// The canvas component's default stage is 1000x500; scale it into a smaller p5 canvas.
const STAGE_WIDTH = 1000;
const STAGE_HEIGHT = 500;
const SCALE = 0.6;

let instance: p5 | null = null;

export function stop() {
  instance?.remove();
  instance = null;
}

export default async function (ctx: TimeContext) {
  stop();
  const stage = document.getElementById("livecode-stage");
  if (!stage) {
    throw new Error(
      "#livecode-stage not found — open this project with the engine in a browser tab",
    );
  }
  instance = new p5((sketch: p5) => {
    sketch.setup = () => {
      sketch.createCanvas(STAGE_WIDTH * SCALE, STAGE_HEIGHT * SCALE);
    };
    sketch.draw = () => {
      const render = shapes.render();
      sketch.background(18, 22, 34);
      sketch.scale(SCALE);

      // Polygons: filled outlines.
      sketch.stroke(120, 200, 255);
      sketch.strokeWeight(2);
      sketch.fill(120, 200, 255, 40);
      for (const polygon of render.polygon) {
        sketch.beginShape();
        for (const point of polygon.points) sketch.vertex(point.x, point.y);
        sketch.endShape(sketch.CLOSE);
      }

      // Circles: an ellipse per baked circle, colored from metadata when present.
      sketch.noStroke();
      for (const circle of render.circle) {
        const color = typeof circle.metadata?.color === "string"
          ? circle.metadata.color
          : "#8ad1a1";
        sketch.fill(color);
        sketch.push();
        sketch.translate(circle.center.x, circle.center.y);
        sketch.rotate(circle.rotation);
        sketch.ellipse(0, 0, circle.rx * 2, circle.ry * 2);
        sketch.pop();
      }

      // Strokes: polylines through the baked points (groups flatten recursively).
      sketch.noFill();
      sketch.stroke(240, 240, 240);
      sketch.strokeWeight(4);
      const drawStrokes = (
        children: typeof render.freehand[number]["children"],
      ) => {
        for (const child of children) {
          if (child.type === "strokeGroup") {
            drawStrokes(child.children);
            continue;
          }
          sketch.beginShape();
          for (const point of child.points) sketch.vertex(point.x, point.y);
          sketch.endShape();
        }
      };
      for (const group of render.freehand) drawStrokes(group.children);
    };
  }, stage);
  try {
    // Idle cancellably forever; the p5 instance does the per-frame work.
    while (true) await ctx.waitSec(3600);
  } finally {
    stop();
  }
}
