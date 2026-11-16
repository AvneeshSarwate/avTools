// The soft contract a runner follows. Runners are templates to copy and
// customize per piece; keep this thin and let runner code be specific.
import type { TimeContext } from "@avtools/core-timing";
import type { Clip, RunnerEvent } from "../model/types";
import type { GhostNote, JsonObject, PianoRollNote, PianoRollScale, PlayheadMarker } from "../pianoRoll/types";

export type TagFieldSpec =
  | { key: string; label: string; kind: "number"; default: number; min?: number; max?: number; step?: number }
  | { key: string; label: string; kind: "boolean"; default: boolean }
  | { key: string; label: string; kind: "string"; default: string; placeholder?: string }
  | { key: string; label: string; kind: "numberList"; default: number[]; placeholder?: string };

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

/** A number param: a draggable bar in the params row. */
export interface NumberParamSpec {
  kind?: "number";
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  /** Shown beside the slider. */
  hint?: string;
}

/**
 * A scale param: a root chooser and a degree list, the shape `new Scale(degrees,
 * root)` takes in packages/music-types (see PianoRollScale).
 */
export interface ScaleParamSpec {
  kind: "scale";
  key: string;
  label: string;
  default: PianoRollScale;
  hint?: string;
}

/** A text param: a text field, committed on Enter or blur when `validate` accepts it. */
export interface TextParamSpec {
  kind: "text";
  key: string;
  label: string;
  default: string;
  hint?: string;
  /** An error message for text that cannot be used (the field keeps the last good value), or null. */
  validate?(text: string): string | null;
}

export type ParamSpec = NumberParamSpec | ScaleParamSpec | TextParamSpec;
export type ParamValue = number | PianoRollScale | string;
export type Params = Record<string, ParamValue>;

/** A number param, or `fallback` when it is missing or not a number. */
export function numberParam(params: Params, key: string, fallback: number): number {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** A text param, or `fallback` when it is missing or not a string. */
export function textParam(params: Params, key: string, fallback: string): string {
  const value = params[key];
  return typeof value === "string" ? value : fallback;
}

/** A scale param, or undefined when it is missing or malformed. */
export function scaleParam(params: Params, key: string): PianoRollScale | undefined {
  const value = params[key] as Partial<PianoRollScale> | undefined;
  if (!value || typeof value !== "object" || typeof value.root !== "number" || !Array.isArray(value.degrees)) return undefined;
  return { root: value.root, degrees: value.degrees.filter((d): d is number => typeof d === "number") };
}

export interface LoopNotes {
  notes: PianoRollNote[];
  loopLength: number;
  /**
   * Where the loop sits on the roll's timeline, in beats (default 0): its
   * notes are at [start, start + loopLength) and the playhead runs from
   * start. A runner whose loop is not the clip (an arpeggio over one chord)
   * can put it under the material it came from.
   */
  start?: number;
}

export interface PlayLoopOptions {
  /** Called at each note-on of the loop, after the note has been sent. */
  onNoteOn?: (note: PianoRollNote) => void;
  /** Color for the live overlay of played notes. */
  color?: string;
}

/** Instance state beyond the clip and params that `generate` may read. */
export interface GenerateContext {
  /** The source roll's cursor, in beats. */
  cursor: number;
}

export interface RunnerApi {
  ctx: TimeContext;
  shapeId: string;
  /** The instance's own clip (notes, loop length, scale), read live. */
  getClip(): Clip;
  getParams(): Params;
  /** Seeded per run; use instead of Math.random. */
  random(): number;
  /** Play one loop of notes: note-ons at position/speed, durations/speed, returns at loopLength/speed. Speed and transpose come from the live params. */
  playLoop(loop: LoopNotes, options?: PlayLoopOptions): Promise<void>;
  /** Fire one note now (transpose applied), as a branch that survives the current loop. */
  playNote(pitch: number, velocity: number, durationBeats: number, color?: string): void;
  /** Show this loop in the instance's Generated roll; null: nothing is sounding (clears it and the playhead). */
  publishLoop(loop: LoopNotes | null): void;
  /** The source roll's cursor, in beats (runners with `usesCursor`). */
  getCursor(): number;
  /** Extra lines on the source roll while running (labelled cursors), replacing the previous set. */
  setMarkers(markers: PlayheadMarker[]): void;
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
  /**
   * Event types this runner sends with `api.emit`. Each connection arrow from
   * an instance carries one of them (its label is a chooser over this list).
   */
  emits?: string[];
  /**
   * The source roll's cursor (a click on the empty grid moves it) is part of
   * this runner's input: it is always drawn, saved with the instance, and
   * read with `api.getCursor()`.
   */
  usesCursor?: boolean;
  /** False: no playhead on the source roll (the Generated roll keeps one), for loops that are not the clip. */
  sourcePlayhead?: boolean;
  /**
   * Pure: one loop from the instance's clip, with the instance's params. Used by Run
   * every pass and by the Preview roll's regenerate.
   */
  generate(clip: Clip, random: () => number, params: Params, context: GenerateContext): LoopNotes;
  /** Static overlays on the source roll (for example variant alternatives), with the instance's params. */
  sourceGhostNotes?(clip: Clip, params: Params): GhostNote[];
  /** Fill for notes in the Generated and Preview rolls (for example a chosen variant). */
  generatedNoteColor?(note: PianoRollNote): string | undefined;
  /** Long-running: loop until the context is cancelled. */
  run(api: RunnerApi): Promise<void>;
}

/**
 * Each runner declares all of its params; nothing is shared between runners.
 * The playback helpers (playLoop, playNote, auditioning, recording) honour
 * params named `transpose` (semitones, applied immediately) and `speed`
 * (multiplier, applied at the next loop) when a runner defines them, and use
 * 0 and 1 otherwise. Copy these specs into a new runner to get them:
 *   { key: "transpose", label: "transpose", min: -24, max: 24, step: 1, default: 0, hint: "semitones, immediate" }
 *   { key: "speed", label: "speed", min: 0.25, max: 4, step: 0.05, default: 1, hint: "applies at next loop" }
 */
export function defaultParams(def: RunnerDefinition): Params {
  return Object.fromEntries(def.params.map((spec) => [spec.key, spec.default]));
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
