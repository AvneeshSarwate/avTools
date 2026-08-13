/**
 * Ephemeral signal wire types. Signals are never persisted, never undoable,
 * and code-published only — so there is no saved-file shape and no set body.
 */

/**
 * What a signal points at, so a view can bind without the producer knowing the
 * view exists: an entity reference, optionally into one field of it. `path` is
 * carried now even though no v1 consumer reads it.
 */
export interface SignalAnchor {
  /** Entity type wire id, e.g. `"pianoRoll"` or `"params"`. */
  type: string;
  name: string;
  path?: string[];
}

/**
 * One ephemeral signal: a named latest-value sample published by running code
 * purely to be watched. Signals are never persisted, never undoable, and end
 * with the run that published them.
 */
export interface SignalEntity {
  name: string;
  /** User-shaped latest value. `null` until the first `set`. */
  value: unknown;
  anchor?: SignalAnchor;
  /** The module whose run owns (and therefore ends) this signal. */
  ownerModuleId?: string;
  /**
   * The owning run ended. Sticky: later writes keep updating `value`, and only
   * a redeclaration of the name clears it.
   */
  ended?: boolean;
  /** Monotonically increasing count of observed value generations. */
  rev: number;
  updatedAt: number;
  updatedBy: string;
  /** Set when the live value stopped being serializable; `value` is the last good one. */
  unserializable?: boolean;
  /**
   * Root-clock logical time at the tick that adopted this value. Quantized by
   * the parent loop (~30 ms) and the sampler (100 ms); absent when no root
   * context is registered.
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
