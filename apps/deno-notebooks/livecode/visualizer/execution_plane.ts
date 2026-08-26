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
   * Attach-only hook (never fired on detach), with the hello resets: what the
   * arriving engine already holds. The server uses it to replay the current
   * project's saved entity data into a fresh engine world.
   */
  onEngineAttached?: (resets: Record<string, SyncEntity[]>) => void;
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

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export function createRemoteExecutionPlane(
  options: RemoteExecutionPlaneOptions,
): RemoteExecutionPlane {
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const pending = new Map<string, PendingEngineRequest>();
  let currentSocket: WebSocket | null = null;
  let attachedEngineKind: "deno" | "browser" | null = null;
  let closing = false;

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
    if (currentSocket !== socket) return;
    currentSocket = null;
    attachedEngineKind = null;
    failAllPending(`engine detached (${reason})`);
    void options.log({ type: "engineDetached", reason });
    if (!closing) options.onEngineResets(emptyResets());
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
    if (socket !== currentSocket) return;

    if (message.type === "engineHello") {
      attachedEngineKind = message.engineKind === "deno" ? "deno" : "browser";
      void options.log({
        type: "engineAttached",
        engineKind: message.engineKind,
      });
      options.onEngineResets(message.resets ?? {});
      options.onEngineAttached?.(message.resets ?? {});
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
    hasEngine: () => currentSocket !== null,
    engineKind: () => attachedEngineKind,
    attachEngineSocket: (socket) => {
      const previous = currentSocket;
      currentSocket = socket;
      if (previous && previous.readyState === WebSocket.OPEN) {
        // Same replacement rule as /client/control: the newest engine wins.
        previous.close();
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
      const socket = currentSocket;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return Promise.reject(
          new Error("No engine attached: open the /engine/ page first"),
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
            new Error(`engine op ${op.kind} timed out after ${timeoutMs}ms`),
          );
        }, timeoutMs) as unknown as number;
        pending.set(requestId, { resolve, reject, timer });
        try {
          socket.send(JSON.stringify(request));
        } catch (error) {
          pending.delete(requestId);
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
    close: () => {
      closing = true;
      failAllPending("server closing");
      currentSocket?.close();
      currentSocket = null;
      attachedEngineKind = null;
      return Promise.resolve();
    },
  };
}
