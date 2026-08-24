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
import { removePathBestEffort } from "./fs_utils.ts";
import { createGeneratedRunId } from "@avtools/livecode-engine/generated_run_id.ts";
import type {
  AddProjectModuleRequest,
  AnalyzeRequest,
  AnalyzeResponse,
  ClientControlClientsResponse,
  ClientControlCommandResponse,
  ClientControlEnvelope,
  ClientControlRequest,
  ClientControlResultMessage,
  CreateProjectRequest,
  EntityCreateRequest,
  EntityDeleteRequest,
  EntityDuplicateRequest,
  EntityMutationSuccess,
  HealthResponse,
  LaunchModuleRequest,
  LaunchModuleResponse,
  LivecodeProjectManifest,
  OpenProjectRequest,
  PianoRollHistoryRequest,
  ProjectCurrentResponse,
  ProjectDataEntityStatus,
  ProjectDataEntry,
  ProjectModuleInput,
  ProjectModuleRecord,
  ProjectModuleSourceResponse,
  ProjectModuleStatus,
  ProjectSaveEntityResult,
  ProjectSaveResponse,
  ProjectSaveSkippedEntity,
  ProjectShadowCheckResponse,
  ProjectStatusResponse,
  ReloadProjectModuleRequest,
  RemoveProjectModuleRequest,
  RuntimeModuleStatus,
  RuntimeStateResponse,
  SetAnimationTimelineRequest,
  SetParamsRequest,
  SetPianoRollRequest,
  StopModuleRequest,
  SyncClientMessage,
  SyncEntity,
  SyncEntityChange,
  SyncMessage,
  UpdateProjectModuleRequest,
  VisualizerManifestMessage,
  WriteProjectModuleRequest,
} from "./protocol.ts";
import type {
  AnimationTimelineSetResult,
  EngineEntityActionResult,
  EngineEntityCapture,
  EngineEntityLoadEntry,
  EngineEntityLoadResult,
  EngineEntitySaveState,
  ParamsEntity,
  ParamsSnapshot,
  PianoRollObject,
  PianoRollSetResult,
  PianoRollSnapshot,
  SignalsSnapshot,
} from "./protocol.ts";
import {
  createLocalExecutionPlane,
  createRemoteExecutionPlane,
  type ExecutionPlane,
  type RemoteExecutionPlane,
} from "./execution_plane.ts";
import type { SyncCollectedChanges } from "@avtools/livecode-engine/sync_sources.ts";
import { allocateEntityDataPath } from "@avtools/livecode-engine/entity_registry.ts";
import {
  analyzeProjectShadow,
  buildProjectImportGraph,
  collectTransitiveDependencies,
} from "./project_shadow_analysis.ts";
import {
  clearModulePianoRollLookups,
} from "@avtools/livecode-engine/runtime.ts";
import { buildBrowserHostAssets } from "../browser_host/build_host_assets.ts";
import { writeBrowserCheckConfig } from "./browser_check_config.ts";
import { ts as typescript } from "npm:ts-morph@23.0.0";

interface PreparedRun {
  moduleId: string;
  generatedRunId: string;
  transformedModuleUri: string;
  projectModulePath?: string;
  sourceHash?: string;
  projectSourceHash?: string;
  manifest: VisualizerManifestMessage;
}

interface SyncSocketState {
  socket: WebSocket;
  /** Type-level subscriptions; a subscribe message replaces the whole set. */
  subscriptions: Set<string>;
  /** Per-socket monotonic counter for gap detection. Never replayed. */
  seq: number;
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
  // Per-module transform cache. Invariant: validity is decided by comparing the
  // cached entry's `sourceHash` against the freshly computed disk hash at read
  // time in materializeProjectRuntime — no manual invalidation is required on
  // mutation paths. Entries are only removed when the module record itself goes
  // away (removeProjectModule).
  materialized: Map<string, {
    sourceHash: string;
    result: AnalyzeResponse;
  }>;
  // Per-project source content cache keyed by absolute source path. Avoids
  // re-reading + re-hashing every *.orig.ts on the idle diagnostics/status
  // poll. Keyed by disk stat (mtime + size) so sanctioned out-of-band editor
  // edits are still detected.
  sourceContentCache: Map<string, {
    mtimeMs: number;
    size: number;
    sourceText: string;
    sourceHash: string;
  }>;
  // Canonical compact JSON of every durable entity as of the last save or open,
  // keyed `"<typeId> <name>"` (type ids are space-free). Purely informational:
  // `/project/status` compares it against the store's current JSON so the
  // client can show an unsaved count. Nothing ever auto-saves off it.
  savedEntityJson: Map<string, string>;
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
  /**
   * Where execution happens. "local" (default) owns an engine in this
   * process. "remote" runs no engine at all: a browser tab opens `/engine/`,
   * attaches over `/engine/uplink`, and every runtime/entity op forwards to
   * it, while analysis, project files, and LSP stay here.
   */
  engineMode?: "local" | "remote";
  /**
   * A built tldraw client (its vite `dist/`) to serve at this origin. With a
   * remote engine this puts UI tabs and the engine tab on ONE origin, which
   * is what lets the client's `sync=broadcast` transport read the engine's
   * BroadcastChannel directly instead of the relayed `/sync` socket.
   */
  uiDist?: string;
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
const MAX_PREPARED_RUNS_PER_MODULE = 3;
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
  const shadowDir = join(sessionDir, "shadow");
  const lspWorkspacesRoot = join(
    Deno.env.get("TMPDIR") ?? "/tmp",
    "avtools-livecode-lsp-workspaces",
  );
  const lspWorkspacesDir = join(lspWorkspacesRoot, sessionId);
  const logsDir = join(sessionRoot, "logs");
  const lspLogsDir = join(logsDir, "lsp");
  const logPath = join(logsDir, "server.log");

  // Fire-and-forget: stale-workspace removal must never delay the server
  // starting to listen. Best-effort by design (see sweepOldLspWorkspaces).
  void sweepOldLspWorkspaces(lspWorkspacesRoot).catch((error) => {
    console.warn(
      "[livecode-visualizer] LSP workspace sweep failed",
      error,
    );
  });
  await Deno.mkdir(modulesDir, { recursive: true });
  await Deno.mkdir(generatedDir, { recursive: true });
  await Deno.mkdir(lspWorkspacesDir, { recursive: true });
  await Deno.mkdir(logsDir, { recursive: true });
  await Deno.mkdir(lspLogsDir, { recursive: true });

