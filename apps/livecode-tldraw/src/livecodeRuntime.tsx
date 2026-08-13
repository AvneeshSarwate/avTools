import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { LSClient } from "@valtown/codemirror-ls";
import {
  createDenoLspConnection,
  livecodeDocumentUri,
  type DenoLspConnection,
  type LspDiagnosticSummary,
  type LspStatus,
  retireLspConnection,
} from "./denoLsp";
import {
  createReconnectingSocket,
  type ReconnectingSocketController,
} from "./reconnectingSocket";
import type {
  ActiveWaitSnapshot,
  AnalyzeResponse,
  HealthResponse,
  HistoryEntry,
  LaunchModuleRequest,
  PreparedBuild,
  PreparedFailure,
  ProjectShadowCheckResponse,
  RuntimeModuleRunSnapshotEntry,
  RuntimeStateResponse,
  VisualizerDiagnostic,
  VisualizerManifestMessage,
} from "./livecodeProtocol";

const BUILD_DEBOUNCE_MS = 100;
const PROJECT_DIAGNOSTICS_POLL_MS = 2_500;

export type ConnectionStatus = "closed" | "connecting" | "open" | "error";
export type BuildStatus =
  | "idle"
  | "queued"
  | "analyzing"
  | "ready"
  | "error"
  | "not-connected";
export type RunStatus =
  | "idle"
  | "running"
  | "stopping"
  | "stopped"
  | "error"
  | "unknown";

export interface RunModuleOptions {
  /** Ask the server to stop this module's running run and start this one. */
  replaceRunning?: boolean;
}

export interface ModuleViewState {
  moduleId: string;
  projectModulePath?: string;
  sourceText: string;
  sourceVersion: number;
  buildStatus: BuildStatus;
  runStatus: RunStatus;
  diagnostics: VisualizerDiagnostic[];
  manifest: VisualizerManifestMessage | null;
  history: HistoryEntry[];
  activeIds: string[];
  pianoRollLookups: Record<string, string>;
  lastSnapshotSeq: number | null;
  latestError: string | null;
}

interface ModuleRecord extends ModuleViewState {
  buildTimer: number | null;
  analyzeSequence: number;
  activeGeneratedRunId: string | null;
  lastTerminalRun: { generatedRunId: string; updatedAtMs: number } | null;
  pendingAnalyze: {
    sourceText: string;
    serverBaseUrl: string;
    promise: Promise<PreparedBuild | null>;
  } | null;
  latestBuild: PreparedBuild | null;
  latestFailure: PreparedFailure | null;
}
export interface LivecodeRuntimeApi {
  serverBaseUrl: string;
  setServerBaseUrl(next: string): void;
  connectionStatus: ConnectionStatus;
  lspStatus: LspStatus;
  lspSessionId: string | null;
  lspClient: LSClient | null;
  lspDiagnosticsByUri: Record<string, LspDiagnosticSummary[]>;
  health: HealthResponse | null;
  projectDiagnostics: ProjectShadowCheckResponse | null;
  projectDiagnosticsError: string | null;
  connectionError: string | null;
  modules: Record<string, ModuleViewState>;
  connect(): Promise<void>;
  disconnect(): void;
  registerModule(
    moduleId: string,
    sourceText: string,
    projectModulePath?: string,
  ): void;
  unregisterModule(moduleId: string): void;
  setModuleSource(moduleId: string, sourceText: string): void;
  runModule(moduleId: string, options?: RunModuleOptions): Promise<void>;
  /** Run over the module's own running run: `runModule` with explicit consent. */
  replaceModule(moduleId: string): Promise<void>;
  stopModule(moduleId: string): Promise<void>;
}

const LivecodeRuntimeContext = createContext<LivecodeRuntimeApi | null>(null);

export function useLivecodeRuntime() {
  const runtime = useContext(LivecodeRuntimeContext);
  if (!runtime) {
    throw new Error(
      "useLivecodeRuntime must be used inside LivecodeRuntimeProvider",
    );
  }
  return runtime;
}

