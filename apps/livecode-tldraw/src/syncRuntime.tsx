// Resets replace a per-type map, and a sequence gap recovers by resubscribing.
// Separate React contexts keep high-frequency entity kinds isolated.

import {
  type Context,
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AnimationTimelineData,
  AnimationTimelineEntity,
  AnimationTimelineSetResult,
  ModuleLookupsEntity,
  ModuleWaitsEntity,
  ParamsEntity,
  ParamsValues,
  PianoRollData,
  PianoRollObject,
  PianoRollSetResult,
  RunEntity,
  SetAnimationTimelineRequest,
  SetPianoRollRequest,
  SignalEntity,
  SyncMessage,
} from "@avtools/livecode-protocol";
import { SYNC_ENTITY_TYPES } from "@avtools/livecode-protocol";
import type { ReconnectingSocketController } from "./reconnectingSocket";
import { engineAction, serverWebSocketUrl } from "./serverRequests";
import {
  applySyncMessageToState,
  emptySyncSlice,
  emptySyncState,
  type SyncEntityTypeKey,
  type SyncSlice,
  type SyncState,
} from "./syncState";
import {
  configuredSyncTransport,
  createBroadcastSyncTransport,
  createWebSocketSyncTransport,
  type SyncPort,
  type SyncTransportCallbacks,
} from "./syncTransport";

export type { SyncSlice } from "./syncState";

export type SyncConnectionStatus = "closed" | "connecting" | "open" | "error";

/**
 * Every kind this client watches — the protocol package's canonical list,
 * shared with the engine's hello/detach resets. One subscribe carries the
 * whole list, and a subscribe REPLACES the socket's set — so this is also the
 * gap-recovery message, resent verbatim.
 */
export { SYNC_ENTITY_TYPES };

/**
 * One entity kind's current state, plus the `seq` of the message that last
 * touched it. Per-slice rather than global so a component showing a sequence
 * number re-renders on its OWN traffic, the way the four channels behaved.
 */
export interface SyncConnection {
  connectionStatus: SyncConnectionStatus;
  connectionError: string | null;
  /** The `seq` of the newest message on this socket, whatever it carried. */
  latestSeq: number | null;
}

export interface SyncActions {
  serverBaseUrl: string;
  setServerBaseUrl(next: string): void;
  setRoll(
    name: string,
    data: PianoRollData,
    options?: { originId?: string; label?: string },
  ): Promise<PianoRollSetResult>;
  undoRoll(name: string, originId?: string): Promise<void>;
  redoRoll(name: string, originId?: string): Promise<void>;
  setParams(
    name: string,
    values: ParamsValues,
    options?: { originId?: string },
  ): Promise<ParamsEntity>;
  setAnimationTimeline(
    name: string,
    data: AnimationTimelineData,
    options?: { originId?: string; expectedRev?: number },
  ): Promise<AnimationTimelineSetResult>;
}

/**
 * Socket-lifecycle edges, delivered imperatively rather than through React
 * state. The livecode runtime hangs its open-sequence (health → LSP → rehydrate
 * → flush pending stops → re-analyze) off these, and that sequence must run once
 * per real socket open: a close and reopen batched into one React commit would
 * collapse into no state change at all and skip the recovery.
 */
export interface SyncLifecycle {
  isOpen(): boolean;
  addListener(listener: SyncLifecycleListener): () => void;
}

export interface SyncLifecycleListener {
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (message: string) => void;
}

const PianoRollsContext = createContext<SyncSlice<PianoRollObject>>(
  emptySyncSlice(),
);
const ParamsContext = createContext<SyncSlice<ParamsEntity>>(emptySyncSlice());
const AnimationTimelinesContext = createContext<
  SyncSlice<AnimationTimelineEntity>
