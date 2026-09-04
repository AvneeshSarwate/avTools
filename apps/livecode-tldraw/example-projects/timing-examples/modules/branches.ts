import { visualizedAwait as __tcvVisualizedAwait, visualizedPianoRollLookup as __tcvPianoRollLookup, visualizedOwnedSignal as __tcvOwnedSignal } from "/engine/runtime.js";
import type { TimeContext } from "@avtools/core-timing";
import { canvasParams } from "canvas-params";
import { canvasSurface } from "canvas-surface";

/**
 * 2. Fan-out with branchWait, join with Promise.all.
 *
 * Each cycle the parent spawns N children with staggered durations. Every
 * child is its own TimeContext: it animates a bar from `v.progTime` (time
 * since that child started) and finishes at its own logical deadline, in
 * deadline order regardless of spawn order. `branchWait` means the join is
 * structured: when `Promise.all` resolves and the parent yields with
 * `wait(0)`, the parent's own `ctx.time` has been advanced to the longest
 * child's end, so the next cycle starts exactly when the last bar finished.
 * (`branch` is the fire-and-forget sibling: it never moves the parent's
 * time.) Two children landing on the same deadline resolve in spawn order,
 * never by wall-clock arrival, which is what makes re-runs deterministic.
 *
 * The livecode analyzer only accepts awaits that involve the context inside
 * a timed scope (anything with a `TimeContext`-typed parameter), so the
 * `Promise.all` join lives in `joinAll(c, children)`: its context parameter
 * is typed structurally, keeping its body out of the timed scopes, while the
 * timed body's `await joinAll(c, …)` is a directly awaited helper receiving
 * the context, which the analyzer instruments as a wait.
 */
const WIDTH = 480;
const HEIGHT = 300;

const params = canvasParams(
  "timing/branches",
  { running: true, voices: 6, longestSec: 2 },
  {
    running: { label: "running" },
    voices: { label: "voices", min: 2, max: 10, step: 1 },
    longestSec: { label: "longest (s)", min: 0.5, max: 4, step: 0.1 },
  },
);

interface Bar {
  duration: number;
  progress: number;
  endedAt: number | null;
  order: number | null;
}

interface State {
  cycle: number;
  bars: Bar[];
  cycleStart: number;
  joinedAt: number | null;
  parentTimeAtJoin: number | null;
}

function freshState(): State {
  return {
    cycle: 0,
    bars: [],
    cycleStart: 0,
    joinedAt: null,
    parentTimeAtJoin: null,
  };
}

export async function runFunc (ctx: TimeContext) {
  const g = canvasSurface("timing/branches").createCanvas(WIDTH, HEIGHT)
    .getContext("2d")!;
  let state = freshState();
  let scene: ReturnType<TimeContext["branch"]> | null = null;

  const runScene = async (c: TimeContext) => {
    for (let cycle = 0;; cycle++) {
      const voices = Math.max(2, Math.round(params.voices));
      state.cycle = cycle;
      state.cycleStart = c.time;
      state.joinedAt = null;
      state.parentTimeAtJoin = null;
      state.bars = Array.from({ length: voices }, (_, i) => ({
        duration: params.longestSec * ((i + 1) / voices),
        progress: 0,
        endedAt: null,
        order: null,
      }));
      let finished = 0;

      const children = state.bars.map((bar, i) =>
        c.branchWait(async (v) => {
          while (v.progTime < bar.duration) {
            bar.progress = v.progTime / bar.duration;
            await v.waitSec(1 / 60);
          }
          bar.progress = 1;
          bar.endedAt = v.time;
          bar.order = finished++;
        }, `voice-${i}`)
      );

      await __tcvVisualizedAwait("timing/branches", "8e6bc8b8-52bd-4bf2-a0cc-d0403b3ae423", joinAll(c, children));
      state.joinedAt = c.time;
      state.parentTimeAtJoin = c.time;
      await __tcvVisualizedAwait("timing/branches", "ba991c70-5275-4cac-9c7a-618a2de59557", c.waitSec(0.8));
    }
  };

  while (true) {
    await __tcvVisualizedAwait("timing/branches", "a952b016-4042-49ae-b32d-87aefbeafc19", ctx.waitSec(1 / 60));
    if (params.running && !scene) {
      state = freshState();
      scene = ctx.branch(runScene, "branches-scene");
    } else if (!params.running && scene) {
      scene.cancel();
      scene = null;
    }
    draw(g, state, params.running);
  }
}

/** The one context method the join needs; see the note at the top. */
interface JoinPoint {
  wait(beats: number): Promise<void>;
}

/**
 * Join: wait for every child, then `wait(0)`, an engine-visible yield that
 * lets the parent's time adopt the branchWait results before continuing.
 */
async function joinAll(c: JoinPoint, children: Promise<unknown>[]) {
  await Promise.all(children);
  await c.wait(0);
}

function draw(g: CanvasRenderingContext2D, state: State, running: boolean) {
  g.fillStyle = "#12161f";
  g.fillRect(0, 0, WIDTH, HEIGHT);
  g.font = "13px ui-monospace, monospace";
  g.textBaseline = "top";
  g.fillStyle = "#dce5df";
  g.fillText(`cycle ${state.cycle}: ${state.bars.length} branchWait children`, 16, 14);

  const top = 40;
  const rowH = Math.min(26, (HEIGHT - top - 60) / Math.max(1, state.bars.length));
  const left = 96;
  const width = WIDTH - left - 24;
  state.bars.forEach((bar, i) => {
    const y = top + i * rowH;
    g.fillStyle = "#9ca8a2";
    g.fillText(`${bar.duration.toFixed(2)} s`, 16, y + 4);
    g.fillStyle = "#232a33";
    g.fillRect(left, y + 2, width, rowH - 6);
    g.fillStyle = bar.endedAt === null ? "#78c8ff" : "#4fd08a";
    g.fillRect(left, y + 2, width * bar.progress, rowH - 6);
    if (bar.order !== null) {
      g.fillStyle = "#12161f";
      g.fillText(`#${bar.order + 1} @ ${(bar.endedAt! - state.cycleStart).toFixed(2)}`,
        left + 6, y + 4);
    }
  });

  g.fillStyle = "#9ca8a2";
  const footer = HEIGHT - 44;
  if (!running) {
    g.fillText("paused (running = false)", 16, footer);
  } else if (state.joinedAt !== null) {
    g.fillStyle = "#4fd08a";
    g.fillText(
      `joined: parent time advanced to longest child (+${
        (state.parentTimeAtJoin! - state.cycleStart).toFixed(2)
      } s)`,
      16,
      footer,
    );
    g.fillStyle = "#9ca8a2";
    g.fillText("children finish in deadline order; ties resolve in spawn order", 16, footer + 18);
  } else {
    g.fillText("parent is awaiting Promise.all(children)…", 16, footer);
  }
}

export default runFunc;
