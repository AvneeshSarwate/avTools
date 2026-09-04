import type { TimeContext } from "@avtools/core-timing";
import { canvasParams } from "canvas-params";
import { canvasSurface } from "canvas-surface";

/**
 * 3. Momentary controls: a checkbox as a trigger, a branch per event.
 *
 * The pane has no buttons, but a boolean works as one: the scene loop polls
 * `fire` at 60 fps, and when it sees `true` it launches a `burst` branch and
 * writes `false` straight back into the params object. The engine samples
 * code writes every tick, so the pane's checkbox clears itself. Each burst
 * is its own timeline started with `branch` (fire and forget): tick the box
 * quickly and several bursts overlap, each expanding on its own clock.
 * `autoFireSec` fires one on a timer so the demo moves unattended; set it
 * to 0 to drive it by hand.
 */
const WIDTH = 480;
const HEIGHT = 300;

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

interface Burst {
  x: number;
  y: number;
  radius: number;
  alpha: number;
  hue: number;
}

interface State {
  bursts: Burst[];
  fired: number;
  manual: number;
}

function freshState(): State {
  return { bursts: [], fired: 0, manual: 0 };
}

/** One event's whole life, on its own timeline. */
async function burst(c: TimeContext, state: State, origin: { x: number; y: number }) {
  const b: Burst = {
    x: origin.x,
    y: origin.y,
    radius: 0,
    alpha: 1,
    hue: Math.floor(c.random() * 360),
  };
  state.bursts.push(b);
  state.fired += 1;
  const seconds = params.burstSec;
  const start = c.time;
  try {
    while (c.time - start < seconds) {
      const t = (c.time - start) / seconds;
      b.radius = 10 + 110 * (1 - (1 - t) * (1 - t));
      b.alpha = 1 - t;
      await c.waitSec(1 / 60);
    }
  } finally {
    // Runs on natural completion and on cancel (the running toggle), so a
    // cancelled burst never lingers in the list.
    state.bursts.splice(state.bursts.indexOf(b), 1);
  }
}

export default async function (ctx: TimeContext) {
  const g = canvasSurface("composition/triggers").createCanvas(WIDTH, HEIGHT)
    .getContext("2d")!;
  let state = freshState();
  let scene: ReturnType<TimeContext["branch"]> | null = null;

  const runScene = async (c: TimeContext) => {
    let lastAuto = c.time;
    for (;;) {
      await c.waitSec(1 / 60);
      if (params.fire) {
        params.fire = false; // consumed: the pane's checkbox clears itself
        state.manual += 1;
        const origin = { x: 60 + c.random() * (WIDTH - 120), y: 60 + c.random() * (HEIGHT - 120) };
        c.branch(async (b) => {
          await burst(b, state, origin);
        }, "burst");
      }
      if (params.autoFireSec > 0 && c.time - lastAuto >= params.autoFireSec) {
        lastAuto = c.time;
        const origin = { x: 60 + c.random() * (WIDTH - 120), y: 60 + c.random() * (HEIGHT - 120) };
        c.branch(async (b) => {
          await burst(b, state, origin);
        }, "auto-burst");
      }
    }
  };

  while (true) {
    await ctx.waitSec(1 / 60);
    if (params.running && !scene) {
      state = freshState();
      scene = ctx.branch(runScene, "triggers-scene");
    } else if (!params.running && scene) {
      scene.cancel();
      scene = null;
    }
    draw(g, state, params.running);
  }
}

function draw(g: CanvasRenderingContext2D, state: State, running: boolean) {
  g.fillStyle = "#12161f";
  g.fillRect(0, 0, WIDTH, HEIGHT);
  g.font = "13px ui-monospace, monospace";
  g.textBaseline = "top";

  for (const b of state.bursts) {
    g.strokeStyle = `hsla(${b.hue}, 80%, 65%, ${b.alpha})`;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
    g.stroke();
  }
  g.lineWidth = 1;

  g.fillStyle = "#dce5df";
  g.fillText(
    running
      ? `${state.bursts.length} live burst${state.bursts.length === 1 ? "" : "s"} · ${state.fired} fired (${state.manual} by hand)`
      : "paused (running = false)",
    16,
    14,
  );
  g.fillStyle = "#9ca8a2";
  g.fillText("tick `fire` in the pane: it launches a burst and unticks itself", 16, HEIGHT - 24);
}
