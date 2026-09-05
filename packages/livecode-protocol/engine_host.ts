// The browser engine host contract: the surface `startBrowserEngineHost`
// (built into the engine asset tree as `engine_host.js`) exposes to whichever
// page embeds it — the standalone engine page, or the tldraw UI hosting the
// engine in its own tab (the in-process topology).
//
// This is not a JSON wire contract: the UI dynamically imports the served
// bundle and calls these functions directly, so the engine and the modules it
// launches share one set of store singletons with no serialization between the
// engine and the views. It lives here because it is the one type source both
// sides compile against.

import type { EngineOp } from "./engine_uplink.ts";
import type { SyncEntity, SyncEntityChange } from "./sync.ts";

/**
 * Engine ownership within one browser origin. `engine` is the only state in
 * which this page runs modules; `blocked` means another tab holds the lock and
 * `takeover()` can steal it; `takenOver`/`stopped` are terminal for this host.
 */
export type BrowserEngineLockState =
  | "starting"
  | "retrying"
  | "engine"
  | "blocked"
  | "takenOver"
  | "stopped";

export interface BrowserEngineHostStatus {
  lock: BrowserEngineLockState;
  /** Human-readable engine line (what the engine page shows as its status). */
  message: string;
  /** Human-readable MIDI line; null before the first init attempt. */
  midi: string | null;
  /** True while the `/engine/uplink` socket to the coordination server is open. */
  uplinkOpen: boolean;
}

export interface BrowserEngineHostOptions {
  /**
   * Directory URL of the engine asset tree this host was loaded from. A bake's
   * `baked.json` is resolved against it, and so is the coordination server's
   * `/engine/uplink` socket (same origin).
   */
  engineBaseUrl: string;
  /**
   * Connect to the coordination server over `/engine/uplink`. Default true; a
   * bake opened with no server anywhere passes false so the host does not
   * retry a socket that can never exist.
   */
  uplink?: boolean;
  onStatus?: (status: BrowserEngineHostStatus) => void;
}

/** A same-realm sync subscriber: receives each tick's changes as-is. */
export interface InProcessSyncObserver {
  /**
   * Entities are the freshly built wire objects the engine emits and never
   * mutates afterwards; the observer owns them and must treat them as
   * immutable.
   */
  onChanges(changes: SyncEntityChange[]): void;
}

export interface BrowserEngineHost {
  status(): BrowserEngineHostStatus;
  /** Status edges: lock transitions, uplink open/close, MIDI line changes. */
  subscribeStatus(
    listener: (status: BrowserEngineHostStatus) => void,
  ): () => void;
  /** Steal the origin's engine lock from another tab. */
  takeover(): void;
  /**
   * Point-in-time full state per requested type (all watched types when
   * omitted). Read-only: never consumes the engine's changed-name gates.
   */
  snapshot(entityTypes?: readonly string[]): Record<string, SyncEntity[]>;
  observe(observer: InProcessSyncObserver): () => void;
  /**
   * Execute one engine op in this realm — the same `executeEngineOp` the
   * uplink and the broadcast actions channel use. Rejects while this page is
   * not the engine.
   */
  execute(op: EngineOp): Promise<unknown>;
  /**
   * Resolves the first time the uplink opens. Never resolves for a host
   * created with `uplink: false`; rejects once the host is shut down.
   */
  whenUplinkOpen(): Promise<void>;
  shutdown(reason: string): void;
}

/** Shape of the `engine_host.js` module the UI imports at runtime. */
export interface BrowserEngineHostModule {
  startBrowserEngineHost(options: BrowserEngineHostOptions): BrowserEngineHost;
}
