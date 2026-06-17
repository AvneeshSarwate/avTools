import { launch, type TimeContext } from "@avtools/core-timing";
import { LSWSServer } from "@valtown/ls-ws-server";
import {
  basename,
  dirname,
  fromFileUrl,
  isAbsolute,
  join,
  normalize,
} from "jsr:@std/path@1";
import { pathToFileURL } from "node:url";
import { analyzeAndTransformTimedModule } from "./analyze_transform.ts";
import { createGeneratedRunId } from "./generated_run_id.ts";
import type {
  ActiveWaitSnapshot,
  AddProjectModuleRequest,
  AnalyzeRequest,
  AnalyzeResponse,
  ClientControlClientsResponse,
  ClientControlCommandResponse,
  ClientControlEnvelope,
  ClientControlRequest,
  ClientControlResultMessage,
  CreateProjectRequest,
  HealthResponse,
  LaunchModuleRequest,
  LivecodeProjectManifest,
  OpenProjectRequest,
  PianoRollHistoryRequest,
  ProjectCurrentResponse,
  ProjectModuleInput,
  ProjectModuleRecord,
  ProjectModuleSourceResponse,
  ProjectModuleStatus,
  ProjectStatusResponse,
  ReloadProjectModuleRequest,
  RemoveProjectModuleRequest,
  RuntimeModuleStatus,
  SetPianoRollRequest,
  StopModuleRequest,
  UpdateProjectModuleRequest,
  WriteProjectModuleRequest,
} from "./protocol.ts";
import {
  makePianoRollSnapshot,
  redoPianoRoll,
  seedDemoPianoRoll,
  setPianoRoll,
  undoPianoRoll,
} from "./piano_roll_store.ts";
import { clearModuleWaits, makeActiveWaitSnapshot } from "./runtime.ts";

interface BranchHandle {
  cancel: () => void;
  finally: (f: () => void) => void;
}

type ModuleStopFunc = () => void | Promise<void>;

interface ActiveModule {
  moduleId: string;
  generatedRunId: string;
  transformedModuleUri: string;
  handle: BranchHandle;
  stopFunc?: ModuleStopFunc;
  projectModulePath?: string;
  sourceHash?: string;
  projectSourceHash?: string;
}

interface PreparedRun {
  moduleId: string;
  generatedRunId: string;
  transformedModuleUri: string;
  projectModulePath?: string;
  sourceHash?: string;
  projectSourceHash?: string;
}

interface ClientControlSocket {
  clientId: string;
  socket: WebSocket;
  connectedAt: number;
}

interface PendingClientCommand {
  clientId: string;
  resolve: (value: ClientControlCommandResponse) => void;
  timer: number;
}

interface ProjectModuleHashes {
  editorHash: string | null;
  lastLoadedHash: string | null;
}

interface ProjectState {
  root: string;
  manifestPath: string;
  manifest: LivecodeProjectManifest;
  hashes: Map<string, ProjectModuleHashes>;
}

interface ProjectMaterializeResult {
  generatedRunId: string;
  projectSourceHash: string;
  sourceHashes: Map<string, string>;
  results: Map<string, AnalyzeResponse>;
}

export interface LivecodeVisualizerServerOptions {
  host?: string;
  port?: number;
  sessionRoot?: string;
  logLevel?: "debug" | "info";
}

export interface LivecodeVisualizerServer {
  baseUrl: string;
  host: string;
  port: number;
  sessionRoot: string;
  close: () => Promise<void>;
}

const SERVER_VERSION = "0.1.0";
const PROJECT_MANIFEST_FILENAME = "project.avtools-livecode.json";
const SOURCE_SUFFIX = ".orig.ts";
const REPO_ROOT = fromFileUrl(new URL("../../../..", import.meta.url));
const STOP_HOOK_TIMEOUT_MS = 2_000;
const DEFAULT_SESSION_ROOT = fromFileUrl(
  new URL("../../.avtools-livecode-sessions", import.meta.url),
);
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};
const NOOP_LSP_LOGGER = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
};

