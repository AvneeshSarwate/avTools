import {
  type MutableRefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createShapeId,
  parseTldrawJsonFile,
  serializeTldrawJson,
  type Editor,
  Tldraw,
  useValue,
} from "tldraw";
import {
  createLivecodeShape,
  LIVECODE_EDITOR_SHAPE_TYPE,
  type LivecodeEditorShape,
  LivecodeEditorShapeUtil,
} from "./LivecodeEditorShape";
import type {
  ClientControlCommand,
  ClientControlEnvelope,
  ClientControlResultMessage,
  DurableEntityRef,
  ProjectCurrentResponse,
  ProjectModuleLocator,
  ProjectModuleRecord,
  ProjectModuleSourceResponse,
  ProjectSaveResponse,
  ProjectStatusResponse,
  RuntimeModuleStatus,
} from "./livecodeProtocol";
import {
  type LivecodeRuntimeApi,
  LivecodeRuntimeProvider,
  useLivecodeRuntime,
} from "./livecodeRuntime";
import { ParamsRuntimeProvider, useParamsRuntime } from "./paramsRuntime";
import {
  createParamPaneShape,
  PARAM_PANE_SHAPE_TYPE,
  type ParamPaneShape,
  ParamPaneShapeUtil,
} from "./ParamPaneShape";
import {
  PianoRollRuntimeProvider,
  usePianoRollRuntime,
} from "./pianoRollRuntime";
import {
  createPianoRollShape,
  PIANO_ROLL_SHAPE_TYPE,
  type PianoRollShape,
  PianoRollShapeUtil,
} from "./PianoRollShape";
import {
  SignalsRuntimeProvider,
  useSignalsRuntime,
} from "./signalsRuntime";
import {
  createSignalScopeShape,
  describeScopeSource,
  SIGNAL_SCOPE_SHAPE_TYPE,
  type SignalScopeShape,
  SignalScopeShapeUtil,
  type SignalScopeSourceType,
} from "./SignalScopeShape";
import { setRuntimeDebugRefs } from "./livecodeTldrawDebug";
import { createReconnectingSocket } from "./reconnectingSocket";
import {
  createEntity,
  deleteEntity,
  duplicateEntity,
  fetchProjectStatus,
  PARAMS_ENTITY_TYPE,
  PIANO_ROLL_ENTITY_TYPE,
  saveProject,
} from "./serverRequests";

const shapeUtils = [
  LivecodeEditorShapeUtil,
  PianoRollShapeUtil,
  ParamPaneShapeUtil,
  SignalScopeShapeUtil,
];
const TLDR_MIME_TYPE = "application/vnd.tldraw+json";

export function App() {
  return (
    <LivecodeRuntimeProvider>
      <LivecodeTldrawPage />
    </LivecodeRuntimeProvider>
  );
}

