/** Native file/UDP support shared by TOP and CHOP hosts. All callbacks run on
 * the instance's JavaScript worker, independently of TD cooking. Reload/reset
 * closes sockets and suppresses old completions. No Node APIs are required. */
export interface RemoteAddress { readonly address: string; readonly port: number; }
export interface UdpOptions {
  /** Numeric IPv4/IPv6 address or localhost. Default 127.0.0.1; use 0.0.0.0 for LAN reception. */
  address?: string;
  /** Local port; 0 (default) chooses an available port. */
  port?: number;
}
export interface UdpSocket {
  readonly localAddress: RemoteAddress;
  /** Resolves when handed to the OS, not when received by the peer. Bytes are copied. */
  send(bytes: Uint8Array, remote: RemoteAddress): Promise<void>;
  onMessage(callback: (bytes: Uint8Array, remote: RemoteAddress) => void): () => void;
  onError(callback: (error: Error) => void): () => void;
  close(): void;
}
export type OscArgument =
  | {type: 'i' | 'f' | 'd' | 'c' | 'r'; value: number}
  | {type: 'h' | 't'; value: bigint}
  | {type: 's' | 'S'; value: string}
  | {type: 'b' | 'm'; value: Uint8Array}
  | {type: 'T' | 'F' | 'N' | 'I'}
  | {type: 'array'; value: OscArgument[]};
/** Numbers infer float32. Use {type:'i', value:42} for OSC int32. */
export type OscValue = OscArgument | number | string | boolean | null | bigint | Uint8Array;
export interface OscMessage {address: string; args?: OscValue[];}
export interface OscBundle {timetag: bigint; packets: OscPacket[];}
export type OscPacket = OscMessage | OscBundle;
export interface ReceivedOscMessage {
  readonly address: string;
  readonly args: OscArgument[];
  /** Innermost bundle timetag, or 1n (immediate) for a standalone message.
   * Future timetags are metadata: delivery is immediate, never scheduled. */
  readonly timetag: bigint;
}
export interface OscSocket {
  readonly localAddress: RemoteAddress;
  send(packet: OscPacket, remote: RemoteAddress): Promise<void>;
  onMessage(callback: (message: ReceivedOscMessage, remote: RemoteAddress) => void): () => void;
  /** Malformed OSC packets are discarded and reported here. */
  onError(callback: (error: Error) => void): () => void;
  close(): void;
}
/** Event-driven WebSocket client shared by TOP and CHOP. */
export interface WebSocketCloseEvent {
  readonly code: number;
  readonly reason: string;
}
export interface WebSocketConnection {
  readonly url: string;
  readonly readyState: 'connecting' | 'open' | 'closing' | 'closed';
  /** Application payload bytes awaiting native send completion. */
  readonly bufferedAmount: number;
  onOpen(callback: () => void): () => void;
  /** Text is a string; binary is an owned Uint8Array. */
  onMessage(callback: (data: string | Uint8Array) => void): () => void;
  onError(callback: (error: Error) => void): () => void;
  onClose(callback: (event: WebSocketCloseEvent) => void): () => void;
  /** Resolves on transport send completion, not peer receipt. Rejects unless open.
   * Maximum 8 MiB/message, 64 pending sends / 16 MiB per runtime. */
  send(data: string | Uint8Array): Promise<void>;
  /** Local close is immediate; it does not wait for a peer handshake.
   * Code 1000 or 3000..4999; reason at most 123 UTF-8 bytes. */
  close(code?: number, reason?: string): void;
}
export interface WebSocketHost {
  /** Returns immediately in connecting state. Register listeners synchronously.
   * ws/wss, DNS and system TLS validation; no server API or automatic reconnect.
   * 16 connections per runtime; receive overflow closes instead of dropping data.
   * Reload/reset automatically cancels connections and old callbacks. */
  connect(url: string): WebSocketConnection;
}
export interface IOHost {
  readonly webSocket: WebSocketHost;
  readonly files: {
    /** TypeScript/source file's parent directory, or project.folder for DAT scripts. */
    readonly baseDirectory: string;
    /** Async regular-file read, maximum 64 MiB; relative paths use baseDirectory.
     * Absolute paths and ../ are allowed. Maximum 4 simultaneous reads. */
    readBytes(path: string): Promise<Uint8Array>;
    readText(path: string): Promise<string>;
  };
  readonly udp: {
    open(options?: UdpOptions): Promise<UdpSocket>;
    /** Received datagrams dropped at the per-instance queue limit (256 packets / 4 MiB). */
    readonly droppedDatagrams: number;
  };
  readonly osc: {open(options?: UdpOptions): Promise<OscSocket>;};
}
