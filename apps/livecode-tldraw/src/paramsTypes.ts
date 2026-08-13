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
}

/** Meta tree keyed like the value tree; leaves refine one binding. */
export interface ParamsMeta {
  [key: string]: ParamsFieldMeta | ParamsMeta;
}

export interface ParamsEntity {
  name: string;
  rev: number;
  values: ParamsValues;
  meta?: ParamsMeta;
  updatedAt: number;
  updatedBy: string;
  /** Set when the live value stopped being serializable; values are the last good ones. */
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

/**
 * File format of a project's `data/params/<encoded-name>.json`. `meta` is saved
 * so a freshly opened project renders correct panes before any module runs; a
 * later `canvasParams` declaration still wins through the normal reconcile.
 */
export interface SavedParamsEntity {
  type: "params";
  name: string;
  savedAt: string;
  values: ParamsValues;
  meta?: ParamsMeta;
}
