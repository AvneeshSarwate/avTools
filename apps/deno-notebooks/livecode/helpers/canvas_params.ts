import { registerParams } from "@avtools/livecode-engine/params_store.ts";
import type {
  ParamsFieldMeta,
  ParamsMeta,
  ParamsMetaFor,
  ParamsValues,
} from "../visualizer/protocol.ts";

export type { ParamsFieldMeta, ParamsMeta, ParamsMetaFor, ParamsValues };

/**
 * Declare a parameter object a canvas pane can edit and monitor.
 *
 * The returned object is the live store value: read and write plain properties
 * on it at any rate. Declaring the same name again reattaches to the same
 * object (reconciled against the new defaults), so a relaunched module keeps
 * the values that were tweaked while it ran.
 *
 * Values must be JSON-simple: finite numbers, strings, booleans, and nested
 * plain objects. Arrays are rejected. `meta` refines the generated controls
 * (tweakpane infers the control kind from the value type).
 */
export function canvasParams<T extends ParamsValues>(
  name: string,
  defaults: T,
  meta?: ParamsMetaFor<T>,
): T {
  return registerParams(name, defaults, meta as ParamsMeta | undefined);
}
