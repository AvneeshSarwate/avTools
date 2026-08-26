import type {
  AnimationTimelineEntity,
  ModuleLookupsEntity,
  ModuleWaitsEntity,
  ParamsEntity,
  PianoRollObject,
  RunEntity,
  SignalEntity,
  SyncMessage,
} from "@avtools/livecode-protocol";
import { SYNC_ENTITY_TYPES } from "@avtools/livecode-protocol";

export interface SyncSlice<E> {
  entities: Record<string, E>;
  latestSeq: number | null;
}

export interface SyncState {
  pianoRoll: SyncSlice<PianoRollObject>;
  params: SyncSlice<ParamsEntity>;
  animationTimeline: SyncSlice<AnimationTimelineEntity>;
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
    pianoRoll: emptySyncSlice(),
    params: emptySyncSlice(),
    animationTimeline: emptySyncSlice(),
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
      if (change.entity === null) delete entities[change.name];
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
