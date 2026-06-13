export type DiagnosticSeverity = "error";

export interface SourceRange {
  from: number;
  to: number;
}

export interface VisualizerDiagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  from: number;
  to: number;
}

export type WaitCallsiteKind =
  | "timeContextMethod"
  | "timeContextArgumentCall";

export interface WaitCallsiteManifestEntry {
  id: string;
  moduleId: string;
  sourceUri: string;
  range: SourceRange;
  kind: WaitCallsiteKind;
  displayName: string;
}

export interface VisualizerManifestMessage {
  type: "manifest";
  moduleId: string;
  sourceVersion: number;
  callsites: WaitCallsiteManifestEntry[];
}

export interface AnalyzeRequest {
  moduleId: string;
  sourceVersion: number;
  sourceUri?: string;
  sourceText: string;
}

export interface AnalyzeSuccess {
  type: "analyzeSuccess";
  moduleId: string;
  sourceVersion: number;
  generatedRunId: string;
  manifest: VisualizerManifestMessage;
  transformedModuleUri: string;
  transformedCode?: string;
}

export interface AnalyzeFailure {
  type: "analyzeFailure";
  moduleId: string;
  sourceVersion: number;
  diagnostics: VisualizerDiagnostic[];
}

export type AnalyzeResponse = AnalyzeSuccess | AnalyzeFailure;

export interface LaunchModuleRequest {
  moduleId: string;
  transformedModuleUri: string;
  generatedRunId: string;
}

export interface StopModuleRequest {
  moduleId: string;
}

export interface ActiveWaitSnapshot {
  type: "activeWaitSnapshot";
  seq: number;
  timestampMs: number;
  modules: Record<string, string[]>;
}

export interface HealthResponse {
  ok: true;
  serverVersion: string;
  sessionRoot: string;
  activeModules: string[];
}

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
}

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
}

export interface PianoRollHistoryRequest {
  name: string;
  originId?: string;
}
