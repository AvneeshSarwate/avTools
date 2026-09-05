import type { TimeContext } from "@avtools/core-timing";
import { canvasParams } from "canvas-params";
import { canvasSurface } from "canvas-surface";

/**
 * 1. Phrases are functions; a variable picks which one plays.
 *
 * A timed behavior is just an async function that takes the context it runs
 * on. `glide` and `hold` are the building blocks; `sweep`, `zigzag`, and
 * `spiral` are phrases composed from them; the scene loop is an `if/else`
 * on the pane's `pattern` that awaits one phrase, then the next. Change
 * `pattern` while a phrase plays: the current one finishes, and the next
 * cycle picks the new function. `phraseSec` is read when a phrase starts;
 * the readout shows which phrase and which sub-step is running.
 */
const WIDTH = 480;
const HEIGHT = 300;
const LEFT = 60;
const RIGHT = WIDTH - 60;
const MID = 150;
const PHRASES = ["sweep", "zigzag", "spiral"];

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

interface Dot {
  x: number;
  y: number;
}

interface State {
  dot: Dot;
  trail: Dot[];
  phrase: string;
  sub: string;
  history: string[];
  cycles: number;
}

function freshState(): State {
  return {
    dot: { x: LEFT, y: MID },
    trail: [],
    phrase: "",
    sub: "",
    history: [],
    cycles: 0,
  };
}

// --- building blocks -------------------------------------------------------

async function glide(c: TimeContext, state: State, to: Dot, seconds: number) {
  const from = { ...state.dot };
  const start = c.time;
  while (c.time - start < seconds) {
    const t = (c.time - start) / seconds;
    const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    state.dot = {
      x: from.x + (to.x - from.x) * eased,
      y: from.y + (to.y - from.y) * eased,
    };
    await c.waitSec(1 / 60);
  }
  state.dot = { ...to };
}

async function hold(c: TimeContext, state: State, seconds: number) {
  state.sub = `hold ${seconds.toFixed(2)} s`;
  await c.waitSec(seconds);
}

// --- phrases: compositions of building blocks -------------------------------

async function sweep(c: TimeContext, state: State) {
  const half = params.phraseSec / 2;
  state.sub = "glide right";
  await glide(c, state, { x: RIGHT, y: MID }, half);
  state.sub = "glide left";
  await glide(c, state, { x: LEFT, y: MID }, half);
}

async function zigzag(c: TimeContext, state: State) {
  const legs: Dot[] = [
    { x: LEFT + 100, y: MID - 70 },
    { x: LEFT + 200, y: MID + 70 },
    { x: LEFT + 300, y: MID - 70 },
    { x: LEFT, y: MID },
  ];
  for (let i = 0; i < legs.length; i++) {
    state.sub = `leg ${i + 1} of ${legs.length}`;
    await glide(c, state, legs[i], params.phraseSec / legs.length);
  }
}

async function spiral(c: TimeContext, state: State) {
  const seconds = params.phraseSec;
  const start = c.time;
  const center = { x: WIDTH / 2, y: MID };
  state.sub = "spiral in";
  while (c.time - start < seconds) {
    const t = (c.time - start) / seconds;
    const radius = 120 * (1 - t);
    const angle = t * Math.PI * 4;
    state.dot = {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    };
    await c.waitSec(1 / 60);
  }
  await hold(c, state, 0.2);
  state.sub = "return";
  await glide(c, state, { x: LEFT, y: MID }, 0.4);
}

export default async function (ctx: TimeContext) {
  const g = canvasSurface("composition/phrases").createCanvas(WIDTH, HEIGHT)
    .getContext("2d")!;
  let state = freshState();
  let scene: ReturnType<TimeContext["branch"]> | null = null;

  const runScene = async (c: TimeContext) => {
    for (;;) {
      const pattern = Math.round(params.pattern);
      state.phrase = PHRASES[pattern] ?? PHRASES[0];
      // The organizing move: a plain conditional chooses a function, and the
      // await hands it this timeline until it returns.
      if (pattern === 1) await zigzag(c, state);
      else if (pattern === 2) await spiral(c, state);
      else await sweep(c, state);
      state.history.unshift(state.phrase);
      state.history.splice(6);
      state.cycles += 1;
      await hold(c, state, params.restSec);
    }
  };

  while (true) {
    await ctx.waitSec(1 / 60);
    if (params.running && !scene) {
      state = freshState();
      scene = ctx.branch(runScene, "phrases-scene");
    } else if (!params.running && scene) {
      scene.cancel();
      scene = null;
    }
    state.trail.push({ ...state.dot });
    if (state.trail.length > 90) state.trail.shift();
    draw(g, state, params.running);
  }
}

function draw(g: CanvasRenderingContext2D, state: State, running: boolean) {
  g.fillStyle = "#12161f";
  g.fillRect(0, 0, WIDTH, HEIGHT);
  g.font = "13px ui-monospace, monospace";
  g.textBaseline = "top";

  state.trail.forEach((p, i) => {
    g.fillStyle = `rgba(120, 200, 255, ${(i / state.trail.length) * 0.6})`;
    g.beginPath();
    g.arc(p.x, p.y, 4, 0, Math.PI * 2);
    g.fill();
  });
  g.fillStyle = "#78c8ff";
  g.beginPath();
  g.arc(state.dot.x, state.dot.y, 12, 0, Math.PI * 2);
  g.fill();

  g.fillStyle = "#dce5df";
  g.fillText(
    running ? `phrase: ${state.phrase} · ${state.sub}` : "paused (running = false)",
    16,
    14,
  );
  g.fillStyle = "#9ca8a2";
  g.fillText(
    `played: ${state.history.length ? state.history.join(" ← ") : "…"}`,
    16,
    HEIGHT - 44,
  );
  g.fillText(`next pick reads pattern = ${Math.round(params.pattern)}`, 16, HEIGHT - 24);
}
