import { type Editor, parseTldrawJsonFile, serializeTldrawJson } from "tldraw";
import type { LivecodeRuntimeApi, ModuleViewState } from "./livecodeRuntime";
import type {
  EntityMutationSuccess,
  ProjectSaveResponse,
  VisualizerManifestMessage,
} from "./livecodeProtocol";
import { createEntityView, saveProjectWithCanvas } from "./canvasViews";
import { createLivecodeShape, createModuleId } from "./LivecodeEditorShape";
import {
  listPianoRollMarkerViews,
  type PianoRollMarkerViewState,
} from "./PianoRollShape";
import {
  createSignalScopeShape,
  listSignalScopeDebug,
  readSignalScopeDebug,
  type SignalScopeDebugState,
  type SignalScopeSourceType,
} from "./SignalScopeShape";
import { createEntity, deleteEntity, duplicateEntity } from "./serverRequests";

export interface TldrawRuntimeDebugModule {
  moduleId: string;
  projectModulePath?: string;
  sourceText: string;
  sourceVersion: number;
  buildStatus: string;
  runStatus: string;
  manifest: VisualizerManifestMessage | null;
  pianoRollLookups: Record<string, string>;
  activeIds: string[];
  latestError: string | null;
  executionCount: number;
  /**
   * The run token of the last run entity this module actually applied. A
   * terminal the dedupe suppressed never sets it, so a test can tell "the run I
   * watched ended" from "an older run's terminal leaked through".
   */
  runToken: string | null;
}

export interface TldrawRuntimeDebugShape {
  id: string;
  type: string;
  x: number;
  y: number;
  props: Record<string, unknown>;
}

export interface TldrawRuntimeDebug {
  connectionStatus: string;
  serverBaseUrl: string;
  modules: Record<string, TldrawRuntimeDebugModule>;
  shapes: TldrawRuntimeDebugShape[];
  setSource(moduleId: string, source: string): void;
  runModule(moduleId: string): Promise<void>;
  /** Run over the module's own running run, as the Replace button does. */
  replaceModule(moduleId: string): Promise<void>;
  stopModule(moduleId: string): Promise<void>;
  connect(): Promise<void>;
  disconnect(): void;
  getModuleIds(): string[];
  getShapes(): TldrawRuntimeDebugShape[];
  selectShape(id: string): void;
  getSelectedShapeIds(): string[];
  createEntityView(type: string, name: string): string | null;
  /** A second (third, ...) module on the canvas; returns its module id. */
  createModule(source?: string): string | null;
  createSignalScope(
    sourceType: SignalScopeSourceType,
    name: string,
    options?: { path?: string; windowSec?: number },
  ): string | null;
  /** What one scope has accumulated; scopes hold samples outside the store. */
  getScopeState(shapeId: string): SignalScopeDebugState | null;
  getScopeStates(): SignalScopeDebugState[];
  /** The marker lines the roll view for `rollName` is currently rendering. */
  getPlayheadMarkers(rollName: string): Array<{ id: string; position: number }>;
  /** Every mounted roll view and its markers, so "no view" is distinguishable. */
  getPlayheadMarkerViews(): PianoRollMarkerViewState[];
  createEntity(type: string, name: string): Promise<EntityMutationSuccess>;
  duplicateEntity(
    type: string,
    sourceName: string,
    targetName: string,
  ): Promise<EntityMutationSuccess>;
  deleteEntity(type: string, name: string): Promise<EntityMutationSuccess>;
  saveProject(): Promise<ProjectSaveResponse>;
  exportTldrJson(): Promise<string>;
  loadTldrJson(json: string): void;
}

declare global {
  interface Window {
    __livecodeTldrawRuntimeDebug?: TldrawRuntimeDebug;
  }
}

interface DebugRefs {
  runtime: LivecodeRuntimeApi | null;
  editor: Editor | null;
}

const refs: DebugRefs = { runtime: null, editor: null };

export function setRuntimeDebugRefs(
  runtime: LivecodeRuntimeApi | null,
  editor: Editor | null,
) {
  refs.runtime = runtime;
  refs.editor = editor;
  installDebugApi();
}

