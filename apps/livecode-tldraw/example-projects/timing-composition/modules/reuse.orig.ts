import type { TimeContext } from "@avtools/core-timing";
import { canvasParams } from "canvas-params";
import { canvasSurface } from "canvas-surface";

/**
 * 2. One function, many voices, per-voice knobs.
 *
 * `bounce` is written once and takes its voice as an argument. Three
 * branches run it at the same time, each pointed at its own folder of the
 * params object: nested objects in `canvasParams` become folders in the
 * pane, so every voice gets its own `period` and `height` sliders. The
 * function re-reads its folder at the start of every half-bounce, which is
 * why a slider change takes effect at the next apex or floor rather than
 * tearing the motion mid-air.
 */
const WIDTH = 480;
const HEIGHT = 300;
const FLOOR = HEIGHT - 50;
const RANGE = 190;

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

interface VoiceKnobs {
  period: number;
  height: number;
}

interface Ball {
  label: string;
  x: number;
  y: number;
  color: string;
  bounces: number;
  /** The live folder this voice reads; never copied, so pane edits show. */
  knobs: () => VoiceKnobs;
}

interface State {
  balls: Ball[];
}

function freshState(): State {
  return {
    balls: [
      { label: "A", x: 100, y: FLOOR, color: "#78c8ff", bounces: 0, knobs: () => params.voices.a },
      { label: "B", x: 240, y: FLOOR, color: "#f2d38b", bounces: 0, knobs: () => params.voices.b },
      { label: "C", x: 380, y: FLOOR, color: "#ff9a6a", bounces: 0, knobs: () => params.voices.c },
    ],
  };
}

async function glideY(c: TimeContext, ball: Ball, to: number, seconds: number) {
  const from = ball.y;
  const start = c.time;
  while (c.time - start < seconds) {
    const t = (c.time - start) / seconds;
    // Ease out on the way up, ease in on the way down: a rough gravity feel.
    const eased = to < from ? 1 - (1 - t) * (1 - t) : t * t;
    ball.y = from + (to - from) * eased;
    await c.waitSec(1 / 60);
  }
  ball.y = to;
}

/** The reusable behavior: which voice it drives is an argument. */
async function bounce(c: TimeContext, ball: Ball) {
  for (;;) {
    const { period, height } = ball.knobs();
    await glideY(c, ball, FLOOR - RANGE * height, period / 2);
    await glideY(c, ball, FLOOR, period / 2);
    ball.bounces += 1;
  }
}

export default async function (ctx: TimeContext) {
  const g = canvasSurface("composition/reuse").createCanvas(WIDTH, HEIGHT)
    .getContext("2d")!;
  let state = freshState();
  let scene: ReturnType<TimeContext["branch"]> | null = null;

  const runScene = async (c: TimeContext) => {
    for (const ball of state.balls) {
      c.branch(async (v) => {
        await bounce(v, ball);
      }, `bounce-${ball.label}`);
    }
    while (true) await c.waitSec(3600);
  };

  while (true) {
    await ctx.waitSec(1 / 60);
    if (params.running && !scene) {
      state = freshState();
      scene = ctx.branch(runScene, "reuse-scene");
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
  g.strokeStyle = "#3a4450";
  g.beginPath();
  g.moveTo(16, FLOOR + 14);
  g.lineTo(WIDTH - 16, FLOOR + 14);
  g.stroke();

  for (const ball of state.balls) {
    const { period, height } = ball.knobs();
    g.fillStyle = ball.color;
    g.beginPath();
    g.arc(ball.x, ball.y, 14, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#9ca8a2";
    g.textAlign = "center";
    g.fillText(ball.label, ball.x, FLOOR + 22);
    g.fillText(`${period.toFixed(2)} s · h ${height.toFixed(2)}`, ball.x, FLOOR + 38);
    g.fillText(`${ball.bounces} bounces`, ball.x, 14);
    g.textAlign = "left";
  }
  if (!running) {
    g.fillStyle = "#9ca8a2";
    g.fillText("paused (running = false)", 16, 36);
  }
}
