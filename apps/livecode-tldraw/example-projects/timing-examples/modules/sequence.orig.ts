import type { TimeContext } from "@avtools/core-timing";
import { canvasParams } from "canvas-params";
import { canvasSurface } from "canvas-surface";

/**
 * 1. Drift-free sequential waits.
 *
 * `await ctx.waitSec(step)` sleeps until an absolute LOGICAL deadline, not
 * "for step ms". Each continuation lands exactly at start + n*step in logical
 * time, and wall-clock jitter never accumulates: if one wake-up is 4 ms late,
 * the next wait is 4 ms shorter. The lower row runs the same rhythm on a
 * chained `setTimeout`, the naive way, whose lateness compounds step after
 * step. The readout shows (wall elapsed − logical elapsed) for both.
 *
 * Every module in this gallery is independent (no imports between examples)
 * and owns a `running` toggle: a baked page auto-launches every module once
 * and cannot start or stop them afterwards, so start/stop is a parameter the
 * module's own loop honors. Turning `running` off cancels this example's
 * scene branch; turning it on starts a fresh one.
 */
const WIDTH = 480;
const HEIGHT = 300;
const STEPS = 8;
const HISTORY = 120;

const params = canvasParams(
  "timing/sequence",
  { running: true, stepSec: 0.25 },
  {
    running: { label: "running" },
    stepSec: { label: "step (s)", min: 0.05, max: 1, step: 0.05 },
  },
);

interface State {
  step: number;
  logicalElapsed: number;
  engineDriftMs: number;
  engineHistory: number[];
  naiveStep: number;
  naiveDriftMs: number;
  naiveHistory: number[];
}

function freshState(): State {
  return {
    step: -1,
    logicalElapsed: 0,
    engineDriftMs: 0,
    engineHistory: [],
    naiveStep: -1,
    naiveDriftMs: 0,
    naiveHistory: [],
  };
}

export default async function (ctx: TimeContext) {
  const g = canvasSurface("timing/sequence").createCanvas(WIDTH, HEIGHT)
    .getContext("2d")!;
  let state = freshState();
  let scene: ReturnType<TimeContext["branch"]> | null = null;

  const runScene = async (c: TimeContext) => {
    // A branch's block first runs at the tree's NEXT timeslice, so its
    // starting `c.time` can trail the root's processed time by one tick. A
    // `waitSec(0)` is the engine's sync point: it moves this context up to
    // the shared logical "now" without advancing it, so both baselines below
    // are taken at the same instant.
    await c.waitSec(0);
    const wallStart = performance.now();
    const logicalStart = c.time;

    // The naive comparison: a setTimeout chain that re-arms itself for
    // `step` ms after each callback, so every late wake-up shifts every
    // later step. Stopped by the branch's cancel hook below.
    const naiveStart = performance.now();
    let naiveTimer: number | null = null;
    let naiveCount = 0;
    const naiveTick = () => {
      naiveCount += 1;
      state.naiveStep = naiveCount % STEPS;
      const ideal = naiveCount * params.stepSec * 1000;
      state.naiveDriftMs = performance.now() - naiveStart - ideal;
      push(state.naiveHistory, state.naiveDriftMs);
      naiveTimer = setTimeout(naiveTick, params.stepSec * 1000);
    };
    naiveTimer = setTimeout(naiveTick, params.stepSec * 1000);

    try {
      for (let i = 0;; i++) {
        state.step = i % STEPS;
        state.logicalElapsed = c.time - logicalStart;
        state.engineDriftMs = performance.now() - wallStart -
          state.logicalElapsed * 1000;
        push(state.engineHistory, state.engineDriftMs);
        await c.waitSec(params.stepSec);
      }
    } finally {
      if (naiveTimer !== null) clearTimeout(naiveTimer);
    }
  };

  while (true) {
    await ctx.waitSec(1 / 60);
    if (params.running && !scene) {
      state = freshState();
      scene = ctx.branch(runScene, "sequence-scene");
    } else if (!params.running && scene) {
      scene.cancel();
      scene = null;
    }
    draw(g, state, params.running);
  }
}

function push(history: number[], value: number) {
  history.push(value);
  if (history.length > HISTORY) history.splice(0, history.length - HISTORY);
}

function draw(g: CanvasRenderingContext2D, state: State, running: boolean) {
  g.fillStyle = "#12161f";
  g.fillRect(0, 0, WIDTH, HEIGHT);
  g.font = "13px ui-monospace, monospace";
  g.textBaseline = "top";

  drawRow(g, 24, "waitSec: drift-free", state.step, state.engineDriftMs,
    state.engineHistory, "#78c8ff");
  drawRow(g, 150, "setTimeout chain: drift accumulates", state.naiveStep,
    state.naiveDriftMs, state.naiveHistory, "#ff9a6a");

  g.fillStyle = "#9ca8a2";
  g.fillText(
    running
      ? `logical elapsed ${state.logicalElapsed.toFixed(2)} s`
      : "paused (running = false)",
    16,
    HEIGHT - 22,
  );
}

function drawRow(
  g: CanvasRenderingContext2D,
  top: number,
  label: string,
  active: number,
  driftMs: number,
  history: number[],
  color: string,
) {
  g.fillStyle = "#dce5df";
  g.fillText(label, 16, top);
  const cell = 44;
  for (let i = 0; i < STEPS; i++) {
    g.fillStyle = i === active ? color : "#232a33";
    g.fillRect(16 + i * (cell + 6), top + 22, cell, 28);
  }
  g.fillStyle = "#9ca8a2";
  g.fillText(`wall − logical: ${driftMs >= 0 ? "+" : ""}${driftMs.toFixed(1)} ms`,
    16, top + 58);
  // Drift history sparkline: flat means no accumulation.
  const left = 16;
  const width = WIDTH - 32;
  const base = top + 100;
  g.strokeStyle = "#3a4450";
  g.beginPath();
  g.moveTo(left, base);
  g.lineTo(left + width, base);
  g.stroke();
  if (history.length > 1) {
    g.strokeStyle = color;
    g.beginPath();
    history.forEach((value, i) => {
      const x = left + (i / (HISTORY - 1)) * width;
      const y = base - Math.max(-18, Math.min(18, value / 4));
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.stroke();
  }
}
