/**
 * The multiplexed sync transport: ONE socket carrying every watched entity
 * kind, per entity, changed-only, scoped to what the socket subscribed to.
 *
 * Two properties define the contract:
 *
 *   1. Per-ENTITY granularity. A changed entity ships whole and `entity: null`
 *      means deleted; there are no sub-entity diffs in v1.
 *   2. `seq` is a per-socket monotonic counter for gap DETECTION only. There is
 *      no replay buffer: a detected gap (or a reconnect) is recovered by
 *      resubscribing, which replies with fresh `resets`.
 */

import type { ParamsEntity } from "./params.ts";
import type { PianoRollObject } from "./piano_roll.ts";
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
export type SyncEntityTypeId =
  | "pianoRoll"
  | "params"
  | "signal"
  | "run"
  | "moduleWaits"
  | "moduleLookups";

/** The payload each entity kind ships. Keyed by the wire type id. */
export interface SyncEntityByType {
  pianoRoll: PianoRollObject;
  params: ParamsEntity;
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

export interface SyncEntityChange<E = SyncEntity> {
  entityType: string;
  name: string;
  /** `null` means the entity was deleted. */
  entity: E | null;
}

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
