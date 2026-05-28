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
