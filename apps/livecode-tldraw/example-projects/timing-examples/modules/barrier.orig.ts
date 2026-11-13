import { awaitBarrier, resolveBarrier, startBarrier, type TimeContext } from "@avtools/core-timing";
import p5 from "p5";
import { canvasParams } from "canvas-params";
import { canvasSurface } from "canvas-surface";

// A finishes its phrase, then waits for B to finish its current cycle.
const params = canvasParams(
  "timing/barrier",
  { running: true, aPhraseSec: 0.5, bPhraseSec: 0.8 },
  {
    running: { label: "running" },
    aPhraseSec: { label: "A phrase (s)", min: 0.1, max: 2, step: 0.05 },
    bPhraseSec: { label: "B phrase (s)", min: 0.1, max: 3, step: 0.05 },
  },
);

const KEY = "timing-examples/barrier";
const state = { a: 0, b: 0, waiting: false };

async function phrase(c: TimeContext, voice: "a" | "b", seconds: number) {
  const start = c.time;
  const end = start + seconds;
  while (c.time < end) {
    state[voice] = (c.time - start) / seconds;
    await c.waitSec(Math.min(1 / 60, end - c.time));
  }
  state[voice] = 1;
}

async function play(c: TimeContext) {
  c.branch(async (b) => {
    while (true) {
      startBarrier(KEY, b);
      await phrase(b, "b", params.bPhraseSec);
      resolveBarrier(KEY, b);
    }
  }, "B");
  while (true) {
    await phrase(c, "a", params.aPhraseSec);
    state.waiting = true;
    await awaitBarrier(KEY, c);
    state.waiting = false;
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
      p.fill("#78c8ff");
      p.text(state.waiting ? "A: waiting for B" : "A: playing", 16, 60);
      p.rect(16, 80, 448 * state.a, 30);
      p.fill("#f2d38b");
      p.text("B: starts and resolves the barrier", 16, 170);
      p.rect(16, 190, 448 * state.b, 30);
      p.noStroke();
      p.fill("#9ca8a2");
      p.text(params.running ? "" : "paused — turn running on to restart", 16, 286);
    };
  }, canvasSurface("timing/barrier").container);

  let scene: ReturnType<TimeContext["branch"]> | null = null;
  try {
    while (true) {
      if (params.running && !scene) {
        state.a = 0;
        state.b = 0;
        state.waiting = false;
        scene = ctx.branch(play, "barrier");
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
