// Ephemeral signals: the second typed wrapper over `entity_store.ts`, and the
// first entity type that is deliberately NOT registered in
// `entity_registry.ts`. That single omission is the whole ephemeral class:
// `/project/save`, `/project/status` data rows, project open, and `/entities/*`
// all iterate `listDurableEntityTypes()`, so signals are invisible to
// persistence by construction rather than by a filter someone has to remember.
//
// Three properties drive the design:
//
//   1. `declareSignal` hands out a handle closed over the record. `set` is a
//      PURE field assignment — no dirty flag, no serialization, no store call —
//      so publishing an unwatched signal costs the same as a property write.
//      `sampleSignalsSnapshot` discovers changes by serialize-compare per tick,
//      exactly like the params sampler.
//   2. Ending is sticky. A run ends its signals, and later writes keep landing
//      in `value` while `ended` stays set until the name is redeclared. A
//      moving-but-ended signal is a surfaced finding, not something to police
//      inside caller-owned timing.
//   3. Nothing reachable from user timing (`set`, `end`, ownership stamping,
//      the sampler) throws.

import {
  clearEntityRecords,
  commitEntityWrite,
  consumeEntityTypeDirty,
  createEntityRecord,
  type EntityRecord,
  getEntityRecord,
  listEntityRecords,
  markEntityTypeDirty,
  nextEntitySnapshotSeq,
  normalizeEntityName,
  safeStringifyEntityValue,
} from "./entity_store.ts";
import { sampleRootTime } from "./runtime.ts";
import type {
  SignalAnchor,
  SignalEntity,
  SignalsSnapshot,
} from "./protocol.ts";

export const SIGNAL_ENTITY_TYPE = "signal";

export interface DeclareSignalOptions {
  anchor?: SignalAnchor;
}

/**
 * What `signal(name)` hands back. `set` and `end` are closures over the record,
 * so publishing never costs a store lookup.
 */
export interface SignalHandle<T = unknown> {
  readonly name: string;
  set(value: T): void;
  end(): void;
}

/**
 * Per-record state that is signal-specific rather than generic entity state.
 * Stored in `EntityRecord.meta`, which the generic store treats as opaque.
 */
interface SignalRecordMeta {
  anchor?: SignalAnchor;
  ownerModuleId?: string;
  ended?: boolean;
  timeSec?: number;
  beats?: number;
}

/**
 * Create-or-reattach. A redeclared name keeps its record (so a handle another
 * module still holds keeps writing to live truth), clears `ended`, and takes
 * the new anchor. Throws only on an empty name.
 */
export function declareSignal<T = unknown>(
  name: string,
  options: DeclareSignalOptions = {},
): SignalHandle<T> {
  const entityName = normalizeEntityName(SIGNAL_ENTITY_TYPE, name);
  const existing = getEntityRecord<unknown>(SIGNAL_ENTITY_TYPE, entityName);
  if (existing) {
    const meta = signalMeta(existing);
    // Redeclaring is how an ended name comes back to life, and how a second run
    // rebinds it: both are value-free changes, so the type is marked dirty
    // without bumping rev (rev counts observed value generations).
    meta.anchor = options.anchor;
    delete meta.ended;
    markEntityTypeDirty(SIGNAL_ENTITY_TYPE);
    return makeSignalHandle<T>(existing);
  }

  const meta: SignalRecordMeta = { anchor: options.anchor };
  // `null` rather than `undefined`: an undefined value does not serialize, and
  // a freshly declared signal is not an unserializable one.
  const record = createEntityRecord<unknown>(
    SIGNAL_ENTITY_TYPE,
    entityName,
    null,
    { meta, updatedBy: "declare", valueJson: "null" },
  );
  return makeSignalHandle<T>(record);
}

/**
 * Mark one signal ended. Idempotent; false when the name is unknown. Never
 * throws: cleanup paths and user code both reach this.
 */
export function endSignal(name: string): boolean {
  const record = getEntityRecord<unknown>(SIGNAL_ENTITY_TYPE, name.trim());
  if (!record) return false;
  return endSignalRecord(record);
}

/**
 * Attribute a signal to the module whose run declared it, which is what lets
 * `endSignalsForModule` end it later. Called by the analyzer-injected
 * `__tcvOwnedSignal` wrapper, so it must never throw.
 */
export function assignSignalOwner(name: string, moduleId: string): boolean {
  const record = getEntityRecord<unknown>(SIGNAL_ENTITY_TYPE, name.trim());
  if (!record) return false;
  const meta = signalMeta(record);
  if (meta.ownerModuleId === moduleId) return true;
  meta.ownerModuleId = moduleId;
  markEntityTypeDirty(SIGNAL_ENTITY_TYPE);
  return true;
}

/**
 * End every signal owned by one module. Called from the same lifecycle sites as
 * `clearModuleWaits`, so a graceful stop, a panic, and a module terminating on
 * its own all end their signals rather than leaving them silently frozen.
 * Returns how many records changed.
 */
export function endSignalsForModule(moduleId: string): number {
  let ended = 0;
  for (const record of listEntityRecords<unknown>(SIGNAL_ENTITY_TYPE)) {
    if (signalMeta(record).ownerModuleId !== moduleId) continue;
    if (endSignalRecord(record)) ended += 1;
  }
  return ended;
}

/** Point-in-time clones of every live signal, sorted by name. */
export function listSignals(): SignalEntity[] {
  return listEntityRecords<unknown>(SIGNAL_ENTITY_TYPE).map(toSignalEntity);
}