function LivecodeTldrawPage() {
  const [editor, setEditor] = useState<Editor | null>(null);
  const runtime = useLivecodeRuntime();
  const { registerModule, unregisterModule, setModuleSource } = runtime;
  const projectPath = useMemo(
    () => new URLSearchParams(window.location.search).get("projectPath"),
    [],
  );
  const canvasUrl = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("tldr") ?? params.get("canvas") ?? params.get("canvasUrl");
  }, []);
  const projectLoadedRef = useRef(false);
  const canvasLoadedRef = useRef(false);
  const suppressStoreListenerRef = useRef(false);
  const layoutUpdateTimersRef = useRef(new Map<string, number>());
  const canvasUpdateTimerRef = useRef<number | undefined>(undefined);

  useClientControlBridge(editor, runtime);

  const syncLivecodeShapesToRuntime = useCallback(() => {
    if (!editor) return;
    const shapes = editor.getCurrentPageShapes().filter(isLivecodeShape);
    const shapeModuleIds = new Set(shapes.map((shape) => shape.props.moduleId));
    for (const moduleId of Object.keys(runtime.modules)) {
      if (!shapeModuleIds.has(moduleId)) unregisterModule(moduleId);
    }
    for (const shape of shapes) {
      registerModule(
        shape.props.moduleId,
        shape.props.source,
        shape.props.projectModulePath,
      );
    }
  }, [editor, registerModule, runtime.modules, unregisterModule]);

  const scheduleProjectModuleLayoutUpdate = useCallback(
    (shape: LivecodeEditorShape) => {
      if (!shape.props.projectModulePath) return;
      const previous = layoutUpdateTimersRef.current.get(shape.props.moduleId);
      if (previous !== undefined) window.clearTimeout(previous);
      const timer = window.setTimeout(() => {
        layoutUpdateTimersRef.current.delete(shape.props.moduleId);
        void postJson<ProjectStatusResponse>(
          `${runtime.serverBaseUrl}/project/modules/update`,
          {
            id: shape.props.moduleId,
            x: shape.x,
            y: shape.y,
            w: shape.props.w,
            h: shape.props.h,
          },
        ).catch((error) => {
          console.error("[livecode-tldraw] failed to persist module layout", error);
        });
      }, 1_000);
      layoutUpdateTimersRef.current.set(shape.props.moduleId, timer);
    },
    [runtime.serverBaseUrl],
  );

  // One collector for every canvas view kind: `/project/canvas` replaces the
  // whole canvas object, so a post that carried only one array would drop the
  // other kind's layout.
  const scheduleCanvasViewsUpdate = useCallback(() => {
    if (!editor || !projectPath) return;
    if (canvasUpdateTimerRef.current !== undefined) {
      window.clearTimeout(canvasUpdateTimerRef.current);
    }
    canvasUpdateTimerRef.current = window.setTimeout(() => {
      canvasUpdateTimerRef.current = undefined;
      const shapes = editor.getCurrentPageShapes();
      const pianoRollViews = shapes
        .filter(isPianoRollShape)
        .map((shape) => ({
          id: shape.id,
          rollName: shape.props.rollName,
          x: shape.x,
          y: shape.y,
          w: shape.props.w,
          h: shape.props.h,
        }));
      const paramPaneViews = shapes
        .filter(isParamPaneShape)
        .map((shape) => ({
          id: shape.id,
          paramsName: shape.props.paramsName,
          x: shape.x,
          y: shape.y,
          w: shape.props.w,
          h: shape.props.h,
        }));
      // A scope is a view of a binding, not of an entity: what it persists is
      // which source it watches, never any of the samples it drew.
      const scopeViews = shapes
        .filter(isSignalScopeShape)
        .map((shape) => ({
          id: shape.id,
          sourceType: shape.props.sourceType,
          name: shape.props.name,
          path: shape.props.path,
          windowSec: shape.props.windowSec,
          x: shape.x,
          y: shape.y,
          w: shape.props.w,
          h: shape.props.h,
        }));
      void postJson(`${runtime.serverBaseUrl}/project/canvas`, {
        canvas: { pianoRollViews, paramPaneViews, scopeViews },
      }).catch((error) => {
        console.error(
          "[livecode-tldraw] failed to persist canvas view layout",
          error,
        );
      });
    }, 1_000);
  }, [editor, projectPath, runtime.serverBaseUrl]);

  const loadTldrawFile = useCallback(
    async (file: File) => {
      if (!editor) return;
      suppressStoreListenerRef.current = true;
      try {
        await loadTldrawCanvasFromFile(editor, file);
      } finally {
        suppressStoreListenerRef.current = false;
        syncLivecodeShapesToRuntime();
      }
    },
    [editor, syncLivecodeShapesToRuntime],
  );

  useEffect(() => {
    setRuntimeDebugRefs(runtime, editor);
  }, [runtime, editor]);

  useEffect(() => {
    if (!editor) return;

    syncLivecodeShapesToRuntime();

    const unsubscribe = editor.store.listen(
      (entry) => {
        if (suppressStoreListenerRef.current) return;
        for (const record of Object.values(entry.changes.added)) {
          if (isLivecodeShape(record)) {
            registerModule(
              record.props.moduleId,
              record.props.source,
              record.props.projectModulePath,
            );
          } else if (isCanvasViewShape(record)) {
            scheduleCanvasViewsUpdate();
          }
        }

        for (const [before, after] of Object.values(entry.changes.updated)) {
          if (isLivecodeShape(before) && !isLivecodeShape(after)) {
            unregisterModule(before.props.moduleId);
          } else if (!isLivecodeShape(before) && isLivecodeShape(after)) {
            registerModule(
              after.props.moduleId,
              after.props.source,
              after.props.projectModulePath,
            );
          } else if (isLivecodeShape(before) && isLivecodeShape(after)) {
            if (before.props.moduleId !== after.props.moduleId) {
              unregisterModule(before.props.moduleId);
              registerModule(
                after.props.moduleId,
                after.props.source,
                after.props.projectModulePath,
              );
            } else if (before.props.source !== after.props.source) {
              setModuleSource(after.props.moduleId, after.props.source);
            }
            if (
              after.props.projectModulePath &&
              hasShapeLayoutChanged(before, after)
            ) {
              scheduleProjectModuleLayoutUpdate(after);
            }
          } else if (hasCanvasViewShapeChanged(before, after)) {
            scheduleCanvasViewsUpdate();
          }
        }

        for (const record of Object.values(entry.changes.removed)) {
          if (isLivecodeShape(record)) {
            unregisterModule(record.props.moduleId);
          } else if (isCanvasViewShape(record)) {
            scheduleCanvasViewsUpdate();
          }
        }
      },
      { source: "all", scope: "document" },
    );

    return () => {
      unsubscribe();
      for (const timer of layoutUpdateTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      layoutUpdateTimersRef.current.clear();
      if (canvasUpdateTimerRef.current !== undefined) {
        window.clearTimeout(canvasUpdateTimerRef.current);
        canvasUpdateTimerRef.current = undefined;
      }
    };
  }, [
    editor,
    registerModule,
    scheduleCanvasViewsUpdate,
    scheduleProjectModuleLayoutUpdate,
    setModuleSource,
    syncLivecodeShapesToRuntime,
    unregisterModule,
  ]);

  useEffect(() => {
    if (!editor || !canvasUrl || projectPath || canvasLoadedRef.current) return;

    void (async () => {
      suppressStoreListenerRef.current = true;
      try {
        await loadTldrawCanvasFromUrl(editor, canvasUrl);
        canvasLoadedRef.current = true;
      } catch (error) {
        canvasLoadedRef.current = false;
        console.error("[livecode-tldraw] failed to load tldraw canvas", error);
      } finally {
        suppressStoreListenerRef.current = false;
        syncLivecodeShapesToRuntime();
      }
    })();
  }, [canvasUrl, editor, projectPath, syncLivecodeShapesToRuntime]);

  useEffect(() => {
    if (!editor || !projectPath || projectLoadedRef.current) return;

    void (async () => {
      suppressStoreListenerRef.current = true;
      try {
        await loadProjectIntoCanvas(editor, runtime.serverBaseUrl, projectPath);
        projectLoadedRef.current = true;
        if (runtime.connectionStatus === "closed") {
          void runtime.connect();
        }
      } catch (error) {
        projectLoadedRef.current = false;
        console.error("[livecode-tldraw] failed to load project", error);
      } finally {
        suppressStoreListenerRef.current = false;
        syncLivecodeShapesToRuntime();
      }
    })();
  }, [editor, projectPath, runtime, syncLivecodeShapesToRuntime]);

  return (
    <PianoRollRuntimeProvider serverBaseUrl={runtime.serverBaseUrl}>
      <ParamsRuntimeProvider serverBaseUrl={runtime.serverBaseUrl}>
        <SignalsRuntimeProvider serverBaseUrl={runtime.serverBaseUrl}>
          <div className="app-shell">
            <TopBar
              editor={editor}
              projectPath={projectPath}
              onOpenTldrawFile={loadTldrawFile}
            />
            <div className="canvas-shell">
              <Tldraw
                shapeUtils={shapeUtils}
                onMount={(mountedEditor) => {
                  setEditor(mountedEditor);
                  if (!projectPath && !canvasUrl && !hasLivecodeShapes(mountedEditor)) {
                    createDefaultLivecodeCanvas(mountedEditor);
                  }
                }}
              />
            </div>
          </div>
        </SignalsRuntimeProvider>
      </ParamsRuntimeProvider>
    </PianoRollRuntimeProvider>
  );
}