>(emptySyncSlice());
const SignalsContext = createContext<SyncSlice<SignalEntity>>(
  emptySyncSlice(),
);
const RunsContext = createContext<SyncSlice<RunEntity>>(emptySyncSlice());
const ModuleWaitsContext = createContext<SyncSlice<ModuleWaitsEntity>>(
  emptySyncSlice(),
);
const ModuleLookupsContext = createContext<SyncSlice<ModuleLookupsEntity>>(
  emptySyncSlice(),
);
const SyncConnectionContext = createContext<SyncConnection | null>(null);
const SyncActionsContext = createContext<SyncActions | null>(null);
const SyncLifecycleContext = createContext<SyncLifecycle | null>(null);

/** Active-ness is derived client-side now; the transport has no active list. */
export function isRunActive(run: RunEntity): boolean {
  return run.state === "launching" || run.state === "running";
}

export function useSyncConnection(): SyncConnection {
  return useRequiredContext(SyncConnectionContext, "useSyncConnection");
}

export function useSyncActions(): SyncActions {
  return useRequiredContext(SyncActionsContext, "useSyncActions");
}

export function useSyncLifecycle(): SyncLifecycle {
  return useRequiredContext(SyncLifecycleContext, "useSyncLifecycle");
}

export interface PianoRollsSyncApi {
  connectionStatus: SyncConnectionStatus;
  connectionError: string | null;
  rolls: Record<string, PianoRollObject>;
  latestSeq: number | null;
  setRoll: SyncActions["setRoll"];
  undoRoll: SyncActions["undoRoll"];
  redoRoll: SyncActions["redoRoll"];
}

export function usePianoRollsSync(): PianoRollsSyncApi {
  const slice = useContext(PianoRollsContext);
  const { connectionStatus, connectionError } = useSyncConnection();
  const { setRoll, undoRoll, redoRoll } = useSyncActions();
  return useMemo(
    () => ({
      connectionStatus,
      connectionError,
      rolls: slice.entities,
      latestSeq: slice.latestSeq,
      setRoll,
      undoRoll,
      redoRoll,
    }),
    [connectionError, connectionStatus, redoRoll, setRoll, slice, undoRoll],
  );
}

export interface ParamsSyncApi {
  connectionStatus: SyncConnectionStatus;
  connectionError: string | null;
  params: Record<string, ParamsEntity>;
  latestSeq: number | null;
  setParams: SyncActions["setParams"];
}

export function useParamsSync(): ParamsSyncApi {
  const slice = useContext(ParamsContext);
  const { connectionStatus, connectionError } = useSyncConnection();
  const { setParams } = useSyncActions();
  return useMemo(
    () => ({
      connectionStatus,
      connectionError,
      params: slice.entities,
      latestSeq: slice.latestSeq,
      setParams,
    }),
    [connectionError, connectionStatus, setParams, slice],
  );
}

export interface AnimationTimelinesSyncApi {
  connectionStatus: SyncConnectionStatus;
  connectionError: string | null;
  timelines: Record<string, AnimationTimelineEntity>;
  latestSeq: number | null;
  setTimeline: SyncActions["setAnimationTimeline"];
}

export function useAnimationTimelinesSync(): AnimationTimelinesSyncApi {
  const slice = useContext(AnimationTimelinesContext);
  const { connectionStatus, connectionError } = useSyncConnection();
  const { setAnimationTimeline } = useSyncActions();
  return useMemo(
    () => ({
      connectionStatus,
      connectionError,
      timelines: slice.entities,
      latestSeq: slice.latestSeq,
      setTimeline: setAnimationTimeline,
    }),
    [connectionError, connectionStatus, setAnimationTimeline, slice],
  );
}

export interface SignalsSyncApi {
  connectionStatus: SyncConnectionStatus;
  connectionError: string | null;
  signals: Record<string, SignalEntity>;
  latestSeq: number | null;
}

/** Read-only by construction: signals are published by running code. */
export function useSignalsSync(): SignalsSyncApi {
  const slice = useContext(SignalsContext);
  const { connectionStatus, connectionError } = useSyncConnection();
  return useMemo(
    () => ({
      connectionStatus,
      connectionError,
      signals: slice.entities,
      latestSeq: slice.latestSeq,
    }),
    [connectionError, connectionStatus, slice],
  );
}

