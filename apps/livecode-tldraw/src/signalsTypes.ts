// Client mirror of the server's ephemeral signal wire types
// (`apps/deno-notebooks/livecode/visualizer/protocol.ts`). Signals are never
// persisted, so unlike params there is no saved-file shape here, and there is
// no set request: signals are code-published only.

/**
 * What a signal points at, so a view can bind without the producer knowing the
 * view exists. `path` is carried on the wire but no v1 consumer reads it.
 */
export interface SignalAnchor {
  /** Entity type wire id, e.g. `"pianoRoll"` or `"params"`. */
  type: string;
  name: string;
  path?: string[];
}

/**
 * One ephemeral signal: a named latest-value sample published by running code
 * purely to be watched. `ended` is sticky — the owning run stopped, and only a
 * redeclaration of the name clears it.
 */
export interface SignalEntity {
  name: string;
  /** User-shaped latest value. `null` until the first `set`. */
  value: unknown;
  anchor?: SignalAnchor;
  ownerModuleId?: string;
  ended?: boolean;
  rev: number;
  updatedAt: number;
  updatedBy: string;
  /** Set when the live value stopped being serializable; `value` is the last good one. */
  unserializable?: boolean;
  /**
   * Root-clock logical time at the tick that adopted this value. Quantized by
   * the parent loop (~30 ms) and the sampler (100 ms); absent when no root
   * context is registered. Shipped for later use; v1 views plot arrival time.
   */
  timeSec?: number;
  beats?: number;
}

export interface SignalsSnapshot {
  type: "signalsSnapshot";
  seq: number;
  timestampMs: number;
  signals: Record<string, SignalEntity>;
}
