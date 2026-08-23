export interface EntityRecord<V = unknown> {
  readonly type: string;
  readonly name: string;
  rev: number;
  /**
   * The live value object. Type wrappers may hand this exact reference to user
   * code, so it must be mutated in place and never rebuilt.
   */
  value: V;
  meta?: unknown;
  updatedAt: number;
  updatedBy: string;
  /** True while the live value cannot be represented on the JSON wire. */
  unserializable?: boolean;
  /** Cached JSON of the last serializable observed value, for no-op detection. */
  lastValueJson: string | null;
}

interface EntityTypeStore {
  records: Map<string, EntityRecord>;
  /**
   * Names touched since the last collect. Resolved against `records` at
   * collect time, so a name created and deleted inside one tick reports as a
   * deletion and one deleted then recreated reports as a change.
   */
  dirtyNames: Set<string>;
  snapshotSeq: number;
  /**
   * Highest rev ever reached by a now-deleted name. A recreated or re-loaded
   * entity starts above it so revs stay monotonic per name across
   * delete/recreate: a pane whose `localRev` outlived the old record can never
   * silently echo-suppress the new one.
   */
  revFloors: Map<string, number>;
}

/**
 * One entity's delivery on the sync transport: the whole entity, or `null`
 * when it was deleted. Type wrappers return arrays of these from their tick.
 */
export interface EntityChange<E> {
  name: string;
  entity: E | null;
}

/** One tick's worth of per-name changes for one entity type. */
export interface EntityChangeSet {
  /** Names whose record exists and changed; sorted for stable delivery. */
  changed: string[];
  /** Names whose record is gone; sorted. */
  deleted: string[];
}

export type EntitySerializationResult =
  | { ok: true; json: string }
  | { ok: false; error: string };

export type EntityWireValue<V> =
  | { ok: true; value: V }
  | { ok: false; error: string };

const stores = new Map<string, EntityTypeStore>();

export function normalizeEntityName(type: string, name: string): string {
  const normalized = name.trim();
  if (!normalized) throw new Error(`${type} entity name must not be empty`);
  return normalized;
}

export function getEntityRecord<V>(
  type: string,
  name: string,
): EntityRecord<V> | undefined {
  return storeFor(type).records.get(name.trim()) as
    | EntityRecord<V>
    | undefined;
}

/** Live records of one type, sorted by name for stable snapshot ordering. */
export function listEntityRecords<V>(type: string): EntityRecord<V>[] {
  return [...storeFor(type).records.values()]
    .sort((a, b) => a.name.localeCompare(b.name)) as EntityRecord<V>[];
}

export function createEntityRecord<V>(
  type: string,
  name: string,
  value: V,
  options: { meta?: unknown; updatedBy?: string; valueJson?: string | null } =
    {},
): EntityRecord<V> {
  const store = storeFor(type);
  const record: EntityRecord<V> = {
    type,
    name,
    rev: (store.revFloors.get(name) ?? 0) + 1,
    value,
    meta: options.meta,
    updatedAt: Date.now(),
    updatedBy: options.updatedBy ?? "server",
    lastValueJson: options.valueJson ??
      safeStringifyEntityValue(value),
  };
  store.records.set(name, record as EntityRecord);
  store.dirtyNames.add(name);
  return record;
}

export function deleteEntityRecord(type: string, name: string): boolean {
  const store = storeFor(type);
  const key = name.trim();
  const record = store.records.get(key);
  const removed = store.records.delete(key);
  if (removed) {
    if (record) {
      store.revFloors.set(
        key,
        Math.max(record.rev, store.revFloors.get(key) ?? 0),
      );
    }
    // A deletion is invisible to any serialize-compare, so it only reaches
    // watchers because the name is recorded here.
    store.dirtyNames.add(key);
  }
  return removed;
}

/** Test seam: a full reset of one type, rev floors included. */
export function clearEntityRecords(type: string): void {
  const store = storeFor(type);
  for (const name of store.records.keys()) store.dirtyNames.add(name);
  store.records.clear();
  store.revFloors.clear();
}

