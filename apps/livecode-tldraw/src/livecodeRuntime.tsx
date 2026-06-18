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
  type DenoLspConnection,
  type LspDiagnosticSummary,
  type LspStatus,
  retireLspConnection,
} from "./denoLsp";
import type {
  ActiveWaitSnapshot,
  AnalyzeResponse,
  HealthResponse,
  HistoryEntry,
  PreparedBuild,
  PreparedFailure,
  ProjectShadowCheckResponse,
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
export type RunStatus = "idle" | "running" | "stopping" | "stopped" | "error";

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
  lastSnapshotSeq: number | null;
  latestError: string | null;
}

interface ModuleRecord extends ModuleViewState {
  buildTimer: number | null;
  analyzeSequence: number;
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
  runModule(moduleId: string): Promise<void>;
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
  const snapshotsSocketRef = useRef<WebSocket | null>(null);
  const lspConnectionRef = useRef<DenoLspConnection | null>(null);

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

  const setServerBaseUrl = useCallback((next: string) => {
    const normalized = normalizeServerBaseUrl(next);
    serverBaseUrlRef.current = normalized;
    setServerBaseUrlState(normalized);
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
          `/project/diagnostics failed with ${response.status}: ${
            await response.text()
          }`,
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
            ];
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

  const connect = useCallback(async () => {
    setConnectionError(null);
    setConnectionStatusRef("connecting");
    snapshotsSocketRef.current?.close();

    try {
      const response = await fetch(`${serverBaseUrlRef.current}/health`);
      if (!response.ok) {
        throw new Error(
          `/health failed with ${response.status}: ${await response.text()}`,
        );
      }
      const healthResponse = (await response.json()) as HealthResponse;
      setHealth(healthResponse);
      reconnectDenoLsp();

      const socketUrl = `${
        serverBaseUrlRef.current.replace(/^http/, "ws")
      }/runtime/snapshots`;
      const socket = new WebSocket(socketUrl);
      snapshotsSocketRef.current = socket;

      socket.onopen = () => {
        setConnectionStatusRef("open");
        for (const record of modulesRef.current.values()) {
          scheduleAnalyze(record, 0);
        }
      };

      socket.onmessage = (event) => {
        const snapshot = JSON.parse(event.data as string) as ActiveWaitSnapshot;
        for (const record of modulesRef.current.values()) {
          record.activeIds = snapshot.modules[record.moduleId] ?? [];
          record.lastSnapshotSeq = snapshot.seq;
        }
        publishAllModules();
      };

      socket.onerror = () => {
        setConnectionError("runtime snapshot websocket failed");
        setConnectionStatusRef("error");
      };

      socket.onclose = () => {
        if (snapshotsSocketRef.current === socket) {
          snapshotsSocketRef.current = null;
        }
        if (connectionStatusRef.current !== "closed") {
          setConnectionStatusRef("closed");
        }
      };
    } catch (error) {
      setConnectionError(
        error instanceof Error ? error.message : String(error),
      );
      setConnectionStatusRef("error");
    }
  }, [
    publishAllModules,
    reconnectDenoLsp,
    scheduleAnalyze,
    setConnectionStatusRef,
  ]);

  const disconnect = useCallback(() => {
    setConnectionError(null);
    setProjectDiagnostics(null);
    setProjectDiagnosticsError(null);
    snapshotsSocketRef.current?.close();
    snapshotsSocketRef.current = null;
    const lspConnection = lspConnectionRef.current;
    lspConnectionRef.current = null;
    setLspClient(null);
    setLspSessionId(null);
    setLspDiagnosticsByUri({});
    setLspStatus("closed");
    retireLspConnection(lspConnection);
    setConnectionStatusRef("closed");
    for (const record of modulesRef.current.values()) {
      record.activeIds = [];
      record.lastSnapshotSeq = null;
    }
    publishAllModules();
  }, [publishAllModules, setConnectionStatusRef]);

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
    return () => {
      snapshotsSocketRef.current?.close();
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
      if (connectionStatusRef.current === "open") {
        void postJson("/runtime/stop", { moduleId }).catch(() => undefined);
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
      record.activeIds = [];
      scheduleAnalyze(record);
    },
    [scheduleAnalyze],
  );

  const runModule = useCallback(
    async (moduleId: string) => {
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

        await postJson("/runtime/launch", {
          moduleId: build.moduleId,
          transformedModuleUri: build.transformedModuleUri,
          generatedRunId: build.generatedRunId,
          sourceHash: build.sourceHash,
          projectSourceHash: build.projectSourceHash,
          projectModulePath: build.projectModulePath,
        });
        record.runStatus = build.manifest.callsites.length > 0
          ? "running"
          : "stopped";
        record.latestError = null;
        publishModule(record);
      } catch (error) {
        record.runStatus = "error";
        record.latestError = error instanceof Error
          ? error.message
          : String(error);
        publishModule(record);
      }
    },
    [ensureBuild, fetchProjectDiagnostics, postJson, publishModule],
  );

  const stopModule = useCallback(
    async (moduleId: string) => {
      const record = modulesRef.current.get(moduleId);
      if (!record) return;
      record.runStatus = "stopping";
      publishModule(record);

      try {
        await postJson("/runtime/stop", { moduleId });
        record.runStatus = "stopped";
        record.activeIds = [];
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
    lastSnapshotSeq: null,
    latestError: null,
    buildTimer: null,
    analyzeSequence: 0,
    pendingAnalyze: null,
    latestBuild: null,
    latestFailure: null,
  };
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
