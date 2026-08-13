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
  /**
   * A `signal(...)` declaration. The whole call is wrapped so the runtime can
   * attribute the signal to its module; the editor renders no widget for it.
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
   * `canvasSignal`): the source range of the name argument expression, so the
   * editor can place an inline widget after it.
   */
  nameArgRange?: SourceRange;
  /**
   * For the name-carrying kinds: the static name when the name argument is a
   * string literal (or a template literal without interpolation). A piano-roll
   * lookup uses it as a fallback before the module runs; params and signal
   * declarations have no runtime name resolution, so a non-literal name simply
   * has no static name and no widget.
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
  manifest?: VisualizerManifestMessage | null;
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

/**
 * A signal-scope view. Unlike the two above it names a binding rather than an
 * entity: the source it watches may be ephemeral (a signal, which this project
 * never saves) or one leaf of a durable params entity. Only the binding is
 * persisted — never any of the samples the scope drew.
 */
export interface ProjectCanvasScopeView {
  id: string;
  sourceType: "signal" | "params";
  name: string;
  /** Dot-joined field path into the bound value; empty for whole values. */
  path: string;
  windowSec: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ProjectCanvasState {
  pianoRollViews?: ProjectCanvasPianoRollView[];
  paramPaneViews?: ProjectCanvasParamPaneView[];
  scopeViews?: ProjectCanvasScopeView[];
}

/**
 * One durable entity's saved JSON file. Deliberately top-level in the manifest
 * rather than inside `canvas`, which `/project/canvas` whole-replaces. `path`
 * is project-relative and ends in `.json`; the entry carries the true entity
 * name, so the filename never has to be decoded.
 */
export interface ProjectDataEntry {
  type: string;
  name: string;
  path: string;
}

export interface LivecodeProjectManifest {
  version: 1;
  name: string;
  modules: ProjectModuleRecord[];
  canvas?: ProjectCanvasState;
  data?: ProjectDataEntry[];
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

/**
 * Informational, warning-tier dirty state for one durable entity. `unsaved`
 * compares the store's cached latest JSON against what the last save/open
 * recorded; a saved-but-absent entity reports as an unsaved deletion. Nothing
 * ever auto-saves off the back of this.
 */
export interface ProjectDataEntityStatus {
  type: string;
  name: string;
  unsaved: boolean;
}

export interface ProjectStatusResponse {
  ok: true;
  project: ProjectCurrentResponse["project"];
  modules: ProjectModuleStatus[];
  activeModules: RuntimeModuleStatus[];
  projectSourceHash: string | null;
  data: ProjectDataEntityStatus[];
}

export interface ProjectSaveEntityResult {
  type: string;
  name: string;
  path: string;
  ok: boolean;
  error?: string;
}

/** An entity save deliberately skipped, with the reason for the operator. */
export interface ProjectSaveSkippedEntity {
  type: string;
  name: string;
  reason: string;
}

export interface ProjectSaveResponse extends ProjectCurrentResponse {
  data: ProjectSaveEntityResult[];
  skipped: ProjectSaveSkippedEntity[];
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
  conflict?: boolean;
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
  expectedRev?: number;
}

export interface PianoRollHistoryRequest {
  name: string;
  originId?: string;
}

export type ParamsPrimitive = number | string | boolean;

/**
 * JSON-simple parameter values: finite numbers, strings, booleans and nested
 * plain objects. Arrays are rejected at registration in v1 (tweakpane has no
 * native array binding).
 */
export interface ParamsValues {
  [key: string]: ParamsPrimitive | ParamsValues;
}

export interface ParamsFieldMeta {
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  /**
   * Opt in to a readonly time-series graph beside the editable binding for a
   * numeric leaf. Bounds come from `min`/`max`; a graph without declared bounds
   * falls back to the pane's default range.
   */
  graph?: boolean;
  /** Graph height in rows. The pane's default applies when absent. */
  rows?: number;
}

/** Meta tree keyed like the value tree; leaves refine one binding. */
export interface ParamsMeta {
  [key: string]: ParamsFieldMeta | ParamsMeta;
}

/**
 * Declaration-site meta typed against a defaults object, so `canvasParams`
 * callers get key completion and per-key checking.
 */
export type ParamsMetaFor<T extends ParamsValues> = {
  [K in keyof T]?: T[K] extends ParamsValues ? ParamsMetaFor<T[K]>
    : ParamsFieldMeta;
};

export interface ParamsEntity {
  name: string;
  rev: number;
  values: ParamsValues;
  meta?: ParamsMeta;
  updatedAt: number;
  updatedBy: string;
  /** Set when the live value stopped being serializable; values are the last good ones. */
  unserializable?: boolean;
  conflict?: boolean;
}

export interface ParamsSnapshot {
  type: "paramsSnapshot";
  seq: number;
  timestampMs: number;
  params: Record<string, ParamsEntity>;
}

export interface SetParamsRequest {
  name: string;
  /** Nested partial: only the leaves present are merged into the live object. */
  values: ParamsValues;
  originId?: string;
  expectedRev?: number;
}

/**
 * What a signal points at, so a view can bind without the producer knowing the
 * view exists: an entity reference, optionally into one field of it. `path` is
 * carried now even though no v1 consumer reads it.
 */
export interface SignalAnchor {
  /** Entity type wire id, e.g. `"pianoRoll"` or `"params"`. */
  type: string;
  name: string;
  path?: string[];
}

/**
 * One ephemeral signal: a named latest-value sample published by running code
 * purely to be watched. Signals are never persisted, never undoable, and end
 * with the run that published them.
 */
export interface SignalEntity {
  name: string;
  /** User-shaped latest value. `null` until the first `set`. */
  value: unknown;
  anchor?: SignalAnchor;
  /** The module whose run owns (and therefore ends) this signal. */
  ownerModuleId?: string;
  /**
   * The owning run ended. Sticky: later writes keep updating `value`, and only
   * a redeclaration of the name clears it.
   */
  ended?: boolean;
  /** Monotonically increasing count of observed value generations. */
  rev: number;
  updatedAt: number;
  updatedBy: string;
  /** Set when the live value stopped being serializable; `value` is the last good one. */
  unserializable?: boolean;
  /**
   * Root-clock logical time at the tick that adopted this value. Quantized by
   * the parent loop (~30 ms) and the sampler (100 ms); absent when no root
   * context is registered.
   */
  timeSec?: number;
  beats?: number;
}

export interface SignalsSnapshot {
  type: "signalsSnapshot";
  seq: number;
  timestampMs: number;
  signals: Record<string, SignalEntity>;
}

/** The affected entity of a generic CRUD action. */
export interface DurableEntityRef {
  type: string;
  name: string;
}

export interface EntityCreateRequest {
  type: string;
  name: string;
}

export interface EntityDuplicateRequest {
  type: string;
  name: string;
  targetName: string;
}

export interface EntityDeleteRequest {
  type: string;
  name: string;
}

export interface EntityMutationSuccess {
  ok: true;
  entity: DurableEntityRef;
}

export interface EntityMutationFailure {
  ok: false;
  error: string;
}

export type EntityMutationResponse =
  | EntityMutationSuccess
  | EntityMutationFailure;

export type EntityCreateResponse = EntityMutationResponse;
export type EntityDuplicateResponse = EntityMutationResponse;
export type EntityDeleteResponse = EntityMutationResponse;

/** File format of `data/pianoRoll/<encoded-name>.json`. */
export interface SavedPianoRollEntity {
  type: "pianoRoll";
  name: string;
  savedAt: string;
  data: PianoRollData;
}

/**
 * File format of `data/params/<encoded-name>.json`. `meta` is saved so a
 * freshly opened project renders correct panes before any module runs; a later
 * `canvasParams` declaration still wins through the normal reconcile.
 */
export interface SavedParamsEntity {
  type: "params";
  name: string;
  savedAt: string;
  values: ParamsValues;
  meta?: ParamsMeta;
}
