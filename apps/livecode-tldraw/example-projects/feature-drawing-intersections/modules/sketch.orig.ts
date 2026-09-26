import type { TimeContext } from "@avtools/core-timing";
import p5 from "p5";
import { drawing } from "canvas-drawing";
import { canvasSurface } from "canvas-surface";

/**
 * Draws only where shapes overlap. Every frame the sketch checks the drawing's
 * revision; when it changed (a committed edit, or one of the ~30/s previews
 * streamed while a shape is dragged), it rasterizes each polygon and circle
 * into a mask and paints every pixel covered by two or more shapes with the
 * average of their colors. A shape's color is `metadata.color`, an `[r, g, b]`
 * array 0-255, and white when missing. Strokes have no area and are ignored.
 */
const shapes = drawing("drawing-intersections_shapes");

// The canvas component's default stage is 1000x500; the sketch renders it at half size.
const STAGE_WIDTH = 1000;
const STAGE_HEIGHT = 500;
const SCALE = 0.5;
const WIDTH = STAGE_WIDTH * SCALE;
const HEIGHT = STAGE_HEIGHT * SCALE;

type Render = ReturnType<typeof shapes.render>;
type AreaShape = Render["polygon"][number] | Render["circle"][number];
type Rgb = [number, number, number];

const WHITE: Rgb = [255, 255, 255];

const colorOf = (shape: AreaShape): Rgb => {
  const color = shape.metadata?.color;
  return Array.isArray(color) && color.length === 3 &&
      color.every((channel) => typeof channel === "number")
    ? color as Rgb
    : WHITE;
};

// Fill one shape into a graphics buffer in stage coordinates.
const fillShape = (g: p5.Graphics, shape: AreaShape) => {
  g.push();
  g.scale(SCALE);
  g.noStroke();
  g.fill(255);
  if (shape.type === "circle") {
    g.translate(shape.center.x, shape.center.y);
    g.rotate(shape.rotation);
    g.ellipse(0, 0, shape.rx * 2, shape.ry * 2);
  } else if (shape.segments) {
    // p5 2.x: one bezierVertex call per control point and anchor, with the
    // segment's order set first.
    g.beginShape();
    g.vertex(shape.segments[0].from.x, shape.segments[0].from.y);
    for (const s of shape.segments) {
      if (s.type === "quadratic") {
        g.bezierOrder(2);
        g.bezierVertex(s.control.x, s.control.y);
      } else {
        g.bezierOrder(3);
        g.bezierVertex(s.control1.x, s.control1.y);
        g.bezierVertex(s.control2.x, s.control2.y);
      }
      g.bezierVertex(s.to.x, s.to.y);
    }
    g.endShape(g.CLOSE);
  } else {
    g.beginShape();
    for (const point of shape.points) g.vertex(point.x, point.y);
    g.endShape(g.CLOSE);
  }
  g.pop();
};

let instance: p5 | null = null;

export function stop() {
  instance?.remove();
  instance = null;
}

export default async function (ctx: TimeContext) {
  stop();
  const surface = canvasSurface("drawing-intersections/sketch");
  instance = new p5((sketch: p5) => {
    let mask: p5.Graphics;
    let overlaps: p5.Image;
    let renderedRev = -1;
    const pixelCount = WIDTH * HEIGHT;
    const coverage = new Uint8Array(pixelCount);
    const sum = new Float32Array(pixelCount * 3);

    const paintOverlaps = (render: Render) => {
      coverage.fill(0);
      sum.fill(0);
      for (const shape of [...render.polygon, ...render.circle]) {
        const [r, gr, b] = colorOf(shape);
        mask.clear();
        fillShape(mask, shape);
        mask.loadPixels();
        for (let i = 0; i < pixelCount; i++) {
          if (mask.pixels[i * 4 + 3] < 128) continue;
          coverage[i]++;
          sum[i * 3] += r;
          sum[i * 3 + 1] += gr;
          sum[i * 3 + 2] += b;
        }
      }
      overlaps.loadPixels();
      for (let i = 0; i < pixelCount; i++) {
        const n = coverage[i];
        const covered = n >= 2;
        overlaps.pixels[i * 4] = covered ? sum[i * 3] / n : 0;
        overlaps.pixels[i * 4 + 1] = covered ? sum[i * 3 + 1] / n : 0;
        overlaps.pixels[i * 4 + 2] = covered ? sum[i * 3 + 2] / n : 0;
        overlaps.pixels[i * 4 + 3] = covered ? 255 : 0;
      }
      overlaps.updatePixels();
    };

    sketch.setup = () => {
      sketch.pixelDensity(1);
      sketch.createCanvas(WIDTH, HEIGHT);
      mask = sketch.createGraphics(WIDTH, HEIGHT);
      mask.pixelDensity(1);
      overlaps = sketch.createImage(WIDTH, HEIGHT);
    };
    sketch.draw = () => {
      const rev = shapes.rev();
      if (rev !== renderedRev) {
        paintOverlaps(shapes.render());
        renderedRev = rev;
      }
      sketch.background(18, 22, 34);
      sketch.image(overlaps, 0, 0);
    };
  }, surface.container);
  try {
    // Idle cancellably forever; the p5 instance does the per-frame work.
    while (true) await ctx.waitSec(3600);
  } finally {
    stop();
  }
}
