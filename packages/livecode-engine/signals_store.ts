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
//      `adoptSignalCodeWrites` discovers changes by serialize-compare per tick,
//      exactly like the params sampler.
//   2. Ending is sticky. A run ends its signals, and later writes keep landing
//      in `value` while `ended` stays set until the name is redeclared. A
//      moving-but-ended signal is a surfaced finding, not something to police
//      inside caller-owned timing.
//   3. Nothing reachable from user timing (`set`, anchor changes, `end`,
//      ownership stamping, the sampler) throws.

import {
  clearEntityRecords,
  cloneEntityValueForWire,
  commitEntityWrite,
  consumeEntityTypeChanges,
  createEntityRecord,
  type EntityChange,
  type EntityRecord,
  getEntityRecord,
  listEntityRecords,
  markEntityRecordChanged,
  nextEntitySnapshotSeq,
  normalizeEntityName,
  serializeEntityValue,
} from "./entity_store.ts";
import { sampleRootTime } from "./runtime.ts";
import type {
  SignalAnchor,
  SignalEntity,
  SignalsSnapshot,
} from "@avtools/livecode-protocol";

export const SIGNAL_ENTITY_TYPE = "signal";

/**
 * What `signal(name)` hands back. Its methods close over the record, so
 * publishing never costs a store lookup.
 */
export interface SignalHandle<T = unknown> {
  readonly name: string;
  set(value: T): void;
  addAnchor(anchor: SignalAnchor): void;
  removeAnchor(anchor: SignalAnchor): void;
  end(): void;
}

/**
 * Per-record state that is signal-specific rather than generic entity state.
 * Stored in `EntityRecord.meta`, which the generic store treats as opaque.
 */
interface SignalRecordMeta {
  anchors: SignalAnchor[];
  ownerModuleId?: string;
  ended?: boolean;
  timeSec?: number;
  beats?: number;
}

/**
 * Create-or-reattach. A redeclared name keeps its record and value, clears its
 * prior run's anchors and `ended` state, and starts a new anchor set.
 */
export function declareSignal<T = unknown>(
  name: string,
): SignalHandle<T> {
  const entityName = normalizeEntityName(SIGNAL_ENTITY_TYPE, name);
  const existing = getEntityRecord<unknown>(SIGNAL_ENTITY_TYPE, entityName);
  if (existing) {
    const meta = signalMeta(existing);
    meta.anchors = [];
    delete meta.ended;
    markEntityRecordChanged(existing);
    return makeSignalHandle<T>(existing);
  }

  const meta: SignalRecordMeta = { anchors: [] };
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
  markEntityRecordChanged(record);
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
 * The sampler half of the tick: adopt code writes as store generations and
 * stamp them with root-clock logical time. `set` is a plain assignment, so this
 * serialize-compare is the only place a published value becomes an observed
 * generation — which is why it runs on EVERY tick whether or not anything is
 * subscribed. Never throws.
 */
export function adoptSignalCodeWrites(): void {
  for (const record of listEntityRecords<unknown>(SIGNAL_ENTITY_TYPE)) {
    const serialized = serializeEntityValue(record.value);

    if (!serialized.ok) {
      if (!record.unserializable) {
        record.unserializable = true;
        markEntityRecordChanged(record);
        console.warn(
          `[signals-store] "${record.name}" value is unavailable to views: ` +
            serialized.error,
        );
      }
      continue;
    }

    if (record.unserializable) {
      delete record.unserializable;
      markEntityRecordChanged(record);
      console.warn(
        `[signals-store] "${record.name}" value is serializable again.`,
      );
    }

    if (serialized.json === record.lastValueJson) continue;
    stampLogicalTime(record);
    commitEntityWrite(record, {
      updatedBy: "code",
      valueJson: serialized.json,
    });
  }
}

/**
 * The broadcast tick: adopt code writes, then drain this type's change gate and
 * return one record per changed name (`entity: null` for a deleted one — how a
 * scope learns its source is gone rather than silently freezing). Null when the
 * tick found nothing.
 */
export function sampleSignalChanges(): EntityChange<SignalEntity>[] | null {
  adoptSignalCodeWrites();
  const changes = consumeEntityTypeChanges(SIGNAL_ENTITY_TYPE);
  if (!changes) return null;
  const collected: EntityChange<SignalEntity>[] = [];
  for (const name of changes.changed) {
    const record = getEntityRecord<unknown>(SIGNAL_ENTITY_TYPE, name);
    if (record) collected.push({ name, entity: toSignalEntity(record) });
  }
  for (const name of changes.deleted) collected.push({ name, entity: null });
  return collected;
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
    addAnchor(anchor) {
      const meta = signalMeta(record);
      if (meta.anchors.some((existing) => anchorsEqual(existing, anchor))) {
        return;
      }
      meta.anchors.push(cloneAnchor(anchor));
      markEntityRecordChanged(record);
    },
    removeAnchor(anchor) {
      const meta = signalMeta(record);
      const index = meta.anchors.findIndex((existing) =>
        anchorsEqual(existing, anchor)
      );
      if (index === -1) return;
      meta.anchors.splice(index, 1);
      markEntityRecordChanged(record);
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
  markEntityRecordChanged(record);
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
  const created: SignalRecordMeta = { anchors: [] };
  record.meta = created;
  return created;
}

function toSignalEntity(record: EntityRecord<unknown>): SignalEntity {
  const meta = signalMeta(record);
  const wireValue = cloneEntityValueForWire(record);
  const entity: SignalEntity = {
    name: record.name,
    value: wireValue.ok ? wireValue.value : null,
    anchors: meta.anchors.map(cloneAnchor),
    rev: record.rev,
    updatedAt: record.updatedAt,
    updatedBy: record.updatedBy,
  };
  if (meta.ownerModuleId) entity.ownerModuleId = meta.ownerModuleId;
  if (meta.ended) entity.ended = true;
  if (!wireValue.ok) entity.unserializable = true;
  if (meta.timeSec !== undefined) entity.timeSec = meta.timeSec;
  if (meta.beats !== undefined) entity.beats = meta.beats;
  return entity;
}

function cloneAnchor(anchor: SignalAnchor): SignalAnchor {
  const clone: SignalAnchor = { type: anchor.type, name: anchor.name };
  if (Array.isArray(anchor.path)) clone.path = [...anchor.path];
  return clone;
}

function anchorsEqual(a: SignalAnchor, b: SignalAnchor): boolean {
  if (a.type !== b.type || a.name !== b.name) return false;
  const aPath = a.path ?? [];
  const bPath = b.path ?? [];
  return aPath.length === bPath.length &&
    aPath.every((part, index) => part === bPath[index]);
}
