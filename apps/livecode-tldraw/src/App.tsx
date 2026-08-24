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
  type Editor,
  parseTldrawJsonFile,
  serializeTldrawJson,
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
  BakedProjectFile,
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
import {
  SyncRuntimeProvider,
  useAnimationTimelinesSync,
  useParamsSync,
  usePianoRollsSync,
  useSignalsSync,
} from "./syncRuntime";
import {
  createSignalScopeShape,
  type SignalScopeSourceType,
} from "./SignalScopeShape";
import {
  CANVAS_VIEW_SHAPE_UTILS,
  collectCanvasViews,
  createAdjacentEntityView,
  createEntityView,
  entityRefForCanvasView,
  hasCanvasViewShapeChanged,
  isCanvasViewShape,
  restoreCanvasViews,
  saveProjectWithCanvas,
} from "./canvasViews";
import { ANIMATION_TIMELINE_ENTITY_TYPE } from "./AnimationEditorShape";
import { setRuntimeDebugRefs } from "./livecodeTldrawDebug";
import { createReconnectingSocket } from "./reconnectingSocket";
import {
  captureBakedEntities,
  createEntity,
  deleteEntity,
  duplicateEntity,
  fetchProjectStatus,
  PARAMS_ENTITY_TYPE,
  PIANO_ROLL_ENTITY_TYPE,
} from "./serverRequests";

const shapeUtils = [
  LivecodeEditorShapeUtil,
  ...CANVAS_VIEW_SHAPE_UTILS,
];
const TLDR_MIME_TYPE = "application/vnd.tldraw+json";

