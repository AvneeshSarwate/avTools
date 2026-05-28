import { launch, type TimeContext } from "@avtools/core-timing";
import { LSWSServer } from "@valtown/ls-ws-server";
import { fromFileUrl, isAbsolute, join } from "jsr:@std/path@1";
import { pathToFileURL } from "node:url";
import { analyzeAndTransformTimedModule } from "./analyze_transform.ts";
import { createGeneratedRunId } from "./generated_run_id.ts";
import type {
  ActiveWaitSnapshot,
  AnalyzeRequest,
  AnalyzeResponse,
  HealthResponse,
  LaunchModuleRequest,
  StopModuleRequest,
} from "./protocol.ts";
import { clearModuleWaits, makeActiveWaitSnapshot } from "./runtime.ts";

interface BranchHandle {
  cancel: () => void;
  finally: (f: () => void) => void;
}

interface ActiveModule {
  moduleId: string;
  generatedRunId: string;
  transformedModuleUri: string;
  handle: BranchHandle;
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
const REPO_ROOT = fromFileUrl(new URL("../../..", import.meta.url));
const DEFAULT_SESSION_ROOT = fromFileUrl(
  new URL("../.avtools-livecode-sessions", import.meta.url),
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
  const activeModules = new Map<string, ActiveModule>();
  const launchQueue: Array<(ctx: TimeContext) => Promise<void> | void> = [];
  let parentContext: TimeContext | null = null;
  let lastSnapshotJson = "";
  let snapshotTimer: number | undefined;
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
      };
      return json(response);
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
      for (const socket of sockets) socket.close();
      for (const moduleId of [...activeModules.keys()]) {
        await stopModule(moduleId, "serverClose");
      }
      parentHandle.cancel();
      await lspWsServer.shutdown();
      await server.shutdown();
    },
  };

  async function analyzeModule(
    requestBody: AnalyzeRequest,
  ): Promise<AnalyzeResponse> {
    await log({
      type: "analyzeStart",
      moduleId: requestBody.moduleId,
      sourceVersion: requestBody.sourceVersion,
    });

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
    });

    if (result.type === "analyzeFailure") {
      await log({
        type: "analyzeFailure",
        moduleId: requestBody.moduleId,
        sourceVersion: requestBody.sourceVersion,
        diagnosticCount: result.diagnostics.length,
      });
      return result;
    }

    await Deno.writeTextFile(generatedPath, result.transformedCode);
    const transformedModuleUri = pathToFileURL(generatedPath).href;
    await log({
      type: "analyzeSuccess",
      moduleId: requestBody.moduleId,
      sourceVersion: requestBody.sourceVersion,
      generatedRunId,
      callsiteCount: result.manifest.callsites.length,
      transformedModuleUri,
    });

    return {
      ...result,
      transformedModuleUri,
      generatedRunId,
      transformedCode: undefined,
    };
  }

  async function launchModule(requestBody: LaunchModuleRequest) {
    await log({
      type: "launchQueued",
      moduleId: requestBody.moduleId,
      generatedRunId: requestBody.generatedRunId,
    });

    await stopModule(requestBody.moduleId, "replaceBeforeLaunch");
    launchQueue.push(async (ctx) => {
      const moduleUrl =
        `${requestBody.transformedModuleUri}?launch=${crypto.randomUUID()}`;
      const mod = await import(moduleUrl) as {
        runFunc?: (ctx: TimeContext) => Promise<void>;
        default?: (ctx: TimeContext) => Promise<void>;
      };
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
        handle,
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

function resolvePath(path: string): string {
  if (path.startsWith("file:")) return fromFileUrl(path);
  if (isAbsolute(path)) return path;
  return join(Deno.cwd(), path);
}

function sanitizeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error &&
    /aborted|context canceled/i.test(error.message);
}
