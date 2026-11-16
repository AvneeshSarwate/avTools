// Variant steps: alternatives written as moves from the note within a scale,
// so they follow the note when it is moved.
//
//   +1  -5  3      scale degrees up / down (no sign: up)
//   +2+  +2+2      degrees, then raw semitones (a bare sign is 1): +2+ is two
//   -1-  +0+       degrees and a semitone up, -1- a degree and a semitone down,
//                  +0+ the same degree a semitone up
//
// Resolution uses the Scale class from packages/music-types: the note's
// degree is Scale.getIndFromPitch rounded to the nearest degree (a note not
// in the scale counts from its nearest scale note), the target is
// Scale.getByIndex(degree + steps) plus the semitones.
// The class file directly rather than "@avtools/music-types": it resolves the
// same in Vite, tsc and Deno (steps.test.ts runs under Deno; Node/tsx treats
// that package folder as CommonJS and cannot see its exports)
import { Scale } from "../../../../../packages/music-types/scale.ts";
import type { PianoRollScale } from "../../pianoRoll/types";
import { clampPitch } from "../runnerTypes";

export interface VariantStep {
  /** The text as written ("+2+"), for labels. */
  text: string;
  degrees: number;
  semitones: number;
}

const STEP = /^([+-]?)(\d+)(?:([+-])(\d*))?$/;

/** Parse "+1 -5 +2+" (spaces or commas). Unreadable tokens come back in `invalid`. */
export function parseVariantSteps(text: string): { steps: VariantStep[]; invalid: string[] } {
  const steps: VariantStep[] = [];
  const invalid: string[] = [];
  for (const token of text.split(/[\s,]+/).filter(Boolean)) {
    const match = STEP.exec(token);
    if (!match) {
      invalid.push(token);
      continue;
    }
    const [, sign, count, semiSign, semiCount] = match;
    const degrees = (sign === "-" ? -1 : 1) * Number(count);
    const semitones = semiSign ? (semiSign === "-" ? -1 : 1) * (semiCount ? Number(semiCount) : 1) : 0;
    steps.push({ text: token, degrees, semitones });
  }
  return { steps, invalid };
}

const DEFAULT_SCALE: PianoRollScale = { root: 60, degrees: [0, 2, 4, 5, 7, 9, 11, 12] };

function toScale(scale: PianoRollScale | undefined): Scale {
  const s = scale ?? DEFAULT_SCALE;
  return new Scale([...s.degrees], s.root);
}

/** The note's degree in the scale: exact when in the scale, else the nearest scale note's. */
function degreeOf(scale: Scale, pitch: number): number {
  return Math.round(scale.getIndFromPitch(pitch));
}

/** The pitch a step lands on from `pitch` in `scale` (C major when undefined). */
export function resolveVariantStep(pitch: number, step: VariantStep, scale: PianoRollScale | undefined): number {
  const s = toScale(scale);
  return clampPitch(s.getByIndex(degreeOf(s, pitch) + step.degrees) + step.semitones);
}
