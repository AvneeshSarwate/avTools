import type { TimeContext } from "@avtools/core-timing";
import p5 from "p5";
import { canvasParams } from "canvas-params";
import { canvasSurface } from "canvas-surface";

// Beat waits follow tempo edits; a cloned voice keeps its starting tempo.
const params = canvasParams(
  "timing/tempo",
  { running: true, bpm: 120, rubato: false, rubatoDepth: 40 },
  {
    running: { label: "running" },
    bpm: { label: "bpm", min: 30, max: 240, step: 1 },
    rubato: { label: "rubato (rampBpmTo)" },
    rubatoDepth: { label: "rubato depth (bpm)", min: 0, max: 80, step: 1 },
  },
);

const state = { beats: [0, 0], bpm: 120, bornBpm: 120 };

async function pulse(c: TimeContext, index: number) {
  while (true) {
    state.beats[index] += 1;
    await c.wait(1); // Beats, not seconds.
  }
}

async function play(c: TimeContext) {
  c.setBpm(params.bpm);
  state.bornBpm = params.bpm;
  c.branch(async (v) => { await pulse(v, 0); }, "shared");
  c.branch(async (v) => { await pulse(v, 1); }, "cloned", { tempo: "cloned" });
  while (true) {
    if (params.rubato) {
      const target = params.bpm + params.rubatoDepth * Math.sin(c.time * Math.PI / 2);
      c.rampBpmTo(Math.max(10, target), 1 / 60);
    } else {
      c.setBpm(params.bpm);
    }
    state.bpm = c.bpm;
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
      state.beats.forEach((beat, i) => {
        const x = 120 + i * 240;
        p.fill(i === 0 ? "#78c8ff" : "#f2d38b");
        p.circle(x, 140, beat % 2 ? 100 : 60);
        p.text(`beat ${beat}`, x - 30, 230);
      });
      p.fill("#dce5df");
      p.text(`shared: ${state.bpm.toFixed(0)} bpm`, 35, 40);
      p.text(`cloned: ${state.bornBpm} bpm`, 275, 40);
      p.noStroke();
      p.fill("#9ca8a2");
      p.text(params.running ? "" : "paused — turn running on to restart", 16, 286);
    };
  }, canvasSurface("timing/tempo").container);

  let scene: ReturnType<TimeContext["branch"]> | null = null;
  try {
    while (true) {
      if (params.running && !scene) {
        state.beats = [0, 0];
        scene = ctx.branch(play, "tempo", { tempo: "cloned" });
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
