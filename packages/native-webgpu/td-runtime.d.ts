/** Common embedded TouchDesigner environment. No browser DOM or Node runtime.
 * Opt into this file from your sketch tsconfig; timers run independently of TD frames.
 */
interface Console {
  log(...data: unknown[]): void;
  info(...data: unknown[]): void;
  error(...data: unknown[]): void;
  warn(...data: unknown[]): void;
  debug(...data: unknown[]): void;
}
declare var console: Console;
interface Performance { now(): number; }
declare var performance: Performance;
interface Crypto { randomUUID(): string; }
declare var crypto: Crypto;
declare function setTimeout<T extends unknown[]>(callback: (...args: T) => void, delay?: number, ...args: T): number;
declare function clearTimeout(handle?: number): void;
declare function setImmediate<T extends unknown[]>(callback: (...args: T) => void, ...args: T): number;
declare function clearImmediate(handle?: number): void;
declare function queueMicrotask(callback: () => void): void;
/** Runs on an accepted TD frame request. Does not synthesize frames while paused. */
declare function requestAnimationFrame(callback: (timestamp: number) => void): number;
declare function cancelAnimationFrame(handle: number): void;
interface EventInit { cancelable?: boolean; }
interface Event {
  readonly type: string;
  readonly cancelable: boolean;
  readonly defaultPrevented: boolean;
  readonly target: EventTarget | null;
  readonly currentTarget: EventTarget | null;
  preventDefault(): void;
  stopImmediatePropagation(): void;
}
declare var Event: { prototype: Event; new(type: string, options?: EventInit): Event; };
interface EventListenerOptions { capture?: boolean; }
interface AddEventListenerOptions extends EventListenerOptions { once?: boolean; }
interface EventListener { (event: Event): void; }
interface EventListenerObject { handleEvent(event: Event): void; }
type EventListenerOrEventListenerObject = EventListener | EventListenerObject;
interface EventTarget {
  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void;
  dispatchEvent(event: Event): boolean;
}
declare var EventTarget: { prototype: EventTarget; new(): EventTarget; };
declare class DOMException extends Error { constructor(message?: string, name?: string); }
interface AbortSignal extends EventTarget {
  readonly aborted: boolean;
  readonly reason: unknown;
  onabort: ((event: Event) => void) | null;
  throwIfAborted(): void;
}
/** Obtain a signal from AbortController; no public constructor or static helpers. */
declare var AbortSignal: { prototype: AbortSignal; };
interface AbortController { readonly signal: AbortSignal; abort(reason?: unknown): void; }
declare var AbortController: { prototype: AbortController; new(): AbortController; };
interface TDPromiseRejectionEvent extends Event { readonly reason: unknown; readonly promise: Promise<unknown>; }
declare function addEventListener(type: 'unhandledrejection', listener: ((event: TDPromiseRejectionEvent) => void) | null, options?: boolean | AddEventListenerOptions): void;
declare function addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void;
declare function removeEventListener(type: 'unhandledrejection', listener: ((event: TDPromiseRejectionEvent) => void) | null, options?: boolean | EventListenerOptions): void;
declare function removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void;
declare function dispatchEvent(event: Event): boolean;