function TopBar({
  editor,
  projectPath,
  onOpenTldrawFile,
}: {
  editor: Editor | null;
  projectPath: string | null;
  onOpenTldrawFile: (file: File) => Promise<void>;
}) {
  const runtime = useLivecodeRuntime();
  const paramsRuntime = useParamsRuntime();
  const pianoRollRuntime = usePianoRollRuntime();
  const signalsRuntime = useSignalsRuntime();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // null while the inline params-name input is closed. Non-modal by design: the
  // canvas stays interactive while it is open. The piano-roll, scope and
  // duplicate drafts below follow the same pattern.
  const [paramPaneDraft, setParamPaneDraft] = useState<string | null>(null);
  const [pianoRollDraft, setPianoRollDraft] = useState<string | null>(null);
  const [scopeDraft, setScopeDraft] = useState<string | null>(null);
  const [duplicateDraft, setDuplicateDraft] = useState<string | null>(null);
  // The name the delete button is armed for, so a selection change disarms it:
  // a confirm can never land on an entity the operator was not looking at.
  const [deleteArmedName, setDeleteArmedName] = useState<string | null>(null);
  const [entityError, setEntityError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const selection = useSelectedEntity(editor);
  const unsavedCount = useUnsavedEntityCount(runtime.serverBaseUrl, projectPath);
  const knownParamsNames = useMemo(
    () => Object.keys(paramsRuntime.params).sort(),
    [paramsRuntime.params],
  );
  const knownRollNames = useMemo(
    () => Object.keys(pianoRollRuntime.rolls).sort(),
    [pianoRollRuntime.rolls],
  );
  // Everything a scope can bind to, in the one syntax the input accepts: signal
  // names as they are, param leaves as `params:<name>.<field>`. Ended signals
  // stay listed — a stopped run's trace is still worth looking at — but say so.
  const scopeSourceOptions = useMemo(
    () => [
      ...Object.values(signalsRuntime.signals)
        .map((signal) => ({
          value: signal.name,
          label: signal.ended ? `${signal.name} (ended)` : signal.name,
        }))
        .sort((a, b) => a.value.localeCompare(b.value)),
      ...Object.values(paramsRuntime.params)
        .flatMap((entity) =>
          listParamsLeafPaths(entity.values).map((leafPath) => ({
            value: `${PARAMS_ENTITY_TYPE}:${entity.name}.${leafPath}`,
            label: `${PARAMS_ENTITY_TYPE}:${entity.name}.${leafPath}`,
          }))
        )
        .sort((a, b) => a.value.localeCompare(b.value)),
    ],
    [paramsRuntime.params, signalsRuntime.signals],
  );
  const moduleCount = useMemo(() => Object.keys(runtime.modules).length, [
    runtime.modules,
  ]);
  const selectionKey = selection ? `${selection.type} ${selection.name}` : "";

  // Entity actions are ordinary serialized POSTs; a rejection is the server's
  // wording, shown in the topbar rather than thrown away.
  const runEntityAction = useCallback(async (action: () => Promise<void>) => {
    setEntityError(null);
    try {
      await action();
    } catch (error) {
      console.error("[livecode-tldraw] entity action failed", error);
      setEntityError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  // A new selection is a new subject: never carry a prefilled duplicate name or
  // an armed delete across it.
  useEffect(() => {
    setDuplicateDraft(null);
    setDeleteArmedName(null);
  }, [selectionKey]);

  useEffect(() => {
    if (deleteArmedName === null) return;
    const timer = window.setTimeout(() => setDeleteArmedName(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [deleteArmedName]);

  const dependencyIssueCount = runtime.projectDiagnostics?.modules.filter((
    moduleEntry,
  ) => moduleEntry.hasDependencyWarnings).length ?? 0;
  const changedDependencyCount = runtime.projectDiagnostics?.modules.filter((
    moduleEntry,
  ) => moduleEntry.changedDependencies.length > 0).length ?? 0;

  return (
    <div
      className="topbar"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="topbar__group topbar__group--server">
        <label htmlFor="server-url">Server</label>
        <input
          id="server-url"
          value={runtime.serverBaseUrl}
          onChange={(event) =>
            runtime.setServerBaseUrl(event.currentTarget.value)}
          spellCheck={false}
        />
        <button
          type="button"
          disabled={runtime.connectionStatus === "connecting"}
          onClick={() =>
            runtime.connectionStatus === "open"
              ? runtime.disconnect()
              : void runtime.connect()}
        >
          {runtime.connectionStatus === "open" ? "Disconnect" : "Connect"}
        </button>
      </div>

      <button
        type="button"
        disabled={!editor}
        onClick={() => {
          if (editor) createDefaultLivecodeCanvas(editor);
        }}
      >
        New canvas
      </button>
      <button
        type="button"
        disabled={!editor}
        onClick={() => fileInputRef.current?.click()}
      >
        Open .tldr
      </button>
      <button
        type="button"
        disabled={!editor}
        onClick={() => {
          if (editor) void saveTldrawCanvas(editor);
        }}
      >
        Save .tldr
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".tldr,application/json"
        style={{ display: "none" }}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (editor && file) {
            void onOpenTldrawFile(file).catch((error) => {
              console.error("[livecode-tldraw] failed to open .tldr file", error);
            });
          }
        }}
      />
      <button
        type="button"
        disabled={!editor}
        onClick={() => {
          if (editor) createLivecodeShape(editor);
        }}
      >
        New module
      </button>
      {pianoRollDraft === null
        ? (
          <button
            type="button"
            disabled={!editor}
            onClick={() => setPianoRollDraft("")}
          >
            New piano roll
          </button>
        )
        : (
          <form
            className="topbar__group"
            onSubmit={(event) => {
              event.preventDefault();
              const rollName = pianoRollDraft.trim();
              if (!editor || !rollName) return;
              void runEntityAction(async () => {
                // Dual mode: a name the store already has only gets another
                // view; a new name is the composite create-entity-plus-view
                // gesture.
                if (!knownRollNames.includes(rollName)) {
                  await createEntity(
                    runtime.serverBaseUrl,
                    PIANO_ROLL_ENTITY_TYPE,
                    rollName,
                  );
                }
                createPianoRollShape(editor, { rollName });
                setPianoRollDraft(null);
              });
            }}
          >
            <input
              autoFocus
              list="topbar-roll-names"
              placeholder="piano roll name"
              value={pianoRollDraft}
              spellCheck={false}
              onChange={(event) => setPianoRollDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setPianoRollDraft(null);
              }}
            />
            <datalist id="topbar-roll-names">
              {knownRollNames.map((name) => <option key={name} value={name} />)}
            </datalist>
            <button type="submit" disabled={!editor || !pianoRollDraft.trim()}>
              Add roll
            </button>
            <button type="button" onClick={() => setPianoRollDraft(null)}>
              Cancel
            </button>
          </form>
        )}
      {paramPaneDraft === null
        ? (
          <button
            type="button"
            disabled={!editor}
            onClick={() => setParamPaneDraft(knownParamsNames[0] ?? "")}
          >
            New params pane
          </button>
        )
        : (
          <form
            className="topbar__group"
            onSubmit={(event) => {
              event.preventDefault();
              const paramsName = paramPaneDraft.trim();
              if (!editor || !paramsName) return;
              createParamPaneShape(editor, { paramsName });
              setParamPaneDraft(null);
            }}
          >
            <input
              autoFocus
              list="topbar-params-names"
              placeholder="params name"
              value={paramPaneDraft}
              spellCheck={false}
              onChange={(event) => setParamPaneDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setParamPaneDraft(null);
              }}
            />
            <datalist id="topbar-params-names">
              {knownParamsNames.map((name) => <option key={name} value={name} />)}
            </datalist>
            <button type="submit" disabled={!editor || !paramPaneDraft.trim()}>
              Add pane
            </button>
            <button type="button" onClick={() => setParamPaneDraft(null)}>
              Cancel
            </button>
          </form>
        )}
      {/*
        A scope binds to a value, not to an entity: any live signal, or one
        durable param leaf. There is nothing to create server-side — the source
        either exists or the scope waits for it — so this gesture is view-only.
      */}
      {scopeDraft === null
        ? (
          <button
            type="button"
            disabled={!editor}
            onClick={() => setScopeDraft("")}
          >
            New scope
          </button>
        )
        : (
          <form
            className="topbar__group"
            onSubmit={(event) => {
              event.preventDefault();
              const source = parseScopeSource(
                scopeDraft,
                Object.keys(signalsRuntime.signals),
              );
              if (!editor || !source) return;
              createSignalScopeShape(editor, source);
              setScopeDraft(null);
            }}
          >
            <input
              autoFocus
              list="topbar-scope-sources"
              placeholder="signal name or params:name.field"
              value={scopeDraft}
              spellCheck={false}
              onChange={(event) => setScopeDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setScopeDraft(null);
              }}
            />
            <datalist id="topbar-scope-sources">
              {scopeSourceOptions.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                  label={option.label}
                />
              ))}
            </datalist>
            <button type="submit" disabled={!editor || !scopeDraft.trim()}>
              Add scope
            </button>
            <button type="button" onClick={() => setScopeDraft(null)}>
              Cancel
            </button>
          </form>
        )}

      {/*
        Entity actions are scoped to a single selected view: a shape is a view
        of an entity, so the entity these act on is unambiguous only then.
        Deleting the view stays the canvas gesture it always was.
      */}
      {selection && duplicateDraft === null
        ? (
          <button
            type="button"
            onClick={() => setDuplicateDraft(`${selection.name}-copy`)}
          >
            Duplicate entity
          </button>
        )
        : null}
      {selection && duplicateDraft !== null
        ? (
          <form
            className="topbar__group"
            onSubmit={(event) => {
              event.preventDefault();
              const targetName = duplicateDraft.trim();
              if (!editor || !targetName) return;
              void runEntityAction(async () => {
                await duplicateEntity(
                  runtime.serverBaseUrl,
                  selection.type,
                  selection.name,
                  targetName,
                );
                createAdjacentEntityView(editor, selection.type, targetName);
                setDuplicateDraft(null);
              });
            }}
          >
            <input
              autoFocus
              placeholder={`copy of ${selection.name}`}
              value={duplicateDraft}
              spellCheck={false}
              onChange={(event) => setDuplicateDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setDuplicateDraft(null);
              }}
            />
            <button type="submit" disabled={!editor || !duplicateDraft.trim()}>
              Duplicate
            </button>
            <button type="button" onClick={() => setDuplicateDraft(null)}>
              Cancel
            </button>
          </form>
        )
        : null}
      {selection
        ? (
          <button
            type="button"
            onClick={() => {
              // Two-step confirm; the arm expires on its own so a stray first
              // click cannot leave a live delete waiting for a second one.
              if (deleteArmedName !== selection.name) {
                setDeleteArmedName(selection.name);
                return;
              }
              setDeleteArmedName(null);
              void runEntityAction(async () => {
                await deleteEntity(
                  runtime.serverBaseUrl,
                  selection.type,
                  selection.name,
                );
              });
            }}
          >
            {deleteArmedName === selection.name
              ? `Really delete ${selection.name}?`
              : "Delete entity"}
          </button>
        )
        : null}

      {/* Explicit save, gated on an open project exactly like the collector. */}
      {projectPath
        ? (
          <div className="topbar__group">
            <button
              type="button"
              onClick={() => {
                setSaveNotice(null);
                void runEntityAction(async () => {
                  setSaveNotice(describeProjectSave(
                    await saveProject(runtime.serverBaseUrl),
                  ));
                });
              }}
            >
              Save project
            </button>
            {unsavedCount === null ? null : (
              <span
                className={`status-pill status-pill--${
                  unsavedCount > 0 ? "unsaved" : "saved"
                }`}
              >
                {unsavedCount > 0 ? `${unsavedCount} unsaved` : "saved"}
              </span>
            )}
            {saveNotice ? <span>{saveNotice}</span> : null}
          </div>
        )
        : null}

      <div className="topbar__status">
        <span
          className={`status-pill status-pill--${runtime.connectionStatus}`}
        >
          {runtime.connectionStatus}
        </span>
        <span className={`status-pill status-pill--${runtime.lspStatus}`}>
          lsp: {runtime.lspStatus}
        </span>
        <span>{moduleCount} modules</span>
        {changedDependencyCount > 0
          ? <span>{changedDependencyCount} dependency updates</span>
          : null}
        {dependencyIssueCount > 0
          ? <span className="topbar__error">{dependencyIssueCount} dependency issues</span>
          : null}
        {runtime.projectDiagnosticsError
          ? (
            <span className="topbar__error">
              diagnostics: {runtime.projectDiagnosticsError}
            </span>
          )
          : null}
        {runtime.connectionError
          ? <span className="topbar__error">{runtime.connectionError}</span>
          : null}
        {entityError
          ? <span className="topbar__error">{entityError}</span>
          : null}
      </div>
    </div>
  );
}

