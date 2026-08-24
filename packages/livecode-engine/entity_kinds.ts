import {
  animationTimelineEntityType,
  type DurableEntityTypeBehavior,
  paramsEntityType,
  pianoRollEntityType,
  registerDurableEntityType,
} from "./entity_registry.ts";
import {
  ANIMATION_TIMELINE_ENTITY_TYPE,
  collectAnimationTimelineChanges,
  listAnimationTimelines,
} from "./animation_timeline_store.ts";
import {
  collectPianoRollChanges,
  listPianoRollObjects,
  PIANO_ROLL_ENTITY_TYPE,
} from "./piano_roll_store.ts";
import {
  listParamsEntities,
  PARAMS_ENTITY_TYPE,
  sampleParamsChanges,
} from "./params_store.ts";
import {
  listSignals,
  sampleSignalChanges,
  SIGNAL_ENTITY_TYPE,
} from "./signals_store.ts";
import { type SyncSource, SyncSourceRegistry } from "./sync_sources.ts";

export interface EntityKindRegistration<E = unknown> {
  typeId: string;
  sync: Omit<SyncSource<E>, "entityType">;
  durable?: DurableEntityTypeBehavior;
}

export const BUILTIN_ENTITY_KINDS: EntityKindRegistration[] = [
  {
    typeId: PIANO_ROLL_ENTITY_TYPE,
    sync: {
      collectChanges: () => collectPianoRollChanges(),
      snapshotAll: () => listPianoRollObjects(),
    },
    durable: pianoRollEntityType,
  },
  {
    typeId: PARAMS_ENTITY_TYPE,
    sync: {
      collectChanges: () => sampleParamsChanges(),
      snapshotAll: () => listParamsEntities(),
    },
    durable: paramsEntityType,
  },
  {
    typeId: ANIMATION_TIMELINE_ENTITY_TYPE,
    sync: {
      collectChanges: () => collectAnimationTimelineChanges(),
      snapshotAll: () => listAnimationTimelines(),
    },
    durable: animationTimelineEntityType,
  },
  {
    typeId: SIGNAL_ENTITY_TYPE,
    sync: {
      collectChanges: () => sampleSignalChanges(),
      snapshotAll: () => listSignals(),
    },
  },
];

export function registerEntityKinds(
  syncSources: SyncSourceRegistry,
  kinds: readonly EntityKindRegistration[],
): void {
  for (const kind of kinds) {
    const artifacts = materializeEntityKind(kind);
    syncSources.register(artifacts.syncSource);
    if (artifacts.durableDescriptor) {
      registerDurableEntityType(artifacts.durableDescriptor);
    }
  }
}

export function materializeEntityKind(kind: EntityKindRegistration): {
  syncSource: SyncSource;
  durableDescriptor?: { typeId: string } & DurableEntityTypeBehavior;
} {
  return {
    syncSource: { entityType: kind.typeId, ...kind.sync },
    durableDescriptor: kind.durable
      ? { typeId: kind.typeId, ...kind.durable }
      : undefined,
  };
}

export function registerBuiltinEntityKinds(
  syncSources: SyncSourceRegistry,
): void {
  registerEntityKinds(syncSources, BUILTIN_ENTITY_KINDS);
}
