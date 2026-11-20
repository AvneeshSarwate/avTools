// The "trill trigger" tag, shared by runners whose notes can set off trills
// in their arrow targets (variants, arp): a tagged note, each time it plays
// (or, in the arp, each time an arp note drawn from it plays), sends a trill
// event with the pitch that sounded, with the tag's probability.
import type { PianoRollNote } from "../pianoRoll/types";
import { type RunnerApi, type TagSpec, tagValue } from "./runnerTypes";

export const TRILL_TAG = "trill";
/**
 * The event sent when a trill trigger fires: `{ pitch, velocity, count? }`.
 * `count` is the number of trill notes requested (absent: the receiver's own
 * default).
 */
export const TRILL_EVENT = "trill";
export const TRILL_COLOR = "#6cd4ff";

export const trillTagSpec: TagSpec = {
  key: TRILL_TAG,
  label: "trill trigger",
  hotkey: "t",
  color: TRILL_COLOR,
  badge: "T",
  fields: [
    { key: "probability", label: "probability", kind: "number", default: 1, min: 0, max: 1, step: 0.05 },
    { key: "notes", label: "trill notes", kind: "numberList", default: [], placeholder: "8 or 3 4 5" },
  ],
};

interface TrillTag {
  /** Chance (0..1) that the trigger fires each time the note plays. */
  probability: number;
  /** Trill note counts to choose from uniformly; empty: the receiver's default. */
  notes: number[];
}

function readTrill(note: PianoRollNote): TrillTag | null {
  const value = tagValue(note, TRILL_TAG);
  if (!value || value === true) return null;
  const probability = typeof value.probability === "number" ? value.probability : 1;
  const notes = Array.isArray(value.notes)
    ? value.notes.filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n >= 1).map((n) => Math.round(n))
    : [];
  return { probability, notes };
}

/**
 * Fire `tagged`'s trill trigger (if it has one, with its probability) for a
 * note that sounded at `pitch`.
 */
export function fireTrill(api: RunnerApi, tagged: PianoRollNote, pitch: number, velocity: number): void {
  const trill = readTrill(tagged);
  if (!trill || api.random() >= trill.probability) return;
  const count = trill.notes.length > 0 ? trill.notes[Math.floor(api.random() * trill.notes.length)] : undefined;
  api.emit({ type: TRILL_EVENT, pitch, velocity, ...(count !== undefined ? { count } : {}) });
}
