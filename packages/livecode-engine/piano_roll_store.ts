// Piano rolls: the third typed wrapper over `entity_store.ts`, and the only
// durable one whose value is written exclusively through this module's own API
// (no live object is handed to user code, so there is no code drift to adopt).
//
// That is why its sync source is pure WRITE-TIME change tracking: every entry
// point below records the name it touched, and an idle store costs one set-size
// check rather than a per-tick serialize of every note array.
//
// What survives from the pre-migration engine, because each earns its keep:
// per-roll undo/redo stacks (now a side structure, dropped with the entity),
// compare-and-set via `expectedRev`, history labels, the never-throw clone
// discipline for user-supplied metadata, and the demo-seed semantics that keep
// an untouched `melody` out of project saves.

import {
  clearEntityRecords,
  commitEntityWrite,
  consumeEntityTypeChanges,
  createEntityRecord,
  deleteEntityRecord,
  type EntityChange,
  type EntityRecord,
  getEntityRecord,
  isEntityRevConflict,
  listEntityRecords,
  markEntityChanged,
  nextEntitySnapshotSeq,
  safeStringifyEntityValue,
} from "./entity_store.ts";
import type {
  MpePitchPoint,
  NoteData,
  NoteDataInput,
  PianoRollData,
  PianoRollObject,
  PianoRollSnapshot,
  PianoRollUpdateSource,
} from "@avtools/livecode-protocol";

export const PIANO_ROLL_ENTITY_TYPE = "pianoRoll";

interface HistoryEntry {
  label: string;
  data: PianoRollData;
  source: PianoRollUpdateSource;
  timestampMs: number;
}

interface RollHistory {
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
}

export interface SetPianoRollOptions {
  label?: string;
  source?: PianoRollUpdateSource;
  originId?: string;
  undoable?: boolean;
  expectedRev?: number;
}

const DEFAULT_ROLL_NAME = "melody";
/** `updatedBy` of an untouched demo seed; project save skips such a roll. */
export const DEMO_SEED_ORIGIN = "demo-seed";
const MAX_HISTORY = 100;
// Editing history, keyed by entity name. Deliberately NOT part of the entity:
// it is never serialized, and it is dropped when the entity is deleted so a
// recreated name cannot undo into a state it never held.
const histories = new Map<string, RollHistory>();
// Names an operator explicitly deleted. Seeding is an explicit server-startup
// action, but this still has to be remembered so a restart-era re-seed (or a
// second server object in one isolate) cannot resurrect a deleted default.
const deletedDefaults = new Set<string>();

export function listPianoRollNames(): string[] {
  return records().map((record) => record.name);
}

export function getPianoRoll(name: string): PianoRollObject | undefined {
  const record = recordFor(name);
  return record ? toObject(record) : undefined;
}

/** Existence without the deep clone `getPianoRoll` owes its callers. */
export function pianoRollExists(name: string): boolean {
  return recordFor(name) !== undefined;
}

/**
 * Point-in-time clones of every roll, sorted by name. Read-only: this is what a
 * `/sync` subscribe reset is built from, so it must not consume the gate.
 */
export function listPianoRollObjects(): PianoRollObject[] {
  return records().map(toObject);
}

