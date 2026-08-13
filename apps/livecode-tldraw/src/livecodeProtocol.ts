export interface SourceRange {
  from: number;
  to: number;
}

export interface VisualizerDiagnostic extends SourceRange {
  severity: "error";
  code: string;
  message: string;
}

export type WaitCallsiteKind =
  | "timeContextMethod"
  | "timeContextArgumentCall"
  | "pianoRollLookup";

export interface WaitCallsiteManifestEntry {
  id: string;
  moduleId: string;
  sourceUri: string;
  range: SourceRange;
  kind: WaitCallsiteKind;
  displayName: string;
  nameArgRange?: SourceRange;
  staticName?: string;
}

export interface VisualizerManifestMessage {
  type: "manifest";
  moduleId: string;
  sourceVersion: number;
  callsites: WaitCallsiteManifestEntry[];
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

export interface LaunchModuleRequest {
  moduleId: string;
  transformedModuleUri: string;
  generatedRunId: string;
  sourceHash?: string;
  projectSourceHash?: string;
  projectModulePath?: string;
  manifest?: VisualizerManifestMessage | null;
  replaceRunning?: boolean;
}

export type RuntimeModuleRunState =
  | "launching"
  | "running"
  | "stopped"
  | "error";

export interface RuntimeModuleRunSnapshotEntry {
  moduleId: string;
  generatedRunId: string;
  state: RuntimeModuleRunState;
  updatedAtMs: number;
  projectModulePath?: string;
  sourceHash?: string;
  projectSourceHash?: string;
  message?: string;
}

export interface ActiveWaitSnapshot {
  type: "activeWaitSnapshot";
  seq: number;
  timestampMs: number;
  modules: Record<string, string[]>;
  pianoRollLookups?: Record<string, Record<string, string>>;
  activeModules?: string[];
  moduleRuns?: Record<string, RuntimeModuleRunSnapshotEntry>;
}

export interface HealthResponse {
  ok: true;
  serverVersion: string;
  sessionRoot: string;
  activeModules: string[];
  runtimeCapabilities?: {
    webgpu: boolean;
    unsafeWindowSurface: boolean;
    windowedP5gpu: boolean;
    warnings: string[];
  };
}

export type ProjectModuleKind = "runnable";

export interface ProjectModuleRecord {
  id: string;
  path: string;
  sourcePath: string;
  runtimePath: string;
  kind: ProjectModuleKind;
  title: string;
  sourceVersion: number;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

export interface ProjectCanvasPianoRollView {
  id: string;
  rollName: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ProjectCanvasParamPaneView {
  id: string;
  paramsName: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ProjectCanvasState {
  pianoRollViews?: ProjectCanvasPianoRollView[];
  paramPaneViews?: ProjectCanvasParamPaneView[];
}

export interface LivecodeProjectManifest {
  version: 1;
  name: string;
  modules: ProjectModuleRecord[];
  canvas?: ProjectCanvasState;
}

export interface ProjectModuleInput {
  id?: string;
  path: string;
  kind?: ProjectModuleKind;
  title?: string;
  sourceText?: string;
  sourceVersion?: number;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

export interface ProjectModuleLocator {
  id?: string;
  path?: string;
}

export interface AddProjectModuleRequest extends ProjectModuleInput {}

export interface ProjectCurrentResponse {
  ok: true;
  project: {
    root: string;
    manifestPath: string;
    manifest: LivecodeProjectManifest;
  } | null;
}

export interface ProjectModuleSourceResponse {
  ok: true;
  module: ProjectModuleRecord;
  sourceText: string;
}

export interface RuntimeModuleStatus {
  moduleId: string;
  generatedRunId: string;
  transformedModuleUri: string;
  projectModulePath?: string;
  sourceHash?: string;
  projectSourceHash?: string;
}

export interface RuntimeStateResponse {
  ok: true;
  activeModules: Array<
    RuntimeModuleStatus & {
      manifest: VisualizerManifestMessage | null;
    }
  >;
  moduleRuns: Record<string, RuntimeModuleRunSnapshotEntry>;
  latestPreparedByModule: Record<string, {
    generatedRunId: string;
    sourceHash?: string;
    manifest: VisualizerManifestMessage;
  }>;
}

export interface ProjectModuleStatus extends ProjectModuleRecord {
  diskHash: string | null;
  editorHash: string | null;
  lastLoadedHash: string | null;
  runHash: string | null;
  dirty: boolean;
  changedOnDisk: boolean;
  conflict: boolean;
  running: boolean;
  runningStale: boolean;
  dependencies: string[];
  dependents: string[];
  changedDependencies: string[];
}

export interface ProjectStatusResponse {
  ok: true;
  project: ProjectCurrentResponse["project"];
  modules: ProjectModuleStatus[];
  activeModules: RuntimeModuleStatus[];
  projectSourceHash: string | null;
}

export interface ProjectDependencyEdge {
  fromModuleId: string;
  toModuleId?: string;
  specifier: string;
  kind: "static" | "dynamic";
  resolvedPath?: string;
  external?: boolean;
  unresolved?: boolean;
}

export interface ProjectShadowDiagnostic {
  source: "deno" | "visualizer";
  moduleId?: string;
  path?: string;
  code: string;
  message: string;
  line?: number;
  column?: number;
  from?: number;
  to?: number;
  raw: string;
}

export interface ProjectShadowModuleStatus {
  moduleId: string;
  path: string;
  dependencies: string[];
  dependents: string[];
  changedDependencies: string[];
  diagnostics: ProjectShadowDiagnostic[];
  dependencyDiagnostics: ProjectShadowDiagnostic[];
  hasDependencyWarnings: boolean;
}

export interface ProjectShadowCheckResponse {
  ok: true;
  project: ProjectCurrentResponse["project"];
  checkedAt: string;
  shadowRoot: string;
  projectSourceHash: string | null;
  edges: ProjectDependencyEdge[];
  modules: ProjectShadowModuleStatus[];
  diagnostics: ProjectShadowDiagnostic[];
  denoCheck: {
    success: boolean;
    code: number;
    output: string;
  };
}

export type ClientControlCommand =
  | { type: "getState" }
  | { type: "openProject"; projectPath: string; connect?: boolean }
  | ({ type: "runModule" } & ProjectModuleLocator)
  | ({ type: "stopModule" } & ProjectModuleLocator)
  | { type: "stopAllModules" }
  | ({ type: "setModuleSource"; sourceText: string } & ProjectModuleLocator)
  | { type: "addProjectModule"; module: AddProjectModuleRequest }
  | ({ type: "reloadProjectModule" } & ProjectModuleLocator);

export interface ClientControlEnvelope {
  type: "clientCommand";
  commandId: string;
  command: ClientControlCommand;
}

export interface ClientControlResultMessage {
  type: "clientCommandResult";
  commandId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface HistoryEntry {
  generatedRunId: string;
  sourceVersion: number;
  callsiteCount: number;
  transformedModuleUri: string;
}

export interface PreparedBuild extends AnalyzeSuccess {
  sourceText: string;
  serverBaseUrl: string;
}

export interface PreparedFailure extends AnalyzeFailure {
  sourceText: string;
  serverBaseUrl: string;
}