/**
 * Read-only point-in-time snapshot for `/signals/list` and socket open. Like
 * its params counterpart it must not touch the broadcast gate or the per-record
 * caches, or one client connecting would consume the pending update for the
 * others.
 */
export function makeSignalsSnapshot(): SignalsSnapshot {
  return {
    type: "signalsSnapshot",
    seq: nextEntitySnapshotSeq(SIGNAL_ENTITY_TYPE),
    timestampMs: Date.now(),
    signals: Object.fromEntries(
      listSignals().map((entity) => [entity.name, entity]),
    ),
  };
}

/**
 * The broadcast tick: adopt code writes as store generations and stamp them
 * with root-clock logical time, then return a snapshot when anything changed.
 * `set` is a plain assignment, so this serialize-compare is the only place a
 * published value becomes an observed generation. Never throws.
 */
export function sampleSignalsSnapshot(): SignalsSnapshot | null {
  for (const record of listEntityRecords<unknown>(SIGNAL_ENTITY_TYPE)) {
    const json = safeStringifyEntityValue(record.value);

    if (json === null) {
      if (!record.unserializable) {
        record.unserializable = true;
        markEntityTypeDirty(SIGNAL_ENTITY_TYPE);
        console.warn(
          `[signals-store] "${record.name}" value can no longer be serialized ` +
            "(cycle, BigInt, or undefined published by code); snapshots keep " +
            "the last good value and flag the signal.",
        );
      }
      continue;
    }

    if (record.unserializable) {
      record.unserializable = false;
      markEntityTypeDirty(SIGNAL_ENTITY_TYPE);
      console.warn(
        `[signals-store] "${record.name}" value is serializable again.`,
      );
    }

    if (json === record.lastValueJson) continue;
    stampLogicalTime(record);
    commitEntityWrite(record, { updatedBy: "code", valueJson: json });
  }

  if (!consumeEntityTypeDirty(SIGNAL_ENTITY_TYPE)) return null;
  return makeSignalsSnapshot();
}

/** Test seam: drops every signal. */
export function clearSignalsStore(): void {
  clearEntityRecords(SIGNAL_ENTITY_TYPE);
}

function makeSignalHandle<T>(record: EntityRecord<unknown>): SignalHandle<T> {
  return {
    name: record.name,
    // Deliberately a bare field assignment: no dirty flag, no serialization.
    // A dirty flag here would broadcast byte-identical snapshots under a loop
    // that re-sets the same value, and would make an unwatched signal cost
    // more than a watched one.
    set(value: T) {
      record.value = value;
    },
    end() {
      endSignalRecord(record);
    },
  };
}

function endSignalRecord(record: EntityRecord<unknown>): boolean {
  const meta = signalMeta(record);
  if (meta.ended) return false;
  meta.ended = true;
  markEntityTypeDirty(SIGNAL_ENTITY_TYPE);
  return true;
}

/**
 * Stamp the logical time at which the sampler adopted a value. Quantized twice
 * over — by the ~30 ms parent loop and by the 100 ms sampler — so it orders
 * samples musically rather than measuring them. Omitted entirely when no root
 * context is registered (a plain `deno run` of a module, or before launch).
 */
function stampLogicalTime(record: EntityRecord<unknown>): void {
  const sample = sampleRootTime();
  if (!sample) return;
  const meta = signalMeta(record);
  meta.timeSec = sample.timeSec;
  meta.beats = sample.beats;
}

function signalMeta(record: EntityRecord<unknown>): SignalRecordMeta {
  const existing = record.meta as SignalRecordMeta | undefined;
  if (existing) return existing;
  const created: SignalRecordMeta = {};
  record.meta = created;
  return created;
}

function toSignalEntity(record: EntityRecord<unknown>): SignalEntity {
  const meta = signalMeta(record);
  const entity: SignalEntity = {
    name: record.name,
    value: cloneSignalValueForWire(record),
    rev: record.rev,
    updatedAt: record.updatedAt,
    updatedBy: record.updatedBy,
  };
  if (meta.anchor) entity.anchor = cloneAnchor(meta.anchor);
  if (meta.ownerModuleId) entity.ownerModuleId = meta.ownerModuleId;
  if (meta.ended) entity.ended = true;
  if (record.unserializable) entity.unserializable = true;
  if (meta.timeSec !== undefined) entity.timeSec = meta.timeSec;
  if (meta.beats !== undefined) entity.beats = meta.beats;
  return entity;
}

/**
 * A signal's value is user-shaped, so unlike a params tree it can legitimately
 * be a bare number or string. `cloneEntityValueForWire` is object-shaped in
 * spirit but works for any JSON value; this wrapper only exists to keep the
 * "last good value" fallback and the never-throw contract explicit.
 */
function cloneSignalValueForWire(record: EntityRecord<unknown>): unknown {
  try {
    const json = JSON.stringify(record.value);
    if (json !== undefined) return JSON.parse(json);
  } catch {
    // Cyclic or BigInt-bearing value published by user code; fall through.
  }
  try {
    if (record.lastValueJson) return JSON.parse(record.lastValueJson);
  } catch {
    // The cache is written by this module, so this should be unreachable.
  }
  return null;
}

function cloneAnchor(anchor: SignalAnchor): SignalAnchor {
  const clone: SignalAnchor = { type: anchor.type, name: anchor.name };
  // Guarded rather than truthy-checked: the anchor comes from user code and
  // this runs inside the never-throw sampler path.
  if (Array.isArray(anchor.path)) clone.path = [...anchor.path];
  return clone;
}
