import { registerParams } from "@avtools/livecode-engine/params_store.ts";
import { cloneEvent } from "@avtools/livecode-engine/events.ts";
import type {
  LivecodeEvent,
  ParamsPrimitive,
} from "@avtools/livecode-protocol";
import type {
  ParamsFieldMeta,
  ParamsMeta,
  ParamsMetaFor,
  ParamsValues,
} from "../visualizer/protocol.ts";

export type { ParamsFieldMeta, ParamsMeta, ParamsMetaFor, ParamsValues };

const BUTTON = Symbol("canvas-params button");
export interface ButtonDeclaration {
  readonly [BUTTON]: true;
  readonly event: LivecodeEvent<Record<string, unknown>>;
}

/** A static message, rendered as a momentary button; the UI supplies body.state. */
export function button(
  event: LivecodeEvent<Record<string, unknown>>,
): ButtonDeclaration {
  if (
    !event?.body || Array.isArray(event.body) || typeof event.body !== "object"
  ) {
    throw new Error("button body must be a plain object");
  }
  if ("state" in event.body) {
    throw new Error("button body.state is supplied by the UI");
  }
  return { [BUTTON]: true, event: cloneEvent(event) };
}

export interface ParamsDeclaration {
  [key: string]: ParamsPrimitive | ButtonDeclaration | ParamsDeclaration;
}

/** Buttons are declaration metadata, absent from the inferred live value. */
export type ParamsValueOf<T> = {
  [K in keyof T as T[K] extends ButtonDeclaration ? never : K]: T[K] extends
    ParamsDeclaration ? ParamsValueOf<T[K]>
    : T[K] extends boolean ? boolean
    : T[K];
};

export type ParamsDeclarationMeta<T> = {
  [K in keyof T]?: T[K] extends ButtonDeclaration
    ? Pick<ParamsFieldMeta, "label">
    : T[K] extends ParamsDeclaration ? ParamsDeclarationMeta<T[K]>
    : Omit<ParamsFieldMeta, "button">;
};

function splitDeclaration(
  defaults: ParamsDeclaration,
  meta: ParamsMeta | undefined,
  seen = new Set<object>(),
): { values: ParamsValues; meta: ParamsMeta } {
  if (
    !defaults || typeof defaults !== "object" || Array.isArray(defaults) ||
    (Object.getPrototypeOf(defaults) !== Object.prototype &&
      Object.getPrototypeOf(defaults) !== null)
  ) {
    throw new Error("canvasParams defaults must be a plain object");
  }
  if (seen.has(defaults)) {
    throw new Error("canvasParams defaults contain a circular reference");
  }
  seen.add(defaults);
  const values: ParamsValues = {};
  const resultMeta: ParamsMeta = { ...meta };
  for (const [key, value] of Object.entries(defaults)) {
    if (value && typeof value === "object" && BUTTON in value) {
      const descriptor = value as ButtonDeclaration;
      Object.defineProperty(resultMeta, key, {
        enumerable: true,
        configurable: true,
        writable: true,
        value: { ...meta?.[key], button: cloneEvent(descriptor.event) },
      });
      continue;
    }
    let next: unknown = value;
    if (
      value && typeof value === "object" && !Array.isArray(value) &&
      (Object.getPrototypeOf(value) === Object.prototype ||
        Object.getPrototypeOf(value) === null)
    ) {
      const nested = splitDeclaration(
        value as ParamsDeclaration,
        meta?.[key] as ParamsMeta | undefined,
        seen,
      );
      next = nested.values;
      if (Object.keys(nested.meta).length) {
        Object.defineProperty(resultMeta, key, {
          value: nested.meta,
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
    }
    Object.defineProperty(values, key, {
      value: next,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  seen.delete(defaults);
  return { values, meta: resultMeta };
}

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
export function canvasParams<T extends ParamsDeclaration>(
  name: string,
  defaults: T,
  meta?: ParamsDeclarationMeta<T>,
): ParamsValueOf<T> {
  const declaration = splitDeclaration(
    defaults,
    meta as ParamsMeta | undefined,
  );
  return registerParams(
    name,
    declaration.values,
    Object.keys(declaration.meta).length ? declaration.meta : undefined,
  ) as ParamsValueOf<T>;
}
