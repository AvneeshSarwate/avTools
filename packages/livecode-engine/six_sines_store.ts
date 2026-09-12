import { createTracked, type Tracked } from "@avtools/tracked-state";
import type { EntityChange } from "./entity_store.ts";
import { normalizeEntityName } from "./entity_store.ts";
import type {
  EntityPatch,
  SixSinesData,
  SixSinesEntity,
  SixSinesWriteOptions,
  SixSinesWriteResult,
} from "@avtools/livecode-protocol";
export type {
  SixSinesData,
  SixSinesEntity,
  SixSinesWriteOptions,
  SixSinesWriteResult,
} from "@avtools/livecode-protocol";
export const SIX_SINES_ENTITY_TYPE = "sixSines";
interface RecordState {
  tracker: Tracked<SixSinesData>;
  live: SixSinesData;
  name: string;
  rev: number;
  updatedAt: number;
  updatedBy: string;
  full: boolean;
}
const records = new Map<string, RecordState>();
const floors = new Map<string, number>();
const dirty = new Set<string>();
type Listener = (
  patches: readonly EntityPatch[],
  liveData: SixSinesData,
) => void;
const listeners = new Map<string, Set<Listener>>();
/**
 * Local fanout on the existing engine collector tick (33 ms by default).
 * Creative writes coalesce between ticks. Paths are entity-relative; a preset
 * change uses data/preset, parameter edits data/values/<id>. Initial creation
 * may provide data/values as a whole. Apply initial live data before subscribing.
 * This callback does not drain or snapshot; unsubscribe when the module stops.
 */
