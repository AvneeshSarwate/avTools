// Generic (type, name)-keyed entity records. This is the minimal shared seam
// under typed entity stores: it owns identity, revisions, no-op caching,
// dirty/seq bookkeeping and never-throw serialization, while per-type
// semantics (validation, reconcile, wire shape) live in the type wrapper next
// to it — `params_store.ts` today. `piano_roll_store.ts` is deliberately NOT
// migrated onto this layer yet.
//
// Every write here must be safe to call from caller-owned livecode timing, so
// nothing below throws except name normalization (used at registration time).

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
  /** True while the live value cannot be serialized (cycle/BigInt from code). */
  unserializable?: boolean;
  /**
   * Cached JSON of the last observed `value`. Lets a write or a sampler tick
   * decide with one serialize + string compare. Empty string when the value was
   * not serializable — it can never match a real serialization, so no-op
   * detection is simply disabled.
   */
  lastValueJson: string;
}

interface EntityTypeStore {
  records: Map<string, EntityRecord>;
  dirty: boolean;
  snapshotSeq: number;
  /**
   * Highest rev ever reached by a now-deleted name. A recreated or re-loaded
   * entity starts above it so revs stay monotonic per name across
   * delete/recreate: a pane whose `localRev` outlived the old record can never
   * silently echo-suppress the new one.
   */
  revFloors: Map<string, number>;
}

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
      safeStringifyEntityValue(value) ?? "",
  };
  store.records.set(name, record as EntityRecord);
  store.dirty = true;
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
    store.dirty = true;
  }
  return removed;
}

/** Test seam: a full reset of one type, rev floors included. */
export function clearEntityRecords(type: string): void {
  const store = storeFor(type);
  store.records.clear();
  store.revFloors.clear();
  store.dirty = true;
}

/**
 * Record one applied generation of a value: bump `rev`, refresh the no-op
 * cache, and mark the type dirty so the next sampler tick broadcasts.
 */
export function commitEntityWrite(
  record: EntityRecord,
  options: { updatedBy: string; valueJson?: string | null },
): void {
  record.rev += 1;
  record.updatedAt = Date.now();
  record.updatedBy = options.updatedBy;
  record.lastValueJson = options.valueJson === undefined
    ? safeStringifyEntityValue(record.value) ?? ""
    : options.valueJson ?? "";
  storeFor(record.type).dirty = true;
}

export function isEntityRevConflict(
  record: EntityRecord,
  expectedRev: number | undefined,
): boolean {
  return expectedRev !== undefined && record.rev !== expectedRev;
}

export function markEntityTypeDirty(type: string): void {
  storeFor(type).dirty = true;
}

/** Reads and clears the broadcast gate for one type. */
export function consumeEntityTypeDirty(type: string): boolean {
  const store = storeFor(type);
  const dirty = store.dirty;
  store.dirty = false;
  return dirty;
}

export function nextEntitySnapshotSeq(type: string): number {
  const store = storeFor(type);
  store.snapshotSeq += 1;
  return store.snapshotSeq;
}

/** JSON.stringify that returns null instead of throwing (cycles, BigInt). */
export function safeStringifyEntityValue(value: unknown): string | null {
  try {
    return JSON.stringify(value) ?? null;
  } catch {
    return null;
  }
}

/**
 * Point-in-time, JSON-safe clone of a record's current value for an HTTP/WS
 * payload. Prefers a fresh round trip of the live value (so a forced snapshot
 * is current without adopting anything), and falls back to the last
 * successfully serialized value when code has since written something that
 * cannot be serialized. Never throws and never mutates the record.
 */
export function cloneEntityValueForWire<V>(record: EntityRecord<V>): V | null {
  try {
    const json = JSON.stringify(record.value);
    if (json !== undefined) return JSON.parse(json) as V;
  } catch {
    // Cyclic or BigInt-bearing value written by user code; fall through.
  }
  try {
    if (record.lastValueJson) return JSON.parse(record.lastValueJson) as V;
  } catch {
    // Cache was written by this module, so this should be unreachable.
  }
  return null;
}

function storeFor(type: string): EntityTypeStore {
  const existing = stores.get(type);
  if (existing) return existing;
  const created: EntityTypeStore = {
    records: new Map(),
    dirty: true,
    snapshotSeq: 0,
    revFloors: new Map(),
  };
  stores.set(type, created);
  return created;
}