export function setPianoRoll(
  name: string,
  data: PianoRollData,
  options: SetPianoRollOptions = {},
): PianoRollObject {
  const entityName = normalizeName(name);
  // Shape (assign note ids, default velocity) WITHOUT cloning, then serialize
  // once for the no-op compare. The expensive never-throw clone only happens
  // when the write actually proceeds.
  const shaped = shapeData(data);
  const shapedJson = safeStringifyEntityValue(shaped);
  const existing = getEntityRecord<PianoRollData>(
    PIANO_ROLL_ENTITY_TYPE,
    entityName,
  );
  const source = options.source ?? "server";
  const undoable = options.undoable ?? true;

  if (existing) {
    if (isEntityRevConflict(existing, options.expectedRev)) {
      return { ...toObject(existing), conflict: true };
    }

    if (shapedJson !== null && existing.lastValueJson === shapedJson) {
      return toObject(existing);
    }

    const nextData = cloneShapedData(shaped, entityName);

    if (undoable) {
      const history = historyFor(entityName);
      pushHistory(history.undoStack, {
        label: options.label ?? "Set piano roll",
        data: cloneRollData(existing.value),
        source,
        timestampMs: Date.now(),
      });
      history.redoStack = [];
    }

    existing.value = nextData;
    commitEntityWrite(existing, {
      updatedBy: options.originId ?? source,
      valueJson: shapedJson,
    });
    return toObject(existing);
  }

  // Roll writes are upserts, unlike `/params/set`: module write-back through
  // `setPianoRollClip` must not need a prior `/entities/create`.
  const record = createEntityRecord<PianoRollData>(
    PIANO_ROLL_ENTITY_TYPE,
    entityName,
    cloneShapedData(shaped, entityName),
    { updatedBy: options.originId ?? source, valueJson: shapedJson },
  );
  return toObject(record);
}

export function undoPianoRoll(
  name: string,
  options: { originId?: string } = {},
): PianoRollObject | undefined {
  const record = recordFor(name);
  if (!record) return undefined;
  const previous = histories.get(record.name)?.undoStack.pop();
  if (!previous) return toObject(record);

  const history = historyFor(record.name);
  pushHistory(history.redoStack, {
    label: "Redo piano roll",
    data: cloneRollData(record.value),
    source: "undoRedo",
    timestampMs: Date.now(),
  });
  applyHistoryEntry(record, previous, options.originId ?? "undo");
  return toObject(record);
}

export function redoPianoRoll(
  name: string,
  options: { originId?: string } = {},
): PianoRollObject | undefined {
  const record = recordFor(name);
  if (!record) return undefined;
  const next = histories.get(record.name)?.redoStack.pop();
  if (!next) return toObject(record);

  const history = historyFor(record.name);
  pushHistory(history.undoStack, {
    label: "Undo piano roll",
    data: cloneRollData(record.value),
    source: "undoRedo",
    timestampMs: Date.now(),
  });
  applyHistoryEntry(record, next, options.originId ?? "redo");
  return toObject(record);
}

/**
 * Explicit operator deletion. A deleted name is remembered so a later demo
 * seeding pass cannot bring it back, and its editing history goes with it:
 * a recreated roll starts with no inherited undo stack.
 */
export function deletePianoRoll(name: string): boolean {
  const entityName = normalizeName(name);
  deletedDefaults.add(entityName);
  histories.delete(entityName);
  return deleteEntityRecord(PIANO_ROLL_ENTITY_TYPE, entityName);
}

/**
 * Cached JSON of the last data written to one roll, for save/dirty compares.
 * Empty string when that data was not serializable; undefined roll gives null.
 */
export function latestPianoRollJson(name: string): string | null {
  const record = recordFor(name);
  return record ? record.lastValueJson : null;
}

/**
 * Drop one roll's undo/redo history. Loading a project adopts disk truth, so
 * the pre-load stacks would undo into a state the file never contained.
 */
export function clearPianoRollHistory(name: string): void {
  const record = recordFor(name);
  if (!record) return;
  histories.delete(record.name);
  // `canUndo`/`canRedo` are part of the wire object, so this is a real change
  // even though no note moved.
  markEntityChanged(PIANO_ROLL_ENTITY_TYPE, record.name);
}

/** Test seam: drops every roll, its history, and the remembered deletions. */
export function clearPianoRollStore(): void {
  clearEntityRecords(PIANO_ROLL_ENTITY_TYPE);
  histories.clear();
  deletedDefaults.clear();
}

/**
 * Read-only point-in-time snapshot for `/piano-roll/list`, socket open, and the
 * legacy full-snapshot broadcast. Like its params counterpart it never consumes
 * the broadcast gate, so one client listing rolls cannot swallow the generation
 * every other open view is still waiting for. `options.force` is accepted for
 * call-site compatibility and has nothing left to switch on.
 */
