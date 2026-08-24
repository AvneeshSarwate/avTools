import type { TimeContext } from "@avtools/core-timing";
import { signal } from "canvas-signals";

const LOOP_BEATS = 8;

/**
 * Publishes a bare-number playhead position (quarter notes) to two rolls. Each
 * bound view renders the same labeled marker; stopping this module removes it
 * from both.
 */
export default async function (ctx: TimeContext) {
  const playhead = signal<number>("signals/walker");
  playhead.addAnchor({ type: "pianoRoll", name: "signals/groove" });
  playhead.addAnchor({ type: "pianoRoll", name: "signals/groove-mirror" });
  const stepBeats = 1 / 8;
  let beat = 0;
  while (true) {
    playhead.set(beat);
    beat = (beat + stepBeats) % LOOP_BEATS;
    await ctx.waitSec(stepBeats * 0.25);
  }
}