/**
 * The durable entity the single selected view addresses, or null. Reactive
 * through tldraw's own signals: `useValue` recomputes only when the selection
 * (or the selected view's entity name) changes, and both halves are primitives
 * so an unrelated shape edit never re-renders the topbar.
 */
function useSelectedEntity(editor: Editor | null): DurableEntityRef | null {
  const type = useValue(
    "selected entity type",
    () => selectedEntityRef(editor)?.type ?? null,
    [editor],
  );
  const name = useValue(
    "selected entity name",
    () => selectedEntityRef(editor)?.name ?? null,
    [editor],
  );
  return type && name ? { type, name } : null;
}

function selectedEntityRef(editor: Editor | null): DurableEntityRef | null {
  const shape = editor?.getOnlySelectedShape();
  if (isPianoRollShape(shape)) {
    return { type: PIANO_ROLL_ENTITY_TYPE, name: shape.props.rollName };
  }
  if (isParamPaneShape(shape)) {
    return { type: PARAMS_ENTITY_TYPE, name: shape.props.paramsName };
  }
  return null;
}

/**
 * What the "New scope" input accepts, in one function so the datalist and the
 * typed form agree: `params:<name>.<field...>` binds one durable param leaf,
 * anything else is a signal name. A signal name that is already known is taken
 * whole (names may contain dots); an unknown one splits at its first dot, so a
 * field of an object-valued signal can be bound before it is published.
 */