  const syncSockets = new Map<WebSocket, SyncSocketState>();
  const clientControlSockets = new Map<string, ClientControlSocket>();
  const pendingClientCommands = new Map<string, PendingClientCommand>();
  const preparedRuns = new Map<string, PreparedRun>();
  const preparedRunIdsByModule = new Map<string, string[]>();
  let currentProject: ProjectState | null = null;
  let diagnosticsInFlight: Promise<ProjectShadowCheckResponse> | null = null;
  let diagnosticsInFlightHash: string | null = null;
  let lastDiagnostics:
    | { diagnosticsKey: string; response: ProjectShadowCheckResponse }
    | null = null;
  let closing = false;

  // Generated code's instrumentation import. Local engines import the package
  // source by file URL; a browser engine imports the served runtime bundle.
  const engineRuntimeImport = () =>
    engineMode === "remote" ? "/engine/runtime.js" : new URL(
      "../../../../packages/livecode-engine/runtime.ts",
      import.meta.url,
    ).href;

  const log = async (entry: Record<string, unknown>) => {
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      ...entry,
    });
    console.log(line);
    try {
      await Deno.writeTextFile(logPath, `${line}\n`, {
        append: true,
        create: true,
      });
    } catch (error) {
      if (!(closing && error instanceof Deno.errors.NotFound)) {
        console.warn("[livecode-visualizer] failed to write log", error);
      }
    }
  };

  const runtimeCapabilities = makeRuntimeCapabilityStatus();
  if (runtimeCapabilities.warnings.length > 0) {
    await log({
      type: "runtimeCapabilityWarning",
      ...runtimeCapabilities,
    });
  }

  // The execution plane. Local mode owns an engine in this process and feeds
  // the fan-out from its broadcast tick; remote mode forwards ops to a
  // browser-tab engine over /engine/uplink and relays its sync feed into the
  // same fan-out. Routes only ever see the plane.
  const engineMode = options.engineMode ?? "local";
  const remotePlane: RemoteExecutionPlane | null = engineMode === "remote"
    ? createRemoteExecutionPlane({
      log,
      onSyncChanges: (changes) => broadcastSyncChangeList(changes),
      onEngineResets: (resets) => broadcastSyncResets(resets),
    })
    : null;
  // MIDI is an execution-plane capability: only a local (in-process) engine
  // should touch native ports. The lazy import keeps a remote coordination
  // server from eagerly opening every MIDI output it will never play.
  const localPlane = engineMode === "local"
    ? createLocalExecutionPlane({
      log,
      panicMidi: (await import("../helpers/midi_helpers.ts")).panicMidi,
      onSyncTick: broadcastSyncChanges,
    })
    : null;
  const plane: ExecutionPlane = (localPlane ?? remotePlane)!;

  // Remote mode serves the engine host page and browser-built module assets;
  // built lazily at first request so local-mode startup pays nothing.
  const browserHostDir = join(sessionDir, "browser-host");
  let browserHostBuild: Promise<void> | null = null;
  const ensureBrowserHostAssets = (): Promise<void> => {
    if (!browserHostBuild) {
      const build = buildBrowserHostAssets({ outDir: browserHostDir })
        .then(() => {
          void log({ type: "browserHostAssetsBuilt", outDir: browserHostDir });
        })
        .catch((error) => {
          // Never cache a failed build: the next request retries instead of
          // serving this one transient failure until restart.
          if (browserHostBuild === build) browserHostBuild = null;
          throw error;
        });
      browserHostBuild = build;
    }
    return browserHostBuild;
  };
  // Serve-time TS -> JS transpile cache for browser-imported module files.
  const transpileCache = new Map<
    string,
    { mtimeMs: number; size: number; js: string }
  >();

  if (!Deno.env.get("CRASH_LOG_LINE_COUNT")) {
    Deno.env.set("CRASH_LOG_LINE_COUNT", "40");
  }
  // The world the current project's modules execute in. The shadow check and
  // the editor's LSP both key off this, so the Run gate and editor diagnostics
  // can never disagree about which globals exist.
  const effectiveEngineTarget = (): "deno" | "browser" =>
    currentProject?.manifest.engineTarget ??
      (engineMode === "remote" ? "browser" : "deno");
  // LSP proxies live in their own processes; they learn the target from this
  // file (read at config-write time, watched for live flips on project open).
  const lspEngineTargetPath = join(lspWorkspacesDir, "engine-target.json");
  const publishLspEngineTarget = async () => {
    await Deno.writeTextFile(
      lspEngineTargetPath,
      JSON.stringify({ target: effectiveEngineTarget() }) + "\n",
    );
  };
  await publishLspEngineTarget();
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
      "--engine-target-file",
      lspEngineTargetPath,
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

  const uiDist = options.uiDist ? resolvePath(options.uiDist) : null;
  const UI_MIME: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".map": "application/json",
    ".woff2": "font/woff2",
    ".tldr": "application/json; charset=utf-8",
  };

  const handler = async (request: Request): Promise<Response> => {
    try {
      return await routeRequest(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void log({
        type: "handlerError",
        path: new URL(request.url).pathname,
        message,
      });
      return json({ ok: false, error: message }, { status: 500 });
    }
  };

  const routeRequest = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      const response: HealthResponse = {
        ok: true,
        serverVersion: SERVER_VERSION,
        sessionRoot,
        activeModules: await activeModuleIdsSafe(),
        runtimeCapabilities,
        engine: {
          mode: engineMode,
          kind: localPlane ? "deno" : remotePlane?.engineKind() ?? null,
          attached: localPlane ? true : remotePlane?.hasEngine() ?? false,
        },
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
      try {
        return json(await launchModule(requestBody));
      } catch (error) {
        return json(
          {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          },
          { status: 409 },
        );
      }
    }

    if (request.method === "POST" && url.pathname === "/runtime/stop") {
      const requestBody = await request.json() as StopModuleRequest;
      await plane.execute({
        kind: "stop",
        moduleId: requestBody.moduleId,
        reason: "stopRequest",
      });
      return json({ ok: true });
    }

    if (request.method === "GET" && url.pathname === "/runtime/status") {
      return json({ ok: true, activeModules: await listRuntimeStatus() });
    }

    if (request.method === "GET" && url.pathname === "/runtime/state") {
      return json(await makeRuntimeStateResponse());
    }

    if (request.method === "POST" && url.pathname === "/runtime/stop-all") {
      await plane.execute({ kind: "stopAll", reason: "stopAllRequest" });
      return json({ ok: true });
    }

    if (request.method === "POST" && url.pathname === "/runtime/panic") {
      await plane.execute({ kind: "panic", reason: "panic" });
      return json({ ok: true });
    }

    if (request.method === "POST" && url.pathname === "/runtime/restart-all") {
      await plane.execute({ kind: "stopAll", reason: "restartAllRequest" });
      if (currentProject) await materializeProjectRuntime(currentProject);
      return json({ ok: true, activeModules: await listRuntimeStatus() });
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
      return json(await saveProject(currentProject));
    }

    if (request.method === "GET" && url.pathname === "/project/current") {
      return json(await makeProjectCurrentResponse());
    }

    if (request.method === "GET" && url.pathname === "/project/status") {
      return json(await makeProjectStatusResponse());
    }

    if (request.method === "GET" && url.pathname === "/project/diagnostics") {
      return json(await makeProjectDiagnosticsResponse());
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

    if (request.method === "POST" && url.pathname === "/project/canvas") {
      const requestBody = await request.json() as {
        canvas: LivecodeProjectManifest["canvas"];
      };
      const state = requireCurrentProject();
      state.manifest.canvas = requestBody.canvas;
      await writeProjectManifest(state);
      return json(await makeProjectCurrentResponse());
    }

    if (request.method === "POST" && url.pathname === "/entities/create") {
      const requestBody = await request.json() as EntityCreateRequest;
      return await entityActionResponse(
        await plane.execute({
          kind: "entityCreate",
          request: requestBody,
        }) as EngineEntityActionResult,
        "entityCreated",
      );
    }

    if (request.method === "POST" && url.pathname === "/entities/duplicate") {
      const requestBody = await request.json() as EntityDuplicateRequest;
      return await entityActionResponse(
        await plane.execute({
          kind: "entityDuplicate",
          request: requestBody,
        }) as EngineEntityActionResult,
        "entityDuplicated",
      );
    }

    if (request.method === "POST" && url.pathname === "/entities/delete") {
      const requestBody = await request.json() as EntityDeleteRequest;
      return await entityActionResponse(
        await plane.execute({
          kind: "entityDelete",
          request: requestBody,
        }) as EngineEntityActionResult,
        "entityDeleted",
      );
    }

    if (request.method === "GET" && url.pathname === "/piano-roll/list") {
      return json(
        await plane.execute({ kind: "pianoRollList" }) as PianoRollSnapshot,
      );
    }

    if (request.method === "POST" && url.pathname === "/piano-roll/set") {
      const requestBody = await request.json() as SetPianoRollRequest;
      return json(
        await plane.execute({
          kind: "pianoRollSet",
          request: requestBody,
        }) as PianoRollSetResult,
      );
    }

    if (request.method === "POST" && url.pathname === "/piano-roll/undo") {
      const requestBody = await request.json() as PianoRollHistoryRequest;
      const result = await plane.execute({
        kind: "pianoRollHistory",
        action: "undo",
        request: requestBody,
      }) as PianoRollObject | null;
      return json(result ?? { ok: false });
    }

    if (request.method === "POST" && url.pathname === "/piano-roll/redo") {
      const requestBody = await request.json() as PianoRollHistoryRequest;
      const result = await plane.execute({
        kind: "pianoRollHistory",
        action: "redo",
        request: requestBody,
      }) as PianoRollObject | null;
      return json(result ?? { ok: false });
    }

    if (request.method === "GET" && url.pathname === "/params/list") {
      return json(
        await plane.execute({ kind: "paramsList" }) as ParamsSnapshot,
      );
    }

    if (request.method === "POST" && url.pathname === "/params/set") {
      const requestBody = await request.json() as SetParamsRequest;
      const entity = await plane.execute({
        kind: "paramsSet",
        request: requestBody,
      }) as ParamsEntity | null;
      if (!entity) {
        return json({
          ok: false,
          error: `No params entity "${requestBody.name}"`,
        }, { status: 404 });
      }
      return json(entity);
    }

    if (
      request.method === "POST" &&
      url.pathname === "/animation-timeline/set"
    ) {
      const requestBody = await request.json() as SetAnimationTimelineRequest;
      return json(
        await plane.execute({
          kind: "animationTimelineSet",
          request: requestBody,
        }) as AnimationTimelineSetResult,
      );
    }

    if (request.method === "GET" && url.pathname === "/signals/list") {
      return json(
        await plane.execute({ kind: "signalsList" }) as SignalsSnapshot,
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

    if (request.method === "GET" && url.pathname === "/sync") {
      const { socket, response } = Deno.upgradeWebSocket(request);
      const state: SyncSocketState = {
        socket,
        subscriptions: new Set(),
        seq: 0,
      };
      socket.onopen = () => {
        // Nothing is sent until the client subscribes: an unwatched entity kind
        // costs this socket nothing.
        syncSockets.set(socket, state);
      };
      socket.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        void handleSyncClientMessage(state, event.data);
      };
      socket.onclose = () => syncSockets.delete(socket);
      socket.onerror = () => syncSockets.delete(socket);
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

    // --- remote engine mode: host page, uplink, and browser module assets ---
    if (remotePlane) {
      if (request.method === "GET" && url.pathname === "/engine/uplink") {
        const { socket, response } = Deno.upgradeWebSocket(request);
        remotePlane.attachEngineSocket(socket);
        await log({ type: "engineUplinkAccepted" });
        return response;
      }

      if (
        request.method === "GET" &&
        (url.pathname === "/engine" || url.pathname === "/engine/")
      ) {
        await ensureBrowserHostAssets();
        return await serveStaticFile(
          join(browserHostDir, "engine.html"),
          "text/html; charset=utf-8",
        );
      }

      if (request.method === "GET" && url.pathname.startsWith("/engine/")) {
        await ensureBrowserHostAssets();
        const relative = url.pathname.slice("/engine/".length);
        const filePath = join(browserHostDir, normalize(relative));
        if (relative.includes("..") || !filePath.startsWith(browserHostDir)) {
          return new Response("Not found", {
            status: 404,
            headers: CORS_HEADERS,
          });
        }
        const contentType = filePath.endsWith(".html")
          ? "text/html; charset=utf-8"
          : filePath.endsWith(".js")
          ? "text/javascript; charset=utf-8"
          : "application/octet-stream";
        return await serveStaticFile(filePath, contentType);
      }

      if (
        request.method === "GET" &&
        url.pathname.startsWith("/engine-assets/generated/")
      ) {
        const relative = decodeURIComponent(
          url.pathname.slice("/engine-assets/generated/".length),
        );
        const filePath = join(generatedDir, normalize(relative));
        if (
          relative.includes("..") || !filePath.startsWith(generatedDir) ||
          !filePath.endsWith(".ts")
        ) {
          return new Response("Not found", {
            status: 404,
            headers: CORS_HEADERS,
          });
        }
        return await serveTranspiledModule(filePath);
      }

      if (
        request.method === "GET" &&
        url.pathname.startsWith("/engine-assets/project/")
      ) {
        if (!currentProject) {
          return new Response("No project open", {
            status: 404,
            headers: CORS_HEADERS,
          });
        }
        const relative = decodeURIComponent(
          url.pathname.slice("/engine-assets/project/".length),
        );
        const filePath = join(currentProject.root, normalize(relative));
        if (
          relative.includes("..") ||
          !filePath.startsWith(currentProject.root) ||
          !filePath.endsWith(".ts")
        ) {
          return new Response("Not found", {
            status: 404,
            headers: CORS_HEADERS,
          });
        }
        return await serveTranspiledModule(filePath);
      }
    }

    // Static UI fallback: everything the API routes above did not claim.
    if (uiDist && request.method === "GET") {
      const relative = url.pathname === "/"
        ? "index.html"
        : decodeURIComponent(url.pathname.slice(1));
      const filePath = join(uiDist, normalize(relative));
      if (!relative.includes("..") && filePath.startsWith(uiDist)) {
        const extension = filePath.slice(filePath.lastIndexOf("."));
        return await serveStaticFile(
          filePath,
          UI_MIME[extension] ?? "application/octet-stream",
        );
      }
    }

    return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  };

  async function serveStaticFile(
    filePath: string,
    contentType: string,
  ): Promise<Response> {
    try {
      const body = await Deno.readFile(filePath);
      return new Response(body, {
        headers: { "content-type": contentType, ...CORS_HEADERS },
      });
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return new Response("Not found", {
          status: 404,
          headers: CORS_HEADERS,
        });
      }
      throw error;
    }
  }

  /**
   * Serve a materialized/generated `.ts` module as browser JS: type stripping
   * only, cached by mtime+size, specifiers untouched — the browser resolves
   * a relative `./state.ts` back through this route, so stable dependency
   * URLs keep the same module-instance retention Deno's cache gives local
   * runs. The entry's `?launch=` query naturally busts the browser cache.
   */
  async function serveTranspiledModule(filePath: string): Promise<Response> {
    let stat: Deno.FileInfo;
    try {
      stat = await Deno.stat(filePath);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return new Response("Not found", {
          status: 404,
          headers: CORS_HEADERS,
        });
      }
      throw error;
    }
    const cached = transpileCache.get(filePath);
    const mtimeMs = stat.mtime?.getTime() ?? 0;
    let js: string;
    if (cached && cached.mtimeMs === mtimeMs && cached.size === stat.size) {
      js = cached.js;
    } else {
      const source = await Deno.readTextFile(filePath);
      js = typescript.transpileModule(source, {
        compilerOptions: {
          target: typescript.ScriptTarget.ES2022,
          module: typescript.ModuleKind.ESNext,
          useDefineForClassFields: true,
        },
      }).outputText;
      transpileCache.set(filePath, { mtimeMs, size: stat.size, js });
    }
    return new Response(js, {
      headers: {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-store",
        ...CORS_HEADERS,
      },
    });
  }

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
      for (const socket of syncSockets.keys()) socket.close();
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
      // Local: clears the broadcast timer, unregisters the root clock, stops
      // all modules, panics MIDI, and cancels the parent loop. Remote: closes
      // the uplink socket and fails its pending ops.
      await plane.close();
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
      materialized: new Map(),
      sourceContentCache: new Map(),
      savedEntityJson: new Map(),
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
    await publishLspEngineTarget();
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
      materialized: new Map(),
      sourceContentCache: new Map(),
      savedEntityJson: new Map(),
    };
    currentProject = state;
    // Before materialization, so every durable entity exists before any module
    // could run and read one.
    await loadProjectEntityData(state);
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
    await publishLspEngineTarget();
    await log({
      type: "projectOpened",
      root,
      moduleCount: state.manifest.modules.length,
      dataCount: state.savedEntityJson.size,
    });
    return await makeProjectCurrentResponse();
  }

  /**
   * Explicit save: the manifest plus one human-readable JSON file per durable
   * entity currently in memory. Every entity serializes synchronously first, so
   * one save captures one coherent instant of the store; only then do the file
   * writes happen. The manifest is written last with the entries that actually
   * reached disk, so a crash mid-save can leave an orphan file but never a
   * manifest entry pointing at a missing one.
   */
  async function saveProject(
    state: ProjectState,
  ): Promise<ProjectSaveResponse> {
    const pending: Array<
      { type: string; name: string; path: string; json: string; text: string }
    > = [];
    const skipped: ProjectSaveSkippedEntity[] = [];
    const usedLowercasePaths = new Set<string>();

    // One point-in-time capture of every durable entity, taken by the engine
    // (local or in the browser tab), so a save stays coherent regardless of
    // where execution happens.
    const capture = await plane.execute({
      kind: "captureEntities",
    }) as EngineEntityCapture[];
    const captureErrors = capture.filter((row) => row.error !== undefined);
    if (captureErrors.length > 0) {
      throw new Error(
        `Project save aborted: ${
          captureErrors.map((row) => `${row.type} "${row.name}": ${row.error}`)
            .join("; ")
        }`,
      );
    }
    for (const row of capture) {
      if (row.payload === null || row.payload === undefined) {
        skipped.push({
          type: row.type,
          name: row.name,
          reason: "unmodified auto-created entity",
        });
        continue;
      }
      if (row.latestJson === null) {
        throw new Error(
          `Project save aborted: ${row.type} "${row.name}" has no serializable state`,
        );
      }
      pending.push({
        type: row.type,
        name: row.name,
        path: allocateEntityDataPath(row.type, row.name, usedLowercasePaths),
        json: row.latestJson,
        text: `${JSON.stringify(row.payload, null, 2)}\n`,
      });
    }

    await writeProjectManifest(state);

    const results: ProjectSaveEntityResult[] = [];
    const savedEntries: ProjectDataEntry[] = [];
    state.savedEntityJson.clear();
    for (const entry of pending) {
      const absolutePath = projectAbsolutePath(state, entry.path);
      try {
        await Deno.mkdir(dirname(absolutePath), { recursive: true });
        await Deno.writeTextFile(absolutePath, entry.text);
        savedEntries.push({
          type: entry.type,
          name: entry.name,
          path: entry.path,
        });
        state.savedEntityJson.set(
          entitySavedStateKey(entry.type, entry.name),
          entry.json,
        );
        results.push({
          type: entry.type,
          name: entry.name,
          path: entry.path,
          ok: true,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({
          type: entry.type,
          name: entry.name,
          path: entry.path,
          ok: false,
          error: message,
        });
        await log({
          type: "projectDataWriteFailed",
          entityType: entry.type,
          name: entry.name,
          path: entry.path,
          message,
        });
      }
    }

    // Deleting an entity and saving removes its manifest entry but leaves the
    // old file on disk, matching the manifest-only module-remove precedent.
    if (savedEntries.length > 0 || state.manifest.data !== undefined) {
      state.manifest.data = savedEntries;
    }
    await writeProjectManifest(state);
    await log({
      type: "projectSaved",
      root: state.root,
      dataCount: savedEntries.length,
      skippedCount: skipped.length,
    });

    return { ...await makeProjectCurrentResponse(), data: results, skipped };
  }

  /**
   * Rehydrate every manifest `data` entry through the registry. A bad row is
   * logged and skipped: one missing or broken file must not fail the whole
   * open, matching the rest of the project loader's posture.
   */
  async function loadProjectEntityData(state: ProjectState): Promise<void> {
    state.savedEntityJson.clear();
    const entries = state.manifest.data;
    if (!Array.isArray(entries)) return;

    const loadable: EngineEntityLoadEntry[] = [];
    for (const rawEntry of entries as Array<Partial<ProjectDataEntry> | null>) {
      try {
        const typeId = typeof rawEntry?.type === "string"
          ? rawEntry.type.trim()
          : "";
        const name = typeof rawEntry?.name === "string"
          ? rawEntry.name.trim()
          : "";
        if (!typeId || !name) {
          throw new Error("Project data entries need a type and a name");
        }
        const relativePath = normalizeProjectDataPath(rawEntry?.path ?? "");
        const text = await Deno.readTextFile(
          projectAbsolutePath(state, relativePath),
        );
        loadable.push({ type: typeId, name, data: JSON.parse(text) });
      } catch (error) {
        await log({
          type: "projectDataLoadSkipped",
          entityType: rawEntry?.type,
          name: rawEntry?.name,
          path: rawEntry?.path,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (loadable.length === 0) return;

    let results: EngineEntityLoadResult[];
    try {
      results = await plane.execute({
        kind: "loadEntities",
        entries: loadable,
      }) as EngineEntityLoadResult[];
    } catch (error) {
      // Remote mode with no engine attached: the open still succeeds; the
      // entities load when an engine is present at the next open.
      await log({
        type: "projectDataLoadSkipped",
        message: error instanceof Error ? error.message : String(error),
        entryCount: loadable.length,
      });
      return;
    }
    for (const result of results) {
      if (result.ok) {
        if (result.latestJson !== null && result.latestJson !== undefined) {
          state.savedEntityJson.set(
            entitySavedStateKey(result.type, result.name),
            result.latestJson,
          );
        }
      } else {
        await log({
          type: "projectDataLoadSkipped",
          entityType: result.type,
          name: result.name,
          message: result.error,
        });
      }
    }
  }

  function entitySavedStateKey(typeId: string, name: string): string {
    return `${typeId} ${name}`;
  }

  async function entityActionResponse(
    result: EngineEntityActionResult,
    logType: string,
  ): Promise<Response> {
    if (!result.ok || !result.entity) {
      return json(
        { ok: false, error: result.error ?? "entity action failed" },
        {
          status: result.status ?? 500,
        },
      );
    }
    await log({
      type: logType,
      entityType: result.entity.type,
      name: result.entity.name,
    });
    const success: EntityMutationSuccess = { ok: true, entity: result.entity };
    return json(success);
  }

  /**
   * Warning-tier dirty state over the union of live entities and the ones the
   * last save/open recorded, so a saved-but-deleted entity reports as an
   * unsaved deletion. An entity a save would skip anyway (an untouched
   * auto-created one) is not an unsaved change.
   */
  async function makeProjectDataStatus(
    state: ProjectState,
  ): Promise<ProjectDataEntityStatus[]> {
    const rows: ProjectDataEntityStatus[] = [];
    const liveKeys = new Set<string>();

    let live: EngineEntitySaveState[];
    try {
      live = await plane.execute({
        kind: "entitySaveState",
      }) as EngineEntitySaveState[];
    } catch {
      // No engine attached: no live entities to report on.
      live = [];
    }
    for (const row of live) {
      const key = entitySavedStateKey(row.type, row.name);
      liveKeys.add(key);
      const saved = state.savedEntityJson.get(key);
      rows.push({
        type: row.type,
        name: row.name,
        unsaved: row.error !== undefined ||
          (saved === undefined ? row.wouldSave : row.latestJson !== saved),
        ...(row.error ? { error: row.error } : {}),
      });
    }

    for (const key of state.savedEntityJson.keys()) {
      if (liveKeys.has(key)) continue;
      const separator = key.indexOf(" ");
      rows.push({
        type: key.slice(0, separator),
        name: key.slice(separator + 1),
        unsaved: true,
      });
    }

    return rows;
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
    // No materialized.delete here: validity is a sourceHash comparison at read
    // time (see ProjectState.materialized), so a stale entry can never be used.
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
    state.materialized.delete(moduleRecord.id);
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
      kind: "runnable",
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
    const runtimeUrl = engineRuntimeImport();
    const results = new Map<string, AnalyzeResponse>();
    const sourceHashes = new Map<string, string>();
    const sourceTexts = new Map<string, string>();

    for (const moduleRecord of state.manifest.modules) {
      const sourceText = await readProjectModuleSource(state, moduleRecord);
      const sourceHash = await hashText(sourceText);
      sourceTexts.set(moduleRecord.id, sourceText);
      sourceHashes.set(moduleRecord.id, sourceHash);
    }

    const projectSourceHash = await projectSourceHashFromHashes(sourceHashes);

    for (const moduleRecord of state.manifest.modules) {
      const sourceText = sourceTexts.get(moduleRecord.id) ?? "";
      const sourceHash = sourceHashes.get(moduleRecord.id) ??
        await hashText(sourceText);
      const cached = state.materialized.get(moduleRecord.id);
      const usingCachedSuccess = cached?.sourceHash === sourceHash &&
        cached.result.type === "analyzeSuccess";
      const result = usingCachedSuccess
        ? cached.result
        : analyzeAndTransformTimedModule({
          moduleId: moduleRecord.id,
          sourceVersion: moduleRecord.sourceVersion,
          sourceUri: projectAbsolutePath(state, moduleRecord.sourcePath),
          sourceText,
          generatedRunId,
          runtimeImport: runtimeUrl,
          requireDefaultTimedRoot: true,
        });
      results.set(moduleRecord.id, result);

      if (usingCachedSuccess) {
        state.hashes.set(moduleRecord.id, {
          editorHash: sourceHash,
          lastLoadedHash: sourceHash,
        });
        continue;
      }

      if (result.type === "analyzeFailure") {
        state.materialized.delete(moduleRecord.id);
        continue;
      }

      const runtimePath = projectAbsolutePath(state, moduleRecord.runtimePath);
      const transformedCode = result.transformedCode;
      if (transformedCode === undefined) {
        throw new Error(`Missing transformed code for ${moduleRecord.id}`);
      }
      await Deno.mkdir(dirname(runtimePath), { recursive: true });
      await Deno.writeTextFile(runtimePath, transformedCode);
      state.materialized.set(moduleRecord.id, { sourceHash, result });
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
        activeModules: await listRuntimeStatusSafe(),
        projectSourceHash: null,
        data: [],
      };
    }

    const moduleStatuses: ProjectModuleStatus[] = [];
    const sourceModules = await readProjectSourceModules(currentProject);
    const diskHashes = new Map(
      sourceModules.map((moduleRecord) => [
        moduleRecord.id,
        moduleRecord.sourceHash,
      ]),
    );
    const projectSourceHash = await projectSourceHashFromHashes(diskHashes);
    const graph = buildProjectImportGraph({
      projectRoot: currentProject.root,
      modules: sourceModules,
    });
    const changedModuleIds = new Set(
      sourceModules
        .filter((moduleRecord) =>
          moduleRecord.lastLoadedHash !== null &&
          moduleRecord.sourceHash !== moduleRecord.lastLoadedHash
        )
        .map((moduleRecord) => moduleRecord.id),
    );

    const runtimeRows = await listRuntimeStatusSafe();
    const activeByModule = new Map(
      runtimeRows.map((row) => [row.moduleId, row]),
    );
    for (const moduleRecord of sourceModules) {
      const diskHash = diskHashes.get(moduleRecord.id) ?? null;
      const hashState = currentProject.hashes.get(moduleRecord.id);
      const active = activeByModule.get(moduleRecord.id);
      const editorHash = hashState?.editorHash ?? null;
      const lastLoadedHash = hashState?.lastLoadedHash ?? null;
      const dependencies = sortedIds(
        graph.dependenciesByModule.get(moduleRecord.id),
      );
      const dependents = sortedIds(
        graph.dependentsByModule.get(moduleRecord.id),
      );
      const changedDependencies = [...collectTransitiveDependencies(
        moduleRecord.id,
        graph.dependenciesByModule,
      )]
        .filter((moduleId) => changedModuleIds.has(moduleId))
        .sort();
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
          active &&
            ((diskHash && active.sourceHash &&
              diskHash !== active.sourceHash) ||
              changedDependencies.length > 0),
        ),
        dependencies,
        dependents,
        changedDependencies,
      });
    }

    return {
      ok: true,
      project: current.project,
      modules: moduleStatuses,
      activeModules: runtimeRows,
      projectSourceHash,
      data: await makeProjectDataStatus(currentProject),
    };
  }

  async function makeProjectDiagnosticsResponse(): Promise<
    ProjectShadowCheckResponse
  > {
    const current = await makeProjectCurrentResponse();
    if (!currentProject) {
      return {
        ok: true,
        project: null,
        checkedAt: new Date().toISOString(),
        shadowRoot: shadowDir,
        projectSourceHash: null,
        edges: [],
        modules: [],
        diagnostics: [],
        denoCheck: { success: true, code: 0, output: "" },
      };
    }

    const sourceModules = await readProjectSourceModules(currentProject);
    const sourceHashes = new Map(
      sourceModules.map((moduleRecord) => [
        moduleRecord.id,
        moduleRecord.sourceHash,
      ]),
    );
    const projectSourceHash = await projectSourceHashFromHashes(sourceHashes);
    // The Run gate checks against the world the modules will execute in: a
    // browser-target project typechecks under the browser lib, where DOM
    // globals are legal and a reachable `Deno.*` is the type error it would
    // be at runtime. The target is part of the cache key so a retargeted
    // project cannot reuse the other world's verdict.
    const engineTarget = effectiveEngineTarget();
    const diagnosticsKey = `${engineTarget}:${projectSourceHash}`;
    if (lastDiagnostics?.diagnosticsKey === diagnosticsKey) {
      return lastDiagnostics.response;
    }
    // If a run is already in flight, only reuse it when it was started for the
    // exact same source hash. Otherwise wait for the slot to free up (the run
    // may already cover a newer hash by the time it finishes) before starting
    // our own run keyed to the current hash. Bounded in practice: each
    // iteration awaits a distinct in-flight run.
    while (diagnosticsInFlight) {
      if (diagnosticsInFlightHash === diagnosticsKey) {
        return await diagnosticsInFlight;
      }
      await diagnosticsInFlight.catch(() => {});
      if (lastDiagnostics?.diagnosticsKey === diagnosticsKey) {
        return lastDiagnostics.response;
      }
    }

    diagnosticsInFlightHash = diagnosticsKey;
    const denoConfigPath = engineTarget === "browser"
      ? await writeBrowserCheckConfig(REPO_ROOT)
      : join(REPO_ROOT, "deno.json");
    const promise = analyzeProjectShadow({
      projectRoot: currentProject.root,
      project: current.project,
      modules: sourceModules,
      shadowRoot: shadowDir,
      repoRoot: REPO_ROOT,
      denoConfigPath,
      runtimeImport: new URL(
        "../../../../packages/livecode-engine/runtime.ts",
        import.meta.url,
      ).href,
    }).then((response) => {
      lastDiagnostics = { diagnosticsKey, response };
      return response;
    });
    diagnosticsInFlight = promise;
    try {
      return await promise;
    } finally {
      if (diagnosticsInFlight === promise) {
        diagnosticsInFlight = null;
        diagnosticsInFlightHash = null;
      }
    }
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

  async function listRuntimeStatus(): Promise<RuntimeModuleStatus[]> {
    return await plane.execute({
      kind: "runtimeStatus",
    }) as RuntimeModuleStatus[];
  }

  /** Status reads that must not fail routes when no engine is attached. */
  async function listRuntimeStatusSafe(): Promise<RuntimeModuleStatus[]> {
    try {
      return await listRuntimeStatus();
    } catch {
      return [];
    }
  }

  async function activeModuleIdsSafe(): Promise<string[]> {
    try {
      return await plane.execute({ kind: "activeModuleIds" }) as string[];
    } catch {
      return [];
    }
  }

  async function makeRuntimeStateResponse(): Promise<RuntimeStateResponse> {
    const latestPreparedByModule:
      RuntimeStateResponse["latestPreparedByModule"] = {};
    for (const [moduleId, ids] of preparedRunIdsByModule) {
      for (let index = ids.length - 1; index >= 0; index--) {
        const prepared = preparedRuns.get(ids[index]);
        if (!prepared) continue;
        latestPreparedByModule[moduleId] = {
          generatedRunId: prepared.generatedRunId,
          sourceHash: prepared.sourceHash,
          manifest: prepared.manifest,
        };
        break;
      }
    }

    const state = await plane.execute({ kind: "runtimeState" }) as Omit<
      RuntimeStateResponse,
      "ok" | "latestPreparedByModule"
    >;
    return { ok: true, ...state, latestPreparedByModule };
  }

  function broadcastSyncChanges(collected: SyncCollectedChanges): void {
    if (collected.size === 0 || syncSockets.size === 0) return;
    const changes: SyncEntityChange[] = [];
    for (const [entityType, entries] of collected) {
      for (const entry of entries) {
        changes.push({
          entityType,
          name: entry.name,
          entity: entry.entity as SyncEntity | null,
        });
      }
    }
    broadcastSyncChangeList(changes);
  }

  /** Fan one flat change list out per socket, filtered to its subscriptions. */
  function broadcastSyncChangeList(changes: SyncEntityChange[]): void {
    if (changes.length === 0 || syncSockets.size === 0) return;
    for (const state of syncSockets.values()) {
      if (state.subscriptions.size === 0) continue;
      const filtered = changes.filter((change) =>
        state.subscriptions.has(change.entityType)
      );
      if (filtered.length === 0) continue;
      sendSyncMessage(state, { changes: filtered });
    }
  }

  /**
   * Push full per-type resets to every subscribed socket — the remote plane's
   * engine attach/detach relay. A reset replaces the client's whole per-type
   * map, so this is how watchers converge on a newly attached engine's world
   * (or on emptiness when the engine tab went away).
   */
  function broadcastSyncResets(resets: Record<string, SyncEntity[]>): void {
    if (syncSockets.size === 0) return;
    for (const state of syncSockets.values()) {
      if (state.subscriptions.size === 0) continue;
      const filtered: Record<string, SyncEntity[]> = {};
      let any = false;
      for (const entityType of state.subscriptions) {
        if (entityType in resets) {
          filtered[entityType] = resets[entityType];
          any = true;
        }
      }
      if (!any) continue;
      sendSyncMessage(state, { resets: filtered });
    }
  }

  /**
   * A subscribe REPLACES the socket's set and resets EVERY listed type, so a
   * client that detects a `seq` gap recovers by resubscribing the same set.
   * There is no replay buffer; a gap over TCP means a server bug, not loss.
   */
  async function handleSyncClientMessage(
    state: SyncSocketState,
    payload: string,
  ): Promise<void> {
    let message: SyncClientMessage;
    try {
      message = JSON.parse(payload) as SyncClientMessage;
    } catch (error) {
      void log({
        type: "syncMalformedMessage",
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    if (message?.type !== "subscribe") return;

    const entityTypes = Array.isArray(message.entityTypes)
      ? message.entityTypes.filter((entityType): entityType is string =>
        typeof entityType === "string"
      )
      : [];
    state.subscriptions = new Set(entityTypes);

    // An interleaved tick change for a just-subscribed type is harmless: the
    // reset that lands afterwards replaces the whole per-type map with newer
    // state. Per-socket seq stays monotonic because sends are synchronous.
    let resets: Record<string, SyncEntity[]>;
    try {
      resets = await plane.execute({
        kind: "snapshotAll",
        entityTypes: [...state.subscriptions],
      }) as Record<string, SyncEntity[]>;
    } catch (error) {
      // Remote mode with no engine attached: the watched world is empty, and
      // an empty reset per requested type says exactly that.
      resets = {};
      for (const entityType of state.subscriptions) resets[entityType] = [];
      void log({
        type: "syncSubscribeResetUnavailable",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    sendSyncMessage(state, { resets });
  }

  function sendSyncMessage(
    state: SyncSocketState,
    body: {
      resets?: Record<string, SyncEntity[]>;
      changes?: SyncEntityChange[];
    },
  ): void {
    if (state.socket.readyState !== WebSocket.OPEN) return;
    const message: SyncMessage = {
      type: "sync",
      seq: state.seq + 1,
      timestampMs: Date.now(),
      ...body,
    };
    let payload: string;
    try {
      payload = JSON.stringify(message);
    } catch (error) {
      // `seq` is only advanced by a message that actually went out, so a
      // hostile entity cannot manufacture a gap the client would chase.
      void log({
        type: "syncSerializeFailed",
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    try {
      state.socket.send(payload);
    } catch (error) {
      void log({
        type: "syncSendFailed",
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    state.seq = message.seq;
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

  async function readProjectSourceModules(state: ProjectState) {
    return await Promise.all(
      state.manifest.modules.map(async (moduleRecord) => {
        const absoluteSourcePath = projectAbsolutePath(
          state,
          moduleRecord.sourcePath,
        );
        const { sourceText, sourceHash } = await readCachedProjectSource(
          state,
          absoluteSourcePath,
        );
        return {
          ...moduleRecord,
          absoluteSourcePath,
          sourceText,
          sourceHash,
          lastLoadedHash: state.hashes.get(moduleRecord.id)?.lastLoadedHash ??
            null,
        };
      }),
    );
  }

  // Reads + hashes a source file, reusing the cached text/hash when the file's
  // stat (mtime + size) is unchanged. Always stats first, so sanctioned
  // out-of-band editor edits to *.orig.ts are still picked up.
  async function readCachedProjectSource(
    state: ProjectState,
    absoluteSourcePath: string,
  ): Promise<{ sourceText: string; sourceHash: string }> {
    let stat: Deno.FileInfo | null = null;
    try {
      stat = await Deno.stat(absoluteSourcePath);
    } catch {
      // Fall through to a direct read, which surfaces the real error (e.g.
      // NotFound) exactly as the previous uncached path did.
    }
    const mtimeMs = stat?.mtime?.getTime();
    const cached = state.sourceContentCache.get(absoluteSourcePath);
    if (
      cached && stat && mtimeMs !== undefined &&
      cached.mtimeMs === mtimeMs && cached.size === stat.size
    ) {
      return { sourceText: cached.sourceText, sourceHash: cached.sourceHash };
    }
    const sourceText = await Deno.readTextFile(absoluteSourcePath);
    const sourceHash = await hashText(sourceText);
    if (stat && mtimeMs !== undefined) {
      state.sourceContentCache.set(absoluteSourcePath, {
        mtimeMs,
        size: stat.size,
        sourceText,
        sourceHash,
      });
    } else {
      // No reliable stat (e.g. mtime unavailable) — don't cache, so the next
      // read re-checks disk rather than trusting a possibly-stale entry.
      state.sourceContentCache.delete(absoluteSourcePath);
    }
    return { sourceText, sourceHash };
  }

  async function updateSourceContentCache(
    state: ProjectState,
    absoluteSourcePath: string,
    sourceText: string,
    sourceHash: string,
  ): Promise<void> {
    try {
      const stat = await Deno.stat(absoluteSourcePath);
      const mtimeMs = stat.mtime?.getTime();
      if (mtimeMs !== undefined) {
        state.sourceContentCache.set(absoluteSourcePath, {
          mtimeMs,
          size: stat.size,
          sourceText,
          sourceHash,
        });
        return;
      }
    } catch {
      // ignore — fall through to invalidation
    }
    state.sourceContentCache.delete(absoluteSourcePath);
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
    // Keep the content cache in sync with what we just wrote so the next poll
    // reuses it. No materialized.delete: that cache self-invalidates by
    // sourceHash comparison at read time (see ProjectState.materialized).
    await updateSourceContentCache(state, sourcePath, sourceText, sourceHash);
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
      kind: "runnable",
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
      kind: "runnable",
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
    // A new analyze means the source changed, so previously recorded
    // piano-roll lookup names (keyed by stale callsite ids) are no longer
    // valid. Clear them so the editor falls back to static names until the
    // module runs again.
    clearModulePianoRollLookups(requestBody.moduleId);

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

      const transformedModuleUri = engineMode === "remote"
        ? `/engine-assets/project/${projectModule.runtimePath}`
        : pathToFileURL(
          projectAbsolutePath(currentProject, projectModule.runtimePath),
        ).href;
      const sourceHash = materialized.sourceHashes.get(projectModule.id);
      await rememberPreparedRun({
        moduleId: projectModule.id,
        generatedRunId: materialized.generatedRunId,
        transformedModuleUri,
        projectModulePath: projectModule.path,
        sourceHash,
        projectSourceHash: materialized.projectSourceHash,
        manifest: result.manifest,
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

    const runtimeUrl = engineRuntimeImport();
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
    const transformedModuleUri = engineMode === "remote"
      ? `/engine-assets/generated/${basename(generatedPath)}`
      : pathToFileURL(generatedPath).href;
    const sourceHash = await hashText(requestBody.sourceText);
    await rememberPreparedRun({
      moduleId: requestBody.moduleId,
      generatedRunId,
      transformedModuleUri,
      sourceHash,
      manifest: result.manifest,
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

  async function rememberPreparedRun(run: PreparedRun): Promise<void> {
    preparedRuns.set(run.generatedRunId, run);
    const ids = (preparedRunIdsByModule.get(run.moduleId) ?? [])
      .filter((id) => preparedRuns.has(id) && id !== run.generatedRunId);
    ids.push(run.generatedRunId);

    const activeRunIds = new Set(
      (await listRuntimeStatusSafe()).map((row) => row.generatedRunId),
    );
    while (ids.length > MAX_PREPARED_RUNS_PER_MODULE) {
      const prunableIndex = ids.findIndex((id) => !activeRunIds.has(id));
      if (prunableIndex < 0) break;
      const [oldestId] = ids.splice(prunableIndex, 1);
      const oldRun = preparedRuns.get(oldestId);
      preparedRuns.delete(oldestId);
      if (oldRun && !oldRun.projectModulePath) {
        await removeGeneratedPreparedFile(oldRun);
      }
    }

    preparedRunIdsByModule.set(run.moduleId, ids);
  }

  async function removeGeneratedPreparedFile(run: PreparedRun): Promise<void> {
    // Local engines import file: URLs; a remote engine imports the served
    // /engine-assets/generated/ URL for the same file under generatedDir —
    // both prune to the same on-disk file.
    const uri = run.transformedModuleUri;
    const remotePrefix = "/engine-assets/generated/";
    const path = uri.startsWith("file:")
      ? fromFileUrl(new URL(uri))
      : uri.startsWith(remotePrefix)
      ? join(generatedDir, uri.slice(remotePrefix.length))
      : null;
    if (!path) return;
    await removePathBestEffort(path, `prepared run ${run.generatedRunId}`);
  }

  async function launchModule(
    requestBody: LaunchModuleRequest,
  ): Promise<LaunchModuleResponse> {
    // The engine owns the whole accept/queue/replace discipline; the server
    // contributes only its prepared-run bookkeeping's build metadata.
    return await plane.execute({
      kind: "launch",
      request: requestBody,
      prepared: preparedRuns.get(requestBody.generatedRunId),
    }) as LaunchModuleResponse;
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

async function sweepOldLspWorkspaces(root: string): Promise<void> {
  const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
  try {
    for await (const entry of Deno.readDir(root)) {
      if (!entry.isDirectory) continue;
      const path = join(root, entry.name);
      try {
        const stat = await Deno.stat(path);
        const modifiedMs = stat.mtime?.getTime() ?? 0;
        if (modifiedMs > 0 && modifiedMs < cutoffMs) {
          await removePathBestEffort(path, "LSP workspace");
        }
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) {
          console.warn(
            "[livecode-visualizer] failed to sweep LSP workspace",
            path,
            error,
          );
        }
      }
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      console.warn(
        "[livecode-visualizer] failed to sweep LSP workspace root",
        root,
        error,
      );
    }
  }
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
  return normalizeProjectPath(path, ".ts", "Project module");
}

/** Same relative/inside-project/no-NUL rules as modules, for data files. */
function normalizeProjectDataPath(path: string): string {
  return normalizeProjectPath(path, ".json", "Project data");
}

function normalizeProjectPath(
  path: string,
  suffix: string,
  label: string,
): string {
  if (!path || path.includes("\0")) {
    throw new Error(`${label} path is required`);
  }
  if (path.startsWith("file:") || isAbsolute(path)) {
    throw new Error(`${label} paths must be relative`);
  }
  const normalized = normalize(path).replaceAll("\\", "/");
  if (
    normalized === "." || normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw new Error(`${label} paths must stay inside the project`);
  }
  if (!normalized.endsWith(suffix)) {
    throw new Error(`${label} paths must end in ${suffix}`);
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

async function hashText(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function projectSourceHashFromHashes(
  sourceHashes: Map<string, string>,
): Promise<string> {
  return await hashText(
    [...sourceHashes.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, hash]) => `${id}:${hash}`)
      .join("\n"),
  );
}

function elapsedMs(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 1000) / 1000;
}

function sortedIds(values: Set<string> | undefined): string[] {
  return [...values ?? []].sort();
}
