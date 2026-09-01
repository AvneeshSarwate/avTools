import type { TimeContext } from "@avtools/core-timing";
import { getPianoRoll } from "piano-roll-store";
import { playPianoRollWithSixSines, stopSixSines } from "./six-sines.ts";

/**
 * Re-read the editable roll at each boundary and play it through Six Sines.
 * The imported project module owns the browser AudioContext and note identity.
 */
export default async function playSixSinesLoop(ctx: TimeContext) {
  try {
    while (true) {
      const roll = getPianoRoll("six-sines/loop");
      if (!roll || roll.data.notes.length === 0) {
        await ctx.waitSec(0.5);
        continue;
      }
      await playPianoRollWithSixSines(ctx, roll, {
        secondsPerBeat: 0.25,
        gate: 0.9,
      });
    }
  } finally {
    stopSixSines();
  }
}

/** The graceful Stop/Replace hook is deliberately idempotent with `finally`. */
export function stop() {
  stopSixSines();
}
