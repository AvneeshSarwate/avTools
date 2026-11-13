import type { TimeContext } from "@avtools/core-timing";
import p5 from "p5";
import { canvasParams } from "canvas-params";
import { canvasSurface } from "canvas-surface";

// Start several bars together; the next cycle waits for all of them.
const params = canvasParams(
  "timing/branches",
  { running: true, voices: 6, longestSec: 2 },
  {
    running: { label: "running" },
    voices: { label: "voices", min: 2, max: 10, step: 1 },
    longestSec: { label: "longest (s)", min: 0.5, max: 4, step: 0.1 },
  },
);

type Bar = { progress: number; duration: number };
const state = { bars: [] as Bar[], joined: false };

async function fillBar(c: TimeContext, bar: Bar) {
  const start = c.time;
  const end = start + bar.duration;
  while (c.time < end) {
    bar.progress = (c.time - start) / bar.duration;
    await c.waitSec(Math.min(1 / 60, end - c.time));
  }
  bar.progress = 1;
}

async function play(c: TimeContext) {
  while (true) {
    state.joined = false;
    const count = Math.max(2, Math.round(params.voices));
    state.bars = Array.from({ length: count }, (_, i) => ({
      progress: 0, duration: params.longestSec * (i + 1) / count,
    }));
    const children = state.bars.map((bar) =>
      c.branchWait(async (voice) => { await fillBar(voice, bar); })
    );
    await Promise.all(children);
    state.joined = true;
    await c.waitSec(0.8);
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
      p.text(state.joined ? "All finished! Next cycle soon…" : "Waiting for every branch…", 16, 30);
      state.bars.forEach((bar, i) => {
        const y = 50 + i * 20;
        p.fill("#232a33");
        p.rect(100, y, 350, 14);
        p.fill(bar.progress === 1 ? "#4fd08a" : "#78c8ff");
        p.rect(100, y, 350 * bar.progress, 14);
        p.text(`${bar.duration.toFixed(1)} s`, 16, y + 13);
      });
      p.noStroke();
      p.fill("#9ca8a2");
      p.text(params.running ? "" : "paused — turn running on to restart", 16, 286);
    };
  }, canvasSurface("timing/branches").container);

  let scene: ReturnType<TimeContext["branch"]> | null = null;
  try {
    while (true) {
      if (params.running && !scene) {
        state.bars = [];
        state.joined = false;
        scene = ctx.branch(play, "branches");
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
