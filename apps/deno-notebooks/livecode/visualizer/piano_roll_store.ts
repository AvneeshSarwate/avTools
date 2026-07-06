import type {
  MpePitchPoint,
  NoteData,
  NoteDataInput,
  PianoRollData,
  PianoRollObject,
  PianoRollSnapshot,
  PianoRollUpdateSource,
} from "./protocol.ts";

interface HistoryEntry {
  label: string;
  data: PianoRollData;
  source: PianoRollUpdateSource;
  timestampMs: number;
}

interface PianoRollRecord extends PianoRollObject {
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  // Cached JSON of the last SHAPED (pre-clone) data assigned to `data`. Lets
  // setPianoRoll detect no-op writes with a single serialize + string compare
  // instead of stringifying both sides on every call. Kept in sync wherever
  // `data` is assigned (set / undo / redo / seed-via-set). Empty string when
  // the data was not JSON-serializable (circular/BigInt metadata) — it can
  // never match a real serialization, so no-op detection is simply disabled.
  lastDataJson: string;
}

export interface SetPianoRollOptions {
  label?: string;
  source?: PianoRollUpdateSource;
  originId?: string;
  undoable?: boolean;
  expectedRev?: number;
}

const DEFAULT_ROLL_NAME = "melody";
const MAX_HISTORY = 100;
const records = new Map<string, PianoRollRecord>();
let snapshotSeq = 0;
let dirty = true;

export function listPianoRollNames(): string[] {
  ensureDefaultPianoRoll();
  return [...records.keys()].sort((a, b) => a.localeCompare(b));
}

export function getPianoRoll(name: string): PianoRollObject | undefined {
  ensureDefaultPianoRoll();
  const record = records.get(name);
  return record ? toObject(record) : undefined;
}

export function getAllPianoRolls(): Record<string, PianoRollObject> {
  ensureDefaultPianoRoll();
  return Object.fromEntries(
    [...records.entries()].map(([name, record]) => [name, toObject(record)]),
  );
}

export function setPianoRoll(
  name: string,
  data: PianoRollData,
  options: SetPianoRollOptions = {},
): PianoRollObject {
  const normalizedName = normalizeName(name);
  // Shape (assign note ids, default velocity) WITHOUT cloning, then serialize
  // once for the no-op compare. The expensive never-throw clone only happens
  // when the write actually proceeds.
  const shaped = shapeData(data);
  const shapedJson = safeStringify(shaped);
  const existing = records.get(normalizedName);
  const source = options.source ?? "server";
  const undoable = options.undoable ?? true;

  if (existing) {
    if (
      options.expectedRev !== undefined && existing.rev !== options.expectedRev
    ) {
      return { ...toObject(existing), conflict: true };
    }

    if (shapedJson !== null && existing.lastDataJson === shapedJson) {
      return toObject(existing);
    }

    const nextData = cloneShapedData(shaped, normalizedName);

    if (undoable) {
      pushHistory(existing.undoStack, {
        label: options.label ?? "Set piano roll",
        data: cloneData(existing.data),
        source,
        timestampMs: Date.now(),
      });
      existing.redoStack = [];
    }

    existing.rev += 1;
    existing.data = nextData;
    existing.lastDataJson = shapedJson ?? "";
    existing.updatedAt = Date.now();
    existing.updatedBy = options.originId ?? source;
    markDirty();
    return toObject(existing);
  }

  const record: PianoRollRecord = {
    name: normalizedName,
    rev: 1,
    data: cloneShapedData(shaped, normalizedName),
    lastDataJson: shapedJson ?? "",
    updatedAt: Date.now(),
    updatedBy: options.originId ?? source,
    canUndo: false,
    canRedo: false,
    undoStack: [],
    redoStack: [],
  };
  records.set(normalizedName, record);
  markDirty();
  return toObject(record);
}

export function undoPianoRoll(
  name: string,
  options: { originId?: string } = {},
): PianoRollObject | undefined {
  ensureDefaultPianoRoll();
  const record = records.get(normalizeName(name));
  const previous = record?.undoStack.pop();
  if (!record || !previous) return record ? toObject(record) : undefined;

  pushHistory(record.redoStack, {
    label: "Redo piano roll",
    data: cloneData(record.data),
    source: "undoRedo",
    timestampMs: Date.now(),
  });
  record.rev += 1;
  record.data = cloneData(previous.data);
  record.lastDataJson = safeStringify(record.data) ?? "";
  record.updatedAt = Date.now();
  record.updatedBy = options.originId ?? "undo";
  markDirty();
  return toObject(record);
}

export function redoPianoRoll(
  name: string,
  options: { originId?: string } = {},
): PianoRollObject | undefined {
  ensureDefaultPianoRoll();
  const record = records.get(normalizeName(name));
  const next = record?.redoStack.pop();
  if (!record || !next) return record ? toObject(record) : undefined;

  pushHistory(record.undoStack, {
    label: "Undo piano roll",
    data: cloneData(record.data),
    source: "undoRedo",
    timestampMs: Date.now(),
  });
  record.rev += 1;
  record.data = cloneData(next.data);
  record.lastDataJson = safeStringify(record.data) ?? "";
  record.updatedAt = Date.now();
  record.updatedBy = options.originId ?? "redo";
  markDirty();
  return toObject(record);
}

export function makePianoRollSnapshot(
  options: { force?: boolean } = {},
): PianoRollSnapshot | null {
  if (!options.force && !dirty) return null;
  dirty = false;
  return {
    type: "pianoRollSnapshot",
    seq: ++snapshotSeq,
    timestampMs: Date.now(),
    rolls: getAllPianoRolls(),
  };
}

export function seedDemoPianoRoll(name = DEFAULT_ROLL_NAME): PianoRollObject {
  const existing = records.get(normalizeName(name));
  if (existing) return toObject(existing);
  return setPianoRoll(
    name,
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
    { label: "Seed demo", source: "server", undoable: false },
  );
}

export function markPianoRollStoreDirty(): void {
  markDirty();
}

function ensureDefaultPianoRoll(): void {
  seedDemoPianoRoll(DEFAULT_ROLL_NAME);
}

function normalizeName(name: string): string {
  const normalized = name.trim();
  if (!normalized) throw new Error("Piano roll name must not be empty");
  return normalized;
}

// JSON.stringify that returns null instead of throwing (circular refs, BigInt
// in user-supplied metadata). setPianoRoll must never throw into caller-owned
// livecode timing, so a failed serialize just disables no-op detection.
function safeStringify(data: PianoRollData): string | null {
  try {
    return JSON.stringify(data);
  } catch {
    return null;
  }
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

function cloneData(data: PianoRollData): PianoRollData {
  return structuredClone(data);
}

function toObject(record: PianoRollRecord): PianoRollObject {
  return {
    name: record.name,
    rev: record.rev,
    data: cloneData(record.data),
    updatedAt: record.updatedAt,
    updatedBy: record.updatedBy,
    canUndo: record.undoStack.length > 0,
    canRedo: record.redoStack.length > 0,
  };
}

function pushHistory(stack: HistoryEntry[], entry: HistoryEntry): void {
  stack.push(entry);
  if (stack.length > MAX_HISTORY) stack.splice(0, stack.length - MAX_HISTORY);
}

function markDirty(): void {
  dirty = true;
}
