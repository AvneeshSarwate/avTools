import type { TimeContext } from "@avtools/core-timing";
import p5 from "p5";
import { canvasParams } from "canvas-params";
import { canvasSurface } from "canvas-surface";

// Cancel a family of branches while the parent heartbeat keeps going.
const params = canvasParams(
  "timing/cancel",
  { running: true, lifetimeSec: 2, gapSec: 1 },
  {
    running: { label: "running" },
    lifetimeSec: { label: "family lifetime (s)", min: 0.5, max: 5, step: 0.1 },
    gapSec: { label: "gap before next (s)", min: 0.2, max: 3, step: 0.1 },
  },
);

const state = { heartbeat: 0, angles: [0, 0], visible: false, cleanups: 0 };

async function orbit(c: TimeContext, index: number) {
  while (true) {
    state.angles[index] += (index + 1) / 60;
    await c.waitSec(1 / 60);
  }
}

async function play(c: TimeContext) {
  c.branch(async (beat) => {
    while (true) {
      state.heartbeat += 1;
      await beat.waitSec(0.5);
    }
  }, "heartbeat");
  while (true) {
    state.visible = true;
    const family = c.branch(async (child) => {
      child.branch(async (a) => { await orbit(a, 0); }, "dot-A");
      child.branch(async (b) => { await orbit(b, 1); }, "dot-B");
      while (true) await child.waitSec(1);
    }, "family");
    family.handleCancel(() => {
      state.visible = false;
      state.cleanups += 1;
    });
    await c.waitSec(params.lifetimeSec);
    family.cancel(); // Cancels both orbit grandchildren too.
    await c.waitSec(params.gapSec);
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
      p.fill(state.heartbeat % 2 ? "#4fd08a" : "#236546");
      p.circle(30, 30, 18);
      p.fill("#dce5df");
      p.text(`parent heartbeat: ${state.heartbeat}`, 50, 35);
      if (state.visible) {
        state.angles.forEach((angle, i) => {
          p.fill(i === 0 ? "#78c8ff" : "#f2d38b");
          p.circle(240 + Math.cos(angle) * 80, 150 + Math.sin(angle) * 80, 20);
        });
      }
      p.fill("#9ca8a2");
      p.text(`family ${state.visible ? "playing" : "cancelled"} · cleanups: ${state.cleanups}`, 16, 255);
      p.noStroke();
      p.fill("#9ca8a2");
      p.text(params.running ? "" : "paused — turn running on to restart", 16, 286);
    };
  }, canvasSurface("timing/cancel").container);

  let scene: ReturnType<TimeContext["branch"]> | null = null;
  try {
    while (true) {
      if (params.running && !scene) {
        state.heartbeat = 0;
        state.angles = [0, 0];
        state.cleanups = 0;
        scene = ctx.branch(play, "cancel");
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
