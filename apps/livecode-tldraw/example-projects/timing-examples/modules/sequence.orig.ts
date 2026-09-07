import type { TimeContext } from "@avtools/core-timing";
import p5 from "p5";
import { canvasParams } from "canvas-params";
import { canvasSurface } from "canvas-surface";

// Move one step, wait, repeat. waitSec keeps the rhythm in logical time.
const params = canvasParams(
  "timing/sequence",
  { running: true, stepSec: 0.25 },
  {
    running: { label: "running" },
    stepSec: { label: "step (s)", min: 0.05, max: 1, step: 0.05 },
  },
);

const state = { step: 0, elapsed: 0 };

async function play(c: TimeContext) {
  const start = c.time;
  while (true) {
    state.elapsed = c.time - start;
    await c.waitSec(params.stepSec);
    state.step = (state.step + 1) % 8;
  }
}

// p5 reads state; all animation changes happen in the timing functions above.
let instance: p5 | null = null;

export function stop() {
  instance?.remove();
  instance = null;
}

export default async function run(ctx: TimeContext) {
  stop();
  instance = new p5((p: p5) => {
    p.setup = () => {
      p.pixelDensity(1);
      p.createCanvas(480, 300);
      p.textSize(14);
    };
    p.draw = () => {
      p.background("#12161f");
      p.noStroke();
      p.fill("#dce5df");
      p.text("One step after each waitSec", 16, 40);
      for (let i = 0; i < 8; i++) {
        p.fill(i === state.step ? "#78c8ff" : "#232a33");
        p.circle(44 + i * 56, 150, 36);
      }
      p.fill("#9ca8a2");
      p.text(`logical time: ${state.elapsed.toFixed(2)} s`, 16, 240);
      p.noStroke();
      p.fill("#9ca8a2");
      p.text(params.running ? "" : "paused — turn running on to restart", 16, 286);
    };
  }, canvasSurface("timing/sequence").container);

  let scene: ReturnType<TimeContext["branch"]> | null = null;
  try {
    while (true) {
      if (params.running && !scene) {
        state.step = 0;
        state.elapsed = 0;
        scene = ctx.branch(play, "sequence");
      } else if (!params.running && scene) {
        scene.cancel();
        scene = null;
      }
      await ctx.waitSec(1 / 60);
    }
  } finally {
    scene?.cancel();
    stop();
  }
}