export interface RunsSyncApi {
  runs: Record<string, RunEntity>;
  latestSeq: number | null;
}

export function useRunsSync(): RunsSyncApi {
  const slice = useContext(RunsContext);
  return useMemo(
    () => ({ runs: slice.entities, latestSeq: slice.latestSeq }),
    [slice],
  );
}

export interface ModuleVizSyncApi {
  /** moduleId → the callsites that module is currently awaiting. */
  moduleWaits: Record<string, ModuleWaitsEntity>;
  /** moduleId → callsiteId → the roll name that callsite last resolved to. */
  moduleLookups: Record<string, ModuleLookupsEntity>;
  latestSeq: number | null;
}

/** Runtime observation state consumed by the editor's inline decorations. */
export function useModuleVizSync(): ModuleVizSyncApi {
  const waits = useContext(ModuleWaitsContext);
  const lookups = useContext(ModuleLookupsContext);
  return useMemo(
    () => ({
      moduleWaits: waits.entities,
      moduleLookups: lookups.entities,
      latestSeq: maxSeq(waits.latestSeq, lookups.latestSeq),
    }),
    [lookups, waits],
  );
}

export function maxSeq(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

/**
 * How this page receives watched state. "ws" is the default `/sync` socket;
 * "broadcast" (URL param `sync=broadcast`) reads the engine tab's
 * BroadcastChannel sync host on the same origin — stage 2 of
 * docs/livecode/history/browser-engine-plan-2026-08.md — and never opens the
 * socket. Writes and every other route stay HTTP against `serverBaseUrl`.
 */
export function SyncRuntimeProvider({ children }: PropsWithChildren) {
  const isLocalDevelopment = ["localhost", "127.0.0.1", "::1"].includes(
    window.location.hostname,
  );
  const initialServerUrl =
    new URLSearchParams(window.location.search).get("serverBaseUrl") ??
      (isLocalDevelopment ? "http://localhost:7777" : window.location.origin);

  const [serverBaseUrl, setServerBaseUrlState] = useState(initialServerUrl);
  const serverBaseUrlRef = useRef(initialServerUrl);
  const [connectionStatus, setConnectionStatus] = useState<
    SyncConnectionStatus
  >("connecting");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [latestSeq, setLatestSeq] = useState<number | null>(null);
  const [state, setState] = useState<SyncState>(emptySyncState);

  // The authoritative maps live in a ref and are mutated as messages land; React
  // state is a per-frame projection of them. Nothing downstream needs to see two
  // messages from the same frame separately.
  const pendingRef = useRef<SyncState>(emptySyncState());
  const dirtyTypesRef = useRef(new Set<SyncEntityTypeKey>());
  const rafRef = useRef<number | null>(null);
  const lastSeqRef = useRef<number | null>(null);
  const controllerRef = useRef<ReconnectingSocketController | null>(null);
  const listenersRef = useRef(new Set<SyncLifecycleListener>());
  const openRef = useRef(false);

  const flush = useCallback(() => {
    rafRef.current = null;
    const dirty = dirtyTypesRef.current;
    if (dirty.size === 0) return;
    const changed: Partial<SyncState> = {};
    for (const entityType of dirty) {
      changed[entityType] = pendingRef.current[entityType] as never;
    }
    dirty.clear();
    setState((current) => ({ ...current, ...changed }));
    setLatestSeq(lastSeqRef.current);
  }, []);

  const scheduleFlush = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = window.requestAnimationFrame(flush);
  }, [flush]);

  const subscribe = useCallback((port: SyncPort) => {
    if (!port.isOpen()) return;
    port.sendMessage({
      type: "subscribe",
      entityTypes: [...SYNC_ENTITY_TYPES],
    });
  }, []);

  const applyMessage = useCallback(
    (message: SyncMessage, port: SyncPort) => {
      const previousSeq = lastSeqRef.current;
      lastSeqRef.current = message.seq;

      const dirty = applySyncMessageToState(pendingRef.current, message);
      for (const entityType of dirty) {
        dirtyTypesRef.current.add(entityType);
      }

      scheduleFlush();

      // Gap detection last, so this message's own content still lands: the
      // resubscribe's resets replace it wholesale a moment later anyway.
      if (previousSeq !== null && message.seq !== previousSeq + 1) {
        subscribe(port);
      } else if (previousSeq === null && !message.resets) {
        // Joining a broadcast mid-stream: the first thing heard can be plain
        // changes (or another tab's reply), so ask for our own resets. A
        // fresh WebSocket never hits this — its first message answers our
        // subscribe and carries resets.
        subscribe(port);
      }
    },
    [scheduleFlush, subscribe],
  );

  const transportCallbacks = useMemo<SyncTransportCallbacks>(() => ({
    onOpen: (port) => {
      openRef.current = true;
      // A fresh transport is owed no state. Subscribe is both registration and
      // the full reset that hydrates this client.
      lastSeqRef.current = null;
      subscribe(port);
      setConnectionStatus("open");
      setConnectionError(null);
      for (const listener of [...listenersRef.current]) listener.onOpen?.();
    },
    onMessage: applyMessage,
    onClose: () => {
      openRef.current = false;
      setConnectionStatus((current) =>
        current === "error" ? current : "closed"
      );
      for (const listener of [...listenersRef.current]) listener.onClose?.();
    },
    onError: (message) => {
      openRef.current = false;
      setConnectionError(message);
      setConnectionStatus("error");
      for (const listener of [...listenersRef.current]) {
        listener.onError?.(message);
      }
    },
  }), [applyMessage, subscribe]);

  if (controllerRef.current === null) {
    controllerRef.current = configuredSyncTransport === "broadcast"
      ? createBroadcastSyncTransport(transportCallbacks)
      : createWebSocketSyncTransport(
        () => serverWebSocketUrl(serverBaseUrlRef.current, "/sync"),
        transportCallbacks,
      );
  }

  // Connects at MOUNT, not at Connect: piano-roll, params, and signals data has
  // always flowed without pressing Connect, and this socket carries them. What
  // Connect governs (LSP, health, rehydration, analysis) is armed separately in
  // livecodeRuntime.
  useEffect(() => {
    const controller = controllerRef.current;
    setConnectionStatus("connecting");
    controller?.connect();
    return () => {
      controller?.close();
      // A deliberate close does not run the socket's own `onclose` path (the
      // controller has already disowned it), so the open flag is cleared here
      // or `isOpen()` would keep reporting a socket that is gone.
      openRef.current = false;
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [serverBaseUrl]);

  const setServerBaseUrl = useCallback((next: string) => {
    const normalized = next.trim().replace(/\/+$/, "");
    if (serverBaseUrlRef.current === normalized) return;
    serverBaseUrlRef.current = normalized;
    // A different server is a different world: drop every map rather than let
    // the old server's entities linger until the new one's resets land.
    pendingRef.current = emptySyncState();
    dirtyTypesRef.current.clear();
    lastSeqRef.current = null;
    setState(emptySyncState());
    setLatestSeq(null);
    setServerBaseUrlState(normalized);
  }, []);

  const setRoll = useCallback(
    async (
      name: string,
      data: PianoRollData,
      options: { originId?: string; label?: string } = {},
    ) => {
      const body: SetPianoRollRequest = {
        name,
        data,
        originId: options.originId,
        label: options.label ?? "Edit piano roll",
        source: "client",
        undoable: true,
      };
      return await engineAction<PianoRollSetResult>(
        { kind: "pianoRollSet", request: body },
        serverBaseUrlRef.current,
        "/piano-roll/set",
        body,
      );
    },
    [],
  );

  const undoRoll = useCallback(async (name: string, originId?: string) => {
    await engineAction(
      { kind: "pianoRollHistory", action: "undo", request: { name, originId } },
      serverBaseUrlRef.current,
      "/piano-roll/undo",
      { name, originId },
    );
  }, []);

  const redoRoll = useCallback(async (name: string, originId?: string) => {
    await engineAction(
      { kind: "pianoRollHistory", action: "redo", request: { name, originId } },
      serverBaseUrlRef.current,
      "/piano-roll/redo",
      { name, originId },
    );
  }, []);

  // Panes send nested leaf patches and never an expectedRev: compare-and-set is
  // reserved for agent/HTTP callers.
  const setParams = useCallback(
    async (
      name: string,
      values: ParamsValues,
      options: { originId?: string } = {},
    ) => {
      const entity = await engineAction<ParamsEntity | null>(
        {
          kind: "paramsSet",
          request: { name, values, originId: options.originId },
        },
        serverBaseUrlRef.current,
        "/params/set",
        { name, values, originId: options.originId },
      );
      if (!entity) throw new Error(`No params entity "${name}"`);
      return entity;
    },
    [],
  );

  const setAnimationTimeline = useCallback(
    async (
      name: string,
      data: AnimationTimelineData,
      options: { originId?: string; expectedRev?: number } = {},
    ) => {
      const body: SetAnimationTimelineRequest = {
        name,
        data,
        originId: options.originId,
        expectedRev: options.expectedRev,
      };
      return await engineAction<AnimationTimelineSetResult>(
        { kind: "animationTimelineSet", request: body },
        serverBaseUrlRef.current,
        "/animation-timeline/set",
        body,
      );
    },
    [],
  );

  // A tiny window hook so tests and agents can read the live sync maps
  // without a server round trip — the only entity reader that exists in the
  // serverless baked topology.
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__livecodeSyncDebug = {
      getEntities: (entityType: SyncEntityTypeKey) => ({
        ...pendingRef.current[entityType]?.entities,
      }),
      latestSeq: () => lastSeqRef.current,
    };
    return () => {
      delete (window as unknown as Record<string, unknown>).__livecodeSyncDebug;
    };
  }, []);

  const lifecycleRef = useRef<SyncLifecycle | null>(null);
  if (lifecycleRef.current === null) {
    lifecycleRef.current = {
      isOpen: () => openRef.current,
      addListener: (listener) => {
        listenersRef.current.add(listener);
        return () => {
          listenersRef.current.delete(listener);
        };
      },
    };
  }

  const connection = useMemo<SyncConnection>(
    () => ({ connectionStatus, connectionError, latestSeq }),
    [connectionError, connectionStatus, latestSeq],
  );

  const actions = useMemo<SyncActions>(
    () => ({
      serverBaseUrl,
      setServerBaseUrl,
      setRoll,
      undoRoll,
      redoRoll,
      setParams,
      setAnimationTimeline,
    }),
    [
      redoRoll,
      serverBaseUrl,
      setAnimationTimeline,
      setParams,
      setRoll,
      setServerBaseUrl,
      undoRoll,
    ],
  );

  return (
    <SyncLifecycleContext.Provider value={lifecycleRef.current}>
      <SyncActionsContext.Provider value={actions}>
        <SyncConnectionContext.Provider value={connection}>
          <PianoRollsContext.Provider value={state.pianoRoll}>
            <ParamsContext.Provider value={state.params}>
              <AnimationTimelinesContext.Provider
                value={state.animationTimeline}
              >
                <SignalsContext.Provider value={state.signal}>
                  <RunsContext.Provider value={state.run}>
                    <ModuleWaitsContext.Provider value={state.moduleWaits}>
                      <ModuleLookupsContext.Provider
                        value={state.moduleLookups}
                      >
                        {children}
                      </ModuleLookupsContext.Provider>
                    </ModuleWaitsContext.Provider>
                  </RunsContext.Provider>
                </SignalsContext.Provider>
              </AnimationTimelinesContext.Provider>
            </ParamsContext.Provider>
          </PianoRollsContext.Provider>
        </SyncConnectionContext.Provider>
      </SyncActionsContext.Provider>
    </SyncLifecycleContext.Provider>
  );
}

function useRequiredContext<T>(
  context: Context<T | null>,
  hookName: string,
): T {
  const value = useContext(context);
  if (!value) {
    throw new Error(`${hookName} must be used inside SyncRuntimeProvider`);
  }
  return value;
}
