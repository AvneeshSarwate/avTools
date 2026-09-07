import type { TimeContext } from "@avtools/core-timing";
import p5 from "p5";
import { canvasParams } from "canvas-params";
import { canvasSurface } from "canvas-surface";

// Keep a branch handle so you can fade out, cancel, and change behaviors.
const params = canvasParams(
  "composition/modes",
  { running: true, mode: 0, fadeSec: 0.6, speed: 1 },
  {
    running: { label: "running" },
    mode: { label: "mode (0 orbit, 1 wave, 2 rain)", min: 0, max: 2, step: 1 },
    fadeSec: { label: "transition (s)", min: 0, max: 2, step: 0.05 },
    speed: { label: "speed", min: 0.1, max: 3, step: 0.1 },
  },
);

const state = { x: 240, y: 150, alpha: 0, label: "orbit" };

async function orbit(c: TimeContext) {
  while (true) {
    state.x = 240 + Math.cos(c.progTime * params.speed) * 90;
    state.y = 150 + Math.sin(c.progTime * params.speed) * 90;
    await c.waitSec(1 / 60);
  }
}

async function wave(c: TimeContext) {
  while (true) {
    state.x = 240 + Math.sin(c.progTime * params.speed) * 180;
    state.y = 150 + Math.sin(c.progTime * params.speed * 2) * 70;
    await c.waitSec(1 / 60);
  }
}

async function rain(c: TimeContext) {
  while (true) {
    state.x = 240;
    state.y = 50 + (c.progTime * params.speed * 100) % 200;
    await c.waitSec(1 / 60);
  }
}

async function fadeTo(c: TimeContext, target: number) {
  const from = state.alpha;
  const seconds = params.fadeSec;
  const start = c.time;
  while (c.time - start < seconds) {
    state.alpha = from + (target - from) * (c.time - start) / seconds;
    await c.waitSec(1 / 60);
  }
  state.alpha = target;
}

async function play(c: TimeContext) {
  let mode = -1;
  let current: ReturnType<TimeContext["branch"]> | null = null;
  while (true) {
    const wanted = Math.round(params.mode);
    if (wanted !== mode) {
      if (current) {
        await fadeTo(c, 0);
        current.cancel();
      }
      mode = wanted;
      state.label = ["orbit", "wave", "rain"][mode];
      if (mode === 1) current = c.branch(wave, "wave");
      else if (mode === 2) current = c.branch(rain, "rain");
      else current = c.branch(orbit, "orbit");
      await fadeTo(c, 1);
    }
    await c.waitSec(1 / 60);
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
      p.text(`mode: ${state.label}`, 16, 30);
      p.fill(120, 200, 255, state.alpha * 255);
      p.circle(state.x, state.y, 32);
      p.noStroke();
      p.fill("#9ca8a2");
      p.text(params.running ? "" : "paused — turn running on to restart", 16, 286);
    };
  }, canvasSurface("composition/modes").container);

  let scene: ReturnType<TimeContext["branch"]> | null = null;
  try {
    while (true) {
      if (params.running && !scene) {
        state.x = 240;
        state.y = 150;
        state.alpha = 0;
        scene = ctx.branch(play, "modes");
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
