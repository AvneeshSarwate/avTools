import type {WebSocketConnection, WebSocketCloseEvent, WebSocketHost} from '../td-io.d.ts';
import type {SketchLifetime} from './td-timing.ts';
import {utf8Encode, utf8Decode} from './osc.ts';

const g = globalThis as any;
let sequence = 0;
type Event = (kind: string, text: string, bytes: Uint8Array, code: number) => void;
const events = new Map<number, Event>();
g.__avWebSocketEvent = (id: number, kind: string, text: string, bytes: Uint8Array, code: number) => {
  events.get(id)?.(kind, text, bytes, code);
};
const native = (op: string, id = 0, socket = 0, text = '', code = 0, bytes?: Uint8Array) =>
  g.__avWebSocket(op, id, socket, text, code, bytes);

export function createWebSocketHost(life: SketchLifetime): WebSocketHost {
  const disposers = new Set<() => void>();
  life.onDispose(() => {
    for (const dispose of [...disposers]) dispose();
    disposers.clear();
  });

  return Object.freeze({
    connect(url: string): WebSocketConnection {
      return life.run(() => {
        if (typeof url !== 'string' || !/^wss?:\/\/[^\s]+$/.test(url) || url.includes('\0')) {
          throw new TypeError('Expected a ws:// or wss:// URL');
        }
        if (disposers.size >= 16) throw new Error('WebSocket connection limit (16)');
        const id = ++sequence;
        let readyState: WebSocketConnection['readyState'] = 'connecting';
        const opens = new Set<() => void>();
        const messages = new Set<(data: string | Uint8Array) => void>();
        const errors = new Set<(error: Error) => void>();
        const closes = new Set<(event: WebSocketCloseEvent) => void>();
        const sends = new Map<number, (error?: Error) => void>();
        let bufferedAmount = 0;

        function listen<T>(set: Set<T>, callback: T) {
          return life.run(() => {
            if (typeof callback !== 'function') throw new TypeError('Expected a callback');
            if (readyState === 'closed') throw new Error('WebSocket is closed');
            set.add(callback);
            return () => { set.delete(callback); };
          });
        }

        function cleanup() {
          readyState = 'closed';
          events.delete(id);
          disposers.delete(dispose);
          for (const [request, finish] of sends) {
            events.delete(request);
            finish(new Error('WebSocket closed before send completed'));
          }
          sends.clear();
          opens.clear(); messages.clear(); errors.clear(); closes.clear();
        }

        function dispose() {
          // Native invalidation also cancels connections if setup throws.
          try { native('close', 0, id, '', 1000); } catch { /* disposed */ }
          cleanup();
        }

        events.set(id, (kind, text, bytes, code) => {
          if (readyState === 'closed') return;
          if (kind === 'open') {
            if (readyState !== 'connecting') return;
            readyState = 'open';
            for (const callback of [...opens]) life.run(callback);
          } else if (kind === 'text' || kind === 'binary') {
            if (readyState !== 'open') return;
            const data = kind === 'text' ? utf8Decode(bytes) : bytes;
            for (const callback of [...messages]) life.run(() => callback(data));
          } else if (kind === 'error') {
            if (!errors.size) console.warn('WebSocket:', text);
            for (const callback of [...errors]) life.run(() => callback(new Error(text)));
          } else if (kind === 'close') {
            const callbacks = [...closes];
            cleanup();
            for (const callback of callbacks) life.run(() => callback(Object.freeze({code, reason: text})));
          }
        });
        disposers.add(dispose);
        try { native('open', id, 0, url); }
        catch (error) { cleanup(); throw error; }

        return Object.freeze({
          url,
          get readyState() { return readyState; },
          get bufferedAmount() { return bufferedAmount; },
          onOpen: (callback: () => void) => listen(opens, callback),
          onMessage: (callback: (data: string | Uint8Array) => void) => listen(messages, callback),
          onError: (callback: (error: Error) => void) => listen(errors, callback),
          onClose: (callback: (event: WebSocketCloseEvent) => void) => listen(closes, callback),
          send(data: string | Uint8Array): Promise<void> {
            return life.run(() => new Promise<void>((resolve, reject) => {
              if (readyState !== 'open') { reject(new Error('WebSocket is not open')); return; }
              const text = typeof data === 'string';
              if (!text && !(data instanceof Uint8Array)) { reject(new TypeError('Expected string or Uint8Array')); return; }
              if (data.length > 8 * 1024 * 1024) { reject(new Error('WebSocket message exceeds 8 MiB')); return; }
              const bytes = text ? utf8Encode(data) : data;
              if (bytes.length > 8 * 1024 * 1024 || sends.size >= 64 || bufferedAmount + bytes.length > 16 * 1024 * 1024) {
                reject(new Error('WebSocket send limit (8 MiB/message, 64 pending / 16 MiB)')); return;
              }
              const request = ++sequence;
              bufferedAmount += bytes.length;
              const finish = (error?: Error) => {
                bufferedAmount -= bytes.length;
                sends.delete(request); events.delete(request);
                if (error) reject(error); else resolve();
              };
              sends.set(request, finish);
              events.set(request, (_kind, error) => finish(error ? new Error(error) : undefined));
              try { native('send', request, id, '', text ? 1 : 0, bytes); }
              catch (error) { finish(error as Error); }
            }));
          },
          close(code = 1000, reason = '') {
            life.run(() => {
              if (readyState === 'closing' || readyState === 'closed') return;
              if (!Number.isInteger(code) || (code !== 1000 && (code < 3000 || code > 4999)) ||
                  typeof reason !== 'string' || utf8Encode(reason).length > 123) throw new Error('Invalid WebSocket close code/reason');
              native('close', 0, id, reason, code);
              readyState = 'closing';
            });
          },
        });
      });
    },
  });
}
