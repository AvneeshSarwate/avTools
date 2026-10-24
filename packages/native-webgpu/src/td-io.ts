import type {IOHost, UdpOptions, UdpSocket, OscSocket, RemoteAddress, ReceivedOscMessage} from '../td-io.d.ts';
import type {SketchLifetime} from './td-timing.ts';
import {encodeOsc, decodeOsc, utf8Decode} from './osc.ts';
const g = globalThis as any;
let sequence = 0;
type Completion = (kind: string, error: string, bytes: Uint8Array, remote: RemoteAddress) => void;
const pending = new Map<number, Completion>();
const receivers = new Map<number, Completion>();
g.__avIOEvent = (id: number, kind: string, error: string, bytes: Uint8Array, address: string, port: number) => {
  const remote = Object.freeze({address, port});
  if (kind === 'data' || kind === 'socketError') receivers.get(id)?.(kind, error, bytes, remote);
  else { const callback = pending.get(id); pending.delete(id); callback?.(kind, error, bytes, remote); }
};
const native = (op: string, id = 0, socket = 0, path = '', port = 0, bytes?: Uint8Array) => g.__avIO(op, id, socket, path, port, bytes);
function address(options: UdpOptions | RemoteAddress = {}): RemoteAddress {
  const address = options.address ?? '127.0.0.1', port = options.port ?? 0;
  if (typeof address !== 'string' || address.includes('\0') || !Number.isInteger(port) || port < 0 || port > 65535) throw Error('Invalid UDP address/port');
  return {address, port};
}
export function createIO(life: SketchLifetime): IOHost {
  const baseDirectory = String(g.__avBaseDirectory ?? '');
  const ids = new Set<number>();
  const sockets = new Set<UdpSocket>();
  life.onDispose(() => { for (const socket of sockets) socket.close(); for (const id of ids) pending.delete(id); ids.clear(); });
  function request<T>(op: string, socket: number, path: string, port: number, bytes: Uint8Array | undefined, done: (kind: string, bytes: Uint8Array, remote: RemoteAddress, id: number) => T): Promise<T> {
    return life.run(() => new Promise<T>((resolve, reject) => {
      if (pending.size >= 128) { reject(Error('Too many pending I/O requests (128)')); return; }
      const id = ++sequence; ids.add(id);
      pending.set(id, (kind, error, data, remote) => {
        ids.delete(id);
        if (kind === 'error') { reject(Error(error)); return; }
        try { resolve(done(kind, data, remote, id)); } catch (error) { reject(error); }
      });
      try { native(op, id, socket, path, port, bytes); }
      catch (error) { pending.delete(id); ids.delete(id); reject(error); }
    }));
  }
  const readBytes = (path: string) => {
    if (typeof path !== 'string' || !path || path.includes('\0')) return Promise.reject(Error('File path must be a nonempty string'));
    const resolved = path.startsWith('/') || !baseDirectory ? path : baseDirectory + '/' + path;
    return request('read', 0, resolved, 0, undefined, (_kind, bytes) => bytes);
  };
  function open(options?: UdpOptions): Promise<UdpSocket> {
    const local = address(options);
    return request('open', 0, local.address, local.port, undefined, (_kind, _bytes, localAddress, id) => {
      let closed = false;
      const listeners = new Set<(bytes: Uint8Array, remote: RemoteAddress) => void>();
      const errors = new Set<(error: Error) => void>();
      const active = () => { if (closed) throw Error('UDP socket is closed'); };
      const socket: UdpSocket = Object.freeze({
        localAddress,
        send(bytes: Uint8Array, destination: RemoteAddress) {
          active();
          if (!(bytes instanceof Uint8Array) || bytes.byteLength > 65507) return Promise.reject(Error('UDP payload must be Uint8Array, at most 65507 bytes'));
          const remote = address(destination);
          if (!remote.port) return Promise.reject(Error('UDP destination port must be 1–65535'));
          return request<void>('send', id, remote.address, remote.port, bytes, () => {});
        },
        onMessage(callback: (bytes: Uint8Array, remote: RemoteAddress) => void) {
          return life.run(() => { active(); if (typeof callback !== 'function') throw TypeError('Expected a callback'); listeners.add(callback); return () => listeners.delete(callback); });
        },
        onError(callback: (error: Error) => void) {
          return life.run(() => { active(); if (typeof callback !== 'function') throw TypeError('Expected a callback'); errors.add(callback); return () => errors.delete(callback); });
        },
        close() {
          if (closed) return;
          closed = true; receivers.delete(id); listeners.clear(); errors.clear(); sockets.delete(socket);
          // Closing is idempotent, including during disposal after failure.
          try { native('close', 0, id); } catch { /* Native invalidation already closes the generation. */ }
        },
      });
      receivers.set(id, (kind, error, bytes, remote) => {
        if (closed) return;
        if (kind === 'data') { for (const callback of [...listeners]) life.run(() => callback(bytes, remote)); }
        else if (errors.size) { for (const callback of [...errors]) life.run(() => callback(Error(error))); }
        else console.warn('UDP receive error:', error);
      });
      sockets.add(socket);
      return socket;
    });
  }
  async function openOsc(options?: UdpOptions): Promise<OscSocket> {
    const socket = await open(options);
    const messages = new Set<(message: ReceivedOscMessage, remote: RemoteAddress) => void>();
    const errors = new Set<(error: Error) => void>();
    let closed = false;
    const report = (error: Error) => { for (const callback of [...errors]) life.run(() => callback(error)); };
    socket.onError(report);
    socket.onMessage((bytes, remote) => {
      let decoded: ReceivedOscMessage[];
      try { decoded = decodeOsc(bytes); } catch (error) { report(error as Error); return; }
      for (const message of decoded) for (const callback of [...messages]) life.run(() => callback(message, remote));
    });
    return Object.freeze<OscSocket>({
      localAddress: socket.localAddress,
      send: (packet, remote) => socket.send(encodeOsc(packet), remote),
      onMessage(callback) { return life.run(() => { if (closed) throw Error('OSC socket is closed'); if (typeof callback !== 'function') throw TypeError('Expected a callback'); messages.add(callback); return () => messages.delete(callback); }); },
      onError(callback) { return life.run(() => { if (closed) throw Error('OSC socket is closed'); if (typeof callback !== 'function') throw TypeError('Expected a callback'); errors.add(callback); return () => errors.delete(callback); }); },
      close() { if (closed) return; closed = true; messages.clear(); errors.clear(); socket.close(); },
    });
  }
  return Object.freeze({
    files: Object.freeze({baseDirectory, readBytes, readText: async (path: string) => utf8Decode(await readBytes(path))}),
    udp: Object.freeze({open, get droppedDatagrams() { return life.run(() => native('stats')); }}),
    osc: Object.freeze({open: openOsc}),
  });
}
