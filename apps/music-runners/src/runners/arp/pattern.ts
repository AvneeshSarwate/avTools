// Arpeggio patterns: Tidal/Strudel mini-notation (parsed by @strudel/mini)
// whose only atoms are chord indexes. `0` is the chord's lowest note, `1`
// the next; indexes wrap around the chord both ways (`-1` is the top note).
// Everything else in the mini-notation works: `[0 1] 2`, `<0 2>`, `0*2`,
// `0(3,8)`, `[0,2]`, `~` rests, `0@3`, `0?`, `0|2`, `{0 1 2}%4`.
// See https://strudel.cc/learn/mini-notation
import { getLeaves, mini, type StrudelPattern } from "@strudel/mini";
import type { PianoRollNote } from "../../pianoRoll/types";
import { clampPitch } from "../runnerTypes";

/** One arpeggio event within a cycle: times are fractions of the cycle. */
export interface ArpStep {
  begin: number;
  duration: number;
  index: number;
  /** The pattern text that made this event, as [from, to) character ranges (for highlighting). */
  locations: Array<[number, number]>;
}

export type ParsedArp = { ok: true; pattern: StrudelPattern } | { ok: false; error: string };

const INDEX_ATOM = /^-?\d+$/;
const REST_ATOMS = new Set(["~", "-"]);
const cache = new Map<string, ParsedArp>();

export function parseArpPattern(text: string): ParsedArp {
  const cached = cache.get(text);
  if (cached) return cached;
  const result = parseUncached(text);
  cache.set(text, result);
  return result;
}

function parseUncached(text: string): ParsedArp {
  if (!text.trim()) return { ok: false, error: "empty pattern" };
  if (text.includes('"')) return { ok: false, error: "quotes are not allowed" };
  try {
    const bad = getLeaves(`"${text}"`)
      .map((leaf) => leaf.source_)
      .filter((atom) => !INDEX_ATOM.test(atom) && !REST_ATOMS.has(atom));
    if (bad.length) return { ok: false, error: `only chord indexes (0 1 -1 …) and ~: ${bad.map((atom) => `"${atom}"`).join(" ")}` };
    return { ok: true, pattern: mini(text) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message.replace(/^\[mini\] /, "").split("\n")[0] };
  }
}

/** The error for a pattern text, or null when it parses (a param validator). */
export function arpPatternError(text: string): string | null {
  const parsed = parseArpPattern(text);
  return parsed.ok ? null : parsed.error;
}

/** The events that start in cycle `cycle` (0, 1, 2, …), in order. */
export function arpCycle(pattern: StrudelPattern, cycle: number): ArpStep[] {
  const steps: ArpStep[] = [];
  for (const hap of pattern.queryArc(cycle, cycle + 1)) {
    if (!hap.whole || !hap.hasOnset()) continue;
    const begin = hap.whole.begin.valueOf();
    // mini() parses `"text"`: its offsets count the opening quote
    const locations = (hap.context?.locations ?? []).map(({ start, end }): [number, number] => [start - 1, end - 1]);
    steps.push({ begin: begin - cycle, duration: hap.whole.end.valueOf() - begin, index: Number(hap.value), locations });
  }
  return steps.sort((a, b) => a.begin - b.begin || a.index - b.index);
}

/** The notes sounding at `position` (start inclusive, end exclusive), low to high. */
export function chordAt(notes: PianoRollNote[], position: number): PianoRollNote[] {
  return notes
    .filter((note) => note.position <= position && position < note.position + note.duration)
    .sort((a, b) => a.pitch - b.pitch);
}

/**
 * The chord note for an index, wrapping around the chord in both directions.
 * Each full wrap adds `wrapShift` semitones (negative indexes subtract), so
 * 0 wraps in place and 12 climbs by octaves.
 */
export function chordNote(chord: PianoRollNote[], index: number, wrapShift: number): { note: PianoRollNote; pitch: number } {
  const size = chord.length;
  const note = chord[((index % size) + size) % size];
  return { note, pitch: clampPitch(note.pitch + Math.floor(index / size) * wrapShift) };
}
