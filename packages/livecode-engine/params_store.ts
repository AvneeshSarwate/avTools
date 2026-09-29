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
//
// The wire form is whole-entity first, then per-facet patches: a value
// generation ships `["values"]`, a preset edit ships `["presets"]`, and
// anything that touches meta or serializability ships the entity whole. Both
// facets are re-serialized at collect time, never at write time, so several
// writes inside one tick still cost one delivery. Presets live beside the
// value tree, not inside it: the live object keeps exactly the declared shape
// and the sampler's serialize-compare never sees a bank that did not change.

import {
  clearEntityRecords,
  cloneEntityValueForWire,
  commitEntityWrite,
  consumeEntityTypeChanges,
  createEntityRecord,
  deleteEntityRecord,
  type EntityChange,
  type EntityRecord,
  getEntityRecord,
  isEntityRevConflict,
  listEntityRecords,
  markEntityFacetChanged,
  markEntityFull,
  nextEntitySnapshotSeq,
  normalizeEntityName,
  safeStringifyEntityValue,
  serializeEntityValue,
  takeEntityFacets,
} from "./entity_store.ts";
import type {
  EntityPatch,
  ParamsEntity,
  ParamsMeta,
  ParamsSnapshot,
  ParamsValues,
} from "@avtools/livecode-protocol";

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

// Named value snapshots per entity, keyed by label. Saved with the entity and
// copied by duplicate; never reconciled against a declaration (a preset is
// what was captured, and recalling it goes through the ordinary patch merge,
// which drops fields that are no longer declared).
const presetsByName = new Map<string, Record<string, ParamsValues>>();

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
  const declaredMeta = cloneParamsMeta(meta, entityName);
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
  }
  // A redeclaration may change the value shape and the meta together, and a
  // pane rebuilds its bindings from both, so it ships whole.
  if (changed || metaChanged) markEntityFull(existing);

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
  markEntityFacetChanged(record, "values");
  return toParamsEntity(record);
}

export interface SetParamsPresetOptions extends SetParamsOptions {
  /** Explicit values to store; omitted means snapshot the current live values. */
  values?: ParamsValues;
}

/**
 * Save a preset under `label`: an explicit value tree, or a snapshot of the
 * live values. Presets are not value generations, so `rev` does not move;
 * the change reaches watchers as a `["presets"]` patch. Undefined when the
 * entity does not exist. Throws on an empty label, a value tree that is not
 * JSON-simple, or a snapshot of a live value that cannot be serialized:
 * preset edits run at route time, never inside timing loops.
 */
export function setParamsPreset(
  name: string,
  label: string,
  options: SetParamsPresetOptions = {},
): ParamsEntity | undefined {
  const entityName = normalizeEntityName(PARAMS_ENTITY_TYPE, name);
  const record = getEntityRecord<ParamsValues>(PARAMS_ENTITY_TYPE, entityName);
  if (!record) return undefined;
  const presetLabel = normalizePresetLabel(entityName, label);
  if (isEntityRevConflict(record, options.expectedRev)) {
    return { ...toParamsEntity(record), conflict: true };
  }

  let stored: ParamsValues;
  if (options.values !== undefined) {
    validateParamsValues(
      options.values,
      `${entityName} preset "${presetLabel}"`,
    );
    stored = cloneParamsValues(options.values, entityName);
  } else {
    const serialized = serializeEntityValue(record.value);
    if (!serialized.ok) {
      throw new Error(
        `Cannot snapshot params "${entityName}" into a preset: ${serialized.error}`,
      );
    }
    stored = JSON.parse(serialized.json) as ParamsValues;
  }

  const presets = presetsByName.get(entityName) ?? {};
  presets[presetLabel] = stored;
  presetsByName.set(entityName, presets);
  markEntityFacetChanged(record, "presets");
  return toParamsEntity(record);
}

/**
 * Drop one preset. Undefined when the entity does not exist; a label that was
 * never saved is a no-op that ships nothing.
 */
export function removeParamsPreset(
  name: string,
  label: string,
): ParamsEntity | undefined {
  const entityName = normalizeEntityName(PARAMS_ENTITY_TYPE, name);
  const record = getEntityRecord<ParamsValues>(PARAMS_ENTITY_TYPE, entityName);
  if (!record) return undefined;
  const presetLabel = normalizePresetLabel(entityName, label);
  const presets = presetsByName.get(entityName);
  if (!presets || !Object.hasOwn(presets, presetLabel)) {
    return toParamsEntity(record);
  }
  delete presets[presetLabel];
  if (Object.keys(presets).length === 0) presetsByName.delete(entityName);
  markEntityFacetChanged(record, "presets");
  return toParamsEntity(record);
}

