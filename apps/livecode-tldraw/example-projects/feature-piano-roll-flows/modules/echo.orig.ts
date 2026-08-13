import type { TimeContext } from "@avtools/core-timing";
import { setPianoRollClip } from "piano-roll-helpers";
import { getPianoRoll } from "piano-roll-store";

/**
 * Read-transform-write: copies `rolls/loop` up an octave (and softer) into
 * `rolls/loop-echo`, then ends naturally. Run seed first, or draw notes into
 * a loop view; re-run this after editing the loop to refresh the echo.
 */
export default async function (ctx: TimeContext) {
  const source = getPianoRoll("rolls/loop");
  if (!source || source.data.notes.length === 0) {
    console.log("[piano-roll-flows] rolls/loop is empty; run seed first");
    return;
  }
  const notes = source.data.notes.map((note, index) => ({
    id: `echo-${index}`,
    pitch: Math.min(127, note.pitch + 12),
    position: note.position,
    duration: note.duration,
    velocity: Math.max(1, Math.round((note.velocity ?? 100) * 0.8)),
  }));
  setPianoRollClip("rolls/loop-echo", { notes });
  console.log(
    `[piano-roll-flows] echoed ${notes.length} notes into rolls/loop-echo`,
  );
  await ctx.waitSec(0.1);
}
