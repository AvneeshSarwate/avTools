import {
  clearPianoRollHistory,
  deletePianoRoll,
  DEMO_SEED_ORIGIN,
  getPianoRoll,
  latestPianoRollJson,
  listPianoRollNames,
  PIANO_ROLL_ENTITY_TYPE,
  pianoRollExists,
  setPianoRoll,
} from "./piano_roll_store.ts";
import {
  createEmptyParams,
  duplicateParams,
  getParams,
  latestParamsJson,
  listParamsNames,
  loadParams,
  PARAMS_ENTITY_TYPE,
  removeParams,
} from "./params_store.ts";
import {
  ANIMATION_TIMELINE_ENTITY_TYPE,
  createEmptyAnimationTimeline,
  duplicateAnimationTimeline,
  getAnimationTimeline,
  latestAnimationTimelineJson,
  listAnimationTimelineNames,
  loadAnimationTimeline,
  removeAnimationTimeline,
} from "./animation_timeline_store.ts";
import type {
  AnimationTimelineData,
  ParamsMeta,
  ParamsValues,
  PianoRollData,
  PianoRollObject,
  PianoRollSetResult,
  SavedAnimationTimelineEntity,
  SavedParamsEntity,
  SavedPianoRollEntity,
} from "@avtools/livecode-protocol";

export interface DurableEntityTypeDescriptor {
  /** Stable wire id. Assumed space-free: saved-state keys are `type name`. */
  typeId: string;
  listNames(): string[];
  exists(name: string): boolean;
  /** Rejects an existing name. */
  create(name: string): void;
  /** Rejects a missing source or an existing target. */
  duplicate(sourceName: string, targetName: string): void;
  remove(name: string): boolean;
  /** JSON-ready saved form, or null to skip this entity in a save. */
  serialize(name: string): unknown | null;
  /** Validate and apply one saved form. */
  deserialize(name: string, data: unknown): void;
  /**
   * Canonical compact JSON of the entity's current value, for the saved-state
   * compare. Null when the entity is absent; the empty string when its value
   * could not be serialized.
   */
  latestJson(name: string): string | null;
}

export type DurableEntityTypeBehavior = Omit<
  DurableEntityTypeDescriptor,
  "typeId"
>;

export { PIANO_ROLL_ENTITY_TYPE };

/** Percent-encoding keeps `data/<type>/<name>.json` collision-free by name. */
const FILE_NAME_SAFE_BYTE = /[a-zA-Z0-9._-]/;
/** Encoded names longer than this are truncated and given a hash suffix. */
const MAX_ENCODED_NAME_LENGTH = 100;

const descriptors = new Map<string, DurableEntityTypeDescriptor>();

/** Idempotent: re-registering one type id replaces the descriptor. */
export function registerDurableEntityType(
  descriptor: DurableEntityTypeDescriptor,
): void {
  descriptors.set(descriptor.typeId, descriptor);
}

export function getDurableEntityType(
  typeId: string,
): DurableEntityTypeDescriptor | undefined {
  return descriptors.get(typeId);
}

/** Registered types, sorted by id so a save writes in a stable order. */
export function listDurableEntityTypes(): DurableEntityTypeDescriptor[] {
  return [...descriptors.values()]
    .sort((a, b) => a.typeId.localeCompare(b.typeId));
}

export const pianoRollEntityType: DurableEntityTypeBehavior = {
  listNames: () => listPianoRollNames(),
  exists: (name) => pianoRollExists(name),
  create(name) {
    if (pianoRollExists(name)) {
      throw new Error(`Piano roll "${name}" already exists`);
    }
    requirePianoRollSet(setPianoRoll(name, { notes: [] }, {
      label: "Create piano roll",
      source: "server",
      originId: "create",
      undoable: false,
    }));
  },
  duplicate(sourceName, targetName) {
    const source = getPianoRoll(sourceName);
    if (!source) throw new Error(`No piano roll "${sourceName}"`);
    if (pianoRollExists(targetName)) {
      throw new Error(`Piano roll "${targetName}" already exists`);
    }
    // getPianoRoll already returns a deep clone, so the copy shares nothing.
    requirePianoRollSet(setPianoRoll(targetName, source.data, {
      label: "Duplicate piano roll",
      source: "server",
      originId: "duplicate",
      undoable: false,
    }));
  },
  remove: (name) => deletePianoRoll(name),
  serialize(name) {
    const roll = getPianoRoll(name);
    if (!roll) return null;
    // A demo seed nobody ever wrote to is not project content: saving it would
    // put a junk melody.json in every project ever saved. Any real write bumps
    // rev past 1 and captures it forever after.
    if (roll.rev === 1 && roll.updatedBy === DEMO_SEED_ORIGIN) return null;
    const saved: SavedPianoRollEntity = {
      type: PIANO_ROLL_ENTITY_TYPE,
      name: roll.name,
      savedAt: new Date().toISOString(),
      data: roll.data,
    };
    return saved;
  },
  deserialize(name, data) {
    const saved = requireJsonObject(data, `Saved piano roll "${name}"`);
    const rollData = requireJsonObject(
      saved.data,
      `Saved piano roll "${name}" data`,
    );
    if (!Array.isArray(rollData.notes)) {
      throw new Error(`Saved piano roll "${name}" data.notes must be an array`);
    }
    for (const note of rollData.notes) {
      const entry = requireJsonObject(note, `Saved piano roll "${name}" note`);
      for (const field of ["pitch", "position", "duration"]) {
        if (!Number.isFinite(entry[field])) {
          throw new Error(
            `Saved piano roll "${name}" note.${field} must be a finite number`,
          );
        }
      }
    }
    requirePianoRollSet(
      setPianoRoll(name, rollData as unknown as PianoRollData, {
        label: "Load project",
        source: "server",
        undoable: false,
      }),
    );
    // Open adopts disk truth, so the pre-load stacks would undo into a state
    // the saved file never contained.
    clearPianoRollHistory(name);
  },
  latestJson: (name) => latestPianoRollJson(name),
};

