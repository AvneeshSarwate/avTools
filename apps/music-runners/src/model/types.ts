import type { TLEditorSnapshot } from "tldraw";
import type { PianoRollNote, PianoRollScale } from "../pianoRoll/types";

/**
 * One instance's piano roll: its notes (with the runner's tag metadata), loop
 * length and scale. Every runner instance owns exactly one, stored by the
 * instance's shape id (src/store/clips.ts); duplicating or pasting an
 * instance copies it.
 */
export interface Clip {
  notes: PianoRollNote[];
  /** Beats. Notes past it stay in data; playback only covers [0, loopLength). */
  loopLength: number;
  /**
   * The clip's scale, in the shape `new Scale(degrees, root)` takes
   * (packages/music-types). Shades the rolls; runners may read it.
   */
  scale: PianoRollScale;
}

/** What one runner instance sends to the instances its arrows point at. */
export interface RunnerEvent {
  type: string;
  /** Sending instance's shape id, filled in by the bus. */
  from?: string;
  [key: string]: unknown;
}

export interface ProjectFile {
  name: string;
  bpm: number;
  /** Note labels: names or MIDI numbers. */
  pitchLabels: "name" | "midi";
  /** Each instance's clip, by shape id. */
  clips: Record<string, Clip>;
  canvas: TLEditorSnapshot | null;
  savedAt: number;
}

export const DEFAULT_LOOP_LENGTH = 16;
export const DEFAULT_BPM = 120;

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}
