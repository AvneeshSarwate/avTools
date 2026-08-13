// Params entities: the first typed wrapper over `entity_store.ts`.
//
// Two properties drive the whole design:
//
//   1. `registerParams` hands out the LIVE value object. User code reads and
//      writes plain properties on it, so writes bypass the store entirely.
//      `sampleParamsSnapshot` is what turns those drifted values into store
//      generations (rev bumps with `updatedBy: "code"`), which keeps rev a
//      monotonic counter of observed value generations and lets pane echo
//      suppression stay sound.
//   2. Object identity is a contract. Reconcile mutates the existing object in
//      place at every depth so a module that kept a reference across a
//      relaunch keeps observing live truth.

import {
  clearEntityRecords,
  cloneEntityValueForWire,
  commitEntityWrite,
  consumeEntityTypeDirty,
  createEntityRecord,
  type EntityRecord,
  getEntityRecord,
  isEntityRevConflict,
  listEntityRecords,
  markEntityTypeDirty,
  nextEntitySnapshotSeq,
  normalizeEntityName,
  safeStringifyEntityValue,
} from "./entity_store.ts";
import type {
  ParamsEntity,
  ParamsMeta,
  ParamsSnapshot,
  ParamsValues,
} from "./protocol.ts";

export const PARAMS_ENTITY_TYPE = "params";

export interface SetParamsOptions {
  originId?: string;
  expectedRev?: number;
}

// Values of fields a later declaration dropped, kept per entity so that
// commenting a field out and putting it back restores the tweaked value rather
// than the declared default. Mirrors the value tree; entries are removed when
// they are restored. In memory only, like the entities themselves.
const tombstones = new Map<string, ParamsValues>();

/**
 * Create-or-reattach. Returns the live value object: the same reference for
 * every declaration of one name, so prior module instances keep working.
 * Throws only on an invalid declaration, which runs at module init rather than
 * inside timing loops.
 */
export function registerParams<T extends ParamsValues>(
  name: string,
  defaults: T,
  meta?: ParamsMeta,
): T {
  const entityName = normalizeEntityName(PARAMS_ENTITY_TYPE, name);
  validateParamsValues(defaults, entityName);
  const declaredMeta = sanitizeMeta(meta, entityName);
  const existing = getEntityRecord<ParamsValues>(
    PARAMS_ENTITY_TYPE,
    entityName,
  );

  if (!existing) {
    const value = structuredClone(defaults) as ParamsValues;
    const record = createEntityRecord<ParamsValues>(
      PARAMS_ENTITY_TYPE,
      entityName,
      value,
      {
        meta: declaredMeta,
        updatedBy: "declare",
        valueJson: safeStringifyEntityValue(value),
      },
    );
    return record.value as T;
  }

  const tombstoneRoot = tombstones.get(entityName) ?? {};
  const changed = reconcileValues(existing.value, defaults, tombstoneRoot);
  pruneEmptyNodes(tombstoneRoot);
  if (Object.keys(tombstoneRoot).length > 0) {
    tombstones.set(entityName, tombstoneRoot);
  } else {
    tombstones.delete(entityName);
  }

  // The declaration always wins for meta. A meta-only change does not bump rev
  // (rev counts value generations); marking the type dirty is enough, because
  // panes rebuild bindings from the value shape and meta, not from rev.
  const metaChanged = !metaEquals(
    existing.meta as ParamsMeta | undefined,
    declaredMeta,
  );
  if (metaChanged) existing.meta = declaredMeta;

  if (changed) {
    commitEntityWrite(existing, {
      updatedBy: "reconcile",
      valueJson: safeStringifyEntityValue(existing.value),
    });
  } else if (metaChanged) {
    markEntityTypeDirty(PARAMS_ENTITY_TYPE);
  }

  return existing.value as T;
}

/**
 * Merge nested leaf patches into the live object in place. Returns undefined
 * when the entity does not exist: entities are declared by code in this slice,
 * so a set never creates one.
 */
export function setParamsValues(
  name: string,
  values: ParamsValues,
  options: SetParamsOptions = {},
): ParamsEntity | undefined {
  const entityName = normalizeEntityName(PARAMS_ENTITY_TYPE, name);
  const record = getEntityRecord<ParamsValues>(PARAMS_ENTITY_TYPE, entityName);
  if (!record) return undefined;

  if (isEntityRevConflict(record, options.expectedRev)) {
    return { ...toParamsEntity(record), conflict: true };
  }

  // No-op detection compares against a FRESH serialization of the pre-merge
  // value, never the cached string: code writes go straight to the live object,
  // so the cache can be one sampler tick stale and would swallow a real edit.
  const beforeJson = safeStringifyEntityValue(record.value);
  mergeParamsPatch(record.value, values, entityName, []);
  const afterJson = safeStringifyEntityValue(record.value);
  if (afterJson !== null && afterJson === beforeJson) {
    return toParamsEntity(record);
  }

  commitEntityWrite(record, {
    updatedBy: options.originId ?? "client",
    valueJson: afterJson,
  });
  return toParamsEntity(record);
}