function parseScopeSource(
  text: string,
  knownSignalNames: string[],
): { sourceType: SignalScopeSourceType; name: string; path: string } | null {
  // The datalist labels ended signals; accept the label back as the name.
  const trimmed = text.trim().replace(/\s*\(ended\)$/, "");
  if (!trimmed) return null;

  const paramsPrefix = `${PARAMS_ENTITY_TYPE}:`;
  if (trimmed.startsWith(paramsPrefix)) {
    const [name, ...pathParts] = trimmed.slice(paramsPrefix.length).split(".");
    if (!name) return null;
    return { sourceType: "params", name, path: pathParts.join(".") };
  }

  const signalText = trimmed.startsWith("signal:")
    ? trimmed.slice("signal:".length)
    : trimmed;
  if (!signalText) return null;
  if (knownSignalNames.includes(signalText)) {
    return { sourceType: "signal", name: signalText, path: "" };
  }
  const [name, ...pathParts] = signalText.split(".");
  if (!name) return null;
  return { sourceType: "signal", name, path: pathParts.join(".") };
}

/** Dot-joined paths of every numeric leaf, for the scope datalist. */
function listParamsLeafPaths(values: unknown, prefix = ""): string[] {
  if (typeof values !== "object" || values === null) return [];
  const paths: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    const leafPath = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "number") {
      paths.push(leafPath);
    } else if (typeof value === "object" && value !== null) {
      paths.push(...listParamsLeafPaths(value, leafPath));
    }
  }
  return paths;
}

/** A view of `name`, beside the selected one so the pair reads as a pair. */
function createAdjacentEntityView(
  editor: Editor,
  entityType: string,
  name: string,
) {
  const source = editor.getOnlySelectedShape();
  const beside = isPianoRollShape(source) || isParamPaneShape(source)
    ? { x: source.x + source.props.w + 40, y: source.y }
    : {};
  return entityType === PIANO_ROLL_ENTITY_TYPE
    ? createPianoRollShape(editor, { ...beside, rollName: name })
    : createParamPaneShape(editor, { ...beside, paramsName: name });
}

function describeProjectSave(result: ProjectSaveResponse): string {
  const failed = result.data.filter((entry) => !entry.ok);
  for (const entry of failed) {
    console.error(
      `[livecode-tldraw] ${entry.type} "${entry.name}" failed to save: ${entry.error}`,
    );
  }
  for (const entry of result.skipped) {
    console.warn(
      `[livecode-tldraw] ${entry.type} "${entry.name}" skipped by save: ${entry.reason}`,
    );
  }
  return [
    `saved ${result.data.length - failed.length}`,
    failed.length > 0 ? `${failed.length} failed` : null,
    result.skipped.length > 0 ? `${result.skipped.length} skipped` : null,
  ].filter((part) => part !== null).join(" | ");
}

/**
 * Unsaved durable entities from `/project/status`, polled while a project is
 * open (the same gate as the canvas collector). Purely informational: nothing
 * here ever writes.
 */
function useUnsavedEntityCount(
  serverBaseUrl: string,
  projectPath: string | null,
) {
  const [unsavedCount, setUnsavedCount] = useState<number | null>(null);

  useEffect(() => {
    if (!projectPath) {
      setUnsavedCount(null);
      return;
    }
    let cancelled = false;
    const poll = () => {
      fetchProjectStatus(serverBaseUrl)
        .then((status) => {
          if (cancelled) return;
          setUnsavedCount(status.data.filter((entry) => entry.unsaved).length);
        })
        .catch(() => {
          if (!cancelled) setUnsavedCount(null);
        });
    };
    poll();
    const timer = window.setInterval(poll, 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [projectPath, serverBaseUrl]);

  return unsavedCount;
}

function useClientControlBridge(
  editor: Editor | null,
  runtime: LivecodeRuntimeApi,
) {
  const editorRef = useRef(editor);
  const runtimeRef = useRef(runtime);
  const clientIdRef = useRef(`livecode-tldraw-${crypto.randomUUID()}`);

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    runtimeRef.current = runtime;
  }, [runtime]);

  useEffect(() => {
    const normalizedServerBaseUrl = runtime.serverBaseUrl.trim().replace(
      /\/+$/,
      "",
    );
    if (!normalizedServerBaseUrl) return;

    const pendingResults = new Map<string, ClientControlResultMessage>();
    const socketUrl = `${
      normalizedServerBaseUrl.replace(/^http/, "ws")
    }/client/control?clientId=${encodeURIComponent(clientIdRef.current)}`;

    const controller = createReconnectingSocket({
      makeUrl: () => socketUrl,
      onOpen: (socket) => {
        flushClientControlResults(socket, pendingResults);
      },
      onMessage: (event) => {
        if (typeof event.data !== "string") return;
        let envelope: ClientControlEnvelope;
        try {
          envelope = JSON.parse(event.data) as ClientControlEnvelope;
        } catch (error) {
          console.warn(
            "[livecode-tldraw] malformed client control message",
            error,
          );
          return;
        }
        if (envelope.type !== "clientCommand") return;

        void executeClientControlCommand(
          envelope.command,
          editorRef,
          runtimeRef,
        )
          .then((result) => {
            queueClientControlResult(controller.socket, pendingResults, {
              type: "clientCommandResult",
              commandId: envelope.commandId,
              ok: true,
              result,
            });
          })
          .catch((error: unknown) => {
            queueClientControlResult(controller.socket, pendingResults, {
              type: "clientCommandResult",
              commandId: envelope.commandId,
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          });
      },
    });

    controller.connect();

    return () => {
      controller.close();
    };
  }, [runtime.serverBaseUrl]);
}

function sendClientControlResult(
  socket: WebSocket | null,
  message: ClientControlResultMessage,
) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(message));
}

