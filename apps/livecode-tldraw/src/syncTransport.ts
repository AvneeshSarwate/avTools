import {
  type BrowserEngineHostStatus,
  SYNC_ENTITY_TYPES,
  type SyncActionResultMessage,
  type SyncClientMessage,
  type SyncMessage,
  type SyncServerMessage,
} from "@avtools/livecode-protocol";
import {
  createReconnectingSocket,
  type ReconnectingSocketController,
} from "./reconnectingSocket";
import { readBootParam } from "./bootParams";
import { IN_PROCESS_ENGINE, inProcessEngineHost } from "./inProcessEngine";

const SYNC_BROADCAST_CHANNEL = "livecode-sync";
const ACTIONS_BROADCAST_CHANNEL = "livecode-actions";

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

/**
 * One sync transport, open: subscribe/sync in one direction, `action`
 * messages answered by `onActionResult` in the other. Every transport
 * carries the action lane — the server's socket, the engine tab's
 * BroadcastChannel, or this tab's own engine — so an entity write takes the
 * same path as the sync it will be observed through, ordered with it.
 */
export interface SyncPort {
  isOpen(): boolean;
  sendMessage(message: SyncClientMessage): void;
}

export interface SyncTransportCallbacks {
  onOpen(port: SyncPort): void;
  onMessage(message: SyncMessage, port: SyncPort): void;
  onActionResult?(message: SyncActionResultMessage): void;
  onClose(): void;
  onError(message: string): void;
}

export function createBroadcastSyncTransport(
  callbacks: SyncTransportCallbacks,
): ReconnectingSocketController {
  let channels: { sync: BroadcastChannel; actions: BroadcastChannel } | null =
    null;
  return {
    socket: null,
    connect: () => {
      if (channels) return;
      const active = {
        sync: new BroadcastChannel(SYNC_BROADCAST_CHANNEL),
        actions: new BroadcastChannel(ACTIONS_BROADCAST_CHANNEL),
      };
      channels = active;
      const port: SyncPort = {
        isOpen: () => channels === active,
        sendMessage: (message) => {
          if (message.type === "action") {
            // The engine tab answers `engineRequest` on its actions channel
            // with the same result envelope its server uplink uses.
            active.actions.postMessage({
              type: "engineRequest",
              requestId: message.requestId,
              op: message.op,
            });
            return;
          }
          active.sync.postMessage(message);
        },
      };
      active.sync.onmessage = (event) => {
        const message = event.data as SyncMessage | undefined;
        if (message?.type !== "sync") return;
        callbacks.onMessage(message, port);
      };
      active.actions.onmessage = (event) => {
        const message = event.data as
          | {
            type?: string;
            requestId?: string;
            ok?: boolean;
            body?: unknown;
            error?: string;
          }
          | undefined;
        if (message?.type !== "engineResult" || !message.requestId) return;
        callbacks.onActionResult?.(
          message.ok
            ? { type: "actionResult", requestId: message.requestId, ok: true, body: message.body }
            : {
              type: "actionResult",
              requestId: message.requestId,
              ok: false,
              error: message.error ?? "engine action failed",
            },
        );
      };
      callbacks.onOpen(port);
    },
    close: () => {
      channels?.sync.close();
      channels?.actions.close();
      channels = null;
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
      let message: SyncServerMessage;
      try {
        message = JSON.parse(event.data as string) as SyncServerMessage;
      } catch (error) {
        console.error("[livecode-tldraw] malformed sync message", error);
        return;
      }
      if (message.type === "actionResult") {
        callbacks.onActionResult?.(message);
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
        let running = false;
        let entityTypes = new Set<string>(SYNC_ENTITY_TYPES);
        const engineRunning = () => host.status().lock === "engine";
        const port: SyncPort = {
          isOpen: () => !active.closed && engineRunning(),
          sendMessage: (message) => {
            if (active.closed) return;
            if (message.type === "action") {
              // A direct call into this tab's engine, answered on the same
              // lane as the socket's replies.
              const { requestId } = message;
              host.execute(message.op).then(
                (body) =>
                  callbacks.onActionResult?.({ type: "actionResult", requestId, ok: true, body }),
                (error) =>
                  callbacks.onActionResult?.({
                    type: "actionResult",
                    requestId,
                    ok: false,
                    error: error instanceof Error ? error.message : String(error),
                  }),
              );
              return;
            }
            if (message.type !== "subscribe") return;
            entityTypes = new Set(message.entityTypes);
            // Answered asynchronously, like a socket reply, so a subscribe
            // issued from inside onOpen never re-enters the provider.
            queueMicrotask(() => {
              if (active.closed) return;
              deliver({ resets: host.snapshot([...entityTypes]) });
            });
          },
        };
        const deliver = (body: Pick<SyncMessage, "resets" | "changes">) => {
          if (active.closed) return;
          callbacks.onMessage(
            { type: "sync", seq: ++seq, timestampMs: Date.now(), ...body },
            port,
          );
        };
        active.teardown.push(
          host.observe({
            onChanges: (changes) => {
              const subscribed = changes.filter((change) =>
                entityTypes.has(change.entityType)
              );
              if (subscribed.length > 0) deliver({ changes: subscribed });
            },
          }),
        );
        const evaluate = (status: BrowserEngineHostStatus) => {
          const shouldBeOpen = status.lock === "engine" &&
            (!options.requireUplink || status.uplinkOpen);
          const wasRunning = running;
          running = status.lock === "engine";
          // Engine loss destroys this world; uplink loss leaves it alive.
          // Hydrate even before a server attaches, and clear it on takeover.
          if (running !== wasRunning && !shouldBeOpen) {
            port.sendMessage({
              type: "subscribe",
              entityTypes: [...entityTypes],
            });
          }
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