function installDebugApi() {
  if (window.__livecodeTldrawRuntimeDebug) return;
  window.__livecodeTldrawRuntimeDebug = {
    get connectionStatus() {
      return refs.runtime?.connectionStatus ?? "closed";
    },
    get serverBaseUrl() {
      return refs.runtime?.serverBaseUrl ?? "";
    },
    get modules() {
      return snapshotModules();
    },
    get shapes() {
      return snapshotShapes();
    },
    setSource(moduleId, source) {
      const editor = refs.editor;
      const runtime = refs.runtime;
      if (!editor || !runtime) return;
      const shape = editor
        .getCurrentPageShapes()
        .find((s) =>
          s.type === "livecode-editor" &&
          (s.props as { moduleId?: string }).moduleId === moduleId
        );
      if (shape) {
        editor.updateShape({
          id: shape.id,
          type: shape.type,
          props: { source },
        } as never);
      }
      runtime.setModuleSource(moduleId, source);
    },
    runModule(moduleId) {
      return refs.runtime?.runModule(moduleId) ?? Promise.resolve();
    },
    replaceModule(moduleId) {
      return refs.runtime?.replaceModule(moduleId) ?? Promise.resolve();
    },
    stopModule(moduleId) {
      return refs.runtime?.stopModule(moduleId) ?? Promise.resolve();
    },
    connect() {
      return refs.runtime?.connect() ?? Promise.resolve();
    },
    disconnect() {
      refs.runtime?.disconnect();
    },
    getModuleIds() {
      return Object.keys(refs.runtime?.modules ?? {});
    },
    getShapes() {
      return snapshotShapes();
    },
    selectShape(id) {
      refs.editor?.select(id as never);
    },
    getSelectedShapeIds() {
      return refs.editor?.getSelectedShapeIds().map(String) ?? [];
    },
    createEntityView(type, name) {
      const editor = refs.editor;
      if (!editor) return null;
      return createEntityView(editor, type, name);
    },
    createModule(source) {
      const editor = refs.editor;
      if (!editor) return null;
      const moduleId = createModuleId();
      createLivecodeShape(editor, {
        moduleId,
        ...(source !== undefined ? { source } : {}),
      });
      return moduleId;
    },
    createSignalScope(sourceType, name, options) {
      const editor = refs.editor;
      if (!editor) return null;
      return String(
        createSignalScopeShape(editor, {
          sourceType,
          name,
          path: options?.path ?? "",
          ...(options?.windowSec !== undefined
            ? { windowSec: options.windowSec }
            : {}),
        }),
      );
    },
    getScopeState(shapeId) {
      return readSignalScopeDebug(shapeId);
    },
    getScopeStates() {
      return listSignalScopeDebug();
    },
    getPlayheadMarkers(rollName) {
      return listPianoRollMarkerViews()
        .filter((view) => view.rollName === rollName)
        .flatMap((view) => view.markers);
    },
    getPlayheadMarkerViews() {
      return listPianoRollMarkerViews();
    },
    // The generic entity actions and the explicit save, headless: agents and the
    // E2E drive these rather than the topbar DOM. A rejected action rejects.
    createEntity(type, name) {
      return createEntity(requireServerBaseUrl(), type, name);
    },
    duplicateEntity(type, sourceName, targetName) {
      return duplicateEntity(
        requireServerBaseUrl(),
        type,
        sourceName,
        targetName,
      );
    },
    deleteEntity(type, name) {
      return deleteEntity(requireServerBaseUrl(), type, name);
    },
    saveProject() {
      const editor = refs.editor;
      if (!editor) {
        return Promise.reject(new Error("No tldraw editor is mounted yet"));
      }
      return saveProjectWithCanvas(editor, requireServerBaseUrl());
    },
    exportTldrJson() {
      const editor = refs.editor;
      return editor ? serializeTldrawJson(editor) : Promise.resolve("");
    },
    loadTldrJson(json) {
      const editor = refs.editor;
      if (!editor) return;
      const result = parseTldrawJsonFile({ json, schema: editor.store.schema });
      if (!result.ok) {
        throw new Error(
          `Could not load .tldr debug json: ${result.error.type}`,
        );
      }
      editor.loadSnapshot(result.value.getStoreSnapshot());
      editor.clearHistory();
    },
  };
}

function requireServerBaseUrl(): string {
  const serverBaseUrl = refs.runtime?.serverBaseUrl;
  if (!serverBaseUrl) throw new Error("No livecode runtime is mounted yet");
  return serverBaseUrl;
}

function snapshotModules(): Record<string, TldrawRuntimeDebugModule> {
  const modules = refs.runtime?.modules ?? {};
  const out: Record<string, TldrawRuntimeDebugModule> = {};
  for (const [moduleId, state] of Object.entries(modules)) {
    out[moduleId] = toDebugModule(state);
  }
  return out;
}

function toDebugModule(state: ModuleViewState): TldrawRuntimeDebugModule {
  return {
    moduleId: state.moduleId,
    projectModulePath: state.projectModulePath,
    sourceText: state.sourceText,
    sourceVersion: state.sourceVersion,
    buildStatus: state.buildStatus,
    runStatus: state.runStatus,
    manifest: state.manifest,
    pianoRollLookups: state.pianoRollLookups,
    activeIds: state.activeIds,
    latestError: state.latestError,
    executionCount: state.executionCount,
    runToken: state.runToken,
  };
}

function snapshotShapes(): TldrawRuntimeDebugShape[] {
  const editor = refs.editor;
  if (!editor) return [];
  return editor.getCurrentPageShapes().map((shape) => ({
    id: shape.id,
    type: shape.type,
    x: shape.x,
    y: shape.y,
    props: shape.props as Record<string, unknown>,
  }));
}
