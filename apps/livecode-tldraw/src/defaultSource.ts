export const DEFAULT_LIVECODE_SOURCE = `import type { TimeContext } from "@avtools/core-timing";
import { getPianoRollClip, playPianoRoll, setPianoRollClip } from "piano-roll-helpers";

const melodyName = "melody";

export default async function(ctx: TimeContext) {
  for (let i = 0; i < 4; i++) {
    const melody = getPianoRollClip(melodyName);
    const semitones = ctx.random() < 0.5 ? 5 : -5;
    const phrase = melody.transpose(semitones);

    setPianoRollClip(melodyName, phrase, { label: \`transpose \${semitones}\` });
    await playPianoRoll(ctx, phrase, { secondsPerBeat: 0.28 });
    await ctx.waitSec(0.12);
  }
}
`
