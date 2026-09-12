/**
 * The multiplexed sync transport: ONE socket carrying every watched entity
 * kind, per entity, changed-only, scoped to what the socket subscribed to.
 *
 * Two properties define the contract:
 *
 *   1. Per-ENTITY granularity. A change carries an entity, sparse patches, or `entity: null`
 *      for deletion. Patches require an initial full reset.
 *   2. `seq` is a per-socket monotonic counter for gap DETECTION only. There is
 *      no replay buffer: a detected gap (or a reconnect) is recovered by
 *      resubscribing, which replies with fresh `resets`.
 */

import type { SixSinesEntity } from "./six_sines.ts";
import type { EntityDelta } from "./patch.ts";
import type { ParamsEntity } from "./params.ts";
import type { PianoRollObject } from "./piano_roll.ts";
import type { AnimationTimelineEntity } from "./animation_timeline.ts";
import type { DrawingEntity } from "./drawing.ts";
import type {
  ModuleLookupsEntity,
  ModuleWaitsEntity,
  RunEntity,
} from "./runtime.ts";
import type { SignalEntity } from "./signals.ts";

/**
 * Entity kinds the sync transport carries. Subscriptions are type-level in v1;
 * per-name scoping is deferred and the envelope already admits it.
 */
export const SYNC_ENTITY_TYPES = [
  "sixSines",
  "pianoRoll",
  "params",
  "animationTimeline",
  "drawing",
  "signal",
  "run",
  "moduleWaits",
  "moduleLookups",
] as const;

export type SyncEntityTypeId = (typeof SYNC_ENTITY_TYPES)[number];

/** The payload each entity kind ships. Keyed by the wire type id. */
export interface SyncEntityByType {
  sixSines: SixSinesEntity;
  pianoRoll: PianoRollObject;
  params: ParamsEntity;
  animationTimeline: AnimationTimelineEntity;
  drawing: DrawingEntity;
  signal: SignalEntity;
  run: RunEntity;
  moduleWaits: ModuleWaitsEntity;
  moduleLookups: ModuleLookupsEntity;
}

export type SyncEntity = SyncEntityByType[SyncEntityTypeId];

/**
 * Client → server. Every subscribe REPLACES the socket's set, and the reply
 * carries `resets` for all the listed types — so gap recovery is simply
 * resubscribing the same set.
 */
export interface SyncSubscribeMessage {
  type: "subscribe";
  entityTypes: string[];
}

export type SyncClientMessage = SyncSubscribeMessage;

export type SyncEntityChange<E = SyncEntity> = EntityDelta<E> & {
  entityType: string;
};
export type SyncDelta<E = SyncEntity> = SyncEntityChange<E>;

export interface SyncMessage<E = SyncEntity> {
  type: "sync";
  /** Per-socket monotonic message counter. Gap detection only; never replayed. */
  seq: number;
  timestampMs: number;
  /**
   * Full current state per entity type, sent in reply to a subscribe. A reset
   * REPLACES the client's whole per-type map: absence means deleted, so
   * entities removed while disconnected do not survive a reconnect.
   */
  resets?: Record<string, E[]>;
  changes?: Array<SyncEntityChange<E>>;
}

export type SyncServerMessage = SyncMessage;
