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
  PianoRollData,
  PianoRollObject,
  PianoRollSnapshot,
} from "./pianoRollTypes";

export type PianoRollConnectionStatus =
  | "closed"
  | "connecting"
  | "open"
  | "error";

export interface PianoRollRuntimeApi {
  connectionStatus: PianoRollConnectionStatus;
  rolls: Record<string, PianoRollObject>;
  latestSeq: number | null;
  connectionError: string | null;
  setRoll(
    name: string,
    data: PianoRollData,
    options?: { originId?: string; label?: string },
  ): Promise<PianoRollObject>;
  undoRoll(name: string, originId?: string): Promise<void>;
  redoRoll(name: string, originId?: string): Promise<void>;
}

const PianoRollRuntimeContext = createContext<PianoRollRuntimeApi | null>(null);

export function usePianoRollRuntime() {
  const runtime = useContext(PianoRollRuntimeContext);
  if (!runtime) {
    throw new Error(
      "usePianoRollRuntime must be used inside PianoRollRuntimeProvider",
    );
  }
  return runtime;
}

export function PianoRollRuntimeProvider({
  serverBaseUrl,
  children,
}: PropsWithChildren<{ serverBaseUrl: string }>) {
  const [connectionStatus, setConnectionStatus] = useState<
    PianoRollConnectionStatus
  >("closed");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [rolls, setRolls] = useState<Record<string, PianoRollObject>>({});
  const [latestSeq, setLatestSeq] = useState<number | null>(null);
  const serverBaseUrlRef = useRef(serverBaseUrl);
  const socketRef = useRef<WebSocket | null>(null);
  const pendingSnapshotRef = useRef<PianoRollSnapshot | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    serverBaseUrlRef.current = serverBaseUrl;
  }, [serverBaseUrl]);

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

  const flushPendingSnapshot = useCallback(() => {
    rafRef.current = null;
    const snapshot = pendingSnapshotRef.current;
    if (!snapshot) return;
    pendingSnapshotRef.current = null;
    setRolls(snapshot.rolls);
    setLatestSeq(snapshot.seq);
  }, []);

  useEffect(() => {
    let disposed = false;
    let reconnectTimer: number | null = null;
    let reconnectBackoffMs = 1_000;

    const clearReconnectTimer = () => {
      if (reconnectTimer === null) return;
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    };

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer !== null) return;
      const delayMs = reconnectBackoffMs;
      reconnectBackoffMs = Math.min(reconnectBackoffMs * 2, 10_000);
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connectSocket();
      }, delayMs);
    };

    const connectSocket = () => {
      if (disposed) return;
      setConnectionError(null);
      setConnectionStatus("connecting");
      const oldSocket = socketRef.current;
      socketRef.current = null;
      oldSocket?.close();

      const socketUrl = `${
        serverBaseUrl.replace(/^http/, "ws")
      }/piano-roll/snapshots`;
      const socket = new WebSocket(socketUrl);
      socketRef.current = socket;

      socket.onopen = () => {
        if (socketRef.current !== socket) return;
        reconnectBackoffMs = 1_000;
        setConnectionStatus("open");
      };
      socket.onerror = () => {
        if (socketRef.current !== socket) return;
        setConnectionError("piano roll websocket failed");
        setConnectionStatus("error");
      };
      socket.onclose = () => {
        if (socketRef.current !== socket) return;
        socketRef.current = null;
        setConnectionStatus((
          current,
        ) => (current === "error" ? current : "closed"));
        scheduleReconnect();
      };
      socket.onmessage = (event) => {
        if (socketRef.current !== socket) return;
        pendingSnapshotRef.current = JSON.parse(
          event.data as string,
        ) as PianoRollSnapshot;
        if (rafRef.current === null) {
          rafRef.current = window.requestAnimationFrame(flushPendingSnapshot);
        }
      };
    };

    connectSocket();

    return () => {
      disposed = true;
      clearReconnectTimer();
      socketRef.current?.close();
      socketRef.current = null;
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [flushPendingSnapshot, serverBaseUrl]);

  const setRoll = useCallback(
    async (
      name: string,
      data: PianoRollData,
      options: { originId?: string; label?: string } = {},
    ) => {
      return await postJson<PianoRollObject>("/piano-roll/set", {
        name,
        data,
        originId: options.originId,
        label: options.label ?? "Edit piano roll",
        source: "client",
        undoable: true,
      });
    },
    [postJson],
  );

  const undoRoll = useCallback(
    async (name: string, originId?: string) => {
      await postJson("/piano-roll/undo", { name, originId });
    },
    [postJson],
  );

  const redoRoll = useCallback(
    async (name: string, originId?: string) => {
      await postJson("/piano-roll/redo", { name, originId });
    },
    [postJson],
  );

  const value = useMemo(
    () => ({
      connectionStatus,
      rolls,
      latestSeq,
      connectionError,
      setRoll,
      undoRoll,
      redoRoll,
    }),
    [
      connectionError,
      connectionStatus,
      latestSeq,
      redoRoll,
      rolls,
      setRoll,
      undoRoll,
    ],
  );

  return (
    <PianoRollRuntimeContext.Provider value={value}>
      {children}
    </PianoRollRuntimeContext.Provider>
  );
}
