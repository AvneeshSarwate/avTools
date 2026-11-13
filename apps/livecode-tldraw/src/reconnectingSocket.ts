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

  type SocketState =
    | { phase: "idle" }
    | { phase: "connecting"; socket: WebSocket }
    | { phase: "open"; socket: WebSocket }
    | { phase: "waiting"; timer: number };

  let state: SocketState = { phase: "idle" };
  let backoffMs = initialBackoffMs;

  const scheduleReconnect = () => {
    if (state.phase === "idle" || state.phase === "waiting") return;
    const delayMs = backoffMs;
    backoffMs = Math.min(backoffMs * backoffFactor, maxBackoffMs);
    const timer = window.setTimeout(() => {
      if (state.phase !== "waiting" || state.timer !== timer) return;
      state = { phase: "idle" };
      open();
    }, delayMs);
    state = { phase: "waiting", timer };
  };

  const open = () => {
    const socket = new WebSocket(options.makeUrl());
    state = { phase: "connecting", socket };

    socket.onopen = () => {
      if (stateSocket(state) !== socket) return;
      state = { phase: "open", socket };
      backoffMs = initialBackoffMs;
      options.onOpen?.(socket);
    };

    socket.onmessage = (event) => {
      if (stateSocket(state) !== socket) return;
      options.onMessage?.(event, socket);
    };

    socket.onerror = () => {
      if (stateSocket(state) !== socket) return;
      options.onError?.();
      // One failure edge owns reconnection. Closing funnels both browser error
      // orderings through onclose instead of allowing an error timer and close
      // timer to race each other.
      socket.close();
    };

    socket.onclose = () => {
      if (stateSocket(state) !== socket) return;
      options.onClose?.();
      scheduleReconnect();
    };
  };

  return {
    connect() {
      retireState(state);
      state = { phase: "idle" };
      open();
    },
    close() {
      const previous = state;
      state = { phase: "idle" };
      retireState(previous);
    },
    get socket() {
      return stateSocket(state);
    },
  };

  function retireState(previous: SocketState): void {
    if (previous.phase === "waiting") {
      window.clearTimeout(previous.timer);
      return;
    }
    const socket = stateSocket(previous);
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    socket.close();
  }

  function stateSocket(candidate: SocketState): WebSocket | null {
    return candidate.phase === "connecting" || candidate.phase === "open"
      ? candidate.socket
      : null;
  }
}