function queueClientControlResult(
  socket: WebSocket | null,
  pendingResults: Map<string, ClientControlResultMessage>,
  message: ClientControlResultMessage,
) {
  pendingResults.set(message.commandId, message);
  flushClientControlResults(socket, pendingResults);
}

function flushClientControlResults(
  socket: WebSocket | null,
  pendingResults: Map<string, ClientControlResultMessage>,
) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  for (const [commandId, message] of pendingResults) {
    sendClientControlResult(socket, message);
    pendingResults.delete(commandId);
  }
}

async function executeClientControlCommand(
  command: ClientControlCommand,
  editorRef: MutableRefObject<Editor | null>,
  runtimeRef: MutableRefObject<LivecodeRuntimeApi>,
): Promise<unknown> {
  if (command.type === "getState") {
    return makeClientControlState(editorRef.current, runtimeRef.current);
  }

  const editor = editorRef.current;
  if (!editor) {
    throw new Error("tldraw editor is not mounted");
  }

  if (command.type === "openProject") {
    await loadProjectIntoCanvas(
      editor,
      runtimeRef.current.serverBaseUrl,
      command.projectPath,
    );
    if (command.connect !== false) {
      await ensureRuntimeOpen(runtimeRef);
    }
    return makeClientControlState(editor, runtimeRef.current);
  }

  if (command.type === "addProjectModule") {
    const status = await postJson<ProjectStatusResponse>(
      `${runtimeRef.current.serverBaseUrl}/project/modules/add`,
      command.module,
    );
    const moduleRecord = findProjectModuleRecord(status.modules, {
      id: command.module.id,
      path: command.module.path,
    });
    if (!moduleRecord) throw new Error("server did not return added module");
    await createOrUpdateProjectShape(
      editor,
      runtimeRef.current.serverBaseUrl,
      status,
      moduleRecord,
    );
    return makeClientControlState(editor, runtimeRef.current);
  }

  if (command.type === "reloadProjectModule") {
    const status = await postJson<ProjectStatusResponse>(
      `${runtimeRef.current.serverBaseUrl}/project/modules/reload`,
      command,
    );
    const moduleRecord = findProjectModuleRecord(status.modules, command);
    if (!moduleRecord) throw new Error("server did not return reloaded module");
    await createOrUpdateProjectShape(
      editor,
      runtimeRef.current.serverBaseUrl,
      status,
      moduleRecord,
    );
    return makeClientControlState(editor, runtimeRef.current);
  }

  if (command.type === "stopAllModules") {
    await Promise.all(
      Object.keys(runtimeRef.current.modules).map((moduleId) =>
        runtimeRef.current.stopModule(moduleId)
      ),
    );
    return makeClientControlState(editor, runtimeRef.current);
  }

  const shape = findLivecodeShapeByLocator(editor, command);
  if (!shape) {
    throw new Error(`No livecode module found for ${JSON.stringify(command)}`);
  }

  if (command.type === "setModuleSource") {
    editor.updateShape<LivecodeEditorShape>({
      id: shape.id,
      type: LIVECODE_EDITOR_SHAPE_TYPE,
      props: { source: command.sourceText },
    });
    runtimeRef.current.setModuleSource(
      shape.props.moduleId,
      command.sourceText,
    );
    return makeClientControlState(editor, runtimeRef.current);
  }

  if (command.type === "runModule") {
    await ensureRuntimeOpen(runtimeRef);
    // Same explicit-consent flag the Replace button sends; absent, this is Run
    // and the server refuses a module that is already running.
    await runtimeRef.current.runModule(shape.props.moduleId, {
      replaceRunning: command.replaceRunning,
    });
    return makeClientControlState(editor, runtimeRef.current);
  }

  if (command.type === "stopModule") {
    await runtimeRef.current.stopModule(shape.props.moduleId);
    return makeClientControlState(editor, runtimeRef.current);
  }

  return makeClientControlState(editor, runtimeRef.current);
}

async function ensureRuntimeOpen(
  runtimeRef: MutableRefObject<LivecodeRuntimeApi>,
) {
  if (runtimeRef.current.connectionStatus === "open") return;
  if (
    runtimeRef.current.connectionStatus === "closed" ||
    runtimeRef.current.connectionStatus === "error"
  ) {
    await runtimeRef.current.connect();
  }
  await waitForClientCondition(
    () => runtimeRef.current.connectionStatus === "open",
    "runtime connection",
    5_000,
  );
}

async function createOrUpdateProjectShape(
  editor: Editor,
  serverBaseUrl: string,
  projectStatus: ProjectStatusResponse,
  moduleRecord: ProjectModuleRecord,
) {
  const source = await fetchJson<ProjectModuleSourceResponse>(
    `${serverBaseUrl}/project/modules/source?path=${
      encodeURIComponent(moduleRecord.path)
    }`,
  );
  const projectRoot = projectStatus.project?.root;
  const shape = findLivecodeShapeByLocator(editor, {
    id: moduleRecord.id,
    path: moduleRecord.path,
  });
  const props = {
    moduleId: moduleRecord.id,
    projectModulePath: moduleRecord.path,
    projectModuleKind: moduleRecord.kind,
    projectSourceUri: projectRoot
      ? fileUrlFromPath(
        `${projectRoot.replace(/\/+$/, "")}/${source.module.sourcePath}`,
      )
      : undefined,
    title: moduleRecord.title,
    source: source.sourceText,
  };
  if (shape) {
    editor.updateShape<LivecodeEditorShape>({
      id: shape.id,
      type: LIVECODE_EDITOR_SHAPE_TYPE,
      props,
    });
    return shape.id;
  }
  return createLivecodeShape(editor, {
    x: moduleRecord.x,
    y: moduleRecord.y,
    w: moduleRecord.w,
    h: moduleRecord.h,
    ...props,
  });
}

