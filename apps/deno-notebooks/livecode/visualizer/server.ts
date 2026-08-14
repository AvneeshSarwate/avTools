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
import { panicMidi } from "../helpers/midi_helpers.ts";
import { analyzeAndTransformTimedModule } from "./analyze_transform.ts";
import { removePathBestEffort } from "./fs_utils.ts";
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
  EntityCreateRequest,
  EntityDeleteRequest,
  EntityDuplicateRequest,
  EntityMutationSuccess,
  HealthResponse,
  LaunchModuleRequest,
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
  RunEntity,
  RuntimeModuleRunSnapshotEntry,
  RuntimeModuleStatus,
  RuntimeStateModuleRun,
  RuntimeStateResponse,
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
import {
  createModuleLookupsSyncSource,
  createModuleWaitsSyncSource,
  createParamsSyncSource,
  createPianoRollSyncSource,
  createRunSyncSource,
  createSignalsSyncSource,
  type SyncCollectedChanges,
  SyncSourceRegistry,
} from "./sync_sources.ts";
import {
  allocateEntityDataPath,
  type DurableEntityTypeDescriptor,
  getDurableEntityType,
  listDurableEntityTypes,
  registerBuiltinDurableEntityTypes,
} from "./entity_registry.ts";
import { makeParamsSnapshot, setParamsValues } from "./params_store.ts";
import {
  makePianoRollSnapshot,
  redoPianoRoll,
  seedDemoPianoRoll,
  setPianoRoll,
  undoPianoRoll,
} from "./piano_roll_store.ts";
import { endSignalsForModule, makeSignalsSnapshot } from "./signals_store.ts";
import {
  analyzeProjectShadow,
  buildProjectImportGraph,
  collectTransitiveDependencies,
} from "./project_shadow_analysis.ts";
import {
  clearModulePianoRollLookups,
  clearModuleWaits,
  makeActiveWaitSnapshot,
  setRootTimeContext,
} from "./runtime.ts";

interface BranchHandle {
  cancel: () => void;
  finally: (f: () => void) => Promise<unknown>;
}

type ModuleStopFunc = () => void | Promise<void>;

interface ActiveModule {
  moduleId: string;
  generatedRunId: string;
  // Identity of this run, not of its build. `generatedRunId` is reused whenever
  // a relaunch finds an unchanged prepared build, so it cannot tell an old run
  // from the one that replaced it; this token can.
  runToken: string;
  transformedModuleUri: string;
  handle: BranchHandle;
  stopFunc?: ModuleStopFunc;
  projectModulePath?: string;
  sourceHash?: string;
  projectSourceHash?: string;
  manifest: VisualizerManifestMessage | null;
}

interface PreparedRun {
  moduleId: string;
  generatedRunId: string;
  transformedModuleUri: string;
  projectModulePath?: string;
  sourceHash?: string;
  projectSourceHash?: string;
  manifest: VisualizerManifestMessage;
}

// An accepted launch is queued, not started. This is the identity of that
// window: it makes a not-yet-started run addressable by stop, panic, and a
// replacing launch, none of which can find it in `activeModules` yet.
interface PendingLaunch {
  generatedRunId: string;
  // Minted at ACCEPT time rather than after the import, so the `launching`
  // entry this request publishes already carries the run's identity and a
  // cancellation can tell whether that entry is still the one it owns.
  runToken: string;
  cancelled: boolean;
}