/** A deep copy of one entity's presets; empty when there are none. */
export function getParamsPresets(name: string): Record<string, ParamsValues> {
  const presets = presetsByName.get(name.trim());
  return presets ? structuredClone(presets) : {};
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
    listParamsEntities().map((entity) => [entity.name, entity]),
  );
}

/**
 * Point-in-time clones of every params entity, sorted by name. Read-only: this
 * is what a `/sync` subscribe reset is built from, so it must never consume the
 * broadcast gate or adopt drift.
 */
export function listParamsEntities(): ParamsEntity[] {
  return listEntityRecords<ParamsValues>(PARAMS_ENTITY_TYPE)
    .map(toParamsEntity);
}

export function listParamsNames(): string[] {
  return listEntityRecords<ParamsValues>(PARAMS_ENTITY_TYPE).map((record) =>
    record.name
  );
}

/**
 * Canonical compact JSON of one entity's live value: exactly what a project
 * save writes and what the saved-state compare comes back to. Serialized fresh
 * rather than read from the no-op cache, so a code write the sampler has not
 * adopted yet can never make a save and its recorded saved state disagree.
 * Null when the entity is absent or its value cannot be serialized.
 */
export function latestParamsJson(name: string): string | null {
  const record = getEntityRecord<ParamsValues>(PARAMS_ENTITY_TYPE, name.trim());
  if (!record) return null;
  return safeStringifyEntityValue(record.value);
}

/**
 * Explicit operator creation of an empty entity. Legal but only useful once a
 * declaration (or a future GUI schema editor) fills it in. Throws on an
 * existing name: generic CRUD runs at route time, never inside timing loops.
 */
export function createEmptyParams(name: string): ParamsEntity {
  const entityName = normalizeEntityName(PARAMS_ENTITY_TYPE, name);
  if (getEntityRecord(PARAMS_ENTITY_TYPE, entityName)) {
    throw new Error(`Params entity "${entityName}" already exists`);
  }
  const value: ParamsValues = {};
  const record = createEntityRecord<ParamsValues>(
    PARAMS_ENTITY_TYPE,
    entityName,
    value,
    { updatedBy: "create", valueJson: safeStringifyEntityValue(value) },
  );
  return toParamsEntity(record);
}

/**
 * The variations gesture: a deep copy of values and meta under a new name.
 * Tombstones are deliberately NOT copied — they are the source's declaration
 * history, not part of the entity's content.
 */
export function duplicateParams(
  sourceName: string,
  targetName: string,
): ParamsEntity {
  const source = normalizeEntityName(PARAMS_ENTITY_TYPE, sourceName);
  const target = normalizeEntityName(PARAMS_ENTITY_TYPE, targetName);
  const sourceRecord = getEntityRecord<ParamsValues>(
    PARAMS_ENTITY_TYPE,
    source,
  );
  if (!sourceRecord) throw new Error(`No params entity "${source}"`);
  if (getEntityRecord(PARAMS_ENTITY_TYPE, target)) {
    throw new Error(`Params entity "${target}" already exists`);
  }

  const value = cloneParamsValues(sourceRecord.value, source);
  const record = createEntityRecord<ParamsValues>(
    PARAMS_ENTITY_TYPE,
    target,
    value,
    {
      meta: cloneParamsMeta(
        sourceRecord.meta as ParamsMeta | undefined,
        source,
      ),
      updatedBy: "duplicate",
      valueJson: safeStringifyEntityValue(value),
    },
  );
  const sourcePresets = presetsByName.get(source);
  if (sourcePresets) presetsByName.set(target, structuredClone(sourcePresets));
  return toParamsEntity(record);
}

/** Explicit operator deletion: the record and its tombstones both go. */
export function removeParams(name: string): boolean {
  const entityName = normalizeEntityName(PARAMS_ENTITY_TYPE, name);
  tombstones.delete(entityName);
  presetsByName.delete(entityName);
  return deleteEntityRecord(PARAMS_ENTITY_TYPE, entityName);
}

