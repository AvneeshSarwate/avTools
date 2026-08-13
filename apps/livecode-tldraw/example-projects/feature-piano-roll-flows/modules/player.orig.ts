import type { TimeContext } from "@avtools/core-timing";
import { playPianoRoll } from "piano-roll-helpers";
import { getPianoRoll } from "piano-roll-store";

/**
 * Infinite player: re-reads `rolls/loop` at every pass, so notes drawn into
 * any bound view are picked up at the next loop boundary. Plays through the
 * default MIDI output when one is available; without MIDI it still advances
 * logical time silently. Stop it with the Stop button; use Replace to swap in
 * edited source mid-run.
 */
export default async function (ctx: TimeContext) {
  while (true) {
    const roll = getPianoRoll("rolls/loop");
    if (!roll || roll.data.notes.length === 0) {
      await ctx.waitSec(0.5);
      continue;
    }
    await playPianoRoll(ctx, roll, { secondsPerBeat: 0.25, log: false });
  }
}
