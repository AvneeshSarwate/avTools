// The server's seam over "where does execution happen": one op surface
// (`EngineOp`, executed by `executeEngineOp` in `@avtools/livecode-engine`)
// behind two planes. The LOCAL plane owns an engine in this process — today's
// behavior. The REMOTE plane forwards every op over the `/engine/uplink`
// WebSocket to a browser-tab engine host and relays its sync feed back to the
// server's `/sync` fan-out. Reads forward too, so every answer is
// point-in-time engine truth; a decimated server-side mirror is a recorded
// future optimization for high-latency links, not part of this contract.

import type {
  EngineOp,
  EngineUplinkClientMessage,
  EngineUplinkRequest,
  SyncEntity,
  SyncEntityChange,
} from "./protocol.ts";
import type { SyncCollectedChanges } from "@avtools/livecode-engine/sync_sources.ts";
import {
  createLivecodeEngine,
  executeEngineOp,
} from "@avtools/livecode-engine";
import { SYNC_ENTITY_TYPES } from "@avtools/livecode-protocol";

export type ExecutionPlaneKind = "local" | "remote";

export interface ExecutionPlane {
  readonly kind: ExecutionPlaneKind;
  execute(op: EngineOp): Promise<unknown>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Local

export interface LocalExecutionPlaneOptions {
  log: (entry: Record<string, unknown>) => void | Promise<void>;
  panicMidi: () => void;
  onSyncTick: (collected: SyncCollectedChanges) => void;
}

export interface LocalExecutionPlane extends ExecutionPlane {
  readonly kind: "local";
}

export function createLocalExecutionPlane(
  options: LocalExecutionPlaneOptions,
): LocalExecutionPlane {
  const engine = createLivecodeEngine({
    log: options.log,
    panicMidi: options.panicMidi,
    onSyncTick: options.onSyncTick,
  });
  return {
    kind: "local",
    execute: (op) => executeEngineOp(engine, op),
    close: () => engine.close(),
  };
}

// ---------------------------------------------------------------------------
// Remote

export interface RemoteExecutionPlaneOptions {
  log: (entry: Record<string, unknown>) => void | Promise<void>;
  /** Relay of one engine tick's changed entities to the `/sync` fan-out. */
  onSyncChanges: (changes: SyncEntityChange[]) => void;
  /**
   * Relay of full per-type state: sent when an engine attaches (its hello
   * resets) and, as empty lists, when it detaches — an absent engine means the
   * watched world is gone, and clients must not keep rendering a dead one.
   */
  onEngineResets: (resets: Record<string, SyncEntity[]>) => void;
  /**
   * Initialize an arriving engine from its hello resets. The supplied executor
   * is pinned to that engine socket; it can be used before the plane becomes
   * ready without accidentally targeting a replacement engine. Ordinary
   * `execute()` calls wait for this hook to settle.
   */
  initializeEngine?: (
    resets: Record<string, SyncEntity[]>,
    execute: (op: EngineOp) => Promise<unknown>,
  ) => void | Promise<void>;
  requestTimeoutMs?: number;
}

export interface RemoteExecutionPlane extends ExecutionPlane {
  readonly kind: "remote";
  /** Adopt a freshly upgraded `/engine/uplink` socket; replaces any previous. */
  attachEngineSocket(socket: WebSocket): void;
  hasEngine(): boolean;
  /** From the attached engine's hello; null while no engine is attached. */
  engineKind(): "deno" | "browser" | null;
}

interface PendingEngineRequest {
  resolve: (body: unknown) => void;
  reject: (error: Error) => void;
  timer: number;
}

interface EngineReadySignal {
  promise: Promise<WebSocket>;
  resolve: (socket: WebSocket) => void;
  reject: (error: Error) => void;
}

type RemoteEngineState =
  | { phase: "detached" }
  | {
    phase: "awaitingHello";
    socket: WebSocket;
    ready: EngineReadySignal;
  }
  | {
    phase: "initializing";
    socket: WebSocket;
    engineKind: "deno" | "browser";
    ready: EngineReadySignal;
  }
  | {
    phase: "ready";
    socket: WebSocket;
    engineKind: "deno" | "browser";
  }
  | { phase: "closed" };

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export function createRemoteExecutionPlane(
  options: RemoteExecutionPlaneOptions,
): RemoteExecutionPlane {
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const pending = new Map<string, PendingEngineRequest>();
  let state: RemoteEngineState = { phase: "detached" };

  function createReadySignal(): EngineReadySignal {
    let resolve!: (socket: WebSocket) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<WebSocket>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    // A socket can disappear before an ordinary operation waits on readiness.
    // Keep that expected transition from becoming an unhandled rejection.
    void promise.catch(() => {});
    return { promise, resolve, reject };
  }

  function stateSocket(candidate = state): WebSocket | null {
    return candidate.phase === "awaitingHello" ||
        candidate.phase === "initializing" || candidate.phase === "ready"
      ? candidate.socket
      : null;
  }

  function failAllPending(reason: string): void {
    for (const [requestId, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
      pending.delete(requestId);
    }
  }

  function emptyResets(): Record<string, SyncEntity[]> {
    return Object.fromEntries(SYNC_ENTITY_TYPES.map((entityType) => [
      entityType,
      [] as SyncEntity[],
    ]));
  }

  function detach(socket: WebSocket, reason: string): void {
    if (stateSocket() !== socket) return;
    const previous = state;
    state = previous.phase === "closed" ? previous : { phase: "detached" };
    if (
      previous.phase === "awaitingHello" || previous.phase === "initializing"
    ) {
      previous.ready.reject(new Error(`engine detached (${reason})`));
    }
    failAllPending(`engine detached (${reason})`);
    void options.log({ type: "engineDetached", reason });
    if (state.phase !== "closed") options.onEngineResets(emptyResets());
  }

  function executeOnSocket(
    socket: WebSocket,
    op: EngineOp,
    operationTimeoutMs = timeoutMs,
  ): Promise<unknown> {
    if (stateSocket() !== socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(
        new Error("engine replaced before operation started"),
      );
    }
    const requestId = crypto.randomUUID();
    const request: EngineUplinkRequest = {
      type: "engineRequest",
      requestId,
      op,
    };
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(
          new Error(
            `engine op ${op.kind} timed out after ${operationTimeoutMs}ms`,
          ),
        );
      }, operationTimeoutMs) as unknown as number;
      pending.set(requestId, { resolve, reject, timer });
      try {
        socket.send(JSON.stringify(request));
      } catch (error) {
        pending.delete(requestId);
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async function executeWhenReady(
    ready: EngineReadySignal,
    op: EngineOp,
  ): Promise<unknown> {
    const deadline = Date.now() + timeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const socket = await Promise.race([
        ready.promise,
        new Promise<WebSocket>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  `engine did not become ready within ${timeoutMs}ms`,
                ),
              ),
            timeoutMs,
          );
        }),
      ]);
      return await executeOnSocket(
        socket,
        op,
        Math.max(1, deadline - Date.now()),
      );
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  async function finishInitialization(
    initializing: Extract<RemoteEngineState, { phase: "initializing" }>,
    resets: Record<string, SyncEntity[]>,
  ): Promise<void> {
    try {
      await options.initializeEngine?.(
        resets,
        (op) => executeOnSocket(initializing.socket, op),
      );
    } catch (error) {
      if (state !== initializing) return;
      void options.log({
        type: "engineInitializationFailed",
        engineKind: initializing.engineKind,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    if (state !== initializing) return;
    state = {
      phase: "ready",
      socket: initializing.socket,
      engineKind: initializing.engineKind,
    };
    initializing.ready.resolve(initializing.socket);
    void options.log({
      type: "engineAttached",
      engineKind: initializing.engineKind,
    });
  }

  function handleMessage(socket: WebSocket, payload: string): void {
    let message: EngineUplinkClientMessage;
    try {
      message = JSON.parse(payload) as EngineUplinkClientMessage;
    } catch (error) {
      void options.log({
        type: "engineUplinkMalformedMessage",
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    if (socket !== stateSocket()) return;

    if (message.type === "engineHello") {
      if (state.phase !== "awaitingHello" || state.socket !== socket) return;
      const resets = message.resets ?? {};
      const initializing: Extract<
        RemoteEngineState,
        { phase: "initializing" }
      > = {
        phase: "initializing",
        socket,
        engineKind: message.engineKind === "deno" ? "deno" : "browser",
        ready: state.ready,
      };
      state = initializing;
      options.onEngineResets(resets);
      void finishInitialization(initializing, resets);
      return;
    }
    if (message.type === "engineLog") {
      void options.log(message.entry ?? {});
      return;
    }
    if (message.type === "engineSync") {
      if (Array.isArray(message.changes) && message.changes.length > 0) {
        options.onSyncChanges(message.changes);
      }
      return;
    }
    if (message.type === "engineResult") {
      const entry = pending.get(message.requestId);
      if (!entry) return;
      pending.delete(message.requestId);
      clearTimeout(entry.timer);
      if (message.ok) entry.resolve(message.body);
      else entry.reject(new Error(message.error ?? "engine op failed"));
    }
  }

  return {
    kind: "remote",
    hasEngine: () => state.phase === "ready",
    engineKind: () => state.phase === "ready" ? state.engineKind : null,
    attachEngineSocket: (socket) => {
      if (state.phase === "closed") {
        socket.close();
        return;
      }
      const previous = state;
      const previousSocket = stateSocket(previous);
      if (
        previous.phase === "awaitingHello" || previous.phase === "initializing"
      ) {
        previous.ready.reject(new Error("engine replaced"));
      }
      state = {
        phase: "awaitingHello",
        socket,
        ready: createReadySignal(),
      };
      if (previousSocket?.readyState === WebSocket.OPEN) {
        // Same replacement rule as /client/control: the newest engine wins.
        previousSocket.close();
      }
      failAllPending("engine replaced");
      socket.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        handleMessage(socket, event.data);
      };
      socket.onclose = () => detach(socket, "closed");
      socket.onerror = () => detach(socket, "error");
    },
    execute: (op) => {
      if (state.phase === "ready") {
        return executeOnSocket(state.socket, op);
      }
      if (state.phase === "awaitingHello" || state.phase === "initializing") {
        return executeWhenReady(state.ready, op);
      }
      return Promise.reject(
        new Error("No engine attached: open the /engine/ page first"),
      );
    },
    close: () => {
      const previous = state;
      state = { phase: "closed" };
      if (
        previous.phase === "awaitingHello" || previous.phase === "initializing"
      ) {
        previous.ready.reject(new Error("server closing"));
      }
      failAllPending("server closing");
      stateSocket(previous)?.close();
      return Promise.resolve();
    },
  };
}
