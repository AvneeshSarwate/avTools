import type { TimeContext } from "@avtools/core-timing";
import p5 from "p5";
import { canvasParams } from "canvas-params";
import { canvasSurface } from "canvas-surface";

// A phrase is an async function. Choose the next one with if/else.
const params = canvasParams(
  "composition/phrases",
  { running: true, pattern: 0, phraseSec: 1.2, restSec: 0.3 },
  {
    running: { label: "running" },
    pattern: { label: "pattern (0 sweep, 1 zigzag, 2 spiral)", min: 0, max: 2, step: 1 },
    phraseSec: { label: "phrase length (s)", min: 0.3, max: 3, step: 0.1 },
    restSec: { label: "rest between (s)", min: 0, max: 1.5, step: 0.05 },
  },
);

const state = { x: 60, y: 150, phrase: "sweep" };

async function glide(c: TimeContext, x: number, y: number, seconds: number) {
  const fromX = state.x;
  const fromY = state.y;
  const start = c.time;
  while (c.time - start < seconds) {
    const t = (c.time - start) / seconds;
    state.x = fromX + (x - fromX) * t;
    state.y = fromY + (y - fromY) * t;
    await c.waitSec(1 / 60);
  }
  state.x = x;
  state.y = y;
}

async function sweep(c: TimeContext, seconds: number) {
  await glide(c, 420, 150, seconds / 2);
  await glide(c, 60, 150, seconds / 2);
}

async function zigzag(c: TimeContext, seconds: number) {
  await glide(c, 180, 70, seconds / 3);
  await glide(c, 360, 230, seconds / 3);
  await glide(c, 60, 150, seconds / 3);
}

async function spiral(c: TimeContext, seconds: number) {
  const start = c.time;
  while (c.time - start < seconds) {
    const t = (c.time - start) / seconds;
    state.x = 240 + Math.cos(t * Math.PI * 4) * 120 * (1 - t);
    state.y = 150 + Math.sin(t * Math.PI * 4) * 120 * (1 - t);
    await c.waitSec(1 / 60);
  }
  state.x = 240;
  state.y = 150;
}

async function play(c: TimeContext) {
  while (true) {
    const pattern = Math.round(params.pattern);
    state.phrase = ["sweep", "zigzag", "spiral"][pattern];
    if (pattern === 1) await zigzag(c, params.phraseSec);
    else if (pattern === 2) await spiral(c, params.phraseSec);
    else await sweep(c, params.phraseSec);
    await c.waitSec(params.restSec);
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
      p.text(`playing: ${state.phrase}`, 16, 30);
      p.fill("#78c8ff");
      p.circle(state.x, state.y, 28);
      p.noStroke();
      p.fill("#9ca8a2");
      p.text(params.running ? "" : "paused — turn running on to restart", 16, 286);
    };
  }, canvasSurface("composition/phrases").container);

  let scene: ReturnType<TimeContext["branch"]> | null = null;
  try {
    while (true) {
      if (params.running && !scene) {
        state.x = 60;
        state.y = 150;
        scene = ctx.branch(play, "phrases");
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
