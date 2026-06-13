import type {
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
}

export interface SetPianoRollOptions {
  label?: string;
  source?: PianoRollUpdateSource;
  originId?: string;
  undoable?: boolean;
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
  const nextData = normalizeData(data);
  const existing = records.get(normalizedName);
  const source = options.source ?? "server";
  const undoable = options.undoable ?? true;

  if (existing) {
    if (JSON.stringify(existing.data) === JSON.stringify(nextData)) {
      return toObject(existing);
    }

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
    existing.updatedAt = Date.now();
    existing.updatedBy = options.originId ?? source;
    markDirty();
    return toObject(existing);
  }

  const record: PianoRollRecord = {
    name: normalizedName,
    rev: 1,
    data: nextData,
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

function normalizeData(data: PianoRollData): PianoRollData {
  return {
    ...data,
    notes: data.notes.map((note, index) => normalizeNote(note, index)),
  };
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
