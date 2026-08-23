/**
 * Canvas-params entity wire types: values, declaration meta, the entity
 * record, its snapshot envelope, and the `/params/set` body.
 */

export type ParamsPrimitive = number | string | boolean;

/**
 * JSON-simple parameter values: finite numbers, strings, booleans and nested
 * plain objects. Arrays are rejected at registration in v1 (tweakpane has no
 * native array binding).
 */
export interface ParamsValues {
  [key: string]: ParamsPrimitive | ParamsValues;
}

export interface ParamsFieldMeta {
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  /**
   * Opt in to a readonly time-series graph beside the editable binding for a
   * numeric leaf. Bounds come from `min`/`max`; a graph without declared bounds
   * falls back to the pane's default range.
   */
  graph?: boolean;
  /** Graph height in rows. The pane's default applies when absent. */
  rows?: number;
}

/** Meta tree keyed like the value tree; leaves refine one binding. */
export interface ParamsMeta {
  [key: string]: ParamsFieldMeta | ParamsMeta;
}

/**
 * Declaration-site meta typed against a defaults object, so `canvasParams`
 * callers get key completion and per-key checking.
 */
export type ParamsMetaFor<T extends ParamsValues> = {
  [K in keyof T]?: T[K] extends ParamsValues ? ParamsMetaFor<T[K]>
    : ParamsFieldMeta;
};

export interface ParamsEntity {
  name: string;
  rev: number;
  /** Null when the current live value cannot be represented on the wire. */
  values: ParamsValues | null;
  meta?: ParamsMeta;
  updatedAt: number;
  updatedBy: string;
  /** Set when `values` is unavailable because the live value is not serializable. */
  unserializable?: boolean;
  conflict?: boolean;
}

export interface ParamsSnapshot {
  type: "paramsSnapshot";
  seq: number;
  timestampMs: number;
  params: Record<string, ParamsEntity>;
}

export interface SetParamsRequest {
  name: string;
  /** Nested partial: only the leaves present are merged into the live object. */
  values: ParamsValues;
  originId?: string;
  expectedRev?: number;
}
