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
import type { SignalEntity, SignalsSnapshot } from "./signalsTypes";
import { createReconnectingSocket } from "./reconnectingSocket";
import { serverWebSocketUrl } from "./serverRequests";

export type SignalsConnectionStatus = "closed" | "connecting" | "open" | "error";

/**
 * Read-only by construction: signals are published by running code and there is
 * no set route, so this provider is a subscription and nothing else.
 */
export interface SignalsRuntimeApi {
  connectionStatus: SignalsConnectionStatus;
  signals: Record<string, SignalEntity>;
  latestSeq: number | null;
  connectionError: string | null;
}

const SignalsRuntimeContext = createContext<SignalsRuntimeApi | null>(null);

export function useSignalsRuntime() {
  const runtime = useContext(SignalsRuntimeContext);
  if (!runtime) {
    throw new Error(
      "useSignalsRuntime must be used inside SignalsRuntimeProvider",
    );
  }
  return runtime;
}

export function SignalsRuntimeProvider({
  serverBaseUrl,
  children,
}: PropsWithChildren<{ serverBaseUrl: string }>) {
  const [connectionStatus, setConnectionStatus] = useState<
    SignalsConnectionStatus
  >("closed");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [signals, setSignalsState] = useState<Record<string, SignalEntity>>({});
  const [latestSeq, setLatestSeq] = useState<number | null>(null);
  const pendingSnapshotRef = useRef<SignalsSnapshot | null>(null);
  const rafRef = useRef<number | null>(null);

  const flushPendingSnapshot = useCallback(() => {
    rafRef.current = null;
    const snapshot = pendingSnapshotRef.current;
    if (!snapshot) return;
    pendingSnapshotRef.current = null;
    setSignalsState(snapshot.signals);
    setLatestSeq(snapshot.seq);
  }, []);

  useEffect(() => {
    const controller = createReconnectingSocket({
      makeUrl: () => serverWebSocketUrl(serverBaseUrl, "/signals/snapshots"),
      onOpen: () => {
        setConnectionStatus("open");
      },
      onError: () => {
        setConnectionError("signals websocket failed");
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
        ) as SignalsSnapshot;
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

  const value = useMemo(
    () => ({ connectionStatus, signals, latestSeq, connectionError }),
    [connectionError, connectionStatus, latestSeq, signals],
  );

  return (
    <SignalsRuntimeContext.Provider value={value}>
      {children}
    </SignalsRuntimeContext.Provider>
  );
}
