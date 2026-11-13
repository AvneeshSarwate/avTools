import type { TimeContext } from "@avtools/core-timing";
import { getPianoRoll } from "piano-roll-store";
import { setPianoRollClip } from "piano-roll-helpers";

// Run again to choose a fresh third or fourth for each melody note.
export default async function harmonize(ctx: TimeContext) {
  const source = getPianoRoll("melody v2");
  if (!source) throw new Error("The source piano roll is missing");
  const scale = [0, 2, 4, 5, 7, 9, 11]; // C major
  const melody = source.data.notes.map((note, i) => ({
    ...note, id: `melody-${i}`,
  }));
  const harmony = source.data.notes.map((note, i) => {
    const degree = scale.indexOf(((note.pitch % 12) + 12) % 12);
    if (degree < 0) throw new Error("Source melody must use C-major notes");
    const steps = ctx.random() < 0.5 ? 2 : 3;
    const target = degree + steps;
    const pitch = 12 * (Math.floor(note.pitch / 12) + Math.floor(target / 7))
      + scale[target % 7];
    if (pitch > 127) throw new Error("Melody is too high to harmonize above MIDI 127");
    return { ...note, id: `harmony-${i}`, pitch };
  });
  setPianoRollClip("piano-lab/harmony", { notes: [...melody, ...harmony] });
}
