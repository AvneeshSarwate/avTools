import type { TimeContext } from "@avtools/core-timing";
import p5 from "p5";
import { canvasParams } from "canvas-params";
import { canvasSurface } from "canvas-surface";

// Run the same bounce function for three balls with different controls.
const params = canvasParams(
  "composition/reuse",
  {
    running: true,
    voices: {
      a: { period: 1.0, height: 0.9 },
      b: { period: 1.6, height: 0.6 },
      c: { period: 0.7, height: 0.4 },
    },
  },
  {
    running: { label: "running" },
    voices: {
      a: {
        period: { label: "A period (s)", min: 0.2, max: 4, step: 0.05 },
        height: { label: "A height", min: 0.05, max: 1, step: 0.05 },
      },
      b: {
        period: { label: "B period (s)", min: 0.2, max: 4, step: 0.05 },
        height: { label: "B height", min: 0.05, max: 1, step: 0.05 },
      },
      c: {
        period: { label: "C period (s)", min: 0.2, max: 4, step: 0.05 },
        height: { label: "C height", min: 0.05, max: 1, step: 0.05 },
      },
    },
  },
);

const state = { heights: [0, 0, 0] };
const voices = ["a", "b", "c"] as const;

async function bounce(c: TimeContext, index: number) {
  while (true) {
    const knobs = params.voices[voices[index]];
    const period = knobs.period;
    const height = knobs.height;
    const start = c.time;
    while (c.time - start < period) {
      const t = (c.time - start) / period;
      state.heights[index] = Math.sin(t * Math.PI) * height * 190;
      await c.waitSec(1 / 60);
    }
    state.heights[index] = 0;
  }
}

async function play(c: TimeContext) {
  for (let i = 0; i < 3; i++) {
    c.branch(async (voice) => { await bounce(voice, i); }, `ball-${i}`);
  }
  while (true) await c.waitSec(1);
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
      state.heights.forEach((height, i) => {
        p.fill(["#78c8ff", "#f2d38b", "#ff9a6a"][i]);
        p.circle(100 + i * 140, 240 - height, 28);
        p.text(voices[i].toUpperCase(), 95 + i * 140, 270);
      });
      p.noStroke();
      p.fill("#9ca8a2");
      p.text(params.running ? "" : "paused — turn running on to restart", 16, 286);
    };
  }, canvasSurface("composition/reuse").container);

  let scene: ReturnType<TimeContext["branch"]> | null = null;
  try {
    while (true) {
      if (params.running && !scene) {
        state.heights = [0, 0, 0];
        scene = ctx.branch(play, "reuse");
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
