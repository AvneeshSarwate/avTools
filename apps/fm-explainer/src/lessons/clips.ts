import type { Clip, ClipTuple } from "./types";

const C4 = 60;

/** One long note, for listening to a slider. */
export const held = (pitch = C4, beats = 4): Clip => ({ notes: [[pitch, 0, beats - 0.25, 100]], loop: beats, bpm: 60 });

/** The same note in four octaves: shows what depends on register. */
export const octaves: Clip = {
  notes: [36, 48, 60, 72].map((p, i): ClipTuple => [p, i * 2, 1.75, 100]),
  loop: 8,
  bpm: 90,
};

/** A phrase that climbs and falls across two octaves. */
export const phrase: Clip = {
  notes: [48, 55, 60, 64, 67, 72, 67, 60].map((p, i): ClipTuple => [p, i, 0.9, 100]),
  loop: 8,
  bpm: 110,
};

/** Repeated note with rising then falling velocity. */
export const velocityRamp = (pitch = C4): Clip => ({
  notes: [20, 40, 60, 80, 100, 127, 90, 50].map((v, i): ClipTuple => [pitch, i, 0.8, v]),
  loop: 8,
  bpm: 110,
});

/** Four sustained chords: inharmonic partials are easy to hear against harmony. */
export const chords: Clip = {
  notes: [
    [60, 64, 67],
    [57, 60, 64],
    [53, 57, 60],
    [55, 59, 62],
  ].flatMap((chord, i) => chord.map((p): ClipTuple => [p, i * 4, 3.8, 90])),
  loop: 16,
  bpm: 96,
};

export const bassLine: Clip = {
  notes: [
    [36, 0, 0.45, 115], [36, 0.75, 0.2, 80], [48, 1, 0.4, 100], [36, 1.5, 0.45, 110],
    [39, 2.5, 0.4, 100], [41, 3, 0.45, 115], [43, 3.5, 0.4, 90],
    [36, 4, 0.45, 115], [36, 4.75, 0.2, 80], [48, 5, 0.4, 100], [34, 5.5, 0.9, 110],
    [31, 7, 0.45, 105], [34, 7.5, 0.4, 95],
  ],
  loop: 8,
  bpm: 104,
};

/** Struck, well-separated notes with room to ring. */
export const struck: Clip = {
  notes: [[60, 0, 1.8, 110], [67, 2, 1.8, 90], [72, 4, 1.8, 105], [64, 6, 1.8, 80]],
  loop: 8,
  bpm: 84,
};

export const bellTune: Clip = {
  notes: [[67, 0, 3.5, 100], [72, 4, 3.5, 90], [64, 8, 3.5, 105], [60, 12, 3.8, 95]],
  loop: 16,
  bpm: 80,
};

export const melody: Clip = {
  notes: [
    [62, 0, 1.4, 96], [65, 1.5, 0.45, 80], [69, 2, 1.9, 104], [67, 4, 0.95, 88], [65, 5, 0.95, 84],
    [64, 6, 1.9, 96], [60, 8, 1.4, 90], [62, 9.5, 0.45, 80], [64, 10, 1.9, 100], [62, 12, 3.6, 92],
  ],
  loop: 16,
  bpm: 92,
};

export const epChords: Clip = {
  notes: [
    [48, 0, 1.9, 96], [64, 0, 1.9, 82], [67, 0, 1.9, 80], [71, 0, 1.9, 86],
    [72, 1.5, 0.45, 110],
    [45, 2, 1.9, 92], [60, 2, 1.9, 78], [64, 2, 1.9, 80], [67, 2, 1.9, 84],
    [41, 4, 1.9, 98], [60, 4, 1.9, 80], [64, 4, 1.9, 82], [69, 4, 1.9, 88],
    [76, 5, 0.9, 118],
    [43, 6, 1.9, 94], [59, 6, 1.9, 80], [62, 6, 1.9, 82], [65, 6, 1.9, 86],
  ],
  loop: 8,
  bpm: 80,
};

export const pluckArp: Clip = {
  notes: [52, 59, 64, 67, 71, 67, 64, 59, 50, 57, 62, 66, 69, 66, 62, 57].map(
    (p, i): ClipTuple => [p, i * 0.5, 0.45, i % 4 === 0 ? 118 : 84],
  ),
  loop: 8,
  bpm: 96,
};

export const hats: Clip = {
  notes: Array.from({ length: 16 }, (_, i): ClipTuple => [60, i * 0.25, 0.1, i % 4 === 2 ? 120 : i % 2 ? 60 : 90]),
  loop: 4,
  bpm: 110,
};

export const drums: Clip = {
  notes: [[48, 0, 0.4, 120], [55, 1, 0.4, 100], [48, 1.5, 0.4, 90], [60, 2, 0.4, 115], [55, 3, 0.4, 100], [52, 3.5, 0.4, 85]],
  loop: 4,
  bpm: 100,
};

export const brassLine: Clip = {
  notes: [
    [58, 0, 0.45, 110], [58, 0.5, 0.45, 96], [65, 1, 1.4, 120], [63, 2.5, 0.45, 100], [62, 3, 0.9, 108],
    [58, 4, 0.45, 110], [60, 4.5, 0.45, 100], [62, 5, 2.8, 124],
  ],
  loop: 8,
  bpm: 108,
};

export const padChords: Clip = {
  notes: [
    [50, 0, 7.6, 84], [57, 0, 7.6, 80], [62, 0, 7.6, 84], [65, 0, 7.6, 88],
    [48, 8, 7.6, 84], [55, 8, 7.6, 80], [60, 8, 7.6, 84], [64, 8, 7.6, 88],
  ],
  loop: 16,
  bpm: 84,
};
