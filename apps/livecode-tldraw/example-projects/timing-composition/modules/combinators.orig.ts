import type { TimeContext } from "@avtools/core-timing";
import p5 from "p5";
import { canvasParams } from "canvas-params";
import { canvasSurface } from "canvas-surface";

// Build a score from functions: sequence, repeat, and parallel.
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
const state = { active: [false, false, false, false, false], cycles: 0 };
const labels = ["intro", "verse", "melody", "drums", "outro"];

function seq(...steps: Timed[]): Timed {
  return async (c: TimeContext) => {
    for (const step of steps) await step(c);
  };
}

function repeat(times: number, step: Timed): Timed {
  return async (c: TimeContext) => {
    for (let i = 0; i < times; i++) await step(c);
  };
}

function par(...voices: Timed[]): Timed {
  return async (c: TimeContext) => {
    await Promise.all(voices.map((voice) => c.branchWait(voice)));
  };
}

function section(index: number, seconds: number): Timed {
  return async (c: TimeContext) => {
    state.active[index] = true;
    try {
      await c.waitSec(seconds);
    } finally {
      state.active[index] = false;
    }
  };
}

async function play(c: TimeContext) {
  while (true) {
    const score = seq(
      section(0, 0.6),
      repeat(Math.round(params.repeats), section(1, params.verseSec)),
      par(section(2, params.melodySec), section(3, params.drumsSec)),
      section(4, 0.6),
    );
    await score(c);
    state.cycles += 1;
    await c.waitSec(0.5);
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
      p.text("intro → verses → melody + drums → outro", 16, 40);
      labels.forEach((label, i) => {
        p.fill(state.active[i] ? "#78c8ff" : "#232a33");
        p.rect(16 + i * 92, 100, 80, 80, 8);
        p.fill("#dce5df");
        p.text(label, 20 + i * 92, 210);
      });
      p.text(`completed: ${state.cycles}`, 16, 255);
      p.noStroke();
      p.fill("#9ca8a2");
      p.text(params.running ? "" : "paused — turn running on to restart", 16, 286);
    };
  }, canvasSurface("composition/combinators").container);

  let scene: ReturnType<TimeContext["branch"]> | null = null;
  try {
    while (true) {
      if (params.running && !scene) {
        state.active.fill(false);
        state.cycles = 0;
        scene = ctx.branch(play, "combinators");
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
