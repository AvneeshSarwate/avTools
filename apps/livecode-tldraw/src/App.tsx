import {
  type MutableRefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createShapeId, type Editor, Tldraw } from "tldraw";
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
import { PianoRollRuntimeProvider } from "./pianoRollRuntime";
import {
  PIANO_ROLL_SHAPE_TYPE,
  type PianoRollShape,
  PianoRollShapeUtil,
} from "./PianoRollShape";

const shapeUtils = [LivecodeEditorShapeUtil, PianoRollShapeUtil];

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
  const projectLoadedRef = useRef(false);

  useClientControlBridge(editor, runtime);

  useEffect(() => {
    if (!editor) return;

    for (const shape of editor.getCurrentPageShapes()) {
      if (isLivecodeShape(shape)) {
        registerModule(
          shape.props.moduleId,
          shape.props.source,
          shape.props.projectModulePath,
        );
      }
    }

    return editor.store.listen(
      (entry) => {
        for (const record of Object.values(entry.changes.added)) {
          if (isLivecodeShape(record)) {
            registerModule(
              record.props.moduleId,
              record.props.source,
              record.props.projectModulePath,
            );
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
          }
        }

        for (const record of Object.values(entry.changes.removed)) {
          if (isLivecodeShape(record)) {
            unregisterModule(record.props.moduleId);
          }
        }
      },
      { source: "all", scope: "document" },
    );
  }, [editor, registerModule, setModuleSource, unregisterModule]);

  useEffect(() => {
    if (!editor || !projectPath || projectLoadedRef.current) return;
    projectLoadedRef.current = true;

    void loadProjectIntoCanvas(editor, runtime.serverBaseUrl, projectPath)
      .then(() => {
        if (runtime.connectionStatus === "closed") {
          void runtime.connect();
        }
      })
      .catch((error) => {
        console.error("[livecode-tldraw] failed to load project", error);
      });
  }, [editor, projectPath, runtime]);

  return (
    <PianoRollRuntimeProvider serverBaseUrl={runtime.serverBaseUrl}>
      <div className="app-shell">
        <TopBar editor={editor} />
        <div className="canvas-shell">
          <Tldraw
            shapeUtils={shapeUtils}
            onMount={(mountedEditor) => {
              setEditor(mountedEditor);
              if (!projectPath && !hasLivecodeShapes(mountedEditor)) {
                createLivecodeShape(mountedEditor, {
                  x: 120,
                  y: 120,
                  title: "module 1",
                });
              }
              if (!projectPath && !hasPianoRollShapes(mountedEditor)) {
                createPianoRollShape(mountedEditor, {
                  x: 820,
                  y: 120,
                  rollName: "melody",
                });
              }
            }}
          />
        </div>
      </div>
    </PianoRollRuntimeProvider>
  );
}

function TopBar({ editor }: { editor: Editor | null }) {
  const runtime = useLivecodeRuntime();
  const moduleCount = useMemo(() => Object.keys(runtime.modules).length, [
    runtime.modules,
  ]);

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
          if (editor) createLivecodeShape(editor);
        }}
      >
        New module
      </button>

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

    let closed = false;
    let reconnectTimer: number | null = null;
    let socket: WebSocket | null = null;
    const socketUrl = `${
      normalizedServerBaseUrl.replace(/^http/, "ws")
    }/client/control?clientId=${encodeURIComponent(clientIdRef.current)}`;

    const connect = () => {
      if (closed) return;
      socket = new WebSocket(socketUrl);

      socket.onmessage = (event) => {
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

        const responseSocket = socket;
        void executeClientControlCommand(
          envelope.command,
          editorRef,
          runtimeRef,
        )
          .then((result) => {
            sendClientControlResult(responseSocket, {
              type: "clientCommandResult",
              commandId: envelope.commandId,
              ok: true,
              result,
            });
          })
          .catch((error: unknown) => {
            sendClientControlResult(responseSocket, {
              type: "clientCommandResult",
              commandId: envelope.commandId,
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          });
      };

      socket.onclose = () => {
        if (closed) return;
        reconnectTimer = window.setTimeout(connect, 1_000);
      };
      socket.onerror = () => {
        socket?.close();
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      socket?.close();
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
      };
    }),
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

function createLivecodeShape(
  editor: Editor,
  options: {
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    moduleId?: string;
    projectModulePath?: string;
    projectModuleKind?: "library" | "runnable";
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
  options: Partial<PianoRollShape["props"]> & { x?: number; y?: number } = {},
) {
  const id = createShapeId();
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
