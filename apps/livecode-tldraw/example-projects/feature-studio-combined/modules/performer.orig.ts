import type { TimeContext } from "@avtools/core-timing";
import { canvasParams } from "canvas-params";
import { signal } from "canvas-signals";
import { playPianoRoll } from "piano-roll-helpers";
import { getPianoRoll } from "piano-roll-store";

/**
 * The combined loop: reads `studio/theme` at every pass (GUI note edits land
 * at the next pass), plays it through a branch, and drives an anchored
 * playhead signal plus the `monitor.level` graph field in lockstep. Tempo and
 * dynamics come from the `studio/mix` pane, captured once per pass.
 *
 * The checked-in `data/` files mean this pane and roll are populated before
 * this module has ever run; the declaration below reattaches to the saved
 * values instead of resetting them.
 */
const mix = canvasParams(
  "studio/mix",
  {
    tempo: { secondsPerBeat: 0.25 },
    dynamics: { velocity: 96, gate: 0.9 },
    monitor: { level: 0 },
  },
  {
    tempo: {
      secondsPerBeat: {
        label: "seconds per beat",
        min: 0.1,
        max: 1,
        step: 0.01,
      },
    },
    dynamics: {
      velocity: { label: "velocity", min: 1, max: 127, step: 1 },
      gate: { label: "gate", min: 0.1, max: 1, step: 0.01 },
    },
    monitor: {
      level: { label: "pass progress", min: 0, max: 1, graph: true },
    },
  },
);

// stop() runs before the run's branch is cancelled, so the loop checks this
// flag to keep a late write from racing past the hook's parked value.
let stopping = false;

export default async function (ctx: TimeContext) {
  stopping = false;
  const playhead = signal<number>("studio/playhead");
  playhead.addAnchor({ type: "pianoRoll", name: "studio/theme" });
  while (true) {
    const roll = getPianoRoll("studio/theme");
    if (!roll || roll.data.notes.length === 0) {
      playhead.set(0);
      await ctx.waitSec(0.5);
      continue;
    }
    const durationBeats = roll.data.notes.reduce(
      (end, note) => Math.max(end, note.position + note.duration),
      0,
    );
    const secondsPerBeat = mix.tempo.secondsPerBeat;
    ctx.branch(async (playCtx: TimeContext) => {
      await playPianoRoll(playCtx, roll, {
        secondsPerBeat,
        velocity: mix.dynamics.velocity,
        gate: mix.dynamics.gate,
        log: false,
      });
    });
    const stepBeats = 1 / 8;
    for (let beat = 0; beat < durationBeats; beat += stepBeats) {
      playhead.set(beat);
      if (!stopping) mix.monitor.level = beat / durationBeats;
      await ctx.waitSec(stepBeats * secondsPerBeat);
    }
  }
}

/** Graceful-stop hook: park the monitor at zero when the run ends. */
export function stop() {
  stopping = true;
  mix.monitor.level = 0;
  console.log("[studio] performer stop(): monitor cleared");
}