export function subscribeSixSinesChanges(
  name: string,
  listener: Listener,
): () => void {
  name = normalizeEntityName(SIX_SINES_ENTITY_TYPE, name);
  let set = listeners.get(name);
  if (!set) listeners.set(name, set = new Set());
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (!set!.size) listeners.delete(name);
  };
}
function validateValues(
  values: unknown,
): asserts values is Record<string, number> {
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw new Error("Six Sines values must be a record");
  }
  const prototype = Object.getPrototypeOf(values);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("Six Sines values must be a plain record");
  }
  for (const id of Reflect.ownKeys(values)) {
    const descriptor = Object.getOwnPropertyDescriptor(values, id)!;
    if (
      typeof id !== "string" || !("value" in descriptor) ||
      !descriptor.enumerable || !descriptor.configurable || !descriptor.writable
    ) throw new Error("Six Sines values must contain ordinary numeric fields");
    validateParameter(id, descriptor.value);
  }
}
function validateParameter(id: string, value: unknown) {
  if (
    typeof id !== "string" || !/^(0|[1-9][0-9]*)$/.test(id) ||
    !Number.isSafeInteger(Number(id))
  ) throw new Error(`Invalid Six Sines parameter ID: ${id}`);
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Six Sines parameter ${id} must be finite`);
  }
}
function validateData(data: SixSinesData) {
  if (!data || typeof data.preset !== "string") {
    throw new Error("Six Sines preset must be native XML text");
  }
  validateValues(data.values);
}
function commit(record: RecordState, originId = "code") {
  record.rev++;
  record.updatedAt = Date.now();
  record.updatedBy = originId;
  dirty.add(record.name);
}
export function registerSixSines(
  name: string,
  defaults: SixSinesData,
): SixSinesData {
  name = normalizeEntityName(SIX_SINES_ENTITY_TYPE, name);
  const existing = records.get(name);
  if (existing) return existing.live;
  validateData(defaults);
  const tracker = createTracked<SixSinesData>({
    preset: defaults.preset,
    values: defaults.values,
  });
  const record = {
    tracker,
    name,
    rev: (floors.get(name) ?? 0) + 1,
    updatedAt: Date.now(),
    updatedBy: "code",
    full: true,
  } as RecordState;
  const values = new Proxy(tracker.state.values, {
    set(target, id, value) {
      if (typeof id !== "string") {
        throw new Error("Parameter ID must be numeric");
      }
      validateParameter(id, value);
      if (!Object.is(target[id], value)) {
        target[id] = value;
        if (records.get(name) === record) commit(record);
      }
      return true;
    },
    deleteProperty(target, id) {
      if (typeof id === "string" && Object.hasOwn(target, id)) {
        delete target[id];
        if (records.get(name) === record) commit(record);
      }
      return true;
    },
    defineProperty() {
      throw new Error("Use parameter assignment");
    },
  });
  record.live = new Proxy(tracker.state, {
    get(target, key) {
      return key === "values" ? values : Reflect.get(target, key);
    },
    getOwnPropertyDescriptor(target, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
      return descriptor && key === "values"
        ? { ...descriptor, value: values }
        : descriptor;
    },
    set(target, key, value) {
      if (key !== "preset" || typeof value !== "string") {
        throw new Error("Use setSixSinesPreset for bulk replacement");
      }
      if (target.preset !== value) {
        target.preset = value;
        if (records.get(name) === record) commit(record);
      }
      return true;
    },
    deleteProperty() {
      throw new Error("Six Sines data fields are required");
    },
    defineProperty() {
      throw new Error("Use assignment or setSixSinesPreset");
    },
  });
  records.set(name, record);
  dirty.add(name);
  return record.live;
}
export function getSixSines(name: string): SixSinesEntity | null {
  const r = records.get(name.trim());
  return r
    ? {
      name: r.name,
      rev: r.rev,
      updatedAt: r.updatedAt,
      updatedBy: r.updatedBy,
      data: r.tracker.snapshot(),
    }
    : null;
}
function writable(
  name: string,
  options: SixSinesWriteOptions,
): RecordState | SixSinesWriteResult {
  if (typeof name !== "string" || !name.trim()) {
    return { ok: false, error: "Six Sines name is required", status: 400 };
  }
  if (options.originId !== undefined && typeof options.originId !== "string") {
    return { ok: false, error: "originId must be a string", status: 422 };
  }
  const r = records.get(name.trim());
  if (!r) {
    return { ok: false, error: `No Six Sines entity "${name}"`, status: 404 };
  }
  if (options.expectedRev !== undefined && options.expectedRev !== r.rev) {
    return { ok: false, error: "Revision conflict", status: 409 };
  }
  return r;
}
export function setSixSinesParameters(
  name: string,
  changes: Record<string, number>,
  options: SixSinesWriteOptions = {},
): SixSinesWriteResult {
  const r = writable(name, options);
  if ("ok" in r) return r;
  try {
    validateValues(changes);
  } catch (e) {
    return { ok: false, error: String(e), status: 422 };
  }
  let changed = false;
  for (const [id, value] of Object.entries(changes)) {
    if (!Object.is(r.tracker.state.values[id], value)) {
      r.tracker.state.values[id] = value;
      changed = true;
    }
  }
  if (changed) commit(r, options.originId);
  return { ok: true, rev: r.rev };
}
export function setSixSinesPreset(
  name: string,
  data: SixSinesData,
  options: SixSinesWriteOptions = {},
): SixSinesWriteResult {
  const r = writable(name, options);
  if ("ok" in r) return r;
  try {
    validateData(data);
  } catch (e) {
    return { ok: false, error: String(e), status: 422 };
  }
  const current = r.tracker.state;
  const keys = Object.keys(data.values);
  const changed = current.preset !== data.preset ||
    keys.length !== Object.keys(current.values).length ||
    keys.some((id) => !Object.is(current.values[id], data.values[id]));
  if (changed) {
    r.tracker.reconcile({ preset: data.preset, values: data.values });
    commit(r, options.originId);
  }
  return { ok: true, rev: r.rev };
}
/** UI patches are validated as a batch before any write; metadata is engine-owned. */
export function patchSixSines(
  name: string,
  patches: EntityPatch[],
  options: SixSinesWriteOptions = {},
): SixSinesWriteResult {
  if (!Array.isArray(patches)) {
    return { ok: false, error: "patches must be an array", status: 422 };
  }
  const changes: Record<string, number> = {};
  for (const p of patches) {
    if (
      !p || p.op !== "set" || !Array.isArray(p.path) || p.path.length !== 3 ||
      p.path[0] !== "data" || p.path[1] !== "values"
    ) {
      return {
        ok: false,
        error: "Only data.values parameter sets are supported",
        status: 422,
      };
    }
    try {
      validateParameter(p.path[2], p.value);
    } catch (e) {
      return { ok: false, error: String(e), status: 422 };
    }
    changes[p.path[2]] = p.value as number;
  }
  return setSixSinesParameters(name, changes, options);
}
export function listSixSinesNames(): string[] {
  return [...records.keys()].sort();
}
export function listSixSines(): SixSinesEntity[] {
  return listSixSinesNames().map((name) => getSixSines(name)!);
}
export function removeSixSines(name: string): boolean {
  name = name.trim();
  const r = records.get(name);
  if (!r) return false;
  floors.set(name, r.rev);
  r.tracker.dispose();
  records.delete(name);
  dirty.add(name);
  return true;
}
export function loadSixSines(name: string, data: SixSinesData): SixSinesData {
  validateData(data);
  if (!records.has(name.trim())) return registerSixSines(name, data);
  const result = setSixSinesPreset(name, data, { originId: "load" });
  if (!result.ok) throw new Error(result.error);
  return records.get(name.trim())!.live;
}
export function latestSixSinesJson(name: string): string | null {
  const entity = getSixSines(name);
  return entity ? JSON.stringify(entity.data) : null;
}
export function collectSixSinesChanges():
  | EntityChange<SixSinesEntity>[]
  | null {
  if (!dirty.size) return null;
  const result: EntityChange<SixSinesEntity>[] = [];
  const names = [...dirty].sort();
  dirty.clear();
  for (const name of names) {
    const r = records.get(name);
    if (!r) {
      result.push({ name, entity: null });
      continue;
    }
    const patches = r.tracker.drain();
    if (r.full) {
      result.push({ name, entity: getSixSines(name)! });
      r.full = false;
    } else {result.push({
        name,
        patches: [
          ...patches.map((p) => ({ ...p, path: ["data", ...p.path] })),
          { op: "set", path: ["rev"], value: r.rev },
          { op: "set", path: ["updatedAt"], value: r.updatedAt },
          { op: "set", path: ["updatedBy"], value: r.updatedBy },
        ],
      });}
  }
  for (const change of result) {
    const r = records.get(change.name);
    if (!r) continue;
    const patches: EntityPatch[] = change.patches ?? [
      {
        op: "set",
        path: ["data", "preset"],
        value: change.entity!.data.preset,
      },
      {
        op: "set",
        path: ["data", "values"],
        value: change.entity!.data.values,
      },
    ];
    for (const listener of [...listeners.get(change.name) ?? []]) {
      try {
        listener(patches, r.live);
      } catch (error) {
        console.error("Six Sines change listener failed", error);
      }
    }
  }
  return result;
}