export async function createLivecodeVisualizerServer(
  options: LivecodeVisualizerServerOptions = {},
): Promise<LivecodeVisualizerServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const sessionRoot = options.sessionRoot
    ? resolvePath(options.sessionRoot)
    : DEFAULT_SESSION_ROOT;
  const sessionId = crypto.randomUUID();
  const sessionDir = join(sessionRoot, sessionId);
  const modulesDir = join(sessionDir, "modules");
  const generatedDir = join(sessionDir, "generated");
  const lspWorkspacesDir = join(
    Deno.env.get("TMPDIR") ?? "/tmp",
    "avtools-livecode-lsp-workspaces",
    sessionId,
  );
  const logsDir = join(sessionRoot, "logs");
  const lspLogsDir = join(logsDir, "lsp");
  const logPath = join(logsDir, "server.log");

  await Deno.mkdir(modulesDir, { recursive: true });
  await Deno.mkdir(generatedDir, { recursive: true });
  await Deno.mkdir(lspWorkspacesDir, { recursive: true });
  await Deno.mkdir(logsDir, { recursive: true });
  await Deno.mkdir(lspLogsDir, { recursive: true });

  const sockets = new Set<WebSocket>();
  const pianoRollSockets = new Set<WebSocket>();
  const clientControlSockets = new Map<string, ClientControlSocket>();
  const pendingClientCommands = new Map<string, PendingClientCommand>();
  const activeModules = new Map<string, ActiveModule>();
  const preparedRuns = new Map<string, PreparedRun>();
  const launchQueue: Array<(ctx: TimeContext) => Promise<void> | void> = [];
  let currentProject: ProjectState | null = null;
  let parentContext: TimeContext | null = null;
  let lastSnapshotJson = "";
  let snapshotTimer: number | undefined;
  let pianoRollSnapshotTimer: number | undefined;
  let closing = false;

  const log = async (entry: Record<string, unknown>) => {
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      ...entry,
    });
    console.log(line);
    await Deno.writeTextFile(logPath, `${line}\n`, {
      append: true,
      create: true,
    });
  };

  const runtimeCapabilities = makeRuntimeCapabilityStatus();
  if (runtimeCapabilities.warnings.length > 0) {
    await log({
      type: "runtimeCapabilityWarning",
      ...runtimeCapabilities,
    });
  }

  const parentHandle = launch(async (ctx) => {
    parentContext = ctx;
    await log({ type: "parentLoopStarted" });
    while (!closing) {
      const queued = launchQueue.splice(0);
      for (const action of queued) {
        await action(ctx);
      }
      try {
        await ctx.waitSec(0.03);
      } catch (error) {
        if (closing || isAbortError(error)) break;
        throw error;
      }
    }
  }, { bpm: 60, debugName: "livecode-visualizer-parent" });
  parentHandle.catch(() => {
    // Expected when the server shuts down.
  });

  if (!Deno.env.get("CRASH_LOG_LINE_COUNT")) {
    Deno.env.set("CRASH_LOG_LINE_COUNT", "40");
  }
  const lspWsServer = new LSWSServer({
    lsCommand: Deno.execPath(),
    lsArgs: [
      "run",
      "--allow-all",
      fromFileUrl(new URL("./lsp_proxy.ts", import.meta.url)),
      "--repo-root",
      REPO_ROOT,
      "--workspace-root",
      lspWorkspacesDir,
    ],
    maxProcs: 4,
    shutdownAfter: 60 * 30,
    lsStdoutLogPath: join(lspLogsDir, "proxy-stdout.log"),
    lsStderrLogPath: join(lspLogsDir, "proxy-stderr.log"),
    logger: NOOP_LSP_LOGGER,
    onProcError: (sessionId, error) => {
      void log({
        type: "lspProcessError",
        sessionId,
        message: error.message,
      });
    },
    onProcExit: (sessionId, code) => {
      void log({
        type: "lspProcessExit",
        sessionId,
        code,
      });
    },
  });

  snapshotTimer = setInterval(() => {
    const snapshot = makeActiveWaitSnapshot();
    const snapshotJson = JSON.stringify(snapshot.modules);
    if (snapshotJson === lastSnapshotJson) return;
    lastSnapshotJson = snapshotJson;
    const payload = JSON.stringify(snapshot);
    for (const socket of sockets) {
      if (socket.readyState === WebSocket.OPEN) socket.send(payload);
    }
    if (options.logLevel === "debug") {
      void log({
        type: "snapshot",
        activeModuleCount: Object.keys(snapshot.modules).length,
        activeCallsiteCount: Object.values(snapshot.modules).reduce(
          (sum, ids) => sum + ids.length,
          0,
        ),
      });
    }
  }, 33) as unknown as number;

  seedDemoPianoRoll();
  pianoRollSnapshotTimer = setInterval(() => {
    const snapshot = makePianoRollSnapshot();
    if (!snapshot) return;
    const payload = JSON.stringify(snapshot);
    for (const socket of pianoRollSockets) {
      if (socket.readyState === WebSocket.OPEN) socket.send(payload);
    }
    if (options.logLevel === "debug") {
      void log({
        type: "pianoRollSnapshot",
        rollCount: Object.keys(snapshot.rolls).length,
      });
    }
  }, 100) as unknown as number;

  const handler = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      const response: HealthResponse = {
        ok: true,
        serverVersion: SERVER_VERSION,
        sessionRoot,
        activeModules: [...activeModules.keys()],
        runtimeCapabilities,
      };
      return json(response);
    }

    if (request.method === "GET" && url.pathname === "/client/clients") {
      const response: ClientControlClientsResponse = {
        ok: true,
        clients: [...clientControlSockets.values()].map((client) => ({
          clientId: client.clientId,
          connectedAt: client.connectedAt,
        })),
      };
      return json(response);
    }

    if (request.method === "POST" && url.pathname === "/client/command") {
      const requestBody = await request.json() as ClientControlRequest;
      return json(await sendClientControlCommand(requestBody));
    }

    if (request.method === "POST" && url.pathname === "/runtime/analyze") {
      const requestBody = await request.json() as AnalyzeRequest;
      return json(await analyzeModule(requestBody));
    }

    if (request.method === "POST" && url.pathname === "/runtime/launch") {
      const requestBody = await request.json() as LaunchModuleRequest;
      await launchModule(requestBody);
      return json({ ok: true });
    }

    if (request.method === "POST" && url.pathname === "/runtime/stop") {
      const requestBody = await request.json() as StopModuleRequest;
      await stopModule(requestBody.moduleId, "stopRequest");
      return json({ ok: true });
    }

    if (request.method === "GET" && url.pathname === "/runtime/status") {
      return json({ ok: true, activeModules: listRuntimeStatus() });
    }

    if (request.method === "POST" && url.pathname === "/runtime/stop-all") {
      await stopAllModules("stopAllRequest");
      return json({ ok: true });
    }

    if (request.method === "POST" && url.pathname === "/runtime/restart-all") {
      await stopAllModules("restartAllRequest");
      if (currentProject) await materializeProjectRuntime(currentProject);
      return json({ ok: true, activeModules: listRuntimeStatus() });
    }

    if (request.method === "POST" && url.pathname === "/project/create") {
      const requestBody = await request.json() as CreateProjectRequest;
      return json(await createProject(requestBody));
    }

    if (request.method === "POST" && url.pathname === "/project/open") {
      const requestBody = await request.json() as OpenProjectRequest;
      return json(await openProject(requestBody.projectPath));
    }

    if (request.method === "POST" && url.pathname === "/project/save") {
      if (!currentProject) {
        return json({ ok: false, error: "No project open" }, { status: 400 });
      }
      await writeProjectManifest(currentProject);
      return json(await makeProjectCurrentResponse());
    }

    if (request.method === "GET" && url.pathname === "/project/current") {
      return json(await makeProjectCurrentResponse());
    }

    if (request.method === "GET" && url.pathname === "/project/status") {
      return json(await makeProjectStatusResponse());
    }

    if (
      request.method === "GET" && url.pathname === "/project/modules/source"
    ) {
      return json(
        await makeProjectModuleSourceResponse({
          id: url.searchParams.get("id") ?? undefined,
          path: url.searchParams.get("path") ?? undefined,
        }),
      );
    }

    if (request.method === "GET" && url.pathname === "/project/events") {
      return json(await makeProjectStatusResponse());
    }

    if (request.method === "POST" && url.pathname === "/project/modules/add") {
      const requestBody = await request.json() as AddProjectModuleRequest;
      return json(await addProjectModule(requestBody));
    }

    if (
      request.method === "POST" && url.pathname === "/project/modules/update"
    ) {
      const requestBody = await request.json() as UpdateProjectModuleRequest;
      return json(await updateProjectModule(requestBody));
    }

    if (
      request.method === "POST" && url.pathname === "/project/modules/write"
    ) {
      const requestBody = await request.json() as WriteProjectModuleRequest;
      return json(await writeProjectModule(requestBody));
    }

    if (
      request.method === "POST" && url.pathname === "/project/modules/reload"
    ) {
      const requestBody = await request.json() as ReloadProjectModuleRequest;
      return json(await reloadProjectModule(requestBody));
    }

    if (
      request.method === "POST" && url.pathname === "/project/modules/remove"
    ) {
      const requestBody = await request.json() as RemoveProjectModuleRequest;
      return json(await removeProjectModule(requestBody));
    }

    if (request.method === "GET" && url.pathname === "/piano-roll/snapshots") {
      const { socket, response } = Deno.upgradeWebSocket(request);
      socket.onopen = () => {
        pianoRollSockets.add(socket);
        socket.send(JSON.stringify(makePianoRollSnapshot({ force: true })));
      };
      socket.onclose = () => pianoRollSockets.delete(socket);
      socket.onerror = () => pianoRollSockets.delete(socket);
      return response;
    }

    if (request.method === "GET" && url.pathname === "/piano-roll/list") {
      return json(makePianoRollSnapshot({ force: true }));
    }

    if (request.method === "POST" && url.pathname === "/piano-roll/set") {
      const requestBody = await request.json() as SetPianoRollRequest;
      return json(setPianoRoll(requestBody.name, requestBody.data, {
        label: requestBody.label,
        source: requestBody.source ?? "client",
        originId: requestBody.originId,
        undoable: requestBody.undoable,
      }));
    }

    if (request.method === "POST" && url.pathname === "/piano-roll/undo") {
      const requestBody = await request.json() as PianoRollHistoryRequest;
      return json(
        undoPianoRoll(requestBody.name, { originId: requestBody.originId }) ??
          { ok: false },
      );
    }

    if (request.method === "POST" && url.pathname === "/piano-roll/redo") {
      const requestBody = await request.json() as PianoRollHistoryRequest;
      return json(
        redoPianoRoll(requestBody.name, { originId: requestBody.originId }) ??
          { ok: false },
      );
    }

    if (request.method === "GET" && url.pathname === "/lsp") {
      const session = url.searchParams.get("session");
      if (!session) {
        return new Response("Missing lsp session", {
          status: 400,
          headers: CORS_HEADERS,
        });
      }

      const { socket, response } = Deno.upgradeWebSocket(request);
      await log({ type: "lspSocketAccepted", sessionId: session });
      try {
        return response;
      } finally {
        lspWsServer.handleNewWebsocket(socket, session);
      }
    }

    if (request.method === "GET" && url.pathname === "/runtime/snapshots") {
      const { socket, response } = Deno.upgradeWebSocket(request);
      socket.onopen = () => {
        sockets.add(socket);
        socket.send(
          JSON.stringify(makeActiveWaitSnapshot() satisfies ActiveWaitSnapshot),
        );
      };
      socket.onclose = () => sockets.delete(socket);
      socket.onerror = () => sockets.delete(socket);
      return response;
    }

    if (request.method === "GET" && url.pathname === "/client/control") {
      const requestedClientId = url.searchParams.get("clientId")?.trim();
      const clientId = requestedClientId || crypto.randomUUID();
      const { socket, response } = Deno.upgradeWebSocket(request);
      socket.onopen = () => {
        const existing = clientControlSockets.get(clientId);
        if (existing && existing.socket.readyState === WebSocket.OPEN) {
          existing.socket.close();
        }
        clientControlSockets.set(clientId, {
          clientId,
          socket,
          connectedAt: Date.now(),
        });
        void log({ type: "clientControlConnected", clientId });
      };
      socket.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        handleClientControlMessage(clientId, event.data);
      };
      socket.onclose = () =>
        removeClientControlSocket(clientId, "closed", socket);
      socket.onerror = () =>
        removeClientControlSocket(clientId, "error", socket);
      return response;
    }

    return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  };

  const server = Deno.serve({ hostname: host, port }, handler);
  const addr = server.addr as Deno.NetAddr;
  const baseUrl = `http://${host}:${addr.port}`;

  await log({
    type: "serverReady",
    host,
    port: addr.port,
    baseUrl,
    sessionRoot,
    sessionId,
    logPath,
  });

  return {
    baseUrl,
    host,
    port: addr.port,
    sessionRoot,
    close: async () => {
      closing = true;
      if (snapshotTimer !== undefined) clearInterval(snapshotTimer);
      if (pianoRollSnapshotTimer !== undefined) {
        clearInterval(pianoRollSnapshotTimer);
      }
      for (const socket of sockets) socket.close();
      for (const socket of pianoRollSockets) socket.close();
      for (const client of clientControlSockets.values()) {
        client.socket.close();
      }
      for (const [commandId, pending] of pendingClientCommands) {
        clearTimeout(pending.timer);
        pending.resolve({
          ok: false,
          commandId,
          clientId: pending.clientId,
          error: "server closed before client command completed",
        });
      }
      pendingClientCommands.clear();
      for (const moduleId of [...activeModules.keys()]) {
        await stopModule(moduleId, "serverClose");
      }
      parentHandle.cancel();
      await lspWsServer.shutdown();
      await server.shutdown();
    },
  };

  async function sendClientControlCommand(
    requestBody: ClientControlRequest,
  ): Promise<ClientControlCommandResponse> {
    const commandId = crypto.randomUUID();
    const target = selectClientControlSocket(requestBody.clientId);
    if (!target) {
      return {
        ok: false,
        commandId,
        clientId: requestBody.clientId ?? "",
        error: requestBody.clientId
          ? `No connected client ${requestBody.clientId}`
          : "No connected livecode-tldraw client",
      };
    }

    const timeoutMs = clampTimeoutMs(requestBody.timeoutMs);
    const envelope: ClientControlEnvelope = {
      type: "clientCommand",
      commandId,
      command: requestBody.command,
    };

    await log({
      type: "clientCommandForwarded",
      commandId,
      clientId: target.clientId,
      commandType: requestBody.command.type,
    });

    return await new Promise<ClientControlCommandResponse>((resolve) => {
      const timer = setTimeout(() => {
        pendingClientCommands.delete(commandId);
        resolve({
          ok: false,
          commandId,
          clientId: target.clientId,
          error:
            `Timed out waiting for client command result after ${timeoutMs}ms`,
        });
      }, timeoutMs) as unknown as number;

      pendingClientCommands.set(commandId, {
        clientId: target.clientId,
        resolve,
        timer,
      });

      try {
        target.socket.send(JSON.stringify(envelope));
      } catch (error) {
        clearTimeout(timer);
        pendingClientCommands.delete(commandId);
        resolve({
          ok: false,
          commandId,
          clientId: target.clientId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  function selectClientControlSocket(
    clientId?: string,
  ): ClientControlSocket | null {
    if (clientId) {
      const client = clientControlSockets.get(clientId);
      return client?.socket.readyState === WebSocket.OPEN ? client : null;
    }
    for (const client of clientControlSockets.values()) {
      if (client.socket.readyState === WebSocket.OPEN) return client;
    }
    return null;
  }

  function handleClientControlMessage(clientId: string, payload: string) {
    let message: ClientControlResultMessage;
    try {
      message = JSON.parse(payload) as ClientControlResultMessage;
    } catch (error) {
      void log({
        type: "clientControlMalformedMessage",
        clientId,
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    if (message.type !== "clientCommandResult") return;
    const pending = pendingClientCommands.get(message.commandId);
    if (!pending) {
      void log({
        type: "clientCommandUnexpectedResult",
        clientId,
        commandId: message.commandId,
      });
      return;
    }
    if (pending.clientId !== clientId) {
      void log({
        type: "clientCommandWrongClient",
        expectedClientId: pending.clientId,
        receivedClientId: clientId,
        commandId: message.commandId,
      });
      return;
    }

    clearTimeout(pending.timer);
    pendingClientCommands.delete(message.commandId);
    void log({
      type: "clientCommandResult",
      commandId: message.commandId,
      clientId,
      ok: message.ok,
      error: message.error,
    });
    pending.resolve({
      ok: message.ok,
      commandId: message.commandId,
      clientId,
      result: message.result,
      error: message.error,
    });
  }

  function removeClientControlSocket(
    clientId: string,
    reason: string,
    expectedSocket?: WebSocket,
  ) {
    const client = clientControlSockets.get(clientId);
    if (!client) return;
    if (expectedSocket && client.socket !== expectedSocket) return;
    clientControlSockets.delete(clientId);
    void log({ type: "clientControlDisconnected", clientId, reason });
    for (const [commandId, pending] of pendingClientCommands) {
      if (pending.clientId !== clientId) continue;
      clearTimeout(pending.timer);
      pendingClientCommands.delete(commandId);
      pending.resolve({
        ok: false,
        commandId,
        clientId,
        error: `Client disconnected before command completed: ${reason}`,
      });
    }
  }

  function clampTimeoutMs(value: number | undefined): number {
    if (typeof value !== "number" || !Number.isFinite(value)) return 10_000;
    return Math.max(100, Math.min(60_000, value));
  }

  async function createProject(
    requestBody: CreateProjectRequest,
  ): Promise<ProjectCurrentResponse> {
    const root = requestBody.projectPath
      ? resolvePath(requestBody.projectPath)
      : join(sessionDir, "project");
    const state: ProjectState = {
      root,
      manifestPath: join(root, PROJECT_MANIFEST_FILENAME),
      manifest: {
        version: 1,
        name: requestBody.name ?? basename(root),
        modules: [],
      },
      hashes: new Map(),
    };

    await Deno.mkdir(root, { recursive: true });
    currentProject = state;
    for (const moduleInput of requestBody.modules ?? []) {
      await addOrUpdateProjectModule(state, moduleInput, {
        allowNew: true,
        writeManifest: false,
      });
    }
    await writeProjectManifest(state);
    if (state.manifest.modules.length > 0) {
      await materializeProjectRuntime(state);
    }
    await log({
      type: "projectCreated",
      root,
      moduleCount: state.manifest.modules.length,
    });
    return await makeProjectCurrentResponse();
  }

  async function openProject(
    projectPath: string,
  ): Promise<ProjectCurrentResponse> {
    const resolved = resolvePath(projectPath);
    const manifestPath = resolved.endsWith(".json")
      ? resolved
      : join(resolved, PROJECT_MANIFEST_FILENAME);
    const root = dirname(manifestPath);
    const manifest = JSON.parse(
      await Deno.readTextFile(manifestPath),
    ) as LivecodeProjectManifest;
    manifest.modules = manifest.modules.map(normalizeProjectModuleRecord);
    const state: ProjectState = {
      root,
      manifestPath,
      manifest,
      hashes: new Map(),
    };
    currentProject = state;
    for (const moduleRecord of state.manifest.modules) {
      const sourceText = await readProjectModuleSource(state, moduleRecord);
      const diskHash = await hashText(sourceText);
      state.hashes.set(moduleRecord.id, {
        editorHash: diskHash,
        lastLoadedHash: diskHash,
      });
    }
    if (state.manifest.modules.length > 0) {
      await materializeProjectRuntime(state);
    }
    await log({
      type: "projectOpened",
      root,
      moduleCount: state.manifest.modules.length,
    });
    return await makeProjectCurrentResponse();
  }

  async function addProjectModule(
    requestBody: AddProjectModuleRequest,
  ): Promise<ProjectStatusResponse> {
    const state = requireCurrentProject();
    await addOrUpdateProjectModule(state, requestBody, {
      allowNew: true,
      writeManifest: true,
    });
    await materializeProjectRuntime(state);
    return await makeProjectStatusResponse();
  }

  async function updateProjectModule(
    requestBody: UpdateProjectModuleRequest,
  ): Promise<ProjectStatusResponse> {
    const state = requireCurrentProject();
    await addOrUpdateProjectModule(state, requestBody, {
      allowNew: false,
      writeManifest: true,
    });
    await materializeProjectRuntime(state);
    return await makeProjectStatusResponse();
  }

  async function writeProjectModule(
    requestBody: WriteProjectModuleRequest,
  ): Promise<ProjectStatusResponse> {
    const state = requireCurrentProject();
    const moduleRecord = findProjectModule(state, requestBody);
    if (!moduleRecord) {
      throw new Error("Project module not found");
    }
    if (requestBody.sourceVersion !== undefined) {
      moduleRecord.sourceVersion = requestBody.sourceVersion;
    } else {
      moduleRecord.sourceVersion += 1;
    }
    await writeProjectModuleSource(state, moduleRecord, requestBody.sourceText);
    await writeProjectManifest(state);
    await materializeProjectRuntime(state);
    return await makeProjectStatusResponse();
  }

  async function reloadProjectModule(
    requestBody: ReloadProjectModuleRequest,
  ): Promise<ProjectStatusResponse> {
    const state = requireCurrentProject();
    const moduleRecord = findProjectModule(state, requestBody);
    if (!moduleRecord) {
      throw new Error("Project module not found");
    }
    const sourceText = await readProjectModuleSource(state, moduleRecord);
    const diskHash = await hashText(sourceText);
    state.hashes.set(moduleRecord.id, {
      editorHash: diskHash,
      lastLoadedHash: diskHash,
    });
    await materializeProjectRuntime(state);
    return await makeProjectStatusResponse();
  }

  async function removeProjectModule(
    requestBody: RemoveProjectModuleRequest,
  ): Promise<ProjectStatusResponse> {
    const state = requireCurrentProject();
    const moduleRecord = findProjectModule(state, requestBody);
    if (!moduleRecord) {
      throw new Error("Project module not found");
    }
    state.manifest.modules = state.manifest.modules.filter((moduleEntry) =>
      moduleEntry.id !== moduleRecord.id
    );
    state.hashes.delete(moduleRecord.id);
    await writeProjectManifest(state);
    return await makeProjectStatusResponse();
  }

  async function addOrUpdateProjectModule(
    state: ProjectState,
    input: ProjectModuleInput,
    options: { allowNew: boolean; writeManifest: boolean },
  ): Promise<ProjectModuleRecord> {
    const normalized = normalizeProjectModuleInput(input);
    const existing = findProjectModule(state, {
      id: input.id,
      path: input.path,
    }) ?? findProjectModule(state, { path: normalized.path });

    if (!existing && !options.allowNew) {
      throw new Error("Project module not found");
    }

    const moduleRecord = existing ?? normalized;
    Object.assign(moduleRecord, {
      kind: input.kind ?? moduleRecord.kind,
      title: input.title ?? moduleRecord.title,
      sourceVersion: input.sourceVersion ?? moduleRecord.sourceVersion,
      x: input.x ?? moduleRecord.x,
      y: input.y ?? moduleRecord.y,
      w: input.w ?? moduleRecord.w,
      h: input.h ?? moduleRecord.h,
    });

    if (!existing) state.manifest.modules.push(moduleRecord);
    if (input.sourceText !== undefined) {
      await writeProjectModuleSource(state, moduleRecord, input.sourceText);
    } else {
      await ensureProjectModuleSource(state, moduleRecord);
    }
    if (options.writeManifest) await writeProjectManifest(state);
    return moduleRecord;
  }

  async function materializeProjectRuntime(
    state: ProjectState,
  ): Promise<ProjectMaterializeResult> {
    const generatedRunId = createGeneratedRunId();
    const runtimeUrl = new URL("./runtime.ts", import.meta.url).href;
    const results = new Map<string, AnalyzeResponse>();
    const sourceHashes = new Map<string, string>();

    for (const moduleRecord of state.manifest.modules) {
      const sourceText = await readProjectModuleSource(state, moduleRecord);
      const sourceHash = await hashText(sourceText);
      sourceHashes.set(moduleRecord.id, sourceHash);
    }

    const projectSourceHash = await hashText(
      [...sourceHashes.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, hash]) => `${id}:${hash}`)
        .join("\n"),
    );

    for (const moduleRecord of state.manifest.modules) {
      const sourceText = await readProjectModuleSource(state, moduleRecord);
      const sourceHash = sourceHashes.get(moduleRecord.id) ??
        await hashText(sourceText);
      const result = analyzeAndTransformTimedModule({
        moduleId: moduleRecord.id,
        sourceVersion: moduleRecord.sourceVersion,
        sourceUri: projectAbsolutePath(state, moduleRecord.sourcePath),
        sourceText,
        generatedRunId,
        runtimeImport: runtimeUrl,
        requireDefaultTimedRoot: moduleRecord.kind === "runnable",
      });
      results.set(moduleRecord.id, result);

      if (result.type === "analyzeFailure") continue;

      const runtimePath = projectAbsolutePath(state, moduleRecord.runtimePath);
      await Deno.mkdir(dirname(runtimePath), { recursive: true });
      await Deno.writeTextFile(runtimePath, result.transformedCode);
      state.hashes.set(moduleRecord.id, {
        editorHash: sourceHash,
        lastLoadedHash: sourceHash,
      });
    }

    return { generatedRunId, projectSourceHash, sourceHashes, results };
  }

  async function makeProjectCurrentResponse(): Promise<ProjectCurrentResponse> {
    return {
      ok: true,
      project: currentProject
        ? {
          root: currentProject.root,
          manifestPath: currentProject.manifestPath,
          manifest: currentProject.manifest,
        }
        : null,
    };
  }

  async function makeProjectStatusResponse(): Promise<ProjectStatusResponse> {
    const current = await makeProjectCurrentResponse();
    if (!currentProject) {
      return {
        ok: true,
        project: null,
        modules: [],
        activeModules: listRuntimeStatus(),
        projectSourceHash: null,
      };
    }

    const moduleStatuses: ProjectModuleStatus[] = [];
    const diskHashes = new Map<string, string>();
    for (const moduleRecord of currentProject.manifest.modules) {
      const diskText = await readProjectModuleSource(
        currentProject,
        moduleRecord,
      );
      const diskHash = await hashText(diskText);
      diskHashes.set(moduleRecord.id, diskHash);
    }
    const projectSourceHash = await hashText(
      [...diskHashes.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, hash]) => `${id}:${hash}`)
        .join("\n"),
    );

    for (const moduleRecord of currentProject.manifest.modules) {
      const diskHash = diskHashes.get(moduleRecord.id) ?? null;
      const hashState = currentProject.hashes.get(moduleRecord.id);
      const active = activeModules.get(moduleRecord.id);
      const editorHash = hashState?.editorHash ?? null;
      const lastLoadedHash = hashState?.lastLoadedHash ?? null;
      const changedOnDisk = Boolean(
        diskHash && lastLoadedHash && diskHash !== lastLoadedHash,
      );
      const dirty = Boolean(
        editorHash && lastLoadedHash && editorHash !== lastLoadedHash,
      );
      moduleStatuses.push({
        ...moduleRecord,
        diskHash,
        editorHash,
        lastLoadedHash,
        runHash: active?.sourceHash ?? null,
        dirty,
        changedOnDisk,
        conflict: dirty && changedOnDisk,
        running: Boolean(active),
        runningStale: Boolean(
          active && active.projectSourceHash &&
            active.projectSourceHash !== projectSourceHash,
        ),
      });
    }

    return {
      ok: true,
      project: current.project,
      modules: moduleStatuses,
      activeModules: listRuntimeStatus(),
      projectSourceHash,
    };
  }

  async function makeProjectModuleSourceResponse(
    locator: { id?: string; path?: string },
  ): Promise<ProjectModuleSourceResponse> {
    const state = requireCurrentProject();
    const moduleRecord = findProjectModule(state, locator);
    if (!moduleRecord) {
      throw new Error("Project module not found");
    }
    return {
      ok: true,
      module: moduleRecord,
      sourceText: await readProjectModuleSource(state, moduleRecord),
    };
  }

  function listRuntimeStatus(): RuntimeModuleStatus[] {
    return [...activeModules.values()].map((active) => ({
      moduleId: active.moduleId,
      generatedRunId: active.generatedRunId,
      transformedModuleUri: active.transformedModuleUri,
      projectModulePath: active.projectModulePath,
      sourceHash: active.sourceHash,
      projectSourceHash: active.projectSourceHash,
    }));
  }

  function requireCurrentProject(): ProjectState {
    if (!currentProject) throw new Error("No project open");
    return currentProject;
  }

  function findProjectModule(
    state: ProjectState,
    locator: { id?: string; path?: string },
  ): ProjectModuleRecord | null {
    if (locator.id) {
      const byId = state.manifest.modules.find((moduleEntry) =>
        moduleEntry.id === locator.id
      );
      if (byId) return byId;
    }
    if (!locator.path) return null;
    const runtimePath = normalizeProjectRuntimePath(locator.path);
    return state.manifest.modules.find((moduleEntry) =>
      moduleEntry.path === runtimePath ||
      moduleEntry.runtimePath === runtimePath ||
      moduleEntry.sourcePath === normalizeProjectSourcePath(locator.path!)
    ) ?? null;
  }

  async function readProjectModuleSource(
    state: ProjectState,
    moduleRecord: ProjectModuleRecord,
  ): Promise<string> {
    return await Deno.readTextFile(
      projectAbsolutePath(state, moduleRecord.sourcePath),
    );
  }

  async function ensureProjectModuleSource(
    state: ProjectState,
    moduleRecord: ProjectModuleRecord,
  ): Promise<void> {
    const sourcePath = projectAbsolutePath(state, moduleRecord.sourcePath);
    try {
      const sourceText = await Deno.readTextFile(sourcePath);
      const sourceHash = await hashText(sourceText);
      if (!state.hashes.has(moduleRecord.id)) {
        state.hashes.set(moduleRecord.id, {
          editorHash: sourceHash,
          lastLoadedHash: sourceHash,
        });
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
      await writeProjectModuleSource(state, moduleRecord, "");
    }
  }

  async function writeProjectModuleSource(
    state: ProjectState,
    moduleRecord: ProjectModuleRecord,
    sourceText: string,
  ): Promise<void> {
    const sourcePath = projectAbsolutePath(state, moduleRecord.sourcePath);
    await Deno.mkdir(dirname(sourcePath), { recursive: true });
    await Deno.writeTextFile(sourcePath, sourceText);
    const sourceHash = await hashText(sourceText);
    state.hashes.set(moduleRecord.id, {
      editorHash: sourceHash,
      lastLoadedHash: sourceHash,
    });
  }

  async function writeProjectManifest(state: ProjectState): Promise<void> {
    const manifest: LivecodeProjectManifest = {
      ...state.manifest,
      modules: state.manifest.modules.map(normalizeProjectModuleRecord),
    };
    await Deno.mkdir(dirname(state.manifestPath), { recursive: true });
    await Deno.writeTextFile(
      state.manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    state.manifest = manifest;
  }

  function normalizeProjectModuleInput(
    input: ProjectModuleInput,
  ): ProjectModuleRecord {
    const runtimePath = normalizeProjectRuntimePath(input.path);
    const sourcePath = sourcePathForRuntimePath(runtimePath);
    return {
      id: input.id ?? moduleIdFromPath(runtimePath),
      path: runtimePath,
      sourcePath,
      runtimePath,
      kind: input.kind ?? "runnable",
      title: input.title ?? basename(runtimePath, ".ts"),
      sourceVersion: input.sourceVersion ?? 1,
      x: input.x,
      y: input.y,
      w: input.w,
      h: input.h,
    };
  }

  function normalizeProjectModuleRecord(
    moduleRecord: ProjectModuleRecord,
  ): ProjectModuleRecord {
    const runtimePath = normalizeProjectRuntimePath(
      moduleRecord.runtimePath ?? moduleRecord.path,
    );
    const sourcePath = moduleRecord.sourcePath
      ? normalizeProjectSourcePath(moduleRecord.sourcePath)
      : sourcePathForRuntimePath(runtimePath);
    return {
      ...moduleRecord,
      path: runtimePath,
      runtimePath,
      sourcePath,
      sourceVersion: moduleRecord.sourceVersion ?? 1,
      kind: moduleRecord.kind ?? "runnable",
      title: moduleRecord.title ?? basename(runtimePath, ".ts"),
    };
  }

  function projectAbsolutePath(
    state: ProjectState,
    relativePath: string,
  ): string {
    return join(state.root, relativePath);
  }

  async function analyzeModule(
    requestBody: AnalyzeRequest,
  ): Promise<AnalyzeResponse> {
    const analyzeStartedAt = performance.now();
    await log({
      type: "analyzeStart",
      moduleId: requestBody.moduleId,
      sourceVersion: requestBody.sourceVersion,
    });

    const projectModule = currentProject
      ? findProjectModule(currentProject, {
        id: requestBody.projectModuleId ?? requestBody.moduleId,
        path: requestBody.projectModulePath,
      })
      : null;

    if (currentProject && projectModule) {
      const materialized = await materializeProjectRuntime(currentProject);
      const result = materialized.results.get(projectModule.id);
      if (!result) {
        throw new Error(`No materialized result for ${projectModule.id}`);
      }
      if (result.type === "analyzeFailure") {
        await log({
          type: "analyzeFailure",
          moduleId: projectModule.id,
          sourceVersion: projectModule.sourceVersion,
          diagnosticCount: result.diagnostics.length,
          durationMs: elapsedMs(analyzeStartedAt),
        });
        return result;
      }

      const transformedModuleUri = pathToFileURL(
        projectAbsolutePath(currentProject, projectModule.runtimePath),
      ).href;
      const sourceHash = materialized.sourceHashes.get(projectModule.id);
      preparedRuns.set(materialized.generatedRunId, {
        moduleId: projectModule.id,
        generatedRunId: materialized.generatedRunId,
        transformedModuleUri,
        projectModulePath: projectModule.path,
        sourceHash,
        projectSourceHash: materialized.projectSourceHash,
      });
      await log({
        type: "analyzeSuccess",
        moduleId: projectModule.id,
        sourceVersion: projectModule.sourceVersion,
        generatedRunId: materialized.generatedRunId,
        callsiteCount: result.manifest.callsites.length,
        transformedModuleUri,
        projectModulePath: projectModule.path,
        durationMs: elapsedMs(analyzeStartedAt),
      });
      const projectManifests = [...materialized.results.values()]
        .filter((entry) => entry.type === "analyzeSuccess")
        .map((entry) => entry.manifest);

      return {
        ...result,
        projectManifests,
        transformedModuleUri,
        generatedRunId: materialized.generatedRunId,
        transformedCode: undefined,
        sourceHash,
        projectSourceHash: materialized.projectSourceHash,
        projectModulePath: projectModule.path,
        projectSourcePath: projectModule.sourcePath,
        projectRuntimePath: projectModule.runtimePath,
      };
    }

    if (requestBody.sourceText === undefined) {
      return {
        type: "analyzeFailure",
        moduleId: requestBody.moduleId,
        sourceVersion: requestBody.sourceVersion,
        diagnostics: [{
          severity: "error",
          code: "TCV_MISSING_SOURCE_TEXT",
          message:
            "sourceText is required unless analyzing an open project module.",
          from: 0,
          to: 0,
        }],
      };
    }

    const generatedRunId = createGeneratedRunId();
    const modulePath = join(
      modulesDir,
      `${sanitizeFilePart(requestBody.moduleId)}.ts`,
    );
    const generatedPath = join(generatedDir, `${generatedRunId}.ts`);
    await Deno.writeTextFile(modulePath, requestBody.sourceText);

    const runtimeUrl = new URL("./runtime.ts", import.meta.url).href;
    const result = analyzeAndTransformTimedModule({
      moduleId: requestBody.moduleId,
      sourceVersion: requestBody.sourceVersion,
      sourceUri: modulePath,
      sourceText: requestBody.sourceText,
      generatedRunId,
      runtimeImport: runtimeUrl,
      requireDefaultTimedRoot: true,
    });

    if (result.type === "analyzeFailure") {
      await log({
        type: "analyzeFailure",
        moduleId: requestBody.moduleId,
        sourceVersion: requestBody.sourceVersion,
        diagnosticCount: result.diagnostics.length,
        durationMs: elapsedMs(analyzeStartedAt),
      });
      return result;
    }

    await Deno.writeTextFile(generatedPath, result.transformedCode);
    const transformedModuleUri = pathToFileURL(generatedPath).href;
    const sourceHash = await hashText(requestBody.sourceText);
    preparedRuns.set(generatedRunId, {
      moduleId: requestBody.moduleId,
      generatedRunId,
      transformedModuleUri,
      sourceHash,
    });
    await log({
      type: "analyzeSuccess",
      moduleId: requestBody.moduleId,
      sourceVersion: requestBody.sourceVersion,
      generatedRunId,
      callsiteCount: result.manifest.callsites.length,
      transformedModuleUri,
      durationMs: elapsedMs(analyzeStartedAt),
    });

    return {
      ...result,
      transformedModuleUri,
      generatedRunId,
      transformedCode: undefined,
      sourceHash,
    };
  }

  async function launchModule(requestBody: LaunchModuleRequest) {
    const prepared = preparedRuns.get(requestBody.generatedRunId);
    await log({
      type: "launchQueued",
      moduleId: requestBody.moduleId,
      generatedRunId: requestBody.generatedRunId,
    });

    await stopModule(requestBody.moduleId, "replaceBeforeLaunch");
    launchQueue.push(async (ctx) => {
      const moduleUrl = appendImportQuery(
        requestBody.transformedModuleUri,
        "launch",
        crypto.randomUUID(),
      );
      const importStartedAt = performance.now();
      const mod = await import(moduleUrl) as {
        runFunc?: (ctx: TimeContext) => Promise<void>;
        default?: (ctx: TimeContext) => Promise<void>;
        stop?: ModuleStopFunc;
      };
      await log({
        type: "moduleImported",
        moduleId: requestBody.moduleId,
        generatedRunId: requestBody.generatedRunId,
        durationMs: elapsedMs(importStartedAt),
      });
      const runFunc = mod.runFunc ?? mod.default;
      if (!runFunc) {
        throw new Error(
          `Generated module ${moduleUrl} does not export runFunc/default`,
        );
      }

      const handle = ctx.branch(async (branchCtx) => {
        await log({
          type: "moduleStarted",
          moduleId: requestBody.moduleId,
          generatedRunId: requestBody.generatedRunId,
        });
        let reason = "completed";
        try {
          await runFunc(branchCtx);
        } catch (error) {
          reason = isAbortError(error) ? "cancelled" : "error";
          if (reason === "error") {
            await log({
              type: "moduleError",
              moduleId: requestBody.moduleId,
              generatedRunId: requestBody.generatedRunId,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        } finally {
          clearModuleWaits(requestBody.moduleId);
          const active = activeModules.get(requestBody.moduleId);
          if (active?.generatedRunId === requestBody.generatedRunId) {
            activeModules.delete(requestBody.moduleId);
            await log({
              type: "moduleStopped",
              moduleId: requestBody.moduleId,
              generatedRunId: requestBody.generatedRunId,
              reason,
            });
          }
        }
      }, requestBody.moduleId);

      activeModules.set(requestBody.moduleId, {
        moduleId: requestBody.moduleId,
        generatedRunId: requestBody.generatedRunId,
        transformedModuleUri: requestBody.transformedModuleUri,
        projectModulePath: prepared?.projectModulePath ??
          requestBody.projectModulePath,
        sourceHash: prepared?.sourceHash ?? requestBody.sourceHash,
        projectSourceHash: prepared?.projectSourceHash ??
          requestBody.projectSourceHash,
        handle,
        stopFunc: typeof mod.stop === "function" ? mod.stop : undefined,
      });
    });

    if (!parentContext) await log({ type: "launchQueuedBeforeParentReady" });
  }

  async function stopModule(moduleId: string, reason: string) {
    const active = activeModules.get(moduleId);
    if (!active) {
      clearModuleWaits(moduleId);
      return;
    }
    await runModuleStopFunc(active, reason);
    active.handle.cancel();
    activeModules.delete(moduleId);
    clearModuleWaits(moduleId);
    await log({
      type: "moduleStopped",
      moduleId,
      generatedRunId: active.generatedRunId,
      reason,
    });
  }

  async function runModuleStopFunc(active: ActiveModule, reason: string) {
    if (!active.stopFunc) return;
    try {
      await withTimeout(
        Promise.resolve(active.stopFunc()),
        STOP_HOOK_TIMEOUT_MS,
        `module ${active.moduleId} stop() timed out after ${STOP_HOOK_TIMEOUT_MS}ms`,
      );
      await log({
        type: "moduleStopHookCompleted",
        moduleId: active.moduleId,
        generatedRunId: active.generatedRunId,
        reason,
      });
    } catch (error) {
      await log({
        type: "moduleStopHookError",
        moduleId: active.moduleId,
        generatedRunId: active.generatedRunId,
        reason,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function stopAllModules(reason: string) {
    for (const moduleId of [...activeModules.keys()]) {
      await stopModule(moduleId, reason);
    }
  }
}

function json(value: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...CORS_HEADERS,
      ...init?.headers,
    },
  });
}

function makeRuntimeCapabilityStatus() {
  const webgpu = typeof navigator.gpu?.requestAdapter === "function";
  const unsafeWindowSurface = typeof (Deno as typeof Deno & {
    UnsafeWindowSurface?: unknown;
  }).UnsafeWindowSurface === "function";
  const windowedP5gpu = webgpu && unsafeWindowSurface;
  const warnings = windowedP5gpu ? [] : [
    "Windowed p5gpu modules require the visualizer server to run with --unstable-webgpu --unstable-ffi.",
  ];
  return {
    webgpu,
    unsafeWindowSurface,
    windowedP5gpu,
    warnings,
  };
}

function resolvePath(path: string): string {
  if (path.startsWith("file:")) return fromFileUrl(path);
  if (isAbsolute(path)) return path;
  return join(Deno.cwd(), path);
}

function sanitizeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function normalizeProjectRelativePath(path: string): string {
  if (!path || path.includes("\0")) {
    throw new Error("Project module path is required");
  }
  if (path.startsWith("file:") || isAbsolute(path)) {
    throw new Error("Project module paths must be relative");
  }
  const normalized = normalize(path).replaceAll("\\", "/");
  if (
    normalized === "." || normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw new Error("Project module paths must stay inside the project");
  }
  if (!normalized.endsWith(".ts")) {
    throw new Error("Project module paths must end in .ts");
  }
  return normalized;
}

function normalizeProjectRuntimePath(path: string): string {
  const normalized = normalizeProjectRelativePath(path);
  if (normalized.endsWith(SOURCE_SUFFIX)) {
    return `${normalized.slice(0, -SOURCE_SUFFIX.length)}.ts`;
  }
  return normalized;
}

function normalizeProjectSourcePath(path: string): string {
  const normalized = normalizeProjectRelativePath(path);
  if (normalized.endsWith(SOURCE_SUFFIX)) return normalized;
  return sourcePathForRuntimePath(normalized);
}

function sourcePathForRuntimePath(runtimePath: string): string {
  const normalized = normalizeProjectRelativePath(runtimePath);
  if (normalized.endsWith(SOURCE_SUFFIX)) return normalized;
  return `${normalized.slice(0, -".ts".length)}${SOURCE_SUFFIX}`;
}

function moduleIdFromPath(runtimePath: string): string {
  return normalizeProjectRuntimePath(runtimePath);
}

function appendImportQuery(uri: string, key: string, value: string): string {
  const separator = uri.includes("?") ? "&" : "?";
  return `${uri}${separator}${encodeURIComponent(key)}=${
    encodeURIComponent(value)
  }`;
}

async function hashText(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function elapsedMs(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 1000) / 1000;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error &&
    /aborted|context canceled/i.test(error.message);
}
