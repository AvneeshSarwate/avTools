import type {
  SyncMessage,
  SyncSubscribeMessage,
} from "@avtools/livecode-protocol";
import {
  createReconnectingSocket,
  type ReconnectingSocketController,
} from "./reconnectingSocket";
import { readBootParam } from "./bootParams";
import { IN_PROCESS_ENGINE, inProcessEngineHost } from "./inProcessEngine";

const SYNC_BROADCAST_CHANNEL = "livecode-sync";

/**
 * "ws" is the default `/sync` socket; "broadcast" (`sync=broadcast`) reads a
 * same-origin engine tab's BroadcastChannel; "inprocess" (`engine=inprocess`)
 * reads this tab's own engine through a same-realm observer, with no
 * serialization at all.
 */
export const configuredSyncTransport: "ws" | "broadcast" | "inprocess" =
  IN_PROCESS_ENGINE
    ? "inprocess"
    : readBootParam("sync") === "broadcast"
    ? "broadcast"
    : "ws";

export interface SyncPort {
  isOpen(): boolean;
  sendMessage(message: SyncSubscribeMessage): void;
}

export interface SyncTransportCallbacks {
  onOpen(port: SyncPort): void;
  onMessage(message: SyncMessage, port: SyncPort): void;
  onClose(): void;
  onError(message: string): void;
}

export function createBroadcastSyncTransport(
  callbacks: SyncTransportCallbacks,
): ReconnectingSocketController {
  let channel: BroadcastChannel | null = null;
  return {
    socket: null,
    connect: () => {
      if (channel) return;
      const active = new BroadcastChannel(SYNC_BROADCAST_CHANNEL);
      channel = active;
      const port: SyncPort = {
        isOpen: () => channel === active,
        sendMessage: (message) => active.postMessage(message),
      };
      active.onmessage = (event) => {
        const message = event.data as SyncMessage | undefined;
        if (message?.type !== "sync") return;
        callbacks.onMessage(message, port);
      };
      callbacks.onOpen(port);
    },
    close: () => {
      channel?.close();
      channel = null;
    },
  };
}

export function createWebSocketSyncTransport(
  makeUrl: () => string,
  callbacks: SyncTransportCallbacks,
): ReconnectingSocketController {
  return createReconnectingSocket({
    makeUrl,
    onOpen: (socket) => callbacks.onOpen(webSocketPort(socket)),
    onMessage: (event, socket) => {
      let message: SyncMessage;
      try {
        message = JSON.parse(event.data as string) as SyncMessage;
      } catch (error) {
        console.error("[livecode-tldraw] malformed sync message", error);
        return;
      }
      if (message.type !== "sync") return;
      callbacks.onMessage(message, webSocketPort(socket));
    },
    onClose: callbacks.onClose,
    onError: () => callbacks.onError("sync websocket failed"),
  });
}

function webSocketPort(socket: WebSocket): SyncPort {
  return {
    isOpen: () => socket.readyState === WebSocket.OPEN,
    sendMessage: (message) => socket.send(JSON.stringify(message)),
  };
}

/**
 * Same-realm sync against this tab's engine. Entity changes flow from the
 * moment the engine runs — they are local truth and need no server — while
 * the open/close edges the runtime hangs its connect sequence on follow the
 * server link when there is one (`requireUplink`), so "open" keeps meaning
 * "the coordination server can reach this engine", as it does for the socket.
 * A serverless bake has no such link and opens as soon as the engine runs.
 */
export function createInProcessSyncTransport(
  callbacks: SyncTransportCallbacks,
  options: { requireUplink: boolean },
): ReconnectingSocketController {
  let session: { closed: boolean; teardown: Array<() => void> } | null = null;
  return {
    socket: null,
    connect: () => {
      if (session) return;
      const active = { closed: false, teardown: [] as Array<() => void> };
      session = active;
      void (async () => {
        let host;
        try {
          host = await inProcessEngineHost();
        } catch (error) {
          if (!active.closed) {
            callbacks.onError(
              error instanceof Error ? error.message : String(error),
            );
          }
          return;
        }
        if (active.closed) return;
        let seq = 0;
        let open = false;
        const engineRunning = () => host.status().lock === "engine";
        const port: SyncPort = {
          isOpen: () => !active.closed && engineRunning(),
          sendMessage: (message) => {
            if (message.type !== "subscribe" || active.closed) return;
            // Answered asynchronously, like a socket reply, so a subscribe
            // issued from inside onOpen never re-enters the provider.
            const resets = host.snapshot(message.entityTypes);
            queueMicrotask(() => {
              if (active.closed) return;
              deliver({ resets });
            });
          },
        };
        const deliver = (body: Pick<SyncMessage, "resets" | "changes">) => {
          callbacks.onMessage(
            { type: "sync", seq: ++seq, timestampMs: Date.now(), ...body },
            port,
          );
        };
        active.teardown.push(
          host.observe({ onChanges: (changes) => deliver({ changes }) }),
        );
        const evaluate = (status: { lock: string; uplinkOpen: boolean }) => {
          const shouldBeOpen = status.lock === "engine" &&
            (!options.requireUplink || status.uplinkOpen);
          if (shouldBeOpen && !open) {
            open = true;
            callbacks.onOpen(port);
          } else if (!shouldBeOpen && open) {
            open = false;
            callbacks.onClose();
          }
        };
        active.teardown.push(host.subscribeStatus(evaluate));
        evaluate(host.status());
      })();
    },
    close: () => {
      if (!session) return;
      session.closed = true;
      for (const dispose of session.teardown) dispose();
      session = null;
    },
  };
}
