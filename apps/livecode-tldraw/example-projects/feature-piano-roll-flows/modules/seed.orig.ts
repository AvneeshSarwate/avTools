import type { TimeContext } from "@avtools/core-timing";
import { setPianoRollClip } from "piano-roll-helpers";

/**
 * Finite writer: fills `rolls/loop` with a fixed four-beat phrase, then ends
 * naturally. `setPianoRollClip` creates the named roll when it does not exist
 * yet, and re-running with unchanged content is a rev-preserving no-op.
 */
export default async function (ctx: TimeContext) {
  setPianoRollClip("rolls/loop", {
    notes: [
      { id: "loop-1", pitch: 60, position: 0, duration: 0.5, velocity: 100 },
      { id: "loop-2", pitch: 63, position: 1, duration: 0.5, velocity: 96 },
      { id: "loop-3", pitch: 67, position: 2, duration: 0.5, velocity: 92 },
      { id: "loop-4", pitch: 70, position: 3, duration: 1, velocity: 104 },
    ],
  });
  console.log("[piano-roll-flows] seeded rolls/loop");
  await ctx.waitSec(0.1);
}
