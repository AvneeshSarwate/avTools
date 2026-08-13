import type { TimeContext } from "@avtools/core-timing";
import { signal } from "canvas-signals";

const LOOP_BEATS = 8;

/**
 * A second playhead against the SAME roll, walking backwards at half speed
 * and publishing the other accepted marker value shape: an object with a
 * numeric `position`. Run walker and strider together to see two labeled
 * markers on one melody.
 */
export default async function (ctx: TimeContext) {
  const playhead = signal<{ position: number }>("signals/strider", {
    anchor: { type: "pianoRoll", name: "signals/groove" },
  });
  const stepBeats = 1 / 4;
  let beat = 0;
  while (true) {
    playhead.set({ position: LOOP_BEATS - beat });
    beat = (beat + stepBeats) % LOOP_BEATS;
    await ctx.waitSec(stepBeats * 0.5);
  }
}