export function makePianoRollSnapshot(
  _options: { force?: boolean } = {},
): PianoRollSnapshot {
  return {
    type: "pianoRollSnapshot",
    seq: nextEntitySnapshotSeq(PIANO_ROLL_ENTITY_TYPE),
    timestampMs: Date.now(),
    rolls: getAllPianoRolls(),
  };
}

/**
 * The broadcast tick: drain this type's change gate and return one record per
 * changed name (`entity: null` for a deleted roll). There is no sampler half —
 * nothing outside this module writes a roll, so there is no drift to adopt and
 * an idle store never serializes a note array.
 */
export function collectPianoRollChanges():
  | EntityChange<PianoRollObject>[]
  | null {
  const changes = consumeEntityTypeChanges(PIANO_ROLL_ENTITY_TYPE);
  if (!changes) return null;
  const collected: EntityChange<PianoRollObject>[] = [];
  for (const name of changes.changed) {
    const record = getEntityRecord<PianoRollData>(PIANO_ROLL_ENTITY_TYPE, name);
    if (record) collected.push({ name, entity: toObject(record) });
  }
  for (const name of changes.deleted) collected.push({ name, entity: null });
  return collected;
}

/**
 * Seed the demo roll unless it already exists or was explicitly deleted. Called
 * once at server construction — never lazily from a read path, so every
 * snapshot builder stays genuinely read-only. The write is stamped `demo-seed`
 * so an untouched seed (still at rev 1) can be left out of project saves.
 */
export function seedDemoPianoRoll(
  name = DEFAULT_ROLL_NAME,
): PianoRollObject | undefined {
  const entityName = normalizeName(name);
  const existing = getEntityRecord<PianoRollData>(
    PIANO_ROLL_ENTITY_TYPE,
    entityName,
  );
  if (existing) return toObject(existing);
  if (deletedDefaults.has(entityName)) return undefined;
  return setPianoRoll(
    entityName,
    {
      notes: [
        {
          id: "demo-c4",
          pitch: 60,
          position: 0,
          duration: 0.75,
          velocity: 100,
        },
        {
          id: "demo-e4",
          pitch: 64,
          position: 0.75,
          duration: 0.75,
          velocity: 96,
        },
        { id: "demo-g4", pitch: 67, position: 1.5, duration: 1, velocity: 104 },
        {
          id: "demo-b4",
          pitch: 71,
          position: 2.75,
          duration: 0.5,
          velocity: 90,
        },
        {
          id: "demo-c5",
          pitch: 72,
          position: 3.25,
          duration: 1.25,
          velocity: 110,
        },
      ],
    },
    {
      label: "Seed demo",
      source: "server",
      originId: DEMO_SEED_ORIGIN,
      undoable: false,
    },
  );
}

function getAllPianoRolls(): Record<string, PianoRollObject> {
  return Object.fromEntries(
    listPianoRollObjects().map((roll) => [roll.name, roll]),
  );
}

function records(): EntityRecord<PianoRollData>[] {
  return listEntityRecords<PianoRollData>(PIANO_ROLL_ENTITY_TYPE);
}

function recordFor(name: string): EntityRecord<PianoRollData> | undefined {
  return getEntityRecord<PianoRollData>(PIANO_ROLL_ENTITY_TYPE, name.trim());
}

function historyFor(name: string): RollHistory {
  const existing = histories.get(name);
  if (existing) return existing;
  const created: RollHistory = { undoStack: [], redoStack: [] };
  histories.set(name, created);
  return created;
}

function applyHistoryEntry(
  record: EntityRecord<PianoRollData>,
  entry: HistoryEntry,
  updatedBy: string,
): void {
  record.value = cloneRollData(entry.data);
  commitEntityWrite(record, {
    updatedBy,
    valueJson: safeStringifyEntityValue(record.value),
  });
}

function normalizeName(name: string): string {
  const normalized = name.trim();
  if (!normalized) throw new Error("Piano roll name must not be empty");
  return normalized;
}

