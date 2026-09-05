import type { TimeContext } from "@avtools/core-timing";
import p5 from "p5";
import { canvasParams } from "canvas-params";
import { canvasSurface } from "canvas-surface";

/**
 * p5 in instance mode, parented to a named surface's container so
 * `createCanvas` lands inside it; the `canvas: canvas-surface/pulse` view
 * mirrors it. p5 owns its own frame loop; this module's TimeContext loop only
 * drives the pulse phase and honors the `running` toggle (the bake's
 * per-example start/stop, since a bake cannot relaunch modules).
 */
const WIDTH = 360;
const HEIGHT = 360;

const params = canvasParams(
  "canvas-surface/pulse",
  { running: true, bpm: 90 },
  {
    running: { label: "running" },
    bpm: { label: "pulse bpm", min: 20, max: 240, step: 1 },
  },
);

let instance: p5 | null = null;
let phase = 0;

export function stop() {
  instance?.remove();
  instance = null;
}

export default async function (ctx: TimeContext) {
  stop();
  const surface = canvasSurface("canvas-surface/pulse");
  instance = new p5((sketch: p5) => {
    sketch.setup = () => {
      sketch.createCanvas(WIDTH, HEIGHT);
    };
    sketch.draw = () => {
      sketch.background(20, 16, 28);
      sketch.noStroke();
      const beat = phase % 1;
      const size = 60 + (1 - beat) * 120;
      sketch.fill(255, 140 + beat * 100, 90);
      sketch.circle(WIDTH / 2, HEIGHT / 2, size);
    };
  }, surface.container);
  try {
    let last = ctx.time;
    while (true) {
      await ctx.waitSec(1 / 60);
      const now = ctx.time;
      const dt = now - last;
      last = now;
      if (!params.running) continue;
      phase += dt * (params.bpm / 60);
    }
  } finally {
    stop();
  }
}
