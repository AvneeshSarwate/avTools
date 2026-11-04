import type { TLEditorSnapshot } from "tldraw";
import type { PianoRollNote } from "../pianoRoll/types";

/** One piano roll's worth of data, tagged with the runner type whose metadata it carries. */
export interface Bank {
  id: string;
  name: string;
  runnerType: string;
  notes: PianoRollNote[];
  /** Beats. Notes past it stay in data; playback only covers [0, loopLength). */
  loopLength: number;
  createdAt: number;
  updatedAt: number;
}

/** What one runner instance sends to the instances its arrows point at. */
export interface RunnerEvent {
  type: string;
  /** Sending instance's shape id, filled in by the bus. */
  from?: string;
  [key: string]: unknown;
}

export interface ProjectFile {
  version: 1;
  name: string;
  bpm: number;
  banks: Bank[];
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
