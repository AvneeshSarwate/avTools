// Scale helpers for the roll: the default, the root-name chooser, parsing the
// degree text field, and the pitch-class sets the grid shades from.
import type { PianoRollScale } from './types'

/** C major: `new Scale([0, 2, 4, 5, 7, 9, 11, 12], 60)` in music-types. */
export const DEFAULT_SCALE: PianoRollScale = { root: 60, degrees: [0, 2, 4, 5, 7, 9, 11, 12] }

/** Root names with both spellings for the accidentals. */
export const ROOT_NAMES = ['C', 'C#/Db', 'D', 'D#/Eb', 'E', 'F', 'F#/Gb', 'G', 'G#/Ab', 'A', 'A#/Bb', 'B']

/** The root's octave stays where it was (C4 = 60 by default) when only its name changes. */
export function withRootPitchClass(scale: PianoRollScale, pitchClass: number): PianoRollScale {
  const octaveBase = scale.root - (((scale.root % 12) + 12) % 12)
  return { ...scale, root: octaveBase + pitchClass }
}

export function formatDegrees(degrees: number[]): string {
  return degrees.join(' ')
}

/**
 * Parse "0 2 4 5 7 9 11 12" (spaces or commas). Integers 0..24, sorted and
 * de-duplicated; must include 0 (the root). The octave (12) is appended when
 * every degree is below it, so "0 2 4 5 7 9 11" means ionian too. Returns null
 * when the text is not a scale.
 */
export function parseDegrees(text: string): number[] | null {
  const parts = text.split(/[\s,]+/).filter(Boolean)
  if (parts.length === 0) return null
  const values = parts.map(Number)
  if (!values.every((value) => Number.isInteger(value) && value >= 0 && value <= 24)) return null
  const degrees = [...new Set(values)].sort((a, b) => a - b)
  if (degrees[0] !== 0) return null
  if (degrees[degrees.length - 1] < 12) degrees.push(12)
  return degrees
}

/** Pitch classes (0..11) in the scale, and the root's. */
export function scalePitchClasses(scale: PianoRollScale): { inScale: Set<number>; root: number } {
  const root = ((scale.root % 12) + 12) % 12
  return { inScale: new Set(scale.degrees.map((degree) => (root + degree) % 12)), root }
}
