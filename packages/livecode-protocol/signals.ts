/**
 * Ephemeral signal wire types. Signals are never persisted, never undoable,
 * and code-published only — so there is no saved-file shape and no set body.
 */

/**
 * One entity a signal points at, optionally narrowed to a field. A signal can
 * carry several anchors so the same runtime value can appear in several views.
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
  anchors: SignalAnchor[];
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
  /** Set when the current live value is unavailable and `value` is null. */
  unserializable?: boolean;
  /**
   * Root-clock logical time at the tick that adopted this value. Quantized by
   * the parent loop and the sync sampler; absent when no root
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
