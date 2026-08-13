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
import type {
  ParamsEntity,
  ParamsSnapshot,
  ParamsValues,
} from "@avtools/livecode-protocol";
import { createReconnectingSocket } from "./reconnectingSocket";
import { postServerJson, serverWebSocketUrl } from "./serverRequests";

export type ParamsConnectionStatus = "closed" | "connecting" | "open" | "error";

export interface ParamsRuntimeApi {
  connectionStatus: ParamsConnectionStatus;
  params: Record<string, ParamsEntity>;
  latestSeq: number | null;
  connectionError: string | null;
  setParams(
    name: string,
    values: ParamsValues,
    options?: { originId?: string },
  ): Promise<ParamsEntity>;
}

const ParamsRuntimeContext = createContext<ParamsRuntimeApi | null>(null);

export function useParamsRuntime() {
  const runtime = useContext(ParamsRuntimeContext);
  if (!runtime) {
    throw new Error("useParamsRuntime must be used inside ParamsRuntimeProvider");
  }
  return runtime;
}

export function ParamsRuntimeProvider({
  serverBaseUrl,
  children,
}: PropsWithChildren<{ serverBaseUrl: string }>) {
  const [connectionStatus, setConnectionStatus] = useState<
    ParamsConnectionStatus
  >("closed");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [params, setParamsState] = useState<Record<string, ParamsEntity>>({});
  const [latestSeq, setLatestSeq] = useState<number | null>(null);
  const serverBaseUrlRef = useRef(serverBaseUrl);
  const pendingSnapshotRef = useRef<ParamsSnapshot | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    serverBaseUrlRef.current = serverBaseUrl;
  }, [serverBaseUrl]);

  const flushPendingSnapshot = useCallback(() => {
    rafRef.current = null;
    const snapshot = pendingSnapshotRef.current;
    if (!snapshot) return;
    pendingSnapshotRef.current = null;
    setParamsState(snapshot.params);
    setLatestSeq(snapshot.seq);
  }, []);

  useEffect(() => {
    const controller = createReconnectingSocket({
      makeUrl: () => serverWebSocketUrl(serverBaseUrl, "/params/snapshots"),
      onOpen: () => {
        setConnectionStatus("open");
      },
      onError: () => {
        setConnectionError("params websocket failed");
        setConnectionStatus("error");
      },
      onClose: () => {
        setConnectionStatus((current) =>
          current === "error" ? current : "closed"
        );
      },
      onMessage: (event) => {
        pendingSnapshotRef.current = JSON.parse(
          event.data as string,
        ) as ParamsSnapshot;
        if (rafRef.current === null) {
          rafRef.current = window.requestAnimationFrame(flushPendingSnapshot);
        }
      },
    });

    setConnectionError(null);
    setConnectionStatus("connecting");
    controller.connect();

    return () => {
      controller.close();
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [flushPendingSnapshot, serverBaseUrl]);

  // Panes send nested leaf patches and never an expectedRev: compare-and-set is
  // reserved for agent/HTTP callers.
  const setParams = useCallback(
    async (
      name: string,
      values: ParamsValues,
      options: { originId?: string } = {},
    ) => {
      return await postServerJson<ParamsEntity>(
        serverBaseUrlRef.current,
        "/params/set",
        { name, values, originId: options.originId },
      );
    },
    [],
  );

  const value = useMemo(
    () => ({
      connectionStatus,
      params,
      latestSeq,
      connectionError,
      setParams,
    }),
    [connectionError, connectionStatus, latestSeq, params, setParams],
  );

  return (
    <ParamsRuntimeContext.Provider value={value}>
      {children}
    </ParamsRuntimeContext.Provider>
  );
}
