import {
  awaitBarrier,
  resolveBarrier,
  startBarrier,
  type TimeContext,
} from "@avtools/core-timing";
import { canvasParams } from "canvas-params";
import { canvasSurface } from "canvas-surface";

/**
 * 4. Barrier sync between loops with different phrase lengths.
 *
 * Voice B plays a long phrase in a loop and brackets each cycle with
 * `startBarrier(key)` / `resolveBarrier(key)`. Voice A plays a shorter phrase
 * and then `awaitBarrier(key)`s: it is released when B's current cycle
 * resolves. So A's starts stay locked to B's cycle boundaries without either
 * voice knowing the other's length, and without any downbeat grid. Change the
 * lengths live: A always idles for exactly the remainder of B's cycle. A
 * barrier is scoped to the root context tree and a user key, so the key here
 * is namespaced to this example.
 */
const WIDTH = 480;
const HEIGHT = 300;
const KEY = "timing-examples/barrier";

const params = canvasParams(
  "timing/barrier",
  { running: true, aPhraseSec: 0.5, bPhraseSec: 0.8 },
  {
    running: { label: "running" },
    aPhraseSec: { label: "A phrase (s)", min: 0.1, max: 2, step: 0.05 },
    bPhraseSec: { label: "B phrase (s)", min: 0.1, max: 3, step: 0.05 },
  },
);

interface Voice {
  progress: number;
  cycles: number;
  waiting: boolean;
  lastStartAt: number | null;
}

interface State {
  a: Voice;
  b: Voice;
  syncs: number;
  lastSyncGap: number | null;
}

function freshState(): State {
  return {
    a: { progress: 0, cycles: 0, waiting: false, lastStartAt: null },
    b: { progress: 0, cycles: 0, waiting: false, lastStartAt: null },
    syncs: 0,
    lastSyncGap: null,
  };
}

export default async function (ctx: TimeContext) {
  const g = canvasSurface("timing/barrier").createCanvas(WIDTH, HEIGHT)
    .getContext("2d")!;
  let state = freshState();
  let scene: ReturnType<TimeContext["branch"]> | null = null;

  const phrase = async (v: TimeContext, voice: Voice, seconds: number) => {
    voice.lastStartAt = v.time;
    const start = v.time;
    while (v.time - start < seconds) {
      voice.progress = (v.time - start) / seconds;
      await v.waitSec(1 / 60);
    }
    voice.progress = 1;
    voice.cycles += 1;
  };

  const runScene = async (c: TimeContext) => {
    c.branch(async (b) => {
      while (true) {
        startBarrier(KEY, b);
        await phrase(b, state.b, params.bPhraseSec);
        resolveBarrier(KEY, b);
      }
    }, "voice-B");

    c.branch(async (a) => {
      while (true) {
        await phrase(a, state.a, params.aPhraseSec);
        state.a.waiting = true;
        await awaitBarrier(KEY, a);
        state.a.waiting = false;
        state.syncs += 1;
        // After release, A's next start coincides with B's next start.
        state.lastSyncGap = state.b.lastStartAt === null
          ? null
          : a.time - state.b.lastStartAt;
      }
    }, "voice-A");

    // The scene branch idles cancellably; the voices are its children.
    while (true) await c.waitSec(3600);
  };

  while (true) {
    await ctx.waitSec(1 / 60);
    if (params.running && !scene) {
      state = freshState();
      scene = ctx.branch(runScene, "barrier-scene");
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

  drawVoice(g, 30, `A: ${params.aPhraseSec.toFixed(2)} s phrase, then awaitBarrier`,
    state.a, "#78c8ff");
  drawVoice(g, 130, `B: ${params.bPhraseSec.toFixed(2)} s phrase, startBarrier … resolveBarrier`,
    state.b, "#f2d38b");

  g.fillStyle = "#9ca8a2";
  if (!running) {
    g.fillText("paused (running = false)", 16, HEIGHT - 60);
    return;
  }
  g.fillText(`A released by B ${state.syncs}× · A cycles ${state.a.cycles} · B cycles ${state.b.cycles}`,
    16, HEIGHT - 60);
  g.fillStyle = "#4fd08a";
  g.fillText(
    state.lastSyncGap === null
      ? "waiting for the first release…"
      : `A's start − B's start after release: ${(state.lastSyncGap * 1000).toFixed(1)} ms`,
    16,
    HEIGHT - 40,
  );
}

function drawVoice(
  g: CanvasRenderingContext2D,
  top: number,
  label: string,
  voice: Voice,
  color: string,
) {
  g.fillStyle = "#dce5df";
  g.fillText(label, 16, top);
  const left = 16;
  const width = WIDTH - 32;
  g.fillStyle = "#232a33";
  g.fillRect(left, top + 24, width, 34);
  if (voice.waiting) {
    // Hatched: this voice is parked on the barrier.
    g.strokeStyle = color;
    g.globalAlpha = 0.5;
    for (let x = left; x < left + width; x += 12) {
      g.beginPath();
      g.moveTo(x, top + 58);
      g.lineTo(x + 12, top + 24);
      g.stroke();
    }
    g.globalAlpha = 1;
    g.fillStyle = color;
    g.fillText("waiting on barrier", left + 8, top + 64);
  } else {
    g.fillStyle = color;
    g.fillRect(left, top + 24, width * voice.progress, 34);
    g.fillStyle = "#9ca8a2";
    g.fillText("playing phrase", left + 8, top + 64);
  }
}
