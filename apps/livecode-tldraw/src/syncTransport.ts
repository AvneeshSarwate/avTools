import type {
  SyncMessage,
  SyncSubscribeMessage,
} from "@avtools/livecode-protocol";
import {
  createReconnectingSocket,
  type ReconnectingSocketController,
} from "./reconnectingSocket";

const SYNC_BROADCAST_CHANNEL = "livecode-sync";

export const configuredSyncTransport: "ws" | "broadcast" =
  new URLSearchParams(window.location.search).get("sync") === "broadcast"
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