// Shape incoming data (assign note ids, default velocity) without cloning, so
// the no-op compare can serialize once before deciding whether a clone is even
// needed. Note-id assignment happens here, before any equality check.
function shapeData(data: PianoRollData): PianoRollData {
  return {
    ...data,
    notes: data.notes.map((note, index) => normalizeNote(note, index)),
  };
}

// Must NEVER throw: this runs inside caller-owned livecode timing (the
// in-process setPianoRoll path is not wrapped by the HTTP handler try/catch).
// Note/point `metadata` is user-supplied and may hold non-cloneable values.
function cloneShapedData(
  shaped: PianoRollData,
  rollName: string,
): PianoRollData {
  try {
    return structuredClone(shaped);
  } catch {
    // structuredClone throws (e.g. DataCloneError) on functions/class
    // instances; fall through to a JSON-based clone.
  }

  try {
    const cloned = JSON.parse(JSON.stringify(shaped)) as PianoRollData;
    console.warn(
      `[piano-roll-store] "${rollName}" write: metadata was not ` +
        "structured-cloneable; converted via JSON (non-cloneable values dropped).",
    );
    return cloned;
  } catch {
    // JSON clone can still throw on cycles/BigInt; rebuild with well-typed
    // fields only, dropping metadata entirely.
  }

  console.warn(
    `[piano-roll-store] "${rollName}" write: metadata could not be cloned; ` +
      "rebuilt with well-typed fields only (metadata stripped).",
  );
  return rebuildSafeData(shaped);
}

// Last-resort clone that keeps only well-typed, always-serializable fields and
// drops user-supplied metadata that broke both structuredClone and JSON clone.
function rebuildSafeData(data: PianoRollData): PianoRollData {
  const rebuilt: PianoRollData = {
    notes: data.notes.map((note) => {
      const safeNote: NoteData = {
        id: (note as NoteData).id,
        pitch: note.pitch,
        position: note.position,
        duration: note.duration,
        velocity: (note as NoteData).velocity,
      };
      if (note.mpePitch) {
        safeNote.mpePitch = {
          points: note.mpePitch.points.map((point) => {
            const safePoint: MpePitchPoint = {
              time: point.time,
              pitchOffset: point.pitchOffset,
            };
            if (point.rooted !== undefined) safePoint.rooted = point.rooted;
            return safePoint;
          }),
        };
      }
      return safeNote;
    }),
  };
  if (data.viewport) rebuilt.viewport = { ...data.viewport };
  if (data.grid) rebuilt.grid = { ...data.grid };
  return rebuilt;
}

function normalizeNote(note: NoteDataInput, index: number): NoteData {
  const id = note.id && note.id.length > 0
    ? note.id
    : `note_${Date.now()}_${index}`;
  return {
    ...note,
    id,
    velocity: note.velocity ?? 100,
  };
}

/**
 * Stored data always came out of `cloneShapedData`, so `structuredClone` is
 * safe here — but reads happen from caller-owned livecode timing, so the
 * fallbacks stay rather than trusting that invariant.
 */
function cloneRollData(data: PianoRollData): PianoRollData {
  try {
    return structuredClone(data);
  } catch {
    // Fall through.
  }
  try {
    return JSON.parse(JSON.stringify(data)) as PianoRollData;
  } catch {
    return rebuildSafeData(data);
  }
}

function toObject(record: EntityRecord<PianoRollData>): PianoRollObject {
  const history = histories.get(record.name);
  return {
    name: record.name,
    rev: record.rev,
    data: cloneRollData(record.value),
    updatedAt: record.updatedAt,
    updatedBy: record.updatedBy,
    canUndo: (history?.undoStack.length ?? 0) > 0,
    canRedo: (history?.redoStack.length ?? 0) > 0,
  };
}

function pushHistory(stack: HistoryEntry[], entry: HistoryEntry): void {
  stack.push(entry);
  if (stack.length > MAX_HISTORY) stack.splice(0, stack.length - MAX_HISTORY);
}