export function getParams(name: string): ParamsEntity | undefined {
  const record = getEntityRecord<ParamsValues>(
    PARAMS_ENTITY_TYPE,
    name.trim(),
  );
  return record ? toParamsEntity(record) : undefined;
}

export function getAllParams(): Record<string, ParamsEntity> {
  return Object.fromEntries(
    listEntityRecords<ParamsValues>(PARAMS_ENTITY_TYPE).map((
      record,
    ) => [record.name, toParamsEntity(record)]),
  );
}

export function listParamsNames(): string[] {
  return listEntityRecords<ParamsValues>(PARAMS_ENTITY_TYPE).map((record) =>
    record.name
  );
}

/**
 * Read-only point-in-time snapshot for `/params/list` and socket open. It must
 * not touch the broadcast gate or the per-entity caches, or one client
 * connecting would consume the pending update for every other client.
 */
export function makeParamsSnapshot(): ParamsSnapshot {
  return {
    type: "paramsSnapshot",
    seq: nextEntitySnapshotSeq(PARAMS_ENTITY_TYPE),
    timestampMs: Date.now(),
    params: getAllParams(),
  };
}

/**
 * The broadcast tick: adopt code writes as store generations, then return a
 * snapshot when anything changed. Never throws — a value that cannot be
 * serialized is flagged on its entity instead of freezing the loop.
 */
export function sampleParamsSnapshot(): ParamsSnapshot | null {
  for (const record of listEntityRecords<ParamsValues>(PARAMS_ENTITY_TYPE)) {
    const json = safeStringifyEntityValue(record.value);

    if (json === null) {
      if (!record.unserializable) {
        record.unserializable = true;
        markEntityTypeDirty(PARAMS_ENTITY_TYPE);
        console.warn(
          `[params-store] "${record.name}" value can no longer be serialized ` +
            "(cycle or BigInt written by code); snapshots keep the last good " +
            "values and flag the entity.",
        );
      }
      continue;
    }

    if (record.unserializable) {
      record.unserializable = false;
      markEntityTypeDirty(PARAMS_ENTITY_TYPE);
      console.warn(
        `[params-store] "${record.name}" value is serializable again.`,
      );
    }

    if (json === record.lastValueJson) continue;
    // Adopt the drift: plain property writes never reach the store API, so this
    // is the only place a code-authored generation can be recorded.
    commitEntityWrite(record, { updatedBy: "code", valueJson: json });
  }

  if (!consumeEntityTypeDirty(PARAMS_ENTITY_TYPE)) return null;
  return makeParamsSnapshot();
}

/** Test seam: drops every params entity and its tombstones. */
export function clearParamsStore(): void {
  clearEntityRecords(PARAMS_ENTITY_TYPE);
  tombstones.clear();
}

function toParamsEntity(record: EntityRecord<ParamsValues>): ParamsEntity {
  const entity: ParamsEntity = {
    name: record.name,
    rev: record.rev,
    values: cloneEntityValueForWire(record) ?? {},
    updatedAt: record.updatedAt,
    updatedBy: record.updatedBy,
  };
  const meta = record.meta as ParamsMeta | undefined;
  if (meta) entity.meta = JSON.parse(JSON.stringify(meta)) as ParamsMeta;
  if (record.unserializable) entity.unserializable = true;
  return entity;
}

// Recursive, in-place reconcile. Existing values survive, new fields arrive at
// their default, a field whose declared type changed takes the new default
// (binding and meta coherence wins), and dropped fields leave a tombstone.
function reconcileValues(
  live: ParamsValues,
  defaults: ParamsValues,
  tombstoneNode: ParamsValues,
): boolean {
  let changed = false;

  for (const key of Object.keys(defaults)) {
    const declared = defaults[key];
    const current = live[key];

    if (isPlainObject(declared)) {
      if (isPlainObject(current)) {
        if (reconcileValues(current, declared, childNode(tombstoneNode, key))) {
          changed = true;
        }
        continue;
      }
      // Absent, or a primitive where an object is now declared: restore the
      // tombstoned object if there is one, then reconcile it against the
      // declaration so the declared shape still wins.
      const restored = takeTombstoneObject(tombstoneNode, key) ?? {};
      live[key] = restored;
      reconcileValues(restored, declared, childNode(tombstoneNode, key));
      changed = true;
      continue;
    }

    if (
      current !== undefined && !isPlainObject(current) &&
      typeof current === typeof declared
    ) {
      continue;
    }

    live[key] = key in live
      ? declared
      : takeTombstonePrimitive(tombstoneNode, key, typeof declared) ?? declared;
    changed = true;
  }

  for (const key of Object.keys(live)) {
    if (key in defaults) continue;
    const dropped = live[key];
    const existingTombstone = tombstoneNode[key];
    tombstoneNode[key] =
      isPlainObject(dropped) && isPlainObject(existingTombstone)
        ? { ...existingTombstone, ...dropped }
        : dropped;
    delete live[key];
    changed = true;
  }

  return changed;
}

