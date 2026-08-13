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
import { createReconnectingSocket } from "./reconnectingSocket";
import { postServerJson, serverWebSocketUrl } from "./serverRequests";

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
  const pendingSnapshotRef = useRef<PianoRollSnapshot | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    serverBaseUrlRef.current = serverBaseUrl;
  }, [serverBaseUrl]);

  const postJson = useCallback(
    <T,>(path: string, body: unknown): Promise<T> =>
      postServerJson<T>(serverBaseUrlRef.current, path, body),
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
    const controller = createReconnectingSocket({
      makeUrl: () => serverWebSocketUrl(serverBaseUrl, "/piano-roll/snapshots"),
      onOpen: () => {
        setConnectionStatus("open");
      },
      onError: () => {
        setConnectionError("piano roll websocket failed");
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
        ) as PianoRollSnapshot;
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