export const paramsEntityType: DurableEntityTypeBehavior = {
  listNames: () => listParamsNames(),
  exists: (name) => getParams(name) !== undefined,
  create(name) {
    createEmptyParams(name);
  },
  duplicate(sourceName, targetName) {
    duplicateParams(sourceName, targetName);
  },
  remove: (name) => removeParams(name),
  serialize(name) {
    // Build the payload from the same canonical string the saved-state compare
    // uses, so file content and recorded saved state can never disagree.
    const json = latestParamsJson(name);
    const entity = getParams(name);
    if (!entity) return null;
    if (json === null) {
      throw new Error(`Params "${name}" cannot be serialized`);
    }
    const saved: SavedParamsEntity = {
      type: PARAMS_ENTITY_TYPE,
      name: entity.name,
      savedAt: new Date().toISOString(),
      values: JSON.parse(json) as ParamsValues,
    };
    if (entity.meta) saved.meta = entity.meta;
    return saved;
  },
  deserialize(name, data) {
    const saved = requireJsonObject(data, `Saved params "${name}"`);
    const values = requireJsonObject(
      saved.values,
      `Saved params "${name}" values`,
    );
    const meta = saved.meta === undefined
      ? undefined
      : requireJsonObject(saved.meta, `Saved params "${name}" meta`);
    // loadParams validates the value tree and mutates any live object in place.
    loadParams(
      name,
      values as ParamsValues,
      meta as ParamsMeta | undefined,
    );
  },
  latestJson: (name) => latestParamsJson(name),
};

function requirePianoRollSet(result: PianoRollSetResult): PianoRollObject {
  if (!result.ok) throw new Error(result.error);
  return result.roll;
}

export const animationTimelineEntityType: DurableEntityTypeBehavior = {
  listNames: () => listAnimationTimelineNames(),
  exists: (name) => getAnimationTimeline(name) !== undefined,
  create: (name) => {
    createEmptyAnimationTimeline(name);
  },
  duplicate: (sourceName, targetName) => {
    duplicateAnimationTimeline(sourceName, targetName);
  },
  remove: (name) => removeAnimationTimeline(name),
  serialize(name) {
    const entity = getAnimationTimeline(name);
    if (!entity) return null;
    const saved: SavedAnimationTimelineEntity = {
      type: ANIMATION_TIMELINE_ENTITY_TYPE,
      name: entity.name,
      savedAt: new Date().toISOString(),
      data: entity.data,
    };
    return saved;
  },
  deserialize(name, data) {
    const saved = requireJsonObject(
      data,
      `Saved animation timeline "${name}"`,
    );
    loadAnimationTimeline(name, saved.data as AnimationTimelineData);
  },
  latestJson: (name) => latestAnimationTimelineJson(name),
};

/**
 * Entity name to file name. Every byte outside `[a-zA-Z0-9._-]` — `%` included
 * — is percent-encoded, which is collision-free by construction and needs no
 * decoder: the manifest entry carries the true name. Long names are truncated
 * and disambiguated with a short hash of the full name.
 */
export function encodeEntityName(name: string): string {
  let encoded = "";
  for (const byte of new TextEncoder().encode(name)) {
    const char = String.fromCharCode(byte);
    encoded += FILE_NAME_SAFE_BYTE.test(char)
      ? char
      : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  if (encoded.length <= MAX_ENCODED_NAME_LENGTH) return encoded;
  const suffix = `-${shortNameHash(name)}`;
  const head = encoded
    .slice(0, MAX_ENCODED_NAME_LENGTH - suffix.length)
    // Never leave a half-written escape behind.
    .replace(/%[0-9A-F]?$/, "");
  return `${head}${suffix}`;
}

/** Project-relative data path for one entity, before collision handling. */
export function entityDataPath(typeId: string, name: string): string {
  return `data/${typeId}/${encodeEntityName(name)}.json`;
}

/**
 * Save-time path allocation. macOS filesystems are case-insensitive, so two
 * names that encode to case-variants of one path would overwrite each other;
 * the second one gets a numeric suffix. The manifest path is authoritative.
 * `usedLowercasePaths` is read and extended by each call.
 */
export function allocateEntityDataPath(
  typeId: string,
  name: string,
  usedLowercasePaths: Set<string>,
): string {
  const encoded = encodeEntityName(name);
  let candidate = `data/${typeId}/${encoded}.json`;
  let suffix = 1;
  while (usedLowercasePaths.has(candidate.toLowerCase())) {
    suffix += 1;
    candidate = `data/${typeId}/${encoded}-${suffix}.json`;
  }
  usedLowercasePaths.add(candidate.toLowerCase());
  return candidate;
}

/** FNV-1a over the UTF-8 bytes: synchronous, short, and stable per name. */
function shortNameHash(name: string): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(name)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function requireJsonObject(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}
