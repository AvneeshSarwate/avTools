import type { TimeContext } from "@avtools/core-timing";
import { setPianoRollClip } from "piano-roll-helpers";
import { getPianoRoll } from "piano-roll-store";

/**
 * Finite variation writer: reads `studio/theme` and writes a double-time,
 * octave-up variation into `studio/theme-var`, then ends naturally. This is
 * the in-medium variations gesture done from code; duplicate/delete from the
 * canvas topbar are the GUI half of the same idea.
 */
export default async function (ctx: TimeContext) {
  const theme = getPianoRoll("studio/theme");
  if (!theme || theme.data.notes.length === 0) {
    console.log("[studio] studio/theme has no notes; nothing to vary");
    return;
  }
  const notes = theme.data.notes.map((note, index) => ({
    id: `var-${index}`,
    pitch: Math.min(127, note.pitch + 12),
    position: note.position / 2,
    duration: Math.max(0.125, note.duration / 2),
    velocity: Math.max(1, Math.round((note.velocity ?? 100) * 0.85)),
  }));
  setPianoRollClip("studio/theme-var", { notes });
  console.log(`[studio] wrote ${notes.length} notes into studio/theme-var`);
  await ctx.waitSec(0.1);
}
