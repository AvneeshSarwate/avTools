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
} from "tldraw";
import { DEFAULT_LIVECODE_SOURCE } from "./defaultSource";
import {
  createModuleId,
  LIVECODE_EDITOR_SHAPE_TYPE,
  type LivecodeEditorShape,
  LivecodeEditorShapeUtil,
} from "./LivecodeEditorShape";
import type {
  ClientControlCommand,
  ClientControlEnvelope,
  ClientControlResultMessage,
  ProjectCurrentResponse,
  ProjectModuleLocator,
  ProjectModuleRecord,
  ProjectModuleSourceResponse,
  ProjectStatusResponse,
  RuntimeModuleStatus,
} from "./livecodeProtocol";
import {
  type LivecodeRuntimeApi,
  LivecodeRuntimeProvider,
  useLivecodeRuntime,
} from "./livecodeRuntime";
import { ParamsRuntimeProvider, useParamsRuntime } from "./paramsRuntime";
import { createParamPaneShape, ParamPaneShapeUtil } from "./ParamPaneShape";
import { PianoRollRuntimeProvider } from "./pianoRollRuntime";
import {
  PIANO_ROLL_SHAPE_TYPE,
  type PianoRollShape,
  PianoRollShapeUtil,
} from "./PianoRollShape";
import { setRuntimeDebugRefs } from "./livecodeTldrawDebug";
import { createReconnectingSocket } from "./reconnectingSocket";

const shapeUtils = [
  LivecodeEditorShapeUtil,
  PianoRollShapeUtil,
  ParamPaneShapeUtil,
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

  const schedulePianoRollCanvasUpdate = useCallback(() => {
    if (!editor || !projectPath) return;
    if (canvasUpdateTimerRef.current !== undefined) {
      window.clearTimeout(canvasUpdateTimerRef.current);
    }
    canvasUpdateTimerRef.current = window.setTimeout(() => {
      canvasUpdateTimerRef.current = undefined;
      const pianoRollViews = editor
        .getCurrentPageShapes()
        .filter(isPianoRollShape)
        .map((shape) => ({
          id: shape.id,
          rollName: shape.props.rollName,
          x: shape.x,
          y: shape.y,
          w: shape.props.w,
          h: shape.props.h,
        }));
      void postJson(`${runtime.serverBaseUrl}/project/canvas`, {
        canvas: { pianoRollViews },
      }).catch((error) => {
        console.error(
          "[livecode-tldraw] failed to persist piano-roll layout",
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
          } else if (isPianoRollShape(record)) {
            schedulePianoRollCanvasUpdate();
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
          } else if (isPianoRollShape(before) !== isPianoRollShape(after)) {
            schedulePianoRollCanvasUpdate();
          } else if (
            isPianoRollShape(before) &&
            isPianoRollShape(after) &&
            hasPianoRollShapeChanged(before, after)
          ) {
            schedulePianoRollCanvasUpdate();
          }
        }

        for (const record of Object.values(entry.changes.removed)) {
          if (isLivecodeShape(record)) {
            unregisterModule(record.props.moduleId);
          } else if (isPianoRollShape(record)) {
            schedulePianoRollCanvasUpdate();
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
    scheduleProjectModuleLayoutUpdate,
    schedulePianoRollCanvasUpdate,
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
        <div className="app-shell">
          <TopBar editor={editor} onOpenTldrawFile={loadTldrawFile} />
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
      </ParamsRuntimeProvider>
    </PianoRollRuntimeProvider>
  );
}

function TopBar({
  editor,
  onOpenTldrawFile,
}: {
  editor: Editor | null;
  onOpenTldrawFile: (file: File) => Promise<void>;
}) {
  const runtime = useLivecodeRuntime();
  const paramsRuntime = useParamsRuntime();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // null while the inline params-name input is closed. Non-modal by design: the
  // canvas stays interactive while it is open.
  const [paramPaneDraft, setParamPaneDraft] = useState<string | null>(null);
  const knownParamsNames = useMemo(
    () => Object.keys(paramsRuntime.params).sort(),
    [paramsRuntime.params],
  );
  const moduleCount = useMemo(() => Object.keys(runtime.modules).length, [
    runtime.modules,
  ]);
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
      </div>
    </div>
  );
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
    await runtimeRef.current.runModule(shape.props.moduleId);
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

function createLivecodeShape(
  editor: Editor,
  options: {
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    moduleId?: string;
    projectModulePath?: string;
    projectModuleKind?: "runnable";
    projectSourceUri?: string;
    title?: string;
    source?: string;
  } = {},
) {
  const id = createShapeId();
  const moduleId = options.moduleId ?? createModuleId();
  const center = editor.getViewportPageBounds().center;
  editor.createShape<LivecodeEditorShape>({
    id,
    type: LIVECODE_EDITOR_SHAPE_TYPE,
    x: options.x ?? center.x - 320,
    y: options.y ?? center.y - 260,
    props: {
      w: options.w ?? 640,
      h: options.h ?? 520,
      moduleId,
      projectModulePath: options.projectModulePath,
      projectModuleKind: options.projectModuleKind,
      projectSourceUri: options.projectSourceUri,
      title: options.title ?? `module ${moduleId.slice(7, 15)}`,
      source: options.source ?? DEFAULT_LIVECODE_SOURCE,
    },
  });
  editor.select(id);
  return id;
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

function hasPianoRollShapes(editor: Editor) {
  return editor.getCurrentPageShapes().some(isPianoRollShape);
}

function createPianoRollShape(
  editor: Editor,
  options:
    & Partial<PianoRollShape["props"]>
    & { x?: number; y?: number; id?: PianoRollShape["id"] } = {},
) {
  const id = options.id ?? createShapeId();
  const rollName = options.rollName ?? "melody";
  editor.createShape<PianoRollShape>({
    id,
    type: PIANO_ROLL_SHAPE_TYPE,
    x: options.x ?? 820,
    y: options.y ?? 120,
    props: {
      w: options.w ?? 560,
      h: options.h ?? 360,
      rollName,
      title: options.title ?? `piano roll: ${rollName}`,
      showControlPanel: options.showControlPanel ?? true,
      interactive: options.interactive ?? true,
    },
  });
  editor.select(id);
  return id;
}
