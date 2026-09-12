import type {
  AnimationTimelineEntity,
  DrawingEntity,
  EntityPatch,
  ModuleLookupsEntity,
  ModuleWaitsEntity,
  ParamsEntity,
  PianoRollObject,
  RunEntity,
  SignalEntity,
  SixSinesEntity,
  SyncMessage,
} from "@avtools/livecode-protocol";
import { SYNC_ENTITY_TYPES } from "@avtools/livecode-protocol";

export interface SyncSlice<E> {
  entities: Record<string, E>;
  latestSeq: number | null;
}

export interface SyncState {
  sixSines: SyncSlice<SixSinesEntity>;
  pianoRoll: SyncSlice<PianoRollObject>;
  params: SyncSlice<ParamsEntity>;
  animationTimeline: SyncSlice<AnimationTimelineEntity>;
  drawing: SyncSlice<DrawingEntity>;
  signal: SyncSlice<SignalEntity>;
  run: SyncSlice<RunEntity>;
  moduleWaits: SyncSlice<ModuleWaitsEntity>;
  moduleLookups: SyncSlice<ModuleLookupsEntity>;
}

export type SyncEntityTypeKey = keyof SyncState;

interface NamedEntity {
  name?: string;
  moduleId?: string;
}

export const emptySyncSlice = <E>(): SyncSlice<E> => ({
  entities: {},
  latestSeq: null,
});

export function emptySyncState(): SyncState {
  return {
    sixSines: emptySyncSlice(),
    pianoRoll: emptySyncSlice(),
    params: emptySyncSlice(),
    animationTimeline: emptySyncSlice(),
    drawing: emptySyncSlice(),
    signal: emptySyncSlice(),
    run: emptySyncSlice(),
    moduleWaits: emptySyncSlice(),
    moduleLookups: emptySyncSlice(),
  };
}

/** Apply one wire message to the authoritative store and return touched kinds. */
export function applySyncMessageToState(
  state: SyncState,
  message: SyncMessage,
): Set<SyncEntityTypeKey> {
  const dirty = new Set<SyncEntityTypeKey>();

  if (message.resets) {
    for (const [entityType, entities] of Object.entries(message.resets)) {
      if (!isSyncEntityType(entityType)) continue;
      const next: Record<string, unknown> = {};
      for (const entity of entities) {
        next[entityName(entity as NamedEntity)] = entity;
      }
      state[entityType] = {
        entities: next,
        latestSeq: message.seq,
      } as never;
      dirty.add(entityType);
    }
  }

  if (message.changes && message.changes.length > 0) {
    const touched = new Map<SyncEntityTypeKey, Record<string, unknown>>();
    for (const change of message.changes) {
      if (!isSyncEntityType(change.entityType)) continue;
      let entities = touched.get(change.entityType);
      if (!entities) {
        entities = { ...state[change.entityType].entities };
        touched.set(change.entityType, entities);
      }
      if (change.patches) {
        if (!Object.hasOwn(entities, change.name)) {
          throw new Error("Sync patch requires a reset baseline");
        }
        entities[change.name] = materializeEntityPatches(
          entities[change.name],
          change.patches,
        );
      } else if (change.entity === null) delete entities[change.name];
      else entities[change.name] = change.entity;
    }
    for (const [entityType, entities] of touched) {
      state[entityType] = { entities, latestSeq: message.seq } as never;
      dirty.add(entityType);
    }
  }

  return dirty;
}

function isSyncEntityType(value: string): value is SyncEntityTypeKey {
  return (SYNC_ENTITY_TYPES as readonly string[]).includes(value);
}

function entityName(entity: NamedEntity): string {
  return entity.name ?? entity.moduleId ?? "";
}

/** Copy each changed ancestor once; untouched branches retain identity. */
export function materializeEntityPatches(
  entity: unknown,
  patches: readonly EntityPatch[],
): unknown {
  let root = entity;
  const copies = new WeakMap<object, Record<string, unknown>>();
  function copy(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object") {
      throw new Error("Patch parent must exist");
    }
    const existing = copies.get(value);
    if (existing) return existing;
    const result =
      (Array.isArray(value) ? value.slice() : { ...value }) as Record<
        string,
        unknown
      >;
    copies.set(value, result);
    copies.set(result, result);
    return result;
  }
  function set(target: object, key: string, value: unknown) {
    Object.defineProperty(target, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  for (const patch of patches) {
    if (!patch.path.length) {
      if (patch.op === "delete") {
        throw new Error("Cannot delete entity root with a patch");
      }
      root = patch.value;
      continue;
    }
    root = copy(root);
    let parent = root as Record<string, unknown>;
    for (const key of patch.path.slice(0, -1)) {
      if (!Object.hasOwn(parent, key)) {
        throw new Error("Patch parent must exist");
      }
      const child = copy(parent[key]);
      set(parent, key, child);
      parent = child;
    }
    const key = patch.path[patch.path.length - 1]!;
    if (patch.op === "delete") delete parent[key];
    else set(parent, key, patch.value);
  }
  return root;
}