async function makeClientControlState(
  editor: Editor | null,
  runtime: LivecodeRuntimeApi,
) {
  const runtimeStatus = await fetchRuntimeStatus(runtime.serverBaseUrl);
  const projectDiagnostics = runtime.projectDiagnostics;
  const activeModuleIds = new Set(
    runtimeStatus.activeModules.map((moduleEntry) => moduleEntry.moduleId),
  );
  const shapes = editor?.getCurrentPageShapes().filter(isLivecodeShape) ?? [];
  return {
    serverBaseUrl: runtime.serverBaseUrl,
    connectionStatus: runtime.connectionStatus,
    lspStatus: runtime.lspStatus,
    moduleCount: shapes.length,
    modules: shapes.map((shape) => {
      const moduleState = runtime.modules[shape.props.moduleId];
      const serverRunning = activeModuleIds.has(shape.props.moduleId);
      return {
        shapeId: shape.id,
        moduleId: shape.props.moduleId,
        title: shape.props.title,
        projectModulePath: shape.props.projectModulePath,
        projectModuleKind: shape.props.projectModuleKind,
        buildStatus: moduleState?.buildStatus ?? "idle",
        runStatus: serverRunning
          ? "running"
          : moduleState?.runStatus === "running"
          ? "stopped"
          : moduleState?.runStatus ?? "idle",
        serverRunning,
        callsiteCount: moduleState?.manifest?.callsites.length ?? 0,
        activeCount: moduleState?.activeIds.length ?? 0,
        sourceVersion: moduleState?.sourceVersion ?? 0,
        latestError: moduleState?.latestError ?? null,
        dependencyStatus: projectDiagnostics?.modules.find((moduleEntry) =>
          moduleEntry.moduleId === shape.props.moduleId
        ) ?? null,
      };
    }),
    dependencyIssueCount: projectDiagnostics?.modules.filter((moduleEntry) =>
      moduleEntry.hasDependencyWarnings
    ).length ?? 0,
    projectDiagnosticsError: runtime.projectDiagnosticsError,
  };
}

async function fetchRuntimeStatus(
  serverBaseUrl: string,
): Promise<{ activeModules: RuntimeModuleStatus[] }> {
  try {
    return await fetchJson<{ activeModules: RuntimeModuleStatus[] }>(
      `${serverBaseUrl}/runtime/status`,
    );
  } catch {
    return { activeModules: [] };
  }
}

function findLivecodeShapeByLocator(
  editor: Editor,
  locator: ProjectModuleLocator,
): LivecodeEditorShape | null {
  const shapes = editor.getCurrentPageShapes().filter(isLivecodeShape);
  if (locator.id) {
    const byId = shapes.find((shape) => shape.props.moduleId === locator.id);
    if (byId) return byId;
  }
  if (locator.path) {
    const byPath = shapes.find(
      (shape) =>
        shape.props.projectModulePath === locator.path ||
        shape.props.moduleId === locator.path,
    );
    if (byPath) return byPath;
  }
  return null;
}

function findProjectModuleRecord(
  modules: ProjectModuleRecord[],
  locator: ProjectModuleLocator,
): ProjectModuleRecord | null {
  if (locator.id) {
    const byId = modules.find((moduleRecord) => moduleRecord.id === locator.id);
    if (byId) return byId;
  }
  if (locator.path) {
    const byPath = modules.find(
      (moduleRecord) =>
        moduleRecord.path === locator.path ||
        moduleRecord.runtimePath === locator.path ||
        moduleRecord.sourcePath === locator.path,
    );
    if (byPath) return byPath;
  }
  return null;
}

