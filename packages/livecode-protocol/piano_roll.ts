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

export interface NoteDataInput {
  id?: string;
  pitch: number;
  position: number;
  duration: number;
  velocity?: number;
  mpePitch?: MpePitchData;
  metadata?: Record<string, unknown>;
}

export interface NoteData extends NoteDataInput {
  id: string;
  velocity: number;
}

export interface PianoRollData {
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

export interface PianoRollHistoryRequest {
  name: string;
  originId?: string;
}
