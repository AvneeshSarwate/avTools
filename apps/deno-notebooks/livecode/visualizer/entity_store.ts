// Generic (type, name)-keyed entity records. This is the minimal shared seam
// under typed entity stores: it owns identity, revisions, no-op caching,
// change/seq bookkeeping and never-throw serialization, while per-type
// semantics (validation, reconcile, wire shape) live in the type wrapper next
// to it — `params_store.ts`, `signals_store.ts` and `piano_roll_store.ts`.
//
// The broadcast gate is a per-type set of CHANGED NAMES rather than one
// boolean, because the sync transport ships per entity: a serialize-compare
// over live values cannot see a deletion or a signal's `ended` flip, so every
// mutator — value writes, meta writes, ended/anchor/owner flips, deletes —
// records the name it touched and exactly one consumer drains the set per tick.
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
    ? safeStringifyEntityValue(record.value) ?? ""
    : options.valueJson ?? "";
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

/** Same, addressed by name — for callers that do not hold the record. */
export function markEntityChanged(type: string, name: string): void {
  storeFor(type).dirtyNames.add(name.trim());
}

/**
 * Drains the broadcast gate for one type: the ONE consumer per tick. Returns
 * null when nothing changed, so an idle type costs a set-size check. Forced
 * snapshots (`/…/list`, socket open, a subscribe reset) never come through
 * here — they must not swallow a generation other watchers are still owed.
 */
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

/** Read-only: whether a tick would find anything to ship. */
export function hasPendingEntityChanges(type: string): boolean {
  return storeFor(type).dirtyNames.size > 0;
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
    dirtyNames: new Set(),
    snapshotSeq: 0,
    revFloors: new Map(),
  };
  stores.set(type, created);
  return created;
}
