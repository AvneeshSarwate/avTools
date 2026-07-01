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
  | "pianoRollLookup";

export interface WaitCallsiteManifestEntry {
  id: string;
  moduleId: string;
  sourceUri: string;
  range: SourceRange;
  kind: WaitCallsiteKind;
  displayName: string;
  /**
   * For `pianoRollLookup` callsites: the source range of the roll-name
   * argument expression, so the editor can place an inline widget after it.
   */
  nameArgRange?: SourceRange;
  /**
   * For `pianoRollLookup` callsites: the static roll name when the name
   * argument is a string literal (or a template literal without
   * interpolation). Used as a fallback before the module runs.
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

export interface LaunchModuleRequest {
  moduleId: string;
  transformedModuleUri: string;
  generatedRunId: string;
  sourceHash?: string;
  projectSourceHash?: string;
  projectModulePath?: string;
  replaceRunning?: boolean;
}

export interface StopModuleRequest {
  moduleId: string;
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
  /**
   * Runtime-resolved piano-roll lookup names, keyed by moduleId then
   * callsiteId. Populated by instrumented `__tcvPianoRollLookup` wrappers
   * in generated modules. Absent/empty until a module runs.
   */
  pianoRollLookups?: Record<string, Record<string, string>>;
  /** Active module ids according to the server runtime. */
  activeModules?: string[];
  /**
   * Latest run lifecycle state by module id. This lets clients mark a module
   * stopped/error even when it has no active wait callsites at completion.
   */
  moduleRuns?: Record<string, RuntimeModuleRunSnapshotEntry>;
}

export interface HealthResponse {
  ok: true;
  serverVersion: string;
  sessionRoot: string;
  activeModules: string[];
  runtimeCapabilities: RuntimeCapabilityStatus;
}

export interface RuntimeCapabilityStatus {
  webgpu: boolean;
  unsafeWindowSurface: boolean;
  windowedP5gpu: boolean;
  warnings: string[];
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

export interface LivecodeProjectManifest {
  version: 1;
  name: string;
  modules: ProjectModuleRecord[];
  canvas?: Record<string, unknown>;
  pianoRollViews?: unknown[];
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

export interface CreateProjectRequest {
  projectPath?: string;
  name?: string;
  modules?: ProjectModuleInput[];
}

export interface OpenProjectRequest {
  projectPath: string;
}

export interface ProjectModuleLocator {
  id?: string;
  path?: string;
}

export interface AddProjectModuleRequest extends ProjectModuleInput {}

export interface UpdateProjectModuleRequest extends ProjectModuleInput {}

export interface WriteProjectModuleRequest extends ProjectModuleLocator {
  sourceText: string;
  sourceVersion?: number;
}

export interface ReloadProjectModuleRequest extends ProjectModuleLocator {}

export interface RemoveProjectModuleRequest extends ProjectModuleLocator {}

export interface ProjectCurrentResponse {
  ok: true;
  project: {
    root: string;
    manifestPath: string;
    manifest: LivecodeProjectManifest;
  } | null;
}

export interface RuntimeModuleStatus {
  moduleId: string;
  generatedRunId: string;
  transformedModuleUri: string;
  projectModulePath?: string;
  sourceHash?: string;
  projectSourceHash?: string;
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

export interface ProjectModuleSourceResponse {
  ok: true;
  module: ProjectModuleRecord;
  sourceText: string;
}

export interface ClientControlTarget {
  clientId?: string;
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

export interface ClientControlRequest extends ClientControlTarget {
  command: ClientControlCommand;
  timeoutMs?: number;
}

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

export interface ClientControlCommandResponse {
  ok: boolean;
  commandId: string;
  clientId: string;
  result?: unknown;
  error?: string;
}

export interface ClientControlClientsResponse {
  ok: true;
  clients: Array<{
    clientId: string;
    connectedAt: number;
  }>;
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
