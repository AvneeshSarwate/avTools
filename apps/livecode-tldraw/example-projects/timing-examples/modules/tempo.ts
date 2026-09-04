import { visualizedAwait as __tcvVisualizedAwait, visualizedPianoRollLookup as __tcvPianoRollLookup, visualizedOwnedSignal as __tcvOwnedSignal } from "/engine/runtime.js";
import type { TimeContext } from "@avtools/core-timing";
import { canvasParams } from "canvas-params";
import { canvasSurface } from "canvas-surface";

/**
 * 5. Beat-space waits under live tempo changes.
 *
 * `await v.wait(1)` sleeps one BEAT under a TempoMap, not a fixed number of
 * seconds: a wait already in flight is retimed when the tempo changes, so
 * dragging the `bpm` slider speeds the shared voice up or down immediately,
 * mid-beat. A branch created with `{ tempo: "cloned" }` gets its own copy of
 * the tempo map at spawn time, so the "cloned" voice keeps the tempo it was
 * born with while the shared voice follows the slider. With `rubato` on, a
 * 60 fps control branch chases a sine curve with `rampBpmTo(target, dt)`,
 * the smooth-tempo idiom: piecewise-linear ramps rather than a staircase of
 * `setBpm` steps, and beat waits still land exactly on the beat integral.
 *
 * The whole example runs inside its own cloned-tempo branch, so its tempo
 * edits never retime beat waits in other modules sharing the engine's root.
 */
const WIDTH = 480;
const HEIGHT = 300;

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

interface Voice {
  label: string;
  beats: number;
  lastBeatAt: number;
  bpmAtBeat: number;
}

interface State {
  shared: Voice;
  cloned: Voice;
  bpmNow: number;
  bornBpm: number;
}

function freshState(): State {
  return {
    shared: { label: "shared tempo (follows slider)", beats: 0, lastBeatAt: -1, bpmAtBeat: 0 },
    cloned: { label: "cloned tempo (frozen at spawn)", beats: 0, lastBeatAt: -1, bpmAtBeat: 0 },
    bpmNow: params.bpm,
    bornBpm: params.bpm,
  };
}

export async function runFunc (ctx: TimeContext) {
  const g = canvasSurface("timing/tempo").createCanvas(WIDTH, HEIGHT)
    .getContext("2d")!;
  let state = freshState();
  let scene: ReturnType<TimeContext["branch"]> | null = null;

  const pulse = async (v: TimeContext, voice: Voice) => {
    while (true) {
      voice.beats += 1;
      voice.lastBeatAt = v.time;
      voice.bpmAtBeat = v.bpm;
      await __tcvVisualizedAwait("timing/tempo", "a27363a1-27b1-4911-9b68-7db6faa75359", v.wait(1));
    }
  };

  const runScene = async (c: TimeContext) => {
    // This example's own tempo domain: a cloned map the slider edits.
    await __tcvVisualizedAwait("timing/tempo", "47d3c551-d66a-4815-bd39-b442821344b5", c.branchWait(async (domain) => {
      domain.setBpm(params.bpm);
      state.bornBpm = params.bpm;

      domain.branch(async (v) => {
        await __tcvVisualizedAwait("timing/tempo", "4f10130f-fea4-4341-9cd9-f33d2884c6ff", pulse(v, state.shared));
      }, "shared-voice");
      domain.branch(async (v) => {
        await __tcvVisualizedAwait("timing/tempo", "5968634c-3f86-4105-a5da-454d0f98ae81", pulse(v, state.cloned));
      }, "cloned-voice", { tempo: "cloned" });

      // Tempo control at 60 fps: follow the slider, or chase a rubato curve.
      let lastSliderBpm = params.bpm;
      const dt = 1 / 60;
      while (true) {
        await __tcvVisualizedAwait("timing/tempo", "102b4254-4a8c-42c8-8bae-739340e3cff4", domain.waitSec(dt));
        if (params.rubato) {
          const t = domain.time;
          const target = params.bpm +
            params.rubatoDepth * Math.sin((2 * Math.PI * t) / 4);
          domain.rampBpmTo(Math.max(10, target), dt);
        } else if (params.bpm !== lastSliderBpm) {
          domain.setBpm(params.bpm);
        }
        lastSliderBpm = params.bpm;
        state.bpmNow = domain.bpm;
      }
    }, "tempo-domain", { tempo: "cloned" }));
  };

  while (true) {
    await __tcvVisualizedAwait("timing/tempo", "28a55bf0-2df4-481f-a09b-59929c4e7c89", ctx.waitSec(1 / 60));
    if (params.running && !scene) {
      state = freshState();
      scene = ctx.branch(runScene, "tempo-scene");
    } else if (!params.running && scene) {
      scene.cancel();
      scene = null;
    }
    draw(g, state, ctx.time, params.running);
  }
}

function draw(
  g: CanvasRenderingContext2D,
  state: State,
  now: number,
  running: boolean,
) {
  g.fillStyle = "#12161f";
  g.fillRect(0, 0, WIDTH, HEIGHT);
  g.font = "13px ui-monospace, monospace";
  g.textBaseline = "top";
  g.fillStyle = "#dce5df";
  g.fillText(
    running
      ? `domain bpm ${state.bpmNow.toFixed(1)}${params.rubato ? " (rubato)" : ""}`
      : "paused (running = false)",
    16,
    14,
  );

  drawVoice(g, 120, state.shared, now, "#78c8ff");
  drawVoice(g, 360, state.cloned, now, "#f2d38b");
  g.fillStyle = "#9ca8a2";
  g.fillText(`cloned voice keeps ${state.bornBpm} bpm from spawn`, 16, HEIGHT - 24);
}

function drawVoice(
  g: CanvasRenderingContext2D,
  cx: number,
  voice: Voice,
  now: number,
  color: string,
) {
  const cy = 150;
  const since = voice.lastBeatAt < 0 ? 1 : now - voice.lastBeatAt;
  const radius = 26 + 34 * Math.max(0, 1 - since * 4);
  g.fillStyle = color;
  g.globalAlpha = 0.35 + 0.65 * Math.max(0, 1 - since * 4);
  g.beginPath();
  g.arc(cx, cy, radius, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;
  g.fillStyle = "#9ca8a2";
  g.textAlign = "center";
  g.fillText(voice.label, cx, cy + 70);
  g.fillText(`beat ${voice.beats} · ${voice.bpmAtBeat.toFixed(0)} bpm`, cx, cy + 90);
  g.textAlign = "left";
}

export default runFunc;
