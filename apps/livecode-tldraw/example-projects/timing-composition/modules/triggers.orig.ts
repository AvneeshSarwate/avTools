import type { TimeContext } from "@avtools/core-timing";
import p5 from "p5";
import { canvasParams } from "canvas-params";
import { canvasSurface } from "canvas-surface";

// Consume the fire checkbox and start one independent burst per event.
const params = canvasParams(
  "composition/triggers",
  { running: true, fire: false, burstSec: 1.4, autoFireSec: 1.5 },
  {
    running: { label: "running" },
    fire: { label: "fire (momentary)" },
    burstSec: { label: "burst length (s)", min: 0.3, max: 4, step: 0.1 },
    autoFireSec: { label: "auto-fire every (s), 0 = off", min: 0, max: 5, step: 0.1 },
  },
);

type Ring = { x: number; y: number; size: number; alpha: number };
const state = { rings: [] as Ring[] };

async function burst(c: TimeContext) {
  const ring = { x: 80 + c.random() * 320, y: 80 + c.random() * 140, size: 20, alpha: 1 };
  state.rings.push(ring);
  const seconds = params.burstSec;
  const start = c.time;
  try {
    while (c.time - start < seconds) {
      const t = (c.time - start) / seconds;
      ring.size = 20 + 180 * t;
      ring.alpha = 1 - t;
      await c.waitSec(1 / 60);
    }
  } finally {
    state.rings = state.rings.filter((item) => item !== ring);
  }
}

async function play(c: TimeContext) {
  let lastAuto = c.time;
  while (true) {
    const auto = params.autoFireSec > 0 && c.time - lastAuto >= params.autoFireSec;
    if (params.fire || auto) {
      params.fire = false;
      if (auto) lastAuto = c.time;
      c.branch(burst, "burst");
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
      p.text("Tick fire to add a ring", 16, 30);
      p.noFill();
      p.strokeWeight(3);
      for (const ring of state.rings) {
        p.stroke(120, 200, 255, ring.alpha * 255);
        p.circle(ring.x, ring.y, ring.size);
      }
      p.noStroke();
      p.fill("#9ca8a2");
      p.text(params.running ? "" : "paused — turn running on to restart", 16, 286);
    };
  }, canvasSurface("composition/triggers").container);

  let scene: ReturnType<TimeContext["branch"]> | null = null;
  try {
    while (true) {
      if (params.running && !scene) {
        state.rings = [];
        scene = ctx.branch(play, "triggers");
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
