import type { TimeContext } from "@avtools/core-timing";
import { signal } from "canvas-signals";

const LOOP_BEATS = 8;

/**
 * Publishes a bare-number playhead position (quarter notes) anchored to the
 * `signals/groove` roll: every bound roll view renders one labeled marker per
 * live anchored signal. Declaring inside the root re-clears a previous run's
 * `ended` flag on relaunch; stopping this module ends the signal and removes
 * the marker.
 */
export default async function (ctx: TimeContext) {
  const playhead = signal<number>("signals/walker", {
    anchor: { type: "pianoRoll", name: "signals/groove" },
  });
  const stepBeats = 1 / 8;
  let beat = 0;
  while (true) {
    playhead.set(beat);
    beat = (beat + stepBeats) % LOOP_BEATS;
    await ctx.waitSec(stepBeats * 0.25);
  }
}
