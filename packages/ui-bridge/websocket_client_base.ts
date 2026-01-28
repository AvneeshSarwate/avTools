export interface PendingRequest<T = unknown> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timeout: number;
}

export interface WebSocketClientOptions {
  logPrefix?: string;
  requestTimeoutMs?: number;
}

export abstract class WebSocketClientBase<IncomingMessage, OutgoingMessage> {
  protected readonly ws: WebSocket;
  protected readonly logPrefix: string;
  protected readonly pendingRequests = new Map<string, PendingRequest>();
  protected requestTimeout = 10000;
  protected _connected = false;

  /** Called when the component signals it's ready */
  onConnectionReady?: () => void;

  /** Called when the WebSocket connection closes */
  onDisconnect?: () => void;

  /** Called when there's an error */
  onError?: (error: Error) => void;

  constructor(ws: WebSocket, options: WebSocketClientOptions = {}) {
    this.ws = ws;
    this.logPrefix = options.logPrefix ?? 'WebSocketClient';
    this.requestTimeout = options.requestTimeoutMs ?? 10000;
    this.setupListeners();
  }

  protected abstract handleMessage(message: IncomingMessage): void;

  protected send(message: OutgoingMessage): void {
    if (this.ws.readyState !== WebSocket.OPEN) {
      console.warn(`[${this.logPrefix}] Cannot send - WebSocket not open`);
      return;
    }
    this.ws.send(JSON.stringify(message));
  }

  protected generateRequestId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  protected registerPendingRequest<T>(resolve: (value: T) => void, reject: (error: Error) => void): string {
    const requestId = this.generateRequestId();
    const timeout = setTimeout(() => {
      this.pendingRequests.delete(requestId);
      reject(new Error('Request timed out'));
    }, this.requestTimeout) as unknown as number;
    this.pendingRequests.set(requestId, {
      resolve: resolve as PendingRequest['resolve'],
      reject,
      timeout,
    });
    return requestId;
  }

  protected resolvePendingRequest<T>(requestId: string, value: T): boolean {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return false;
    clearTimeout(pending.timeout);
    this.pendingRequests.delete(requestId);
    (pending.resolve as (value: T) => void)(value);
    return true;
  }

  protected rejectAllPendingRequests(message: string): void {
    for (const [requestId, { reject, timeout }] of this.pendingRequests) {
      clearTimeout(timeout);
      reject(new Error(message));
      this.pendingRequests.delete(requestId);
    }
  }

  private setupListeners(): void {
    this.ws.onopen = () => {
      this._connected = true;
    };

    this.ws.onmessage = (event: MessageEvent) => {
      const data = typeof event.data === 'string' ? event.data : '';
      this.handleRawMessage(data);
    };

    this.ws.onclose = () => {
      this._connected = false;
      this.rejectAllPendingRequests('WebSocket connection closed');
      this.onDisconnect?.();
    };

    this.ws.onerror = () => {
      this.onError?.(new Error('WebSocket error'));
    };
  }

  private handleRawMessage(data: string): void {
    try {
      const message = JSON.parse(data) as IncomingMessage;
      this.handleMessage(message);
    } catch (error) {
      console.warn(`[${this.logPrefix}] Error handling message:`, error);
    }
  }
}
