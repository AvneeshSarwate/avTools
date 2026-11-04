// The soft contract a runner follows. Runners are templates to copy and
// customize per piece; keep this thin and let runner code be specific.
import type { TimeContext } from "@avtools/core-timing";
import type { Bank, RunnerEvent } from "../model/types";
import type { GhostNote, JsonObject, PianoRollNote } from "../pianoRoll/types";

export type TagFieldSpec =
  | { key: string; label: string; kind: "number"; default: number; min?: number; max?: number; step?: number }
  | { key: string; label: string; kind: "boolean"; default: boolean }
  | { key: string; label: string; kind: "string"; default: string }
  | { key: string; label: string; kind: "numberList"; default: number[] };

/** One annotation a runner understands, stored under `metadata[key]`. */
export interface TagSpec {
  key: string;
  label: string;
  /** Single character; pressed while the source roll has focus to toggle the tag on the selection. */
  hotkey?: string;
  color?: string;
  /** Short badge text; defaults to the label's first letters. */
  badge?: string;
  /** Empty fields means the tag is a boolean flag stored as `true`. */
  fields: TagFieldSpec[];
}

export interface ParamSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  /** Shown beside the slider. */
  hint?: string;
}

export type Params = Record<string, number>;

export interface LoopNotes {
  notes: PianoRollNote[];
  loopLength: number;
}

export interface PlayLoopOptions {
  /** Called at each note-on of the loop, after the note has been sent. */
  onNoteOn?: (note: PianoRollNote) => void;
  /** Color for the live overlay of played notes. */
  color?: string;
}

export interface RunnerApi {
  ctx: TimeContext;
  shapeId: string;
  getBank(): Bank;
  getParams(): Params;
  /** Seeded per run; use instead of Math.random. */
  random(): number;
  /** Play one loop of notes: note-ons at position/speed, durations/speed, returns at loopLength/speed. Speed and transpose come from the live params. */
  playLoop(loop: LoopNotes, options?: PlayLoopOptions): Promise<void>;
  /** Fire one note now (transpose applied), as a branch that survives the current loop. */
  playNote(pitch: number, velocity: number, durationBeats: number, color?: string): void;
  /** Show this loop in the instance's Generated roll. */
  publishLoop(loop: LoopNotes): void;
  emit(event: RunnerEvent): void;
  onEvent(handler: (event: RunnerEvent) => void): () => void;
  /** Last note this instance sent a note-on for, from any source. */
  lastPlayed(): PianoRollNote | null;
  log(message: string): void;
}

export interface RunnerDefinition {
  type: string;
  label: string;
  description: string;
  tags: TagSpec[];
  params: ParamSpec[];
  /** Pure: one loop from the bank. Used by Run every pass and by the Preview roll's regenerate. */
  generate(bank: Bank, random: () => number): LoopNotes;
  /** Static overlays on the source roll (for example variant alternatives). */
  sourceGhostNotes?(bank: Bank): GhostNote[];
  /** Fill for notes in the Generated and Preview rolls (for example a chosen variant). */
  generatedNoteColor?(note: PianoRollNote): string | undefined;
  /** Long-running: loop until the context is cancelled. */
  run(api: RunnerApi): Promise<void>;
}

export const BASE_PARAMS: ParamSpec[] = [
  { key: "transpose", label: "transpose", min: -24, max: 24, step: 1, default: 0, hint: "semitones, immediate" },
  { key: "speed", label: "speed", min: 0.25, max: 4, step: 0.05, default: 1, hint: "applies at next loop" },
];

export function defaultParams(def: RunnerDefinition): Params {
  return Object.fromEntries([...BASE_PARAMS, ...def.params].map((spec) => [spec.key, spec.default]));
}

export function tagValue(note: PianoRollNote, key: string): JsonObject | true | undefined {
  const value = note.metadata?.[key];
  if (value === true) return true;
  if (value && typeof value === "object" && !Array.isArray(value)) return value as JsonObject;
  return undefined;
}

export function tagDefaults(tag: TagSpec): JsonObject | true {
  if (tag.fields.length === 0) return true;
  return Object.fromEntries(tag.fields.map((field) => [field.key, structuredClone(field.default)]));
}

/** The notes that start inside the loop window, sorted by position. */
export function notesInLoop(notes: PianoRollNote[], loopLength: number): PianoRollNote[] {
  return notes.filter((note) => note.position < loopLength).sort((a, b) => a.position - b.position || a.pitch - b.pitch);
}

export function clampPitch(pitch: number): number {
  return Math.max(0, Math.min(127, Math.round(pitch)));
}
