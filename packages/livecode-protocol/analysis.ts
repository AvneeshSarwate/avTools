/**
 * Analyzer wire types: source positions, diagnostics, the wait-callsite
 * manifest, and the `/runtime/analyze` request/response pair.
 */

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
  | "timeContextArgumentCall"
  | "pianoRollLookup"
  /** A `canvasParams(...)` declaration. Observed only; never instrumented. */
  | "canvasParams"
  /** An `animationTimeline(...)` declaration. Observed only; never instrumented. */
  | "animationTimeline"
  /** A `drawing(...)` declaration. Observed only; never instrumented. */
  | "canvasDrawing"
  /**
   * A `signal(...)` declaration. The whole call is wrapped so the runtime can
   * attribute the signal to its module.
   */
  | "canvasSignal";

export interface WaitCallsiteManifestEntry {
  id: string;
  moduleId: string;
  sourceUri: string;
  range: SourceRange;
  kind: WaitCallsiteKind;
  displayName: string;
  /**
   * For the name-carrying kinds (`pianoRollLookup`, `canvasParams`,
   * `animationTimeline`, `canvasSignal`): the source range of the name argument
   * expression, so the editor can place an inline widget beside the declaration.
   */
  nameArgRange?: SourceRange;
  /**
   * For the name-carrying kinds: the static name when the name argument is a
   * string literal (or a template literal without interpolation). A piano-roll
   * lookup uses it as a fallback before the module runs; declarations have no
   * runtime name resolution, so a non-literal name has no static name or widget.
   */
  staticName?: string;
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
  sourceText?: string;
  projectModuleId?: string;
  projectModulePath?: string;
}

export interface AnalyzeSuccess {
  type: "analyzeSuccess";
  moduleId: string;
  sourceVersion: number;
  generatedRunId: string;
  manifest: VisualizerManifestMessage;
  projectManifests?: VisualizerManifestMessage[];
  transformedModuleUri: string;
  transformedCode?: string;
  sourceHash?: string;
  projectSourceHash?: string;
  projectModulePath?: string;
  projectSourcePath?: string;
  projectRuntimePath?: string;
}

export interface AnalyzeFailure {
  type: "analyzeFailure";
  moduleId: string;
  sourceVersion: number;
  diagnostics: VisualizerDiagnostic[];
}

export type AnalyzeResponse = AnalyzeSuccess | AnalyzeFailure;
