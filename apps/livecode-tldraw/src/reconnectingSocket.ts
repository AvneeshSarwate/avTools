export interface ReconnectingSocketOptions {
  makeUrl: () => string;
  onOpen?: (socket: WebSocket) => void;
  onMessage?: (event: MessageEvent, socket: WebSocket) => void;
  onClose?: () => void; // fires for the CURRENT socket only
  onError?: () => void; // fires for the CURRENT socket only
  initialBackoffMs?: number; // default 1000
  maxBackoffMs?: number; // default 10000
  backoffFactor?: number; // default 2
}

export interface ReconnectingSocketController {
  connect(): void; // opens now; enables auto-reconnect
  close(): void; // closes; disables auto-reconnect; clears timer
  readonly socket: WebSocket | null; // current socket or null
}

export function createReconnectingSocket(
  options: ReconnectingSocketOptions,
): ReconnectingSocketController {
  const initialBackoffMs = options.initialBackoffMs ?? 1_000;
  const maxBackoffMs = options.maxBackoffMs ?? 10_000;
  const backoffFactor = options.backoffFactor ?? 2;

  let enabled = false;
  let currentSocket: WebSocket | null = null;
  let reconnectTimer: number | null = null;
  let backoffMs = initialBackoffMs;

  const clearReconnectTimer = () => {
    if (reconnectTimer === null) return;
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };

  const scheduleReconnect = () => {
    if (!enabled || reconnectTimer !== null) return;
    const delayMs = backoffMs;
    backoffMs = Math.min(backoffMs * backoffFactor, maxBackoffMs);
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      open();
    }, delayMs);
  };

  const open = () => {
    if (!enabled) return;
    clearReconnectTimer();
    const previous = currentSocket;
    currentSocket = null;
    previous?.close();

    const socket = new WebSocket(options.makeUrl());
    currentSocket = socket;

    socket.onopen = () => {
      if (currentSocket !== socket) return;
      backoffMs = initialBackoffMs;
      options.onOpen?.(socket);
    };

    socket.onmessage = (event) => {
      if (currentSocket !== socket) return;
      options.onMessage?.(event, socket);
    };

    socket.onerror = () => {
      if (currentSocket !== socket) return;
      options.onError?.();
      scheduleReconnect();
    };

    socket.onclose = () => {
      if (currentSocket !== socket) return;
      currentSocket = null;
      options.onClose?.();
      scheduleReconnect();
    };
  };

  return {
    connect() {
      enabled = true;
      open();
    },
    close() {
      enabled = false;
      clearReconnectTimer();
      const socket = currentSocket;
      currentSocket = null;
      socket?.close();
    },
    get socket() {
      return currentSocket;
    },
  };
}