async function waitForClientCondition(
  predicate: () => boolean,
  label: string,
  timeoutMs: number,
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function hasLivecodeShapes(editor: Editor) {
  return editor.getCurrentPageShapes().some((shape) =>
    shape.type === LIVECODE_EDITOR_SHAPE_TYPE
  );
}

function isLivecodeShape(record: unknown): record is LivecodeEditorShape {
  if (!record || typeof record !== "object") return false;
  const candidate = record as { typeName?: unknown; type?: unknown };
  return candidate.typeName === "shape" &&
    candidate.type === LIVECODE_EDITOR_SHAPE_TYPE;
}

function hasShapeLayoutChanged(
  before: LivecodeEditorShape,
  after: LivecodeEditorShape,
) {
  return before.x !== after.x ||
    before.y !== after.y ||
    before.props.w !== after.props.w ||
    before.props.h !== after.props.h;
}

function hasPianoRollShapeChanged(
  before: PianoRollShape,
  after: PianoRollShape,
) {
  return before.x !== after.x ||
    before.y !== after.y ||
    before.props.w !== after.props.w ||
    before.props.h !== after.props.h ||
    before.props.rollName !== after.props.rollName;
}

function hasParamPaneShapeChanged(
  before: ParamPaneShape,
  after: ParamPaneShape,
) {
  return before.x !== after.x ||
    before.y !== after.y ||
    before.props.w !== after.props.w ||
    before.props.h !== after.props.h ||
    before.props.paramsName !== after.props.paramsName;
}

function hasSignalScopeShapeChanged(
  before: SignalScopeShape,
  after: SignalScopeShape,
) {
  return before.x !== after.x ||
    before.y !== after.y ||
    before.props.w !== after.props.w ||
    before.props.h !== after.props.h ||
    before.props.sourceType !== after.props.sourceType ||
    before.props.name !== after.props.name ||
    before.props.path !== after.props.path ||
    before.props.windowSec !== after.props.windowSec;
}

/** True for every shape kind persisted in `manifest.canvas`. */
function isCanvasViewShape(record: unknown) {
  return isPianoRollShape(record) || isParamPaneShape(record) ||
    isSignalScopeShape(record);
}

/**
 * Whether one updated record changes what `/project/canvas` would carry. A
 * record that became (or stopped being) a canvas view also counts.
 */
function hasCanvasViewShapeChanged(before: unknown, after: unknown) {
  if (isPianoRollShape(before) && isPianoRollShape(after)) {
    return hasPianoRollShapeChanged(before, after);
  }
  if (isParamPaneShape(before) && isParamPaneShape(after)) {
    return hasParamPaneShapeChanged(before, after);
  }
  if (isSignalScopeShape(before) && isSignalScopeShape(after)) {
    return hasSignalScopeShapeChanged(before, after);
  }
  return isCanvasViewShape(before) || isCanvasViewShape(after);
}

function clearCurrentCanvas(editor: Editor) {
  const shapes = editor.getCurrentPageShapes();
  if (shapes.length > 0) editor.deleteShapes(shapes.map((shape) => shape.id));
}

function createDefaultLivecodeCanvas(editor: Editor) {
  clearCurrentCanvas(editor);
  const moduleId = createLivecodeShape(editor, {
    x: 120,
    y: 120,
    title: "module 1",
  });
  createPianoRollShape(editor, {
    x: 820,
    y: 120,
    rollName: "melody",
  });
  editor.select(moduleId);
  editor.zoomToSelection();
}

async function saveTldrawCanvas(editor: Editor) {
  const json = await serializeTldrawJson(editor);
  const blob = new Blob([json], { type: TLDR_MIME_TYPE });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = `livecode-tldraw-${new Date().toISOString().slice(0, 10)}.tldr`;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function loadTldrawCanvasFromFile(editor: Editor, file: File) {
  await loadTldrawCanvasJson(editor, await file.text(), file.name);
}

async function loadTldrawCanvasFromUrl(editor: Editor, url: string) {
  const resolvedUrl = new URL(url, window.location.href).href;
  const response = await fetch(resolvedUrl);
  if (!response.ok) {
    throw new Error(`${resolvedUrl} failed with ${response.status}: ${await response.text()}`);
  }
  await loadTldrawCanvasJson(editor, await response.text(), resolvedUrl);
}

async function loadTldrawCanvasJson(
  editor: Editor,
  json: string,
  label: string,
) {
  const result = parseTldrawJsonFile({
    json,
    schema: editor.store.schema,
  });
  if (!result.ok) {
    throw new Error(`Could not load ${label}: ${result.error.type}`);
  }

  const snapshot = result.value.getStoreSnapshot();
  editor.loadSnapshot(snapshot);
  editor.clearHistory();
  const bounds = editor.getCurrentPageBounds();
  if (bounds) {
    editor.zoomToBounds(bounds, { targetZoom: 1, immediate: true });
  }
}

async function loadProjectIntoCanvas(
  editor: Editor,
  serverBaseUrl: string,
  projectPath: string,
) {
  const normalizedServerBaseUrl = serverBaseUrl.trim().replace(/\/+$/, "");
  const currentShapes = editor.getCurrentPageShapes();
  if (currentShapes.length > 0) {
    editor.deleteShapes(currentShapes.map((shape) => shape.id));
  }

  const project = await postJson<ProjectCurrentResponse>(
    `${normalizedServerBaseUrl}/project/open`,
    { projectPath },
  );
  const projectRoot = project.project?.root;
  const modules = project.project?.manifest.modules ?? [];
  for (const moduleRecord of modules) {
    const source = await fetchJson<ProjectModuleSourceResponse>(
      `${normalizedServerBaseUrl}/project/modules/source?path=${
        encodeURIComponent(moduleRecord.path)
      }`,
    );
    createLivecodeShape(editor, {
      x: moduleRecord.x,
      y: moduleRecord.y,
      w: moduleRecord.w,
      h: moduleRecord.h,
      moduleId: moduleRecord.id,
      projectModulePath: moduleRecord.path,
      projectModuleKind: moduleRecord.kind,
      projectSourceUri: projectRoot
        ? fileUrlFromPath(
          `${projectRoot.replace(/\/+$/, "")}/${source.module.sourcePath}`,
        )
        : undefined,
      title: moduleRecord.title,
      source: source.sourceText,
    });
  }

  const pianoRollViews = project.project?.manifest.canvas?.pianoRollViews ?? [];
  for (const view of pianoRollViews) {
    const shapeId = view.id as PianoRollShape["id"];
    if (editor.getShape(shapeId)) continue;
    createPianoRollShape(editor, {
      id: shapeId,
      x: view.x,
      y: view.y,
      w: view.w,
      h: view.h,
      rollName: view.rollName,
      title: `piano roll: ${view.rollName}`,
    });
  }

  const paramPaneViews = project.project?.manifest.canvas?.paramPaneViews ?? [];
  for (const view of paramPaneViews) {
    const shapeId = view.id as ParamPaneShape["id"];
    if (editor.getShape(shapeId)) continue;
    createParamPaneShape(editor, {
      id: shapeId,
      x: view.x,
      y: view.y,
      w: view.w,
      h: view.h,
      paramsName: view.paramsName,
      title: `params: ${view.paramsName}`,
    });
  }

  const scopeViews = project.project?.manifest.canvas?.scopeViews ?? [];
  for (const view of scopeViews) {
    const shapeId = view.id as SignalScopeShape["id"];
    if (editor.getShape(shapeId)) continue;
    createSignalScopeShape(editor, {
      id: shapeId,
      x: view.x,
      y: view.y,
      w: view.w,
      h: view.h,
      sourceType: view.sourceType,
      name: view.name,
      path: view.path,
      windowSec: view.windowSec,
      title: describeScopeSource(view.sourceType, view.name, view.path),
    });
  }
}

function fileUrlFromPath(path: string) {
  return `file://${
    path.split("/").map((
      part,
      index,
    ) => (index === 0 ? "" : encodeURIComponent(part))).join("/")
  }`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

function isPianoRollShape(shape: unknown): shape is PianoRollShape {
  return Boolean(
    shape &&
      typeof shape === "object" &&
      "type" in shape &&
      (shape as { type?: unknown }).type === PIANO_ROLL_SHAPE_TYPE,
  );
}

function isParamPaneShape(shape: unknown): shape is ParamPaneShape {
  return Boolean(
    shape &&
      typeof shape === "object" &&
      "type" in shape &&
      (shape as { type?: unknown }).type === PARAM_PANE_SHAPE_TYPE,
  );
}

function isSignalScopeShape(shape: unknown): shape is SignalScopeShape {
  return Boolean(
    shape &&
      typeof shape === "object" &&
      "type" in shape &&
      (shape as { type?: unknown }).type === SIGNAL_SCOPE_SHAPE_TYPE,
  );
}

function hasPianoRollShapes(editor: Editor) {
  return editor.getCurrentPageShapes().some(isPianoRollShape);
}

