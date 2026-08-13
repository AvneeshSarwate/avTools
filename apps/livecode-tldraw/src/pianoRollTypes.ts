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

export interface PianoRollSnapshot {
  type: "pianoRollSnapshot";
  seq: number;
  timestampMs: number;
  rolls: Record<string, PianoRollObject>;
}

/** File format of a project's `data/pianoRoll/<encoded-name>.json`. */
export interface SavedPianoRollEntity {
  type: "pianoRoll";
  name: string;
  savedAt: string;
  data: PianoRollData;
}