/**
 * Adopt saved truth for one entity. Reconcile-grade: an existing entity is
 * mutated IN PLACE at every depth, so a module holding the live object (or a
 * nested object inside it) keeps observing truth. Rev always bumps, because
 * open is an explicit operator action whose result panes must not
 * echo-suppress. Throws on values that are not JSON-simple; loading runs at
 * route time, not inside timing loops.
 */
export function loadParams(
  name: string,
  values: ParamsValues,
  meta?: ParamsMeta,
  presets?: Record<string, ParamsValues>,
): ParamsEntity {
  const entityName = normalizeEntityName(PARAMS_ENTITY_TYPE, name);
  validateParamsValues(values, entityName);
  const loadedMeta = cloneParamsMeta(meta, entityName);
  const loadedPresets = clonePresets(presets, entityName);
  // Saved truth replaces the bank as it replaces the values: a file without
  // presets means the entity has none.
  if (loadedPresets) presetsByName.set(entityName, loadedPresets);
  else presetsByName.delete(entityName);
  const existing = getEntityRecord<ParamsValues>(
    PARAMS_ENTITY_TYPE,
    entityName,
  );
  // A load replaces the whole value tree, so pre-load tombstones are stale by
  // construction: without this, re-declaring a dropped field after a load would
  // restore a value the saved file never contained.
  tombstones.delete(entityName);

  if (!existing) {
    const value = structuredClone(values) as ParamsValues;
    const record = createEntityRecord<ParamsValues>(
      PARAMS_ENTITY_TYPE,
      entityName,
      value,
      {
        meta: loadedMeta,
        updatedBy: "load",
        valueJson: safeStringifyEntityValue(value),
      },
    );
    return toParamsEntity(record);
  }

  applyLoadedValues(existing.value, values);
  existing.meta = loadedMeta;
  commitEntityWrite(existing, {
    updatedBy: "load",
    valueJson: safeStringifyEntityValue(existing.value),
  });
  markEntityFull(existing);
  return toParamsEntity(existing);
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
 * The sampler half of the tick: adopt code writes as store generations. It runs
 * on EVERY tick regardless of who is watching — "unwatched costs nothing" is a
 * transport property, and rev has to stay a monotonic generation counter
 * whether or not a pane is open. Never throws: a value that cannot be
 * serialized is flagged on its entity instead of freezing the loop.
 */
export function adoptParamsCodeWrites(): void {
  for (const record of listEntityRecords<ParamsValues>(PARAMS_ENTITY_TYPE)) {
    const serialized = serializeEntityValue(record.value);

    if (!serialized.ok) {
      if (!record.unserializable) {
        record.unserializable = true;
        markEntityFull(record);
        console.warn(
          `[params-store] "${record.name}" value is unavailable to views: ` +
            serialized.error,
        );
      }
      continue;
    }

    if (record.unserializable) {
      delete record.unserializable;
      markEntityFull(record);
      console.warn(
        `[params-store] "${record.name}" value is serializable again.`,
      );
    }

    const json = serialized.json;
    if (json === record.lastValueJson) continue;
    // Adopt the drift: plain property writes never reach the store API, so this
    // is the only place a code-authored generation can be recorded.
    commitEntityWrite(record, { updatedBy: "code", valueJson: json });
    markEntityFacetChanged(record, "values");
  }
}

/**
 * The broadcast tick: adopt code writes, then drain this type's change gate and
 * return one delivery per changed name (`entity: null` for a deleted one). Null
 * when the tick found nothing, so an idle store sends nothing at all.
 *
 * A name whose pending facets are known ships patches for just those facets;
 * anything else (creation, load, redeclaration, a serializability flip) ships
 * the whole entity. Facet values are serialized here, once per tick.
 */
export function sampleParamsChanges(): EntityChange<ParamsEntity>[] | null {
  adoptParamsCodeWrites();
  const changes = consumeEntityTypeChanges(PARAMS_ENTITY_TYPE);
  if (!changes) return null;
  const collected: EntityChange<ParamsEntity>[] = [];
  for (const name of changes.changed) {
    const record = getEntityRecord<ParamsValues>(PARAMS_ENTITY_TYPE, name);
    // Defensive: a name can only be in `changed` while its record exists.
    if (!record) continue;
    const facets = takeEntityFacets(PARAMS_ENTITY_TYPE, name);
    const patches = facets && facets !== "full"
      ? facetPatches(record, facets)
      : null;
    if (patches) collected.push({ name, patches });
    else collected.push({ name, entity: toParamsEntity(record) });
  }
  for (const name of changes.deleted) {
    takeEntityFacets(PARAMS_ENTITY_TYPE, name);
    collected.push({ name, entity: null });
  }
  return collected;
}

/** Null when a facet cannot be shipped sparsely, so the caller ships whole. */
function facetPatches(
  record: EntityRecord<ParamsValues>,
  facets: Set<string>,
): EntityPatch[] | null {
  const patches: EntityPatch[] = [];
  if (facets.has("values")) {
    const wireValue = cloneEntityValueForWire(record);
    if (!wireValue.ok) return null;
    patches.push({ op: "set", path: ["values"], value: wireValue.value });
  }
  if (facets.has("presets")) {
    const presets = presetsByName.get(record.name);
    patches.push(
      presets
        ? { op: "set", path: ["presets"], value: structuredClone(presets) }
        : { op: "delete", path: ["presets"] },
    );
  }
  if (patches.length === 0) return null;
  patches.push(
    { op: "set", path: ["rev"], value: record.rev },
    { op: "set", path: ["updatedAt"], value: record.updatedAt },
    { op: "set", path: ["updatedBy"], value: record.updatedBy },
  );
  return patches;
}

/** Test seam: drops every params entity and its tombstones. */
export function clearParamsStore(): void {
  clearEntityRecords(PARAMS_ENTITY_TYPE);
  tombstones.clear();
  presetsByName.clear();
}

function toParamsEntity(record: EntityRecord<ParamsValues>): ParamsEntity {
  const wireValue = cloneEntityValueForWire(record);
  const entity: ParamsEntity = {
    name: record.name,
    rev: record.rev,
    values: wireValue.ok ? wireValue.value : null,
    updatedAt: record.updatedAt,
    updatedBy: record.updatedBy,
  };
  const meta = record.meta as ParamsMeta | undefined;
  if (meta) entity.meta = JSON.parse(JSON.stringify(meta)) as ParamsMeta;
  if (!wireValue.ok) entity.unserializable = true;
  const presets = presetsByName.get(record.name);
  if (presets) entity.presets = structuredClone(presets);
  return entity;
}

function normalizePresetLabel(entityName: string, label: string): string {
  const normalized = label.trim();
  if (!normalized) {
    throw new Error(`Params "${entityName}" preset label must not be empty`);
  }
  return normalized;
}

function clonePresets(
  presets: Record<string, ParamsValues> | undefined,
  entityName: string,
): Record<string, ParamsValues> | undefined {
  if (presets === undefined) return undefined;
  if (!isPlainObject(presets)) {
    throw new Error(`Params "${entityName}" presets must be a plain object`);
  }
  const result: Record<string, ParamsValues> = {};
  for (const [label, values] of Object.entries(presets)) {
    const presetLabel = normalizePresetLabel(entityName, label);
    validateParamsValues(values, `${entityName} preset "${presetLabel}"`);
    result[presetLabel] = cloneParamsValues(values, entityName);
  }
  return Object.keys(result).length ? result : undefined;
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

// Depth-wise in-place replacement for a load. Same identity discipline as
// reconcileValues: a nested object that exists on both sides is mutated rather
// than rebuilt, so a module holding `params.strobe` keeps observing truth.
function applyLoadedValues(live: ParamsValues, loaded: ParamsValues): void {
  for (const key of Object.keys(loaded)) {
    const incoming = loaded[key];
    const current = live[key];

    if (isPlainObject(incoming)) {
      const target = isPlainObject(current) ? current : {};
      if (target !== current) live[key] = target;
      applyLoadedValues(target, incoming);
      continue;
    }

    live[key] = incoming;
  }

  for (const key of Object.keys(live)) {
    if (!(key in loaded)) delete live[key];
  }
}

function cloneParamsValues(
  values: ParamsValues,
  sourceName: string,
): ParamsValues {
  const serialized = serializeEntityValue(values);
  if (!serialized.ok) {
    throw new Error(
      `Cannot duplicate params "${sourceName}": ${serialized.error}`,
    );
  }
  return JSON.parse(serialized.json) as ParamsValues;
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

function cloneParamsMeta(
  meta: ParamsMeta | undefined,
  entityName: string,
): ParamsMeta | undefined {
  if (meta === undefined) return undefined;
  const serialized = serializeEntityValue(meta);
  if (!serialized.ok) {
    throw new Error(
      `canvasParams("${entityName}"): meta is not serializable: ${serialized.error}`,
    );
  }
  return JSON.parse(serialized.json) as ParamsMeta;
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
