/**
 * Piano-roll entity wire types plus its HTTP request bodies and snapshot
 * envelope. These are the WIRE shapes the store and the clients exchange; the
 * bundled `<piano-roll-component>` has its own internal types.
 */

export type PianoRollUpdateSource =
  | "server"
  | "client"
  | "livecode"
  | "undoRedo";

export interface MpePitchPoint {
  time: number;
  pitchOffset: number;
  metadata?: Record<string, unknown>;
  rooted?: boolean;
}

export interface MpePitchData {
  points: MpePitchPoint[];
}

/**
 * One breakpoint of a per-note 0..127 expression curve (MPE pressure, or
 * timbre/CC74). `time` is 0..1 across the note, like `MpePitchPoint`.
 */
export interface MpeValuePoint {
  time: number;
  value: number;
  metadata?: Record<string, unknown>;
}

export interface MpeValueData {
  points: MpeValuePoint[];
}

export interface NoteDataInput {
  id?: string;
  pitch: number;
  position: number;
  duration: number;
  velocity?: number;
  mpePitch?: MpePitchData;
  mpePressure?: MpeValueData;
  mpeTimbre?: MpeValueData;
  metadata?: Record<string, unknown>;
}

export interface NoteData extends NoteDataInput {
  id: string;
  velocity: number;
}

export interface PianoRollData {
  /** Committed playback-start cursor in beats. Older documents default to zero. */
  playStartPosition?: number;
  notes: NoteDataInput[];
  viewport?: {
    scrollX: number;
    scrollY: number;
    zoomX: number;
    zoomY: number;
  };
  grid?: {
    subdivision?: number;
  };
}

export interface PianoRollObject {
  name: string;
  rev: number;
  data: PianoRollData;
  updatedAt: number;
  updatedBy: string;
  canUndo: boolean;
  canRedo: boolean;
  conflict?: boolean;
}

export type PianoRollSetResult =
  | { ok: true; roll: PianoRollObject }
  | { ok: false; error: string; current?: PianoRollObject };

export interface PianoRollSnapshot {
  type: "pianoRollSnapshot";
  seq: number;
  timestampMs: number;
  rolls: Record<string, PianoRollObject>;
}

export interface SetPianoRollRequest {
  name: string;
  data: PianoRollData;
  originId?: string;
  label?: string;
  source?: PianoRollUpdateSource;
  undoable?: boolean;
  expectedRev?: number;
}

export interface SetPianoRollCursorRequest {
  name: string;
  position: number;
  originId?: string;
}

export interface PianoRollHistoryRequest {
  name: string;
  originId?: string;
}
