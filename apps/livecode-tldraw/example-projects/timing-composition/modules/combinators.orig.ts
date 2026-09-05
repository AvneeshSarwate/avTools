import type { TimeContext } from "@avtools/core-timing";
import { canvasParams } from "canvas-params";
import { canvasSurface } from "canvas-surface";

/**
 * 4. Combinators: a score assembled from higher-order functions.
 *
 * Because a timed behavior is a function of its context, behaviors compose
 * like functions. `seq` runs behaviors one after another, `repeat` runs one
 * N times, and `par` runs several at once on branchWait children and joins
 * them. `section` makes a leaf behavior that draws itself onto the timeline.
 * The score is rebuilt each cycle from the pane's values, so `repeats` and
 * the section lengths reshape the structure live. Watch the join: `par`
 * ends when its longest voice ends, and the outro starts exactly then.
 */
const WIDTH = 480;
const HEIGHT = 300;
const LANES = 4;
const WINDOW_SEC = 12;

const params = canvasParams(
  "composition/combinators",
  { running: true, repeats: 2, verseSec: 0.8, melodySec: 1.6, drumsSec: 1.0 },
  {
    running: { label: "running" },
    repeats: { label: "verse repeats", min: 1, max: 5, step: 1 },
    verseSec: { label: "verse (s)", min: 0.2, max: 3, step: 0.1 },
    melodySec: { label: "melody (s)", min: 0.2, max: 4, step: 0.1 },
    drumsSec: { label: "drums (s)", min: 0.2, max: 4, step: 0.1 },
  },
);

type Timed = (c: TimeContext) => Promise<void>;

interface Block {
  name: string;
  color: string;
  lane: number;
  startAt: number;
  endAt: number | null;
}

interface State {
  blocks: Block[];
  laneBusy: boolean[];
  cycles: number;
  joinedAt: number | null;
}

function freshState(): State {
  return { blocks: [], laneBusy: Array(LANES).fill(false), cycles: 0, joinedAt: null };
}

/** The one context method the join needs, typed structurally so this helper
 * stays outside the analyzer's timed scopes (see timing-examples/branches). */
interface JoinPoint {
  wait(beats: number): Promise<void>;
}

async function joinAll(c: JoinPoint, children: Promise<unknown>[]) {
  await Promise.all(children);
  await c.wait(0);
}

// --- combinators ------------------------------------------------------------

function seq(...steps: Timed[]): Timed {
  return async (c: TimeContext) => {
    for (const step of steps) await step(c);
  };
}

function repeat(times: () => number, step: Timed): Timed {
  return async (c: TimeContext) => {
    const n = Math.max(1, Math.round(times()));
    for (let i = 0; i < n; i++) await step(c);
  };
}

function par(...voices: Timed[]): Timed {
  return async (c: TimeContext) => {
    await joinAll(c, voices.map((voice) => c.branchWait(voice)));
  };
}

// --- leaves -----------------------------------------------------------------

function section(state: State, name: string, seconds: () => number, color: string): Timed {
  return async (c: TimeContext) => {
    let lane = state.laneBusy.indexOf(false);
    if (lane < 0) lane = LANES - 1;
    state.laneBusy[lane] = true;
    const block: Block = { name, color, lane, startAt: c.time, endAt: null };
    state.blocks.push(block);
    await c.waitSec(seconds());
    block.endAt = c.time;
    state.laneBusy[lane] = false;
  };
}

export default async function (ctx: TimeContext) {
  const g = canvasSurface("composition/combinators").createCanvas(WIDTH, HEIGHT)
    .getContext("2d")!;
  let state = freshState();
  let scene: ReturnType<TimeContext["branch"]> | null = null;

  const runScene = async (c: TimeContext) => {
    for (;;) {
      const score = seq(
        section(state, "intro", () => 0.6, "#78c8ff"),
        repeat(() => params.repeats, section(state, "verse", () => params.verseSec, "#4fd08a")),
        par(
          section(state, "melody", () => params.melodySec, "#f2d38b"),
          section(state, "drums", () => params.drumsSec, "#ff9a6a"),
        ),
        section(state, "outro", () => 0.6, "#78c8ff"),
      );
      await score(c);
      state.cycles += 1;
      await c.waitSec(0.5);
    }
  };

  while (true) {
    await ctx.waitSec(1 / 60);
    if (params.running && !scene) {
      state = freshState();
      scene = ctx.branch(runScene, "combinators-scene");
    } else if (!params.running && scene) {
      scene.cancel();
      scene = null;
    }
    // Forget blocks that scrolled off the left edge.
    const cutoff = ctx.time - WINDOW_SEC;
    state.blocks = state.blocks.filter((b) => b.endAt === null || b.endAt > cutoff);
    draw(g, state, ctx.time, params.running);
  }
}

function draw(g: CanvasRenderingContext2D, state: State, now: number, running: boolean) {
  g.fillStyle = "#12161f";
  g.fillRect(0, 0, WIDTH, HEIGHT);
  g.font = "13px ui-monospace, monospace";
  g.textBaseline = "top";
  g.fillStyle = "#dce5df";
  g.fillText(
    `seq(intro, repeat(${Math.round(params.repeats)}, verse), par(melody, drums), outro)`,
    16,
    14,
  );

  const left = 16;
  const right = WIDTH - 16;
  const pxPerSec = (right - left) / WINDOW_SEC;
  const top = 50;
  const laneH = 40;
  for (const block of state.blocks) {
    const x0 = right - (now - block.startAt) * pxPerSec;
    const x1 = block.endAt === null ? right : right - (now - block.endAt) * pxPerSec;
    const y = top + block.lane * laneH;
    const x = Math.max(left, x0);
    const w = Math.max(2, x1 - x - 2); // a 2 px gap separates adjacent blocks
    g.fillStyle = block.color;
    g.globalAlpha = block.endAt === null ? 1 : 0.55;
    g.fillRect(x, y, w, laneH - 8);
    g.globalAlpha = 1;
    if (g.measureText(block.name).width + 8 <= w) {
      g.fillStyle = "#12161f";
      g.fillText(block.name, x + 4, y + 10);
    }
  }
  g.strokeStyle = "#dce5df";
  g.beginPath();
  g.moveTo(right, top - 6);
  g.lineTo(right, top + LANES * laneH);
  g.stroke();

  g.fillStyle = "#9ca8a2";
  g.fillText(
    running ? `cycles completed: ${state.cycles} · lanes = concurrent voices` : "paused (running = false)",
    16,
    HEIGHT - 24,
  );
}
