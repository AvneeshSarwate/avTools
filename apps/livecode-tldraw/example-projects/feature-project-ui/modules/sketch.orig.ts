import type { TimeContext } from "@avtools/core-timing";
import p5 from "p5";
import { canvasParams } from "canvas-params";

/**
 * A ring of circles in the engine tab, driven entirely by one params entity.
 * The entity is what the project's own preset bank (ui/index.tsx) reads and
 * writes: the sketch knows nothing about presets, it only reads `look` every
 * frame, so a recalled preset shows up at the next draw.
 */
export const look = canvasParams("project-ui/look", {
  hue: 200,
  count: 12,
  size: 0.5,
  speed: 1,
  spin: true,
}, {
  hue: { min: 0, max: 360, step: 1 },
  count: { min: 1, max: 64, step: 1 },
  size: { min: 0.05, max: 1, step: 0.01 },
  speed: { min: 0, max: 4, step: 0.01 },
});

const WIDTH = 480;
const HEIGHT = 360;

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
    let angle = 0;
    sketch.setup = () => {
      sketch.createCanvas(WIDTH, HEIGHT);
      sketch.colorMode(sketch.HSB, 360, 100, 100);
    };
    sketch.draw = () => {
      sketch.background(220, 30, 10);
      sketch.noStroke();
      sketch.fill(look.hue, 70, 95);
      if (look.spin) angle += 0.01 * look.speed;
      const radius = Math.min(WIDTH, HEIGHT) * 0.35;
      const diameter = look.size * 60;
      for (let i = 0; i < look.count; i += 1) {
        const a = angle + (i / look.count) * Math.PI * 2;
        sketch.circle(
          WIDTH / 2 + Math.cos(a) * radius,
          HEIGHT / 2 + Math.sin(a) * radius,
          diameter,
        );
      }
    };
  }, stage);
  try {
    while (true) await ctx.waitSec(3600);
  } finally {
    stop();
  }
}