// What the server actually stores per module. This is exactly `/runtime/state`'s
// row: the legacy entry plus the run token. The deprecated `/runtime/snapshots`
// envelope keeps its token-FREE rows (see `legacyModuleRuns`).
type ModuleRunRecord = RuntimeStateModuleRun;

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
// The cadence of the ONE broadcast timer, which samples every sync source and
// feeds the `/sync` sockets plus the deprecated `/runtime/snapshots` shim from
// that single collect. Changed-only gating keeps the idle cost at a set check.
const SNAPSHOT_TICK_MS = 33;
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

  // The deprecated `/runtime/snapshots` shim's sockets. Every entity kind now
  // reaches clients on `/sync`; this set exists only for the Vue SketchWrapper.
  const sockets = new Set<WebSocket>();
  const syncSockets = new Map<WebSocket, SyncSocketState>();
  const clientControlSockets = new Map<string, ClientControlSocket>();
  const pendingClientCommands = new Map<string, PendingClientCommand>();
  const activeModules = new Map<string, ActiveModule>();
  const pendingLaunches = new Map<string, PendingLaunch>();
  const moduleRunSnapshots = new Map<string, ModuleRunRecord>();
  // Module ids whose run entry changed since the last collect.
  const dirtyRunModules = new Set<string>();
  const preparedRuns = new Map<string, PreparedRun>();
  const preparedRunIdsByModule = new Map<string, string[]>();
  const launchQueue: Array<(ctx: TimeContext) => Promise<void> | void> = [];
  let currentProject: ProjectState | null = null;
  let diagnosticsInFlight: Promise<ProjectShadowCheckResponse> | null = null;
  let diagnosticsInFlightHash: string | null = null;
  let lastDiagnostics:
    | { projectSourceHash: string; response: ProjectShadowCheckResponse }
    | null = null;
  let parentContext: TimeContext | null = null;
  let lastSnapshotJson = "";
  let closing = false;

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

  const parentHandle = launch(async (ctx) => {
    parentContext = ctx;
    // The parent loop is the process's root clock. Observation code (the
    // signals sampler today) stamps samples with its logical time.
    setRootTimeContext(ctx);
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

  registerBuiltinDurableEntityTypes();
  // Construction, not a read path: `snapshotAll()` has to be genuinely
  // read-only, so nothing may seed a roll on the way to answering a subscribe.
  seedDemoPianoRoll();

  const syncSources = new SyncSourceRegistry();
  syncSources.register(createPianoRollSyncSource());
  syncSources.register(createParamsSyncSource());
  syncSources.register(createSignalsSyncSource());
  syncSources.register(createModuleWaitsSyncSource());
  syncSources.register(createModuleLookupsSyncSource());
  syncSources.register(createRunSyncSource({
    listModuleIds: () => [...moduleRunSnapshots.keys()],
    read: (moduleId) => runEntityFor(moduleId),
    consumeDirty: () => {
      if (dirtyRunModules.size === 0) return [];
      const drained = [...dirtyRunModules];
      dirtyRunModules.clear();
      return drained;
    },
  }));

  // ONE timer, and one walk over every source per tick. `collectAll` drains the
  // change gates, so it must be called exactly once here; the deprecated
  // `/runtime/snapshots` shim derives its envelope from the same sources
  // afterwards through its own pure whole-snapshot compare.
  const broadcastTimer = setInterval(() => {
    try {
      broadcastSyncChanges(syncSources.collectAll());
      broadcastLegacyRuntimeSnapshot();
    } catch (error) {
      void log({
        type: "broadcastTickError",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, SNAPSHOT_TICK_MS) as unknown as number;

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
      try {
        await launchModule(requestBody);
        return json({ ok: true });
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
      await stopModule(requestBody.moduleId, "stopRequest");
      return json({ ok: true });
    }

    if (request.method === "GET" && url.pathname === "/runtime/status") {
      return json({ ok: true, activeModules: listRuntimeStatus() });
    }

    if (request.method === "GET" && url.pathname === "/runtime/state") {
      return json(makeRuntimeStateResponse());
    }

    if (request.method === "POST" && url.pathname === "/runtime/stop-all") {
      await stopAllModules("stopAllRequest");
      return json({ ok: true });
    }

    if (request.method === "POST" && url.pathname === "/runtime/panic") {
      await panicRuntime("panic");
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
      const resolved = resolveEntityRequest(requestBody.type, requestBody.name);
      if ("error" in resolved) return entityError(resolved);
      const { descriptor, name } = resolved;
      if (descriptor.exists(name)) {
        return entityError({
          error: `${descriptor.typeId} entity "${name}" already exists`,
          status: 409,
        });
      }
      descriptor.create(name);
      await log({ type: "entityCreated", entityType: descriptor.typeId, name });
      return json(entityMutationSuccess(descriptor.typeId, name));
    }

    if (request.method === "POST" && url.pathname === "/entities/duplicate") {
      const requestBody = await request.json() as EntityDuplicateRequest;
      const resolved = resolveEntityRequest(requestBody.type, requestBody.name);
      if ("error" in resolved) return entityError(resolved);
      const { descriptor, name } = resolved;
      const targetName = typeof requestBody.targetName === "string"
        ? requestBody.targetName.trim()
        : "";
      if (!targetName) {
        return entityError({
          error: "Entity targetName is required",
          status: 400,
        });
      }
      if (!descriptor.exists(name)) {
        return entityError({
          error: `No ${descriptor.typeId} entity "${name}"`,
          status: 404,
        });
      }
      if (descriptor.exists(targetName)) {
        return entityError({
          error: `${descriptor.typeId} entity "${targetName}" already exists`,
          status: 409,
        });
      }
      descriptor.duplicate(name, targetName);
      await log({
        type: "entityDuplicated",
        entityType: descriptor.typeId,
        name,
        targetName,
      });
      return json(entityMutationSuccess(descriptor.typeId, targetName));
    }

    if (request.method === "POST" && url.pathname === "/entities/delete") {
      const requestBody = await request.json() as EntityDeleteRequest;
      const resolved = resolveEntityRequest(requestBody.type, requestBody.name);
      if ("error" in resolved) return entityError(resolved);
      const { descriptor, name } = resolved;
      if (!descriptor.remove(name)) {
        return entityError({
          error: `No ${descriptor.typeId} entity "${name}"`,
          status: 404,
        });
      }
      await log({ type: "entityDeleted", entityType: descriptor.typeId, name });
      return json(entityMutationSuccess(descriptor.typeId, name));
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
        expectedRev: requestBody.expectedRev,
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

    if (request.method === "GET" && url.pathname === "/params/list") {
      return json(makeParamsSnapshot());
    }

    if (request.method === "POST" && url.pathname === "/params/set") {
      const requestBody = await request.json() as SetParamsRequest;
      const entity = setParamsValues(requestBody.name, requestBody.values, {
        originId: requestBody.originId,
        expectedRev: requestBody.expectedRev,
      });
      if (!entity) {
        return json({
          ok: false,
          error: `No params entity "${requestBody.name}"`,
        }, { status: 404 });
      }
      return json(entity);
    }

    if (request.method === "GET" && url.pathname === "/signals/list") {
      return json(makeSignalsSnapshot());
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
        handleSyncClientMessage(state, event.data);
      };
      socket.onclose = () => syncSockets.delete(socket);
      socket.onerror = () => syncSockets.delete(socket);
      return response;
    }

    if (request.method === "GET" && url.pathname === "/runtime/snapshots") {
      const { socket, response } = Deno.upgradeWebSocket(request);
      socket.onopen = () => {
        sockets.add(socket);
        socket.send(
          JSON.stringify(makeRuntimeSnapshot() satisfies ActiveWaitSnapshot),
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
      clearInterval(broadcastTimer);
      // The parent loop is about to be cancelled; a cancelled clock must not
      // keep stamping samples with its frozen logical time.
      setRootTimeContext(null);
      for (const socket of sockets) socket.close();
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
      await stopAllModules("serverClose");
      panicMidi();
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

    for (const descriptor of listDurableEntityTypes()) {
      for (const name of descriptor.listNames()) {
        try {
          const payload = descriptor.serialize(name);
          if (payload === null || payload === undefined) {
            const latest = descriptor.latestJson(name);
            skipped.push({
              type: descriptor.typeId,
              name,
              reason: latest === null || latest === ""
                ? "value could not be serialized"
                : "unmodified auto-created entity",
            });
            continue;
          }
          pending.push({
            type: descriptor.typeId,
            name,
            path: allocateEntityDataPath(
              descriptor.typeId,
              name,
              usedLowercasePaths,
            ),
            json: descriptor.latestJson(name) ?? "",
            text: `${JSON.stringify(payload, null, 2)}\n`,
          });
        } catch (error) {
          // One hostile entity must not fail the whole save.
          skipped.push({
            type: descriptor.typeId,
            name,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
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
        const descriptor = getDurableEntityType(typeId);
        if (!descriptor) throw new Error(`Unknown entity type "${typeId}"`);
        const relativePath = normalizeProjectDataPath(rawEntry?.path ?? "");
        const text = await Deno.readTextFile(
          projectAbsolutePath(state, relativePath),
        );
        descriptor.deserialize(name, JSON.parse(text));
        const json = descriptor.latestJson(name);
        if (json !== null) {
          state.savedEntityJson.set(entitySavedStateKey(typeId, name), json);
        }
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
  }

  function entitySavedStateKey(typeId: string, name: string): string {
    return `${typeId} ${name}`;
  }

  function resolveEntityRequest(
    typeId: unknown,
    name: unknown,
  ):
    | { descriptor: DurableEntityTypeDescriptor; name: string }
    | { error: string; status: number } {
    const requestedType = typeof typeId === "string" ? typeId.trim() : "";
    const requestedName = typeof name === "string" ? name.trim() : "";
    if (!requestedType) {
      return { error: "Entity type is required", status: 400 };
    }
    if (!requestedName) {
      return { error: "Entity name is required", status: 400 };
    }
    const descriptor = getDurableEntityType(requestedType);
    if (!descriptor) {
      return { error: `Unknown entity type "${requestedType}"`, status: 404 };
    }
    return { descriptor, name: requestedName };
  }

  function entityError(failure: { error: string; status: number }): Response {
    return json({ ok: false, error: failure.error }, {
      status: failure.status,
    });
  }

  function entityMutationSuccess(
    typeId: string,
    name: string,
  ): EntityMutationSuccess {
    return { ok: true, entity: { type: typeId, name } };
  }

  /**
   * Warning-tier dirty state over the union of live entities and the ones the
   * last save/open recorded, so a saved-but-deleted entity reports as an
   * unsaved deletion. An entity a save would skip anyway (an untouched
   * auto-created one) is not an unsaved change.
   */
  function makeProjectDataStatus(
    state: ProjectState,
  ): ProjectDataEntityStatus[] {
    const rows: ProjectDataEntityStatus[] = [];
    const liveKeys = new Set<string>();

    for (const descriptor of listDurableEntityTypes()) {
      for (const name of descriptor.listNames()) {
        const key = entitySavedStateKey(descriptor.typeId, name);
        liveKeys.add(key);
        const saved = state.savedEntityJson.get(key);
        rows.push({
          type: descriptor.typeId,
          name,
          unsaved: saved === undefined
            ? descriptor.serialize(name) !== null
            : descriptor.latestJson(name) !== saved,
        });
      }
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
    const runtimeUrl = new URL("./runtime.ts", import.meta.url).href;
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
        activeModules: listRuntimeStatus(),
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

    for (const moduleRecord of sourceModules) {
      const diskHash = diskHashes.get(moduleRecord.id) ?? null;
      const hashState = currentProject.hashes.get(moduleRecord.id);
      const active = activeModules.get(moduleRecord.id);
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
      activeModules: listRuntimeStatus(),
      projectSourceHash,
      data: makeProjectDataStatus(currentProject),
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
    if (lastDiagnostics?.projectSourceHash === projectSourceHash) {
      return lastDiagnostics.response;
    }
    // If a run is already in flight, only reuse it when it was started for the
    // exact same source hash. Otherwise wait for the slot to free up (the run
    // may already cover a newer hash by the time it finishes) before starting
    // our own run keyed to the current hash. Bounded in practice: each
    // iteration awaits a distinct in-flight run.
    while (diagnosticsInFlight) {
      if (diagnosticsInFlightHash === projectSourceHash) {
        return await diagnosticsInFlight;
      }
      await diagnosticsInFlight.catch(() => {});
      if (lastDiagnostics?.projectSourceHash === projectSourceHash) {
        return lastDiagnostics.response;
      }
    }

    diagnosticsInFlightHash = projectSourceHash;
    const promise = analyzeProjectShadow({
      projectRoot: currentProject.root,
      project: current.project,
      modules: sourceModules,
      shadowRoot: shadowDir,
      repoRoot: REPO_ROOT,
      denoConfigPath: join(REPO_ROOT, "deno.json"),
      runtimeImport: new URL("./runtime.ts", import.meta.url).href,
    }).then((response) => {
      lastDiagnostics = { projectSourceHash, response };
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

  function makeRuntimeStateResponse(): RuntimeStateResponse {
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

    return {
      ok: true,
      activeModules: [...activeModules.values()].map((active) => ({
        moduleId: active.moduleId,
        generatedRunId: active.generatedRunId,
        transformedModuleUri: active.transformedModuleUri,
        projectModulePath: active.projectModulePath,
        sourceHash: active.sourceHash,
        projectSourceHash: active.projectSourceHash,
        manifest: active.manifest,
      })),
      // `/runtime/state` carries the run token: rehydration is where a client
      // seeds the token memory its terminal dedupe keys on.
      moduleRuns: Object.fromEntries(moduleRunSnapshots),
      latestPreparedByModule,
    };
  }

  function makeRuntimeSnapshot(): ActiveWaitSnapshot {
    const snapshot = makeActiveWaitSnapshot();
    return {
      ...snapshot,
      activeModules: [...activeModules.keys()].sort((a, b) =>
        a.localeCompare(b)
      ),
      moduleRuns: legacyModuleRuns(),
    };
  }

  /**
   * The deprecated `/runtime/snapshots` shim's `moduleRuns` map, with
   * `runToken` stripped. That envelope stays frozen for the client that never
   * migrated; the token reaches subscribers on the `run` entity, and
   * `/runtime/state` — which only migrated clients read — carries it too.
   */
  function legacyModuleRuns(): Record<string, RuntimeModuleRunSnapshotEntry> {
    const entries: Record<string, RuntimeModuleRunSnapshotEntry> = {};
    for (const [moduleId, record] of moduleRunSnapshots) {
      const { runToken: _runToken, ...wire } = record;
      entries[moduleId] = wire;
    }
    return entries;
  }

  /** One module's run as a sync entity. Null when it has never had a run. */
  function runEntityFor(moduleId: string): RunEntity | null {
    const record = moduleRunSnapshots.get(moduleId);
    if (!record) return null;
    const entity: RunEntity = {
      moduleId: record.moduleId,
      state: record.state,
      generatedRunId: record.generatedRunId,
      runToken: record.runToken,
      updatedAt: record.updatedAtMs,
    };
    if (record.projectModulePath !== undefined) {
      entity.projectModulePath = record.projectModulePath;
    }
    if (record.sourceHash !== undefined) entity.sourceHash = record.sourceHash;
    if (record.projectSourceHash !== undefined) {
      entity.projectSourceHash = record.projectSourceHash;
    }
    if (record.message !== undefined) entity.message = record.message;
    return entity;
  }

  function setModuleRunSnapshot(
    entry: Omit<ModuleRunRecord, "updatedAtMs">,
  ): ModuleRunRecord {
    const stored: ModuleRunRecord = {
      ...entry,
      updatedAtMs: Date.now(),
    };
    moduleRunSnapshots.set(entry.moduleId, stored);
    dirtyRunModules.add(entry.moduleId);
    // Returned so a writer can later ask whether its entry is still the latest.
    return stored;
  }

  // --- broadcast fan-out -------------------------------------------------
  // Everything below reads ONE collected result. Nothing here drains a gate.

  function broadcastSyncChanges(collected: SyncCollectedChanges): void {
    if (collected.size === 0 || syncSockets.size === 0) return;
    for (const state of syncSockets.values()) {
      if (state.subscriptions.size === 0) continue;
      const changes: SyncEntityChange[] = [];
      for (const [entityType, entries] of collected) {
        if (!state.subscriptions.has(entityType)) continue;
        for (const entry of entries) {
          changes.push({
            entityType,
            name: entry.name,
            entity: entry.entity as SyncEntity | null,
          });
        }
      }
      if (changes.length === 0) continue;
      sendSyncMessage(state, { changes });
    }
  }

  /**
   * `/runtime/snapshots` keeps FULL fidelity — modules, lookups, activeModules,
   * and `moduleRuns` with `updatedAtMs` — because the Vue SketchWrapper reads
   * `{seq, modules}` from it and nothing else may narrow a shipped shape out
   * from under a client this slice does not modernize. Its gate stays the
   * serialized whole-snapshot compare it has always been: that is a pure
   * comparison, not a gate anything else consumes.
   */
  function broadcastLegacyRuntimeSnapshot(): void {
    const snapshot = makeRuntimeSnapshot();
    const snapshotJson = JSON.stringify(snapshot.modules) +
      JSON.stringify(snapshot.pianoRollLookups ?? {}) +
      JSON.stringify(snapshot.activeModules ?? []) +
      JSON.stringify(snapshot.moduleRuns ?? {});
    if (snapshotJson === lastSnapshotJson) return;
    lastSnapshotJson = snapshotJson;
    sendSnapshotToSockets(sockets, snapshot);
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
  }

  function sendSnapshotToSockets(
    targets: Set<WebSocket>,
    snapshot: unknown,
  ): void {
    if (targets.size === 0) return;
    let payload: string;
    try {
      payload = JSON.stringify(snapshot);
    } catch (error) {
      // User-supplied metadata can be cyclic. One hostile entity must not take
      // the shared broadcast tick down with it.
      void log({
        type: "snapshotSerializeFailed",
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    for (const socket of targets) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      try {
        socket.send(payload);
      } catch (error) {
        // One socket that closed between the check and the send must not skip
        // the other channels: they all share this tick now.
        void log({
          type: "snapshotSendFailed",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * A subscribe REPLACES the socket's set and resets EVERY listed type, so a
   * client that detects a `seq` gap recovers by resubscribing the same set.
   * There is no replay buffer; a gap over TCP means a server bug, not loss.
   */
  function handleSyncClientMessage(
    state: SyncSocketState,
    payload: string,
  ): void {
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

    const resets: Record<string, SyncEntity[]> = {};
    for (const entityType of state.subscriptions) {
      resets[entityType] = syncSources.snapshotAll(entityType) as SyncEntity[];
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

      const transformedModuleUri = pathToFileURL(
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

    while (ids.length > MAX_PREPARED_RUNS_PER_MODULE) {
      const prunableIndex = ids.findIndex((id) => !isGeneratedRunActive(id));
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

  function isGeneratedRunActive(generatedRunId: string): boolean {
    return [...activeModules.values()].some((active) =>
      active.generatedRunId === generatedRunId
    );
  }

  async function removeGeneratedPreparedFile(run: PreparedRun): Promise<void> {
    const url = new URL(run.transformedModuleUri);
    if (url.protocol !== "file:") return;
    await removePathBestEffort(
      fromFileUrl(url),
      `prepared run ${run.generatedRunId}`,
    );
  }

  async function launchModule(requestBody: LaunchModuleRequest) {
    const prepared = preparedRuns.get(requestBody.generatedRunId);
    await log({
      type: "launchQueued",
      moduleId: requestBody.moduleId,
      generatedRunId: requestBody.generatedRunId,
    });

    // A launch already accepted but not yet started is refused exactly like a
    // running one, so two rapid requests cannot both pass the safety check.
    // `replaceRunning` supersedes the queued run instead: its action still runs,
    // sees `cancelled`, and returns before it can import anything. A cancelled
    // entry counts as absent: its action is already doomed, and refusing
    // because of it would 409 the relaunch that follows a Stop.
    const supersededLaunch = pendingLaunches.get(requestBody.moduleId);
    if (supersededLaunch && !supersededLaunch.cancelled) {
      if (!requestBody.replaceRunning) {
        throw new Error(
          `Module ${requestBody.moduleId} is already launching; stop it first or pass replaceRunning: true.`,
        );
      }
      supersededLaunch.cancelled = true;
    }

    if (activeModules.has(requestBody.moduleId)) {
      if (!requestBody.replaceRunning) {
        throw new Error(
          `Module ${requestBody.moduleId} is already running; stop it first or pass replaceRunning: true.`,
        );
      }
      // Request-time stop, so an explicit replacement silences the old run at
      // the moment the user asked for it. The queued action stops again if a
      // run appears in the meantime; a second stop is idempotent.
      await stopModule(requestBody.moduleId, "replaceBeforeLaunch");
    }

    // The stop above suspends past the point where it empties `activeModules`
    // — its teardown still awaits a log write — so another request can pass
    // both checks in that window and register its own pending entry. The `set`
    // below would then replace an uncancelled entry, orphaning an action that
    // stop-all and panic can no longer see and that would still run user code.
    // Anything holding the slot at this point is superseded by this request,
    // which is the one the caller is waiting on.
    const racedLaunch = pendingLaunches.get(requestBody.moduleId);
    if (racedLaunch) racedLaunch.cancelled = true;

    // This run's own identity, minted HERE rather than after the import so the
    // `launching` entry already carries it. `generatedRunId` cannot stand in:
    // a relaunch reuses it whenever the prepared build is unchanged — Replace
    // without an edit does exactly that — so it cannot distinguish this run
    // from the one it replaced.
    const runToken = crypto.randomUUID();
    const pendingLaunch: PendingLaunch = {
      generatedRunId: requestBody.generatedRunId,
      runToken,
      cancelled: false,
    };
    pendingLaunches.set(requestBody.moduleId, pendingLaunch);

    const runSnapshotBase = {
      moduleId: requestBody.moduleId,
      generatedRunId: requestBody.generatedRunId,
      runToken,
      projectModulePath: prepared?.projectModulePath ??
        requestBody.projectModulePath,
      sourceHash: prepared?.sourceHash ?? requestBody.sourceHash,
      projectSourceHash: prepared?.projectSourceHash ??
        requestBody.projectSourceHash,
    };
    setModuleRunSnapshot({
      ...runSnapshotBase,
      state: "launching",
    });

    launchQueue.push(async (ctx) => {
      try {
        // Acceptance means queued, so every safety decision taken between the
        // request and this turn is re-applied here rather than trusted from
        // request time.
        if (pendingLaunch.cancelled) {
          publishCancelledLaunch(
            requestBody.moduleId,
            pendingLaunch,
            "launchCancelled",
          );
          await log({
            type: "launchCancelled",
            moduleId: requestBody.moduleId,
            generatedRunId: requestBody.generatedRunId,
            reason: "cancelledBeforeStart",
          });
          return;
        }

        if (activeModules.has(requestBody.moduleId)) {
          if (!requestBody.replaceRunning) {
            // A run appeared between acceptance and execution and this launch
            // never asked to replace it. It loses silently: any lifecycle
            // snapshot written here would clobber `moduleRuns` for the run that
            // is genuinely active, and that run's own snapshots keep clients
            // converged.
            await log({
              type: "launchAborted",
              moduleId: requestBody.moduleId,
              generatedRunId: requestBody.generatedRunId,
              reason: "moduleAlreadyRunning",
            });
            return;
          }
          await stopModule(requestBody.moduleId, "replaceBeforeLaunch");
        }

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

        // The import is the one long await inside this action, so a stop can
        // land while it is pending. Checked once more before any user code runs.
        if (pendingLaunch.cancelled) {
          publishCancelledLaunch(
            requestBody.moduleId,
            pendingLaunch,
            "launchCancelled",
          );
          await log({
            type: "launchCancelled",
            moduleId: requestBody.moduleId,
            generatedRunId: requestBody.generatedRunId,
            reason: "cancelledDuringImport",
          });
          return;
        }

        const runFunc = mod.runFunc ?? mod.default;
        if (!runFunc) {
          throw new Error(
            `Generated module ${moduleUrl} does not export runFunc/default`,
          );
        }

        const handle = ctx.branch(async (branchCtx) => {
          setModuleRunSnapshot({ ...runSnapshotBase, state: "running" });
          await log({
            type: "moduleStarted",
            moduleId: requestBody.moduleId,
            generatedRunId: requestBody.generatedRunId,
          });
          let reason = "completed";
          let errorMessage: string | undefined;
          try {
            await runFunc(branchCtx);
          } catch (error) {
            reason = isAbortError(error) ? "cancelled" : "error";
            if (reason === "error") {
              errorMessage = error instanceof Error
                ? error.message
                : String(error);
              await log({
                type: "moduleError",
                moduleId: requestBody.moduleId,
                generatedRunId: requestBody.generatedRunId,
                message: errorMessage,
              });
            }
          } finally {
            clearModuleWaits(requestBody.moduleId);
            const active = activeModules.get(requestBody.moduleId);
            if (active?.runToken === runToken) {
              activeModules.delete(requestBody.moduleId);
              // Guarded, unlike clearModuleWaits: `ended` sticks, so a slow-dying
              // previous branch must not end the signals a replacement run has
              // already redeclared.
              endSignalsForModule(requestBody.moduleId);
              setModuleRunSnapshot({
                ...runSnapshotBase,
                state: reason === "error" ? "error" : "stopped",
                ...(errorMessage ? { message: errorMessage } : {}),
              });
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
          runToken,
          transformedModuleUri: requestBody.transformedModuleUri,
          projectModulePath: runSnapshotBase.projectModulePath,
          sourceHash: runSnapshotBase.sourceHash,
          projectSourceHash: runSnapshotBase.projectSourceHash,
          manifest: prepared?.manifest ?? requestBody.manifest ?? null,
          handle,
          stopFunc: typeof mod.stop === "function" ? mod.stop : undefined,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setModuleRunSnapshot({
          ...runSnapshotBase,
          state: "error",
          message,
        });
        await log({
          type: "moduleError",
          moduleId: requestBody.moduleId,
          generatedRunId: requestBody.generatedRunId,
          message,
        });
      } finally {
        // Ownership has already transferred to `activeModules` on the success
        // path, so the module is never absent from both maps while startable.
        // The identity check matters because a superseding request can have
        // registered its own pending entry under this module ID by now.
        if (pendingLaunches.get(requestBody.moduleId) === pendingLaunch) {
          pendingLaunches.delete(requestBody.moduleId);
        }
      }
    });

    if (!parentContext) await log({ type: "launchQueuedBeforeParentReady" });
  }

  // The terminal snapshot an accepted-then-cancelled launch owes its client —
  // but only while the `launching` entry it published is still the latest one.
  // If anything has written since (a successor's `launching`, or the stop that
  // cancelled this launch), that writer owns the run entry and this write would
  // clobber it.
  //
  // Both halves of the test are load-bearing. The token rules out a successor's
  // entry, which `generatedRunId` could not: a relaunch of an unchanged build
  // reuses the ID. The state check rules out this launch's OWN terminal — a
  // stop cancels the pending launch and publishes `stopped` under the same
  // token, and the queued action then arrives and must not reopen it.
  function publishCancelledLaunch(
    moduleId: string,
    pending: PendingLaunch,
    message: string,
  ): void {
    const current = moduleRunSnapshots.get(moduleId);
    if (!current) return;
    if (current.runToken !== pending.runToken) return;
    if (current.state !== "launching") return;
    setModuleRunSnapshot({
      ...current,
      state: "stopped",
      message,
    });
  }

  // A queued launch has no branch to cancel and no active entry to tear down,
  // so cancelling it is an intent flag plus that terminal snapshot.
  async function cancelPendingLaunch(
    moduleId: string,
    pending: PendingLaunch,
    reason: string,
  ): Promise<void> {
    pending.cancelled = true;
    publishCancelledLaunch(moduleId, pending, reason);
    await log({
      type: "launchCancelled",
      moduleId,
      generatedRunId: pending.generatedRunId,
      reason,
    });
  }

  async function cancelPendingLaunches(reason: string): Promise<void> {
    for (const [moduleId, pending] of [...pendingLaunches]) {
      if (pending.cancelled) continue;
      await cancelPendingLaunch(moduleId, pending, reason);
    }
  }

  async function stopModule(moduleId: string, reason: string) {
    const active = activeModules.get(moduleId);
    if (!active) {
      clearModuleWaits(moduleId);
      const pending = pendingLaunches.get(moduleId);
      if (pending && !pending.cancelled) {
        await cancelPendingLaunch(moduleId, pending, reason);
        return;
      }
      const previous = moduleRunSnapshots.get(moduleId);
      if (previous?.state === "launching" || previous?.state === "running") {
        setModuleRunSnapshot({
          ...previous,
          state: "stopped",
          message: reason,
        });
      }
      return;
    }
    await runModuleStopFunc(active, reason);
    await teardownActiveModule(active, reason);
  }

  // Shared per-module teardown tail used by both graceful stop and panic. The
  // only difference between the two paths is that panic skips runModuleStopFunc
  // and passes its own reason/log type; the snapshot payload is identical.
  async function teardownActiveModule(
    active: ActiveModule,
    reason: string,
    opts: { logType?: string } = {},
  ) {
    // Cancelling the branch is unconditional: this handle is the run the caller
    // asked to stop, whatever has happened to the module slot since.
    active.handle.cancel();
    // Everything below is slot-scoped, so it only applies while this record is
    // still the module's active run. `stopModule` can await a `stop()` hook for
    // up to two seconds, and a replacement can win the slot inside that window;
    // deleting by key, ending signals, or writing a terminal snapshot then
    // would retire the run that is currently playing. Object identity, not
    // `generatedRunId`, because a relaunch of an unchanged build reuses the ID.
    if (activeModules.get(active.moduleId) !== active) {
      await log({
        type: "supersededTeardown",
        moduleId: active.moduleId,
        generatedRunId: active.generatedRunId,
        reason,
      });
      return;
    }
    activeModules.delete(active.moduleId);
    clearModuleWaits(active.moduleId);
    // Ephemeral entities end with the run that published them rather than
    // silently freezing, so stop and panic both end this module's signals.
    endSignalsForModule(active.moduleId);
    setModuleRunSnapshot({
      moduleId: active.moduleId,
      generatedRunId: active.generatedRunId,
      runToken: active.runToken,
      state: "stopped",
      projectModulePath: active.projectModulePath,
      sourceHash: active.sourceHash,
      projectSourceHash: active.projectSourceHash,
      message: reason,
    });
    await log({
      type: opts.logType ?? "moduleStopped",
      moduleId: active.moduleId,
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
    await cancelPendingLaunches(reason);
    await Promise.all(
      [...activeModules.keys()].map((moduleId) => stopModule(moduleId, reason)),
    );
  }

  async function panicRuntime(reason: string) {
    // Queued launches first: panic must not let one start after it.
    await cancelPendingLaunches(reason);
    for (const active of [...activeModules.values()]) {
      await teardownActiveModule(active, reason, {
        logType: "modulePanicStopped",
      });
    }
    panicMidi();
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