export function App() {
  // The sync provider is outermost because everything else reads from it: the
  // entity shapes take their maps from it directly, and the livecode runtime
  // takes runs/waits/lookups plus its socket lifecycle from it.
  return (
    <SyncRuntimeProvider>
      <LivecodeRuntimeProvider>
        <LivecodeTldrawPage />
      </LivecodeRuntimeProvider>
    </SyncRuntimeProvider>
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
    return params.get("tldr") ?? params.get("canvas") ??
      params.get("canvasUrl");
  }, []);
  // `serverBaseUrl=none` is the serverless baked topology: the project shape
  // comes from the bake's static baked.json instead of project routes.
  const bakedMode = isBakedServerBaseUrl(runtime.serverBaseUrl);
  const projectLoadedRef = useRef(false);
  const canvasLoadedRef = useRef(false);
  const bakedLoadedRef = useRef(false);
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
          console.error(
            "[livecode-tldraw] failed to persist module layout",
            error,
          );
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
      void postJson(`${runtime.serverBaseUrl}/project/canvas`, {
        canvas: collectCanvasViews(shapes),
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

    return unsubscribe;
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
    return () => {
      for (const timer of layoutUpdateTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      layoutUpdateTimersRef.current.clear();
      if (canvasUpdateTimerRef.current !== undefined) {
        window.clearTimeout(canvasUpdateTimerRef.current);
        canvasUpdateTimerRef.current = undefined;
      }
    };
  }, []);

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

  useEffect(() => {
    if (!editor || !bakedMode || projectPath || canvasUrl) return;
    if (bakedLoadedRef.current) return;
    bakedLoadedRef.current = true;

    void (async () => {
      suppressStoreListenerRef.current = true;
      try {
        await loadBakedProjectIntoCanvas(editor);
      } catch (error) {
        // A bake always ships baked.json; missing means this is a plain
        // serverless page, which still deserves a canvas to look at.
        console.error("[livecode-tldraw] failed to load baked project", error);
        if (!hasLivecodeShapes(editor)) createDefaultLivecodeCanvas(editor);
      } finally {
        suppressStoreListenerRef.current = false;
        syncLivecodeShapesToRuntime();
      }
    })();
  }, [bakedMode, canvasUrl, editor, projectPath, syncLivecodeShapesToRuntime]);

  return (
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
            if (
              !projectPath && !canvasUrl && !bakedMode &&
              !hasLivecodeShapes(mountedEditor)
            ) {
              createDefaultLivecodeCanvas(mountedEditor);
            }
          }}
        />
      </div>
    </div>
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
  const paramsRuntime = useParamsSync();
  const pianoRollRuntime = usePianoRollsSync();
  const animationRuntime = useAnimationTimelinesSync();
  const signalsRuntime = useSignalsSync();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [scopeDraft, setScopeDraft] = useState<string | null>(null);
  const [duplicateDraft, setDuplicateDraft] = useState<string | null>(null);
  // The name the delete button is armed for, so a selection change disarms it:
  // a confirm can never land on an entity the operator was not looking at.
  const [deleteArmedName, setDeleteArmedName] = useState<string | null>(null);
  const [entityError, setEntityError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const selection = useSelectedEntity(editor);
  const unsavedCount = useUnsavedEntityCount(
    runtime.serverBaseUrl,
    projectPath,
  );
  const knownParamsNames = useMemo(
    () => Object.keys(paramsRuntime.params).sort(),
    [paramsRuntime.params],
  );
  const knownRollNames = useMemo(
    () => Object.keys(pianoRollRuntime.rolls).sort(),
    [pianoRollRuntime.rolls],
  );
  const knownAnimationNames = useMemo(
    () => Object.keys(animationRuntime.timelines).sort(),
    [animationRuntime.timelines],
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
      return true;
    } catch (error) {
      console.error("[livecode-tldraw] entity action failed", error);
      setEntityError(error instanceof Error ? error.message : String(error));
      return false;
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
      <strong className="topbar__brand">Livecode</strong>

      <div className="topbar__actions">
        <details className="topbar__menu" name="livecode-topbar-menu">
          <summary>Server</summary>
          <div className="topbar__panel">
            <label htmlFor="server-url">Server URL</label>
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
        </details>

        <details className="topbar__menu" name="livecode-topbar-menu">
          <summary>Canvas</summary>
          <div className="topbar__panel topbar__panel--stack">
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
          </div>
        </details>
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
                console.error(
                  "[livecode-tldraw] failed to open .tldr file",
                  error,
                );
              });
            }
          }}
        />

        <details className="topbar__menu" name="livecode-topbar-menu">
          <summary>Add</summary>
          <div className="topbar__panel topbar__panel--stack">
            <button
              type="button"
              disabled={!editor}
              onClick={() => {
                if (editor) createLivecodeShape(editor);
              }}
            >
              New module
            </button>
            <EntityViewCreator
              editor={editor}
              buttonLabel="New piano roll"
              submitLabel="Add roll"
              placeholder="piano roll name"
              datalistId="topbar-roll-names"
              knownNames={knownRollNames}
              onAdd={(name) =>
                runEntityAction(async () => {
                  if (!knownRollNames.includes(name)) {
                    await createEntity(
                      runtime.serverBaseUrl,
                      PIANO_ROLL_ENTITY_TYPE,
                      name,
                    );
                  }
                  if (editor) {
                    createEntityView(editor, PIANO_ROLL_ENTITY_TYPE, name);
                  }
                })}
            />
            <EntityViewCreator
              editor={editor}
              buttonLabel="New params pane"
              submitLabel="Add pane"
              placeholder="params name"
              datalistId="topbar-params-names"
              knownNames={knownParamsNames}
              initialName={knownParamsNames[0] ?? ""}
              onAdd={async (name) => {
                if (!editor) return false;
                createEntityView(editor, PARAMS_ENTITY_TYPE, name);
                return true;
              }}
            />
            <EntityViewCreator
              editor={editor}
              buttonLabel="New animation"
              submitLabel="Add animation"
              placeholder="animation name"
              datalistId="topbar-animation-names"
              knownNames={knownAnimationNames}
              onAdd={(name) =>
                runEntityAction(async () => {
                  if (!knownAnimationNames.includes(name)) {
                    await createEntity(
                      runtime.serverBaseUrl,
                      ANIMATION_TIMELINE_ENTITY_TYPE,
                      name,
                    );
                  }
                  if (editor) {
                    createEntityView(
                      editor,
                      ANIMATION_TIMELINE_ENTITY_TYPE,
                      name,
                    );
                  }
                })}
            />
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
                    onChange={(event) =>
                      setScopeDraft(event.currentTarget.value)}
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
                  <button
                    type="submit"
                    disabled={!editor || !scopeDraft.trim()}
                  >
                    Add scope
                  </button>
                  <button type="button" onClick={() => setScopeDraft(null)}>
                    Cancel
                  </button>
                </form>
              )}
          </div>
        </details>

        {selection
          ? (
            <details className="topbar__menu" name="livecode-topbar-menu">
              <summary>Entity</summary>
              <div className="topbar__panel topbar__panel--stack">
                <span className="topbar__selection-name">
                  {selection.type}: {selection.name}
                </span>
                {duplicateDraft === null
                  ? (
                    <button
                      type="button"
                      onClick={() =>
                        setDuplicateDraft(`${selection.name}-copy`)}
                    >
                      Duplicate entity
                    </button>
                  )
                  : (
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
                          createAdjacentEntityView(
                            editor,
                            selection.type,
                            targetName,
                          );
                          setDuplicateDraft(null);
                        });
                      }}
                    >
                      <input
                        autoFocus
                        placeholder={`copy of ${selection.name}`}
                        value={duplicateDraft}
                        spellCheck={false}
                        onChange={(event) =>
                          setDuplicateDraft(event.currentTarget.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") setDuplicateDraft(null);
                        }}
                      />
                      <button
                        type="submit"
                        disabled={!editor || !duplicateDraft.trim()}
                      >
                        Duplicate
                      </button>
                      <button
                        type="button"
                        onClick={() => setDuplicateDraft(null)}
                      >
                        Cancel
                      </button>
                    </form>
                  )}
                <button
                  type="button"
                  className="topbar__danger"
                  onClick={() => {
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
              </div>
            </details>
          )
          : null}

        {isBakedServerBaseUrl(runtime.serverBaseUrl)
          ? (
            <button
              type="button"
              className="topbar__primary"
              onClick={() => {
                setSaveNotice(null);
                void runEntityAction(async () => {
                  setSaveNotice(await exportBakedDataFile());
                });
              }}
            >
              Export data
            </button>
          )
          : null}

        {projectPath
          ? (
            <div className="topbar__save">
              <button
                type="button"
                className="topbar__primary"
                disabled={!editor}
                onClick={() => {
                  setSaveNotice(null);
                  void runEntityAction(async () => {
                    if (!editor) throw new Error("No canvas is mounted yet");
                    setSaveNotice(describeProjectSave(
                      await saveProjectWithCanvas(
                        editor,
                        runtime.serverBaseUrl,
                      ),
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
            </div>
          )
          : null}
      </div>

      <div className="topbar__status">
        <span
          className={`status-pill status-pill--${runtime.connectionStatus}`}
        >
          {runtime.connectionStatus}
        </span>
        <span className={`status-pill status-pill--${runtime.lspStatus}`}>
          lsp: {runtime.lspStatus}
        </span>
        <span className="topbar__secondary-status">{moduleCount} modules</span>
        {changedDependencyCount > 0
          ? <span>{changedDependencyCount} dependency updates</span>
          : null}
        {dependencyIssueCount > 0
          ? (
            <span className="topbar__error">
              {dependencyIssueCount} dependency issues
            </span>
          )
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
        {saveNotice
          ? <span className="topbar__notice">{saveNotice}</span>
          : null}
      </div>
    </div>
  );
}

function EntityViewCreator({
  editor,
  buttonLabel,
  submitLabel,
  placeholder,
  datalistId,
  knownNames,
  initialName = "",
  onAdd,
}: {
  editor: Editor | null;
  buttonLabel: string;
  submitLabel: string;
  placeholder: string;
  datalistId: string;
  knownNames: string[];
  initialName?: string;
  onAdd(name: string): Promise<boolean>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  if (draft === null) {
    return (
      <button
        type="button"
        disabled={!editor}
        onClick={() => setDraft(initialName)}
      >
        {buttonLabel}
      </button>
    );
  }

  return (
    <form
      className="topbar__group"
      onSubmit={(event) => {
        event.preventDefault();
        const name = draft.trim();
        if (!editor || !name || submitting) return;
        setSubmitting(true);
        void onAdd(name).then((ok) => {
          if (ok) setDraft(null);
        }).finally(() => setSubmitting(false));
      }}
    >
      <input
        autoFocus
        list={datalistId}
        placeholder={placeholder}
        value={draft}
        spellCheck={false}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setDraft(null);
        }}
      />
      <datalist id={datalistId}>
        {knownNames.map((name) => <option key={name} value={name} />)}
      </datalist>
      <button type="submit" disabled={!editor || !draft.trim() || submitting}>
        {submitLabel}
      </button>
      <button type="button" onClick={() => setDraft(null)}>
        Cancel
      </button>
    </form>
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
  return entityRefForCanvasView(editor?.getOnlySelectedShape());
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
    // "none" is the serverless baked topology: no control bridge to open.
    if (!normalizedServerBaseUrl || normalizedServerBaseUrl === "none") return;

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
    dependencyIssueCount:
      projectDiagnostics?.modules.filter((moduleEntry) =>
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
  createEntityView(editor, PIANO_ROLL_ENTITY_TYPE, "melody", {
    x: 820,
    y: 120,
  });
  editor.select(moduleId);
  editor.zoomToSelection();
}

async function saveTldrawCanvas(editor: Editor) {
  const json = await serializeTldrawJson(editor);
  downloadTextFile(
    `livecode-tldraw-${new Date().toISOString().slice(0, 10)}.tldr`,
    json,
    TLDR_MIME_TYPE,
  );
}

/** True when `serverBaseUrl=none` — the serverless baked topology. */
function isBakedServerBaseUrl(serverBaseUrl: string): boolean {
  return serverBaseUrl.trim().replace(/\/+$/, "") === "none";
}

/**
 * The baked topology's save, export-only by decision: one JSON download of the
 * durable entities the engine tab holds, as the same `{type, name, data}` rows
 * baked.json carries, so a future bake or import can consume it directly.
 * Returns the notice text for the topbar.
 */
async function exportBakedDataFile(): Promise<string> {
  const { entities, skippedCount } = await captureBakedEntities();
  const json = JSON.stringify(
    { exportedAt: new Date().toISOString(), data: entities },
    null,
    2,
  ) + "\n";
  downloadTextFile(
    `livecode-data-${
      new Date().toISOString().slice(0, 19).replaceAll(":", "-")
    }.json`,
    json,
    "application/json",
  );
  const noun = entities.length === 1 ? "entity" : "entities";
  const skippedNote = skippedCount > 0 ? ` (${skippedCount} skipped)` : "";
  return `exported ${entities.length} ${noun}${skippedNote}`;
}

function downloadTextFile(filename: string, text: string, mimeType: string) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
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
    throw new Error(
      `${resolvedUrl} failed with ${response.status}: ${await response.text()}`,
    );
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

  restoreCanvasViews(editor, project.project?.manifest.canvas);
}

/**
 * The serverless project-shaped boot (Setup A): manifest layout and module
 * sources come from the bake's static baked.json instead of project routes.
 * Code shapes are read-only — a bake's code is display, not editable source —
 * and carry no projectModulePath, so nothing ever tries to persist layout or
 * writes for them.
 */
async function loadBakedProjectIntoCanvas(editor: Editor) {
  const baked = await fetchJson<BakedProjectFile>(
    new URL("engine/baked.json", window.location.href).href,
  );
  const currentShapes = editor.getCurrentPageShapes();
  if (currentShapes.length > 0) {
    editor.deleteShapes(currentShapes.map((shape) => shape.id));
  }

  const sourceByModuleId = new Map(
    baked.modules.map((entry) => [entry.moduleId, entry.sourceText]),
  );
  for (const moduleRecord of baked.manifest.modules) {
    createLivecodeShape(editor, {
      x: moduleRecord.x,
      y: moduleRecord.y,
      w: moduleRecord.w,
      h: moduleRecord.h,
      moduleId: moduleRecord.id,
      projectModuleKind: moduleRecord.kind,
      title: moduleRecord.title,
      source: sourceByModuleId.get(moduleRecord.id) ?? "",
      readOnly: true,
    });
  }

  restoreCanvasViews(editor, baked.manifest.canvas);
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
