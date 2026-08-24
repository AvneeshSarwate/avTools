/**
 * Project wire types: the on-disk manifest, the module/canvas records it
 * holds, and the `/project/*` request and response bodies.
 */

import type { RuntimeModuleStatus } from "./runtime.ts";

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

export interface ProjectCanvasAnimationEditorView {
  id: string;
  animationName: string;
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
  animationEditorViews?: ProjectCanvasAnimationEditorView[];
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
  /**
   * Which world this project's modules execute in, which is also the world
   * they are typechecked against: "browser" runs the shadow `deno check`
   * under a browser lib (DOM globals legal, `Deno.*` a type error), "deno"
   * under the default Deno lib. Absent means "follow the server's engine
   * mode" — a `--engine remote` server materializes for the browser, so its
   * projects check against browser truth by default.
   */
  engineTarget?: "deno" | "browser";
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
  error?: string;
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