export function LivecodeRuntimeProvider({ children }: PropsWithChildren) {
  const initialServerUrl =
    new URLSearchParams(window.location.search).get("serverBaseUrl") ??
      "http://localhost:7777";

  const [serverBaseUrl, setServerBaseUrlState] = useState(initialServerUrl);
  const serverBaseUrlRef = useRef(initialServerUrl);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(
    "closed",
  );
  const connectionStatusRef = useRef<ConnectionStatus>("closed");
  const [lspStatus, setLspStatus] = useState<LspStatus>("closed");
  const [lspSessionId, setLspSessionId] = useState<string | null>(null);
  const [lspClient, setLspClient] = useState<LSClient | null>(null);
  const [lspDiagnosticsByUri, setLspDiagnosticsByUri] = useState<
    Record<string, LspDiagnosticSummary[]>
  >({});
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [projectDiagnostics, setProjectDiagnostics] = useState<
    ProjectShadowCheckResponse | null
  >(null);
  const [projectDiagnosticsError, setProjectDiagnosticsError] = useState<
    string | null
  >(null);
  const [modules, setModules] = useState<Record<string, ModuleViewState>>({});
  const modulesRef = useRef(new Map<string, ModuleRecord>());
  const snapshotsControllerRef = useRef<ReconnectingSocketController | null>(
    null,
  );
  const connectRef = useRef<() => Promise<void>>(async () => {});
  const disconnectRef = useRef<() => void>(() => {});
  const pendingStopsRef = useRef<string[]>([]);
  const lspConnectionRef = useRef<DenoLspConnection | null>(null);
  const snapshotOpenRef = useRef<(socket: WebSocket) => void>(() => {});
  const snapshotMessageRef = useRef<(event: MessageEvent) => void>(() => {});
  const snapshotCloseRef = useRef<() => void>(() => {});
  const snapshotErrorRef = useRef<() => void>(() => {});

  if (snapshotsControllerRef.current === null) {
    snapshotsControllerRef.current = createReconnectingSocket({
      makeUrl: () =>
        `${serverBaseUrlRef.current.replace(/^http/, "ws")}/runtime/snapshots`,
      onOpen: (socket) => snapshotOpenRef.current(socket),
      onMessage: (event) => snapshotMessageRef.current(event),
      onClose: () => snapshotCloseRef.current(),
      onError: () => snapshotErrorRef.current(),
    });
  }

  const publishModule = useCallback((record: ModuleRecord) => {
    const view = toViewState(record);
    setModules((current) => ({ ...current, [record.moduleId]: view }));
  }, []);

  const publishAllModules = useCallback(() => {
    const next: Record<string, ModuleViewState> = {};
    for (const record of modulesRef.current.values()) {
      next[record.moduleId] = toViewState(record);
    }
    setModules(next);
  }, []);

  const setConnectionStatusRef = useCallback((next: ConnectionStatus) => {
    connectionStatusRef.current = next;
    setConnectionStatus(next);
  }, []);

  const markModulesUnknown = useCallback(() => {
    for (const record of modulesRef.current.values()) {
      record.runStatus = "unknown";
      record.activeIds = [];
      record.pianoRollLookups = {};
      record.lastSnapshotSeq = null;
    }
    publishAllModules();
  }, [publishAllModules]);

  const setServerBaseUrl = useCallback((next: string) => {
    const normalized = normalizeServerBaseUrl(next);
    if (serverBaseUrlRef.current === normalized) return;
    const reconnectAfterChange = connectionStatusRef.current !== "closed";
    disconnectRef.current();
    serverBaseUrlRef.current = normalized;
    setServerBaseUrlState(normalized);
    if (reconnectAfterChange) {
      window.setTimeout(() => void connectRef.current(), 0);
    }
  }, []);

  const reconnectDenoLsp = useCallback(() => {
    const oldConnection = lspConnectionRef.current;
    const sessionId = `lsp-${crypto.randomUUID()}`;

    setLspStatus("connecting");
    setLspSessionId(sessionId);
    setLspDiagnosticsByUri({});

    const connection = createDenoLspConnection({
      serverBaseUrl: serverBaseUrlRef.current,
      sessionId,
      onStatus: setLspStatus,
      onDiagnostics: (uri, diagnostics) => {
        setLspDiagnosticsByUri((current) => ({
          ...current,
          [uri]: diagnostics,
        }));
      },
      onError: (message) => {
        setConnectionError(message);
      },
    });

    lspConnectionRef.current = connection;
    setLspClient(connection.client);
    retireLspConnection(oldConnection);

    void connection.transport.connect().catch((error) => {
      if (lspConnectionRef.current !== connection) return;
      setLspStatus("error");
      setConnectionError(
        error instanceof Error ? error.message : String(error),
      );
    });
  }, []);

  const postJson = useCallback(
    async <T,>(path: string, body: unknown): Promise<T> => {
      const response = await fetch(`${serverBaseUrlRef.current}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(
          `${path} failed with ${response.status}: ${await response.text()}`,
        );
      }
      return (await response.json()) as T;
    },
    [],
  );

  const fetchProjectDiagnostics = useCallback(async () => {
    if (connectionStatusRef.current !== "open") return null;
    try {
      const response = await fetch(
        `${serverBaseUrlRef.current}/project/diagnostics`,
      );
      if (!response.ok) {
        throw new Error(
          `/project/diagnostics failed with ${response.status}: ${await response
            .text()}`,
        );
      }
      const diagnostics = (await response.json()) as ProjectShadowCheckResponse;
      setProjectDiagnostics(diagnostics);
      setProjectDiagnosticsError(null);
      return diagnostics;
    } catch (error) {
      setProjectDiagnosticsError(
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
  }, []);

  const rehydrateRuntimeState = useCallback(async () => {
    const response = await fetch(`${serverBaseUrlRef.current}/runtime/state`);
    if (!response.ok) {
      throw new Error(
        `/runtime/state failed with ${response.status}: ${await response
          .text()}`,
      );
    }
    const state = (await response.json()) as RuntimeStateResponse;
    const activeByModule = new Map(
      state.activeModules.map((moduleEntry) => [
        moduleEntry.moduleId,
        moduleEntry,
      ]),
    );

    for (const record of modulesRef.current.values()) {
      const active = activeByModule.get(record.moduleId);
      const run = state.moduleRuns[record.moduleId];
      const latestPrepared = state.latestPreparedByModule[record.moduleId];
      if (active) {
        record.runStatus = "running";
        record.activeGeneratedRunId = active.generatedRunId;
        record.manifest = active.manifest ?? record.manifest;
        record.latestError = null;
      } else {
        record.activeGeneratedRunId = null;
        record.activeIds = [];
        record.runStatus = run
          ? moduleRunStateToRunStatus(run.state)
          : "idle";
        if (run && (run.state === "stopped" || run.state === "error")) {
          record.lastTerminalRun = {
            generatedRunId: run.generatedRunId,
            updatedAtMs: run.updatedAtMs,
          };
        }
        if (run?.state === "error") {
          record.latestError = run.message ?? record.latestError;
        }
        if (latestPrepared?.manifest) {
          record.manifest = latestPrepared.manifest;
        }
      }
    }
    publishAllModules();
  }, [publishAllModules]);

  const flushPendingStops = useCallback(async () => {
    const pending = [...new Set(pendingStopsRef.current)];
    pendingStopsRef.current = [];
    await Promise.all(
      pending.map((moduleId) =>
        postJson("/runtime/stop", { moduleId }).catch(() => undefined)
      ),
    );
  }, [postJson]);

  const analyzeNow = useCallback(
    async (
      record: ModuleRecord,
      sourceText: string,
    ): Promise<PreparedBuild | null> => {
      if (connectionStatusRef.current !== "open") {
        record.buildStatus = "not-connected";
        publishModule(record);
        return null;
      }

      const sourceVersion = record.sourceVersion + 1;
      const analyzeSequence = record.analyzeSequence + 1;
      const requestServerUrl = serverBaseUrlRef.current;
      record.sourceVersion = sourceVersion;
      record.analyzeSequence = analyzeSequence;
      record.buildStatus = "analyzing";
      record.latestError = null;
      publishModule(record);

      const analyzeRequest = record.projectModulePath
        ? {
          moduleId: record.moduleId,
          sourceVersion,
          projectModulePath: record.projectModulePath,
        }
        : {
          moduleId: record.moduleId,
          sourceVersion,
          sourceUri: `livecode-editor://${record.moduleId}.ts`,
          sourceText,
        };

      const promise = (async () => {
        if (record.projectModulePath) {
          await postJson("/project/modules/write", {
            path: record.projectModulePath,
            sourceText,
            sourceVersion,
          });
        }
        return await postJson<AnalyzeResponse>(
          "/runtime/analyze",
          analyzeRequest,
        );
      })()
        .then((response): PreparedBuild | null => {
          if (record.analyzeSequence !== analyzeSequence) return null;
          if (record.projectModulePath) {
            void fetchProjectDiagnostics();
          }

          if (response.type === "analyzeSuccess") {
            const prepared: PreparedBuild = {
              ...response,
              sourceText,
              serverBaseUrl: requestServerUrl,
            };
            record.latestBuild = prepared;
            record.latestFailure = null;
            record.manifest = response.manifest;
            record.diagnostics = [];
            record.buildStatus = "ready";
            record.history = [
              {
                generatedRunId: response.generatedRunId,
                sourceVersion: response.sourceVersion,
                callsiteCount: response.manifest.callsites.length,
                transformedModuleUri: response.transformedModuleUri,
              },
              ...record.history,
            ].slice(0, 50);
            publishModule(record);
            return prepared;
          }

          record.latestBuild = null;
          record.latestFailure = {
            ...response,
            sourceText,
            serverBaseUrl: requestServerUrl,
          };
          record.manifest = null;
          record.diagnostics = response.diagnostics;
          record.activeIds = [];
          record.pianoRollLookups = {};
          record.buildStatus = "error";
          publishModule(record);
          return null;
        })
        .catch((error: unknown) => {
          if (record.analyzeSequence !== analyzeSequence) return null;
          record.latestBuild = null;
          record.latestFailure = null;
          record.manifest = null;
          record.diagnostics = [];
          record.activeIds = [];
          record.pianoRollLookups = {};
          record.buildStatus = "error";
          record.latestError = error instanceof Error
            ? error.message
            : String(error);
          publishModule(record);
          return null;
        })
        .finally(() => {
          if (record.pendingAnalyze?.promise === promise) {
            record.pendingAnalyze = null;
          }
        });

      record.pendingAnalyze = {
        sourceText,
        serverBaseUrl: requestServerUrl,
        promise,
      };

      return promise;
    },
    [fetchProjectDiagnostics, postJson, publishModule],
  );

  const scheduleAnalyze = useCallback(
    (record: ModuleRecord, delayMs = BUILD_DEBOUNCE_MS) => {
      if (record.buildTimer !== null) {
        window.clearTimeout(record.buildTimer);
      }
      record.buildStatus = connectionStatusRef.current === "open"
        ? "queued"
        : "not-connected";
      publishModule(record);
      record.buildTimer = window.setTimeout(() => {
        record.buildTimer = null;
        void analyzeNow(record, record.sourceText);
      }, delayMs);
    },
    [analyzeNow, publishModule],
  );

  const ensureBuild = useCallback(
    async (record: ModuleRecord): Promise<PreparedBuild | null> => {
      if (
        record.latestBuild &&
        record.latestBuild.sourceText === record.sourceText &&
        record.latestBuild.serverBaseUrl === serverBaseUrlRef.current
      ) {
        return record.latestBuild;
      }

      if (
        record.pendingAnalyze &&
        record.pendingAnalyze.sourceText === record.sourceText &&
        record.pendingAnalyze.serverBaseUrl === serverBaseUrlRef.current
      ) {
        return await record.pendingAnalyze.promise;
      }

      if (record.buildTimer !== null) {
        window.clearTimeout(record.buildTimer);
        record.buildTimer = null;
      }

      return await analyzeNow(record, record.sourceText);
    },
    [analyzeNow],
  );

  snapshotOpenRef.current = (socket) => {
    setConnectionStatusRef("open");
    void (async () => {
      try {
        // Health + LSP recovery run on EVERY socket open (not just manual
        // connect) so an auto-reconnect after a server restart restores the
        // LSP session and health state, matching the pre-refactor behavior
        // where reconnects re-ran the full connect() path.
        const response = await fetch(`${serverBaseUrlRef.current}/health`);
        if (!response.ok) {
          throw new Error(
            `/health failed with ${response.status}: ${await response.text()}`,
          );
        }
        const healthResponse = (await response.json()) as HealthResponse;
        if (snapshotsControllerRef.current?.socket !== socket) return;
        setHealth(healthResponse);
        reconnectDenoLsp();
        await rehydrateRuntimeState();
        await flushPendingStops();
        for (const record of modulesRef.current.values()) {
          scheduleAnalyze(record, 0);
        }
      } catch (error) {
        if (snapshotsControllerRef.current?.socket !== socket) return;
        setConnectionError(
          error instanceof Error ? error.message : String(error),
        );
      }
    })();
  };

  snapshotMessageRef.current = (event) => {
    const snapshot = JSON.parse(event.data as string) as ActiveWaitSnapshot;
    const pianoRollLookups = snapshot.pianoRollLookups ?? {};
    const moduleRuns = snapshot.moduleRuns ?? {};
    for (const record of modulesRef.current.values()) {
      record.activeIds = snapshot.modules[record.moduleId] ?? [];
      record.pianoRollLookups = pianoRollLookups[record.moduleId] ?? {};
      applyModuleRunSnapshot(record, moduleRuns[record.moduleId]);
      record.lastSnapshotSeq = snapshot.seq;
    }
    publishAllModules();
  };

  snapshotCloseRef.current = () => {
    markModulesUnknown();
    if (connectionStatusRef.current !== "closed") {
      setConnectionStatusRef("closed");
    }
  };

  snapshotErrorRef.current = () => {
    setConnectionError("runtime snapshot websocket failed");
    setConnectionStatusRef("error");
  };

  const connect = useCallback(async () => {
    setConnectionError(null);
    setConnectionStatusRef("connecting");
    // Health check, LSP reconnect, and rehydrate all run in the controller's
    // onOpen handler, so manual connects and automatic reconnects follow the
    // identical recovery path. If the server is down the socket fails to open
    // and the controller keeps retrying with backoff.
    snapshotsControllerRef.current?.connect();
  }, [setConnectionStatusRef]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  const disconnect = useCallback(() => {
    snapshotsControllerRef.current?.close();
    setConnectionError(null);
    setProjectDiagnostics(null);
    setProjectDiagnosticsError(null);
    const lspConnection = lspConnectionRef.current;
    lspConnectionRef.current = null;
    setLspClient(null);
    setLspSessionId(null);
    setLspDiagnosticsByUri({});
    setLspStatus("closed");
    retireLspConnection(lspConnection);
    setConnectionStatusRef("closed");
    markModulesUnknown();
  }, [markModulesUnknown, setConnectionStatusRef]);

  useEffect(() => {
    if (connectionStatus !== "open") return;
    void fetchProjectDiagnostics();
    const timer = window.setInterval(
      () => void fetchProjectDiagnostics(),
      PROJECT_DIAGNOSTICS_POLL_MS,
    );
    return () => window.clearInterval(timer);
  }, [connectionStatus, fetchProjectDiagnostics]);

  useEffect(() => {
    const controller = snapshotsControllerRef.current;
    return () => {
      controller?.close();
      retireLspConnection(lspConnectionRef.current);
    };
  }, []);

  const registerModule = useCallback(
    (moduleId: string, sourceText: string, projectModulePath?: string) => {
      const existing = modulesRef.current.get(moduleId);
      if (existing) return;
      const record = makeModuleRecord(moduleId, sourceText, projectModulePath);
      modulesRef.current.set(moduleId, record);
      publishModule(record);
      if (connectionStatusRef.current === "open") {
        scheduleAnalyze(record, 0);
      }
    },
    [publishModule, scheduleAnalyze],
  );

  const unregisterModule = useCallback(
    (moduleId: string) => {
      const record = modulesRef.current.get(moduleId);
      if (!record) return;
      if (record.buildTimer !== null) {
        window.clearTimeout(record.buildTimer);
      }
      modulesRef.current.delete(moduleId);
      setModules((current) => {
        const next = { ...current };
        delete next[moduleId];
        return next;
      });
      const documentUri = livecodeDocumentUri(moduleId);
      setLspDiagnosticsByUri((current) => {
        const next = { ...current };
        delete next[documentUri];
        return next;
      });
      if (connectionStatusRef.current === "open") {
        void postJson("/runtime/stop", { moduleId }).catch(() => undefined);
      } else {
        pendingStopsRef.current.push(moduleId);
      }
    },
    [postJson],
  );

  const setModuleSource = useCallback(
    (moduleId: string, sourceText: string) => {
      const record = modulesRef.current.get(moduleId);
      if (!record) return;
      if (record.sourceText === sourceText) return;
      record.sourceText = sourceText;
      record.latestBuild = null;
      record.latestFailure = null;
      record.manifest = null;
      record.diagnostics = [];
      record.activeIds = [];
      record.pianoRollLookups = {};
      record.activeGeneratedRunId = null;
      scheduleAnalyze(record);
    },
    [scheduleAnalyze],
  );

  const runModule = useCallback(
    async (moduleId: string, options: RunModuleOptions = {}) => {
      const record = modulesRef.current.get(moduleId);
      if (!record) return;
      record.runStatus = "running";
      record.latestError = null;
      publishModule(record);

      const build = await ensureBuild(record);
      if (!build) {
        record.runStatus = "error";
        record.latestError = record.latestError ??
          "module did not analyze successfully";
        publishModule(record);
        return;
      }

      try {
        if (record.projectModulePath) {
          const diagnostics = await fetchProjectDiagnostics();
          if (!diagnostics) {
            record.runStatus = "error";
            record.latestError = "project diagnostics are not available";
            publishModule(record);
            return;
          }
          if (!diagnostics.denoCheck.success) {
            record.runStatus = "error";
            record.latestError = summarizeProjectDiagnostics(
              record.moduleId,
              diagnostics,
            );
            publishModule(record);
            return;
          }
        }

        // Claiming the new run before posting is what keeps the terminal guard
        // in `applyModuleRunSnapshot` sound during a replacement: the run being
        // replaced reports its terminal with the previous ID, which no longer
        // matches and is correctly ignored.
        record.activeGeneratedRunId = build.generatedRunId;
        await postJson("/runtime/launch", {
          moduleId: build.moduleId,
          transformedModuleUri: build.transformedModuleUri,
          generatedRunId: build.generatedRunId,
          sourceHash: build.sourceHash,
          projectSourceHash: build.projectSourceHash,
          projectModulePath: build.projectModulePath,
          manifest: build.manifest,
          ...(options.replaceRunning ? { replaceRunning: true } : {}),
        } satisfies LaunchModuleRequest);
        record.runStatus = "running";
        record.latestError = null;
        publishModule(record);
      } catch (error) {
        record.runStatus = "error";
        record.activeGeneratedRunId = null;
        record.latestError = error instanceof Error
          ? error.message
          : String(error);
        publishModule(record);
      }
    },
    [ensureBuild, fetchProjectDiagnostics, postJson, publishModule],
  );

  // Replacement is an explicit gesture, never an implicit consequence of Run:
  // the server refuses a launch over a running module unless this flag says the
  // user asked for it.
  const replaceModule = useCallback(
    (moduleId: string) => runModule(moduleId, { replaceRunning: true }),
    [runModule],
  );

  const stopModule = useCallback(
    async (moduleId: string) => {
      const record = modulesRef.current.get(moduleId);
      if (!record) return;
      record.runStatus = "stopping";
      publishModule(record);

      try {
        await postJson("/runtime/stop", { moduleId });
        record.runStatus = "stopping";
        record.latestError = null;
      } catch (error) {
        record.runStatus = "error";
        record.latestError = error instanceof Error
          ? error.message
          : String(error);
      }
      publishModule(record);
    },
    [postJson, publishModule],
  );

  useEffect(() => {
    disconnectRef.current = disconnect;
  }, [disconnect]);

  const value = useMemo<LivecodeRuntimeApi>(
    () => ({
      serverBaseUrl,
      setServerBaseUrl,
      connectionStatus,
      lspStatus,
      lspSessionId,
      lspClient,
      lspDiagnosticsByUri,
      health,
      projectDiagnostics,
      projectDiagnosticsError,
      connectionError,
      modules,
      connect,
      disconnect,
      registerModule,
      unregisterModule,
      setModuleSource,
      runModule,
      replaceModule,
      stopModule,
    }),
    [
      serverBaseUrl,
      setServerBaseUrl,
      connectionStatus,
      lspStatus,
      lspSessionId,
      lspClient,
      lspDiagnosticsByUri,
      health,
      projectDiagnostics,
      projectDiagnosticsError,
      connectionError,
      modules,
      connect,
      disconnect,
      registerModule,
      unregisterModule,
      setModuleSource,
      runModule,
      replaceModule,
      stopModule,
    ],
  );

  return (
    <LivecodeRuntimeContext.Provider value={value}>
      {children}
    </LivecodeRuntimeContext.Provider>
  );
}

function makeModuleRecord(
  moduleId: string,
  sourceText: string,
  projectModulePath?: string,
): ModuleRecord {
  return {
    moduleId,
    projectModulePath,
    sourceText,
    sourceVersion: 0,
    buildStatus: "idle",
    runStatus: "idle",
    diagnostics: [],
    manifest: null,
    history: [],
    activeIds: [],
    pianoRollLookups: {},
    lastSnapshotSeq: null,
    latestError: null,
    buildTimer: null,
    activeGeneratedRunId: null,
    lastTerminalRun: null,
    analyzeSequence: 0,
    pendingAnalyze: null,
    latestBuild: null,
    latestFailure: null,
  };
}

function applyModuleRunSnapshot(
  record: ModuleRecord,
  run: RuntimeModuleRunSnapshotEntry | undefined,
) {
  if (!run) return;
  const isServerActive = run.state === "launching" || run.state === "running";

  if (isServerActive) {
    const seenTerminal = record.lastTerminalRun !== null &&
      record.lastTerminalRun.generatedRunId === run.generatedRunId &&
      run.updatedAtMs <= record.lastTerminalRun.updatedAtMs;
    if (seenTerminal) return;
    record.activeGeneratedRunId = run.generatedRunId;
    if (record.runStatus !== "stopping") record.runStatus = "running";
    return;
  }

  // Mirror of the active-side dedupe. A terminal entry stays in `moduleRuns`
  // for the life of the server, so every later snapshot re-delivers it; without
  // this, a run started after it would be retired by its predecessor's terminal
  // during the window where the record holds no claim yet (Run sets `running`
  // optimistically, then awaits the build before claiming the new run ID).
  const seenTerminal = record.lastTerminalRun !== null &&
    record.lastTerminalRun.generatedRunId === run.generatedRunId &&
    run.updatedAtMs <= record.lastTerminalRun.updatedAtMs;
  if (seenTerminal) return;

  record.lastTerminalRun = {
    generatedRunId: run.generatedRunId,
    updatedAtMs: run.updatedAtMs,
  };

  const matchesActiveRun = record.activeGeneratedRunId === run.generatedRunId;
  // With no active-run claim there is nothing to protect, so a terminal
  // snapshot is server truth and applies. That case is ordinary: an edit calls
  // `setModuleSource`, which nulls the claim, and a module edited while it ran
  // would otherwise never see its own natural completion and stay `running`
  // until a reload. The guard exists only to stop an OLD run's terminal from
  // clobbering a NEWER client-initiated launch, which stays covered because
  // `runModule` sets the new generated run ID before it posts.
  const mayApplyTerminalState = matchesActiveRun ||
    !record.activeGeneratedRunId;
  if (!mayApplyTerminalState) return;

  record.activeGeneratedRunId = null;
  record.activeIds = [];
  if (run.state === "error") {
    record.runStatus = "error";
    record.latestError = run.message ?? record.latestError;
  } else if (run.state === "stopped") {
    record.runStatus = "stopped";
  }
}

function moduleRunStateToRunStatus(
  state: RuntimeModuleRunSnapshotEntry["state"],
): RunStatus {
  if (state === "launching" || state === "running") return "unknown";
  return state;
}

function toViewState(record: ModuleRecord): ModuleViewState {
  return {
    moduleId: record.moduleId,
    projectModulePath: record.projectModulePath,
    sourceText: record.sourceText,
    sourceVersion: record.sourceVersion,
    buildStatus: record.buildStatus,
    runStatus: record.runStatus,
    diagnostics: record.diagnostics,
    manifest: record.manifest,
    history: record.history,
    activeIds: record.activeIds,
    pianoRollLookups: record.pianoRollLookups,
    lastSnapshotSeq: record.lastSnapshotSeq,
    latestError: record.latestError,
  };
}

function summarizeProjectDiagnostics(
  moduleId: string,
  diagnostics: ProjectShadowCheckResponse,
) {
  const moduleDiagnostics = diagnostics.modules.find((moduleEntry) =>
    moduleEntry.moduleId === moduleId
  );
  const directDiagnostic = moduleDiagnostics?.diagnostics[0] ??
    moduleDiagnostics?.dependencyDiagnostics[0] ??
    diagnostics.diagnostics[0];
  const count = diagnostics.diagnostics.length;
  if (!directDiagnostic) {
    return `project typecheck failed (${count} diagnostics)`;
  }
  const location = directDiagnostic.path ?? directDiagnostic.moduleId ??
    "project";
  return `project typecheck failed (${count} diagnostics): ${location} ${directDiagnostic.code}: ${directDiagnostic.message}`;
}

function normalizeServerBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}