/**
 * Record one applied generation of a value: bump `rev`, refresh the no-op
 * cache, and record the name so the next broadcast tick ships it.
 */
export function commitEntityWrite(
  record: EntityRecord,
  options: { updatedBy: string; valueJson?: string | null },
): void {
  record.rev += 1;
  record.updatedAt = Date.now();
  record.updatedBy = options.updatedBy;
  record.lastValueJson = options.valueJson === undefined
    ? safeStringifyEntityValue(record.value)
    : options.valueJson;
  storeFor(record.type).dirtyNames.add(record.name);
}

export function isEntityRevConflict(
  record: EntityRecord,
  expectedRev: number | undefined,
): boolean {
  return expectedRev !== undefined && record.rev !== expectedRev;
}

/**
 * Record a change that is not a value generation — a meta replacement, a
 * signal's `ended`/anchor/owner flip, an `unserializable` transition. These
 * never bump `rev`, so nothing but this call can make them reach a watcher.
 */
export function markEntityRecordChanged(record: EntityRecord): void {
  storeFor(record.type).dirtyNames.add(record.name);
}

export function markEntityChanged(type: string, name: string): void {
  storeFor(type).dirtyNames.add(name.trim());
}

/** Drains one entity type's change gate; snapshots never call this. */
export function consumeEntityTypeChanges(
  type: string,
): EntityChangeSet | null {
  const store = storeFor(type);
  if (store.dirtyNames.size === 0) return null;
  const changed: string[] = [];
  const deleted: string[] = [];
  for (const name of store.dirtyNames) {
    if (store.records.has(name)) changed.push(name);
    else deleted.push(name);
  }
  store.dirtyNames.clear();
  changed.sort((a, b) => a.localeCompare(b));
  deleted.sort((a, b) => a.localeCompare(b));
  return { changed, deleted };
}

export function nextEntitySnapshotSeq(type: string): number {
  const store = storeFor(type);
  store.snapshotSeq += 1;
  return store.snapshotSeq;
}

export function serializeEntityValue(
  value: unknown,
): EntitySerializationResult {
  try {
    validateJsonValue(value, "$", new Set());
    const json = JSON.stringify(value);
    return json === undefined
      ? { ok: false, error: "value is undefined" }
      : { ok: true, json };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function safeStringifyEntityValue(value: unknown): string | null {
  const serialized = serializeEntityValue(value);
  return serialized.ok ? serialized.json : null;
}

export function cloneEntityValueForWire<V>(
  record: EntityRecord<V>,
): EntityWireValue<V> {
  const serialized = serializeEntityValue(record.value);
  return serialized.ok
    ? { ok: true, value: JSON.parse(serialized.json) as V }
    : serialized;
}

function validateJsonValue(
  value: unknown,
  path: string,
  ancestors: Set<object>,
): void {
  if (
    value === null || typeof value === "string" || typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${path} is not a finite number`);
    }
    return;
  }
  if (typeof value !== "object") {
    throw new Error(`${path} has unsupported type ${typeof value}`);
  }
  if (ancestors.has(value)) {
    throw new Error(`${path} contains a circular reference`);
  }

  const prototype = Object.getPrototypeOf(value);
  if (
    !Array.isArray(value) && prototype !== Object.prototype &&
    prototype !== null
  ) {
    throw new Error(`${path} is not a plain JSON object`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new Error(`${path} has symbol-keyed data`);
  }

  ancestors.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) throw new Error(`${path}[${index}] is missing`);
      validateJsonValue(value[index], `${path}[${index}]`, ancestors);
    }
  } else {
    for (const [key, child] of Object.entries(value)) {
      validateJsonValue(child, `${path}.${key}`, ancestors);
    }
  }
  ancestors.delete(value);
}

function storeFor(type: string): EntityTypeStore {
  const existing = stores.get(type);
  if (existing) return existing;
  const created: EntityTypeStore = {
    records: new Map(),
    dirtyNames: new Set(),
    snapshotSeq: 0,
    revFloors: new Map(),
  };
  stores.set(type, created);
  return created;
}