function mergeParamsPatch(
  live: ParamsValues,
  patch: ParamsValues,
  entityName: string,
  path: string[],
): void {
  if (!isPlainObject(patch)) return;

  for (const key of Object.keys(patch)) {
    const incoming = patch[key];
    const current = live[key];
    const fieldPath = [...path, key];

    if (isPlainObject(incoming)) {
      if (isPlainObject(current)) {
        mergeParamsPatch(current, incoming, entityName, fieldPath);
      } else {
        warnIgnoredField(
          entityName,
          fieldPath,
          "no nested object is declared there",
        );
      }
      continue;
    }

    if (current === undefined) {
      warnIgnoredField(entityName, fieldPath, "the field is not declared");
      continue;
    }
    if (isPlainObject(current) || typeof current !== typeof incoming) {
      warnIgnoredField(
        entityName,
        fieldPath,
        `expected ${typeof current}, received ${describeValue(incoming)}`,
      );
      continue;
    }
    if (typeof incoming === "number" && !Number.isFinite(incoming)) {
      warnIgnoredField(entityName, fieldPath, "value is not a finite number");
      continue;
    }

    live[key] = incoming;
  }
}

function validateParamsValues(
  values: ParamsValues,
  entityName: string,
  path: string[] = [],
  seen: Set<unknown> = new Set(),
): void {
  if (!isPlainObject(values)) {
    throw new Error(
      `canvasParams("${entityName}"): defaults must be a plain object ` +
        `(received ${describeValue(values)}).`,
    );
  }
  if (seen.has(values)) {
    throw new Error(
      `canvasParams("${entityName}"): ${
        fieldLabel(path)
      } contains a circular reference.`,
    );
  }
  seen.add(values);

  for (const key of Object.keys(values)) {
    const value = values[key];
    const fieldPath = [...path, key];

    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        throw new Error(
          `canvasParams("${entityName}"): field "${
            fieldPath.join(".")
          }" must ` +
            `be a finite number (received ${String(value)}).`,
        );
      }
      continue;
    }
    if (typeof value === "string" || typeof value === "boolean") continue;
    if (isPlainObject(value)) {
      validateParamsValues(value, entityName, fieldPath, seen);
      continue;
    }

    throw new Error(
      `canvasParams("${entityName}"): field "${
        fieldPath.join(".")
      }" must be a ` +
        "finite number, string, boolean, or nested plain object (received " +
        `${describeValue(value)}).`,
    );
  }

  seen.delete(values);
}

// Meta is refinement only and must stay JSON-sendable; a meta that cannot be
// serialized is dropped with a warning rather than failing the declaration.
function sanitizeMeta(
  meta: ParamsMeta | undefined,
  entityName: string,
): ParamsMeta | undefined {
  if (meta === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(meta)) as ParamsMeta;
  } catch {
    console.warn(
      `[params-store] "${entityName}" declaration: meta could not be ` +
        "serialized and was dropped.",
    );
    return undefined;
  }
}

function metaEquals(
  current: ParamsMeta | undefined,
  next: ParamsMeta | undefined,
): boolean {
  if (current === next) return true;
  if (!current || !next) return false;
  return JSON.stringify(current) === JSON.stringify(next);
}

function childNode(node: ParamsValues, key: string): ParamsValues {
  const existing = node[key];
  if (isPlainObject(existing)) return existing;
  const created: ParamsValues = {};
  node[key] = created;
  return created;
}

function takeTombstoneObject(
  node: ParamsValues,
  key: string,
): ParamsValues | undefined {
  const stored = node[key];
  if (!isPlainObject(stored)) return undefined;
  delete node[key];
  return stored;
}

function takeTombstonePrimitive(
  node: ParamsValues,
  key: string,
  expectedType: string,
): number | string | boolean | undefined {
  const stored = node[key];
  if (stored === undefined || isPlainObject(stored)) return undefined;
  if (typeof stored !== expectedType) return undefined;
  delete node[key];
  return stored;
}

function pruneEmptyNodes(node: ParamsValues): void {
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (!isPlainObject(value)) continue;
    pruneEmptyNodes(value);
    if (Object.keys(value).length === 0) delete node[key];
  }
}

function warnIgnoredField(
  entityName: string,
  path: string[],
  reason: string,
): void {
  console.warn(
    `[params-store] "${entityName}" set: ignored field "${path.join(".")}" ` +
      `(${reason}).`,
  );
}

function fieldLabel(path: string[]): string {
  return path.length === 0 ? "defaults" : `field "${path.join(".")}"`;
}

function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return "an array (arrays are not supported in canvas params yet)";
  }
  if (typeof value === "object") {
    return Object.getPrototypeOf(value) === Object.prototype ||
        Object.getPrototypeOf(value) === null
      ? "an object"
      : `a ${(value as object).constructor?.name ?? "class"} instance`;
  }
  return typeof value;
}

function isPlainObject(value: unknown): value is ParamsValues {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
