import { type MutableRefObject, useEffect, useRef } from "react";
import type { Editor } from "tldraw";
import {
  createLivecodeShape,
  LIVECODE_EDITOR_SHAPE_TYPE,
  type LivecodeEditorShape,
} from "./LivecodeEditorShape";
import type {
  ClientControlCommand,
  ClientControlEnvelope,
  ClientControlResultMessage,
  ProjectModuleLocator,
  ProjectModuleRecord,
  ProjectModuleSourceResponse,
  ProjectStatusResponse,
  RuntimeModuleStatus,
} from "./livecodeProtocol";
import type { LivecodeRuntimeApi } from "./livecodeRuntime";
import { createReconnectingSocket } from "./reconnectingSocket";
import {
  fetchJson,
  fileUrlFromPath,
  isLivecodeShape,
  loadProjectIntoCanvas,
  postJson,
} from "./projectCanvas";

export function useClientControlBridge(
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
