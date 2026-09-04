import type { TimeContext } from "@avtools/core-timing";
import { canvasParams } from "canvas-params";
import { canvasSurface } from "canvas-surface";

/**
 * 5. Modes: swapping long-running behaviors with transitions.
 *
 * `orbit`, `wave`, and `rain` are behaviors that run forever. A manager loop
 * watches the pane's `mode`; when it changes, the manager awaits a
 * `fadeTo(0)` transition, cancels the current behavior through its branch
 * handle, starts the new one with an `if/else`, and awaits `fadeTo(1)`. The
 * handle is an ordinary value, so "the thing currently running" is a
 * variable the manager owns, and the transitions are just more timed
 * functions composed around it.
 */
const WIDTH = 480;
const HEIGHT = 300;
const MODES = ["orbit", "wave", "rain"];
const COUNT = 24;

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

interface Particle {
  x: number;
  y: number;
}

interface Scene {
  alpha: number;
  particles: Particle[];
  label: string;
  phase: string;
  switches: number;
}

function freshScene(): Scene {
  return { alpha: 0, particles: [], label: "", phase: "", switches: 0 };
}

// --- behaviors: each runs until cancelled -----------------------------------

async function orbit(c: TimeContext, scene: Scene) {
  const start = c.time;
  for (;;) {
    const t = (c.time - start) * params.speed;
    scene.particles = Array.from({ length: COUNT }, (_, i) => {
      const a = t + (i / COUNT) * Math.PI * 2;
      const r = 70 + 40 * Math.sin(t * 0.7 + i);
      return { x: WIDTH / 2 + Math.cos(a) * r, y: HEIGHT / 2 + Math.sin(a) * r };
    });
    await c.waitSec(1 / 60);
  }
}

async function wave(c: TimeContext, scene: Scene) {
  const start = c.time;
  for (;;) {
    const t = (c.time - start) * params.speed;
    scene.particles = Array.from({ length: COUNT }, (_, i) => ({
      x: 30 + (i / (COUNT - 1)) * (WIDTH - 60),
      y: HEIGHT / 2 + Math.sin(t * 2 + i * 0.5) * 70,
    }));
    await c.waitSec(1 / 60);
  }
}

async function rain(c: TimeContext, scene: Scene) {
  const drops = Array.from({ length: COUNT }, () => ({
    x: 20 + c.random() * (WIDTH - 40),
    y: c.random() * HEIGHT,
    v: 60 + c.random() * 140,
  }));
  let last = c.time;
  for (;;) {
    const dt = (c.time - last) * params.speed;
    last = c.time;
    for (const d of drops) {
      d.y += d.v * dt;
      if (d.y > HEIGHT) d.y -= HEIGHT;
    }
    scene.particles = drops.map((d) => ({ x: d.x, y: d.y }));
    await c.waitSec(1 / 60);
  }
}

// --- transition -------------------------------------------------------------

async function fadeTo(c: TimeContext, scene: Scene, target: number, seconds: number) {
  const from = scene.alpha;
  const start = c.time;
  while (c.time - start < seconds) {
    scene.alpha = from + (target - from) * ((c.time - start) / seconds);
    await c.waitSec(1 / 60);
  }
  scene.alpha = target;
}

export default async function (ctx: TimeContext) {
  const g = canvasSurface("composition/modes").createCanvas(WIDTH, HEIGHT)
    .getContext("2d")!;
  let scene = freshScene();
  let manager: ReturnType<TimeContext["branch"]> | null = null;

  const runManager = async (c: TimeContext) => {
    let mode = -1;
    let current: ReturnType<TimeContext["branch"]> | null = null;
    for (;;) {
      const wanted = Math.round(params.mode);
      if (wanted !== mode) {
        if (current) {
          scene.phase = `fading out ${MODES[mode]}`;
          await fadeTo(c, scene, 0, params.fadeSec);
          current.cancel();
        }
        mode = wanted;
        scene.label = MODES[mode] ?? MODES[0];
        scene.particles = [];
        if (mode === 1) {
          current = c.branch(async (b) => {
            await wave(b, scene);
          }, "wave");
        } else if (mode === 2) {
          current = c.branch(async (b) => {
            await rain(b, scene);
          }, "rain");
        } else {
          current = c.branch(async (b) => {
            await orbit(b, scene);
          }, "orbit");
        }
        scene.phase = `fading in ${scene.label}`;
        await fadeTo(c, scene, 1, params.fadeSec);
        scene.phase = "steady";
        scene.switches += 1;
      }
      await c.waitSec(1 / 30);
    }
  };

  while (true) {
    await ctx.waitSec(1 / 60);
    if (params.running && !manager) {
      scene = freshScene();
      manager = ctx.branch(runManager, "modes-manager");
    } else if (!params.running && manager) {
      manager.cancel();
      manager = null;
    }
    draw(g, scene, params.running);
  }
}

function draw(g: CanvasRenderingContext2D, scene: Scene, running: boolean) {
  g.fillStyle = "#12161f";
  g.fillRect(0, 0, WIDTH, HEIGHT);
  g.font = "13px ui-monospace, monospace";
  g.textBaseline = "top";

  g.fillStyle = `rgba(120, 200, 255, ${Math.max(0, Math.min(1, scene.alpha))})`;
  for (const p of scene.particles) {
    g.beginPath();
    g.arc(p.x, p.y, 6, 0, Math.PI * 2);
    g.fill();
  }

  g.fillStyle = "#dce5df";
  g.fillText(
    running ? `mode: ${scene.label} · ${scene.phase}` : "paused (running = false)",
    16,
    14,
  );
  g.fillStyle = "#9ca8a2";
  g.fillText(`switches: ${scene.switches} · fade ${params.fadeSec.toFixed(2)} s`, 16, HEIGHT - 24);
}
