// `collectChanges()` is the only consumer of a source's change gate;
// `snapshotAll()` is read-only. Samplers run every tick regardless of current
// subscriptions so observation cannot change engine behavior.

import { type EntityChange, safeStringifyEntityValue } from "./entity_store.ts";
import {
  consumeDirtyLookupModules,
  consumeDirtyWaitModules,
  getModuleLookups,
  getModuleWaitCallsites,
  listLookupModuleIds,
  listWaitModuleIds,
} from "./runtime.ts";
import type {
  ModuleLookupsEntity,
  ModuleWaitsEntity,
  RunEntity,
} from "@avtools/livecode-protocol";

export const MODULE_WAITS_ENTITY_TYPE = "moduleWaits";
export const MODULE_LOOKUPS_ENTITY_TYPE = "moduleLookups";
export const RUN_ENTITY_TYPE = "run";

export interface SyncSource<E = unknown> {
  readonly entityType: string;
  /** Drains this kind's gate. Null when the tick found nothing to ship. */
  collectChanges(): EntityChange<E>[] | null;
  /** Read-only full state, for a subscribe reset. */
  snapshotAll(): E[];
}

/** Per-tick result: entity type → the changes collected for it. */
export type SyncCollectedChanges = Map<string, EntityChange<unknown>[]>;

export class SyncSourceRegistry {
  readonly #sources = new Map<string, SyncSource<unknown>>();

  register<E>(source: SyncSource<E>): void {
    this.#sources.set(source.entityType, source as SyncSource<unknown>);
  }

  has(entityType: string): boolean {
    return this.#sources.has(entityType);
  }

  entityTypes(): string[] {
    return [...this.#sources.keys()];
  }

  /**
   * One walk over every source. This is the single consumer of every gate on
   * the tick; both the `/sync` fan-out and the legacy channels read its result.
   */
  collectAll(): SyncCollectedChanges {
    const collected: SyncCollectedChanges = new Map();
    for (const source of this.#sources.values()) {
      const changes = source.collectChanges();
      if (changes && changes.length > 0) {
        collected.set(source.entityType, changes);
      }
    }
    return collected;
  }

  /** Read-only. An unregistered type resets to an empty list rather than 404. */
  snapshotAll(entityType: string): unknown[] {
    return this.#sources.get(entityType)?.snapshotAll() ?? [];
  }
}

export function createModuleWaitsSyncSource(): SyncSource<unknown> {
  return createModuleKeyedSource<ModuleWaitsEntity>({
    entityType: MODULE_WAITS_ENTITY_TYPE,
    listNames: listWaitModuleIds,
    consumeDirty: consumeDirtyWaitModules,
    read: (moduleId) => {
      const callsiteIds = getModuleWaitCallsites(moduleId);
      return callsiteIds ? { moduleId, callsiteIds } : null;
    },
  });
}

export function createModuleLookupsSyncSource(): SyncSource<unknown> {
  return createModuleKeyedSource<ModuleLookupsEntity>({
    entityType: MODULE_LOOKUPS_ENTITY_TYPE,
    listNames: listLookupModuleIds,
    consumeDirty: consumeDirtyLookupModules,
    read: (moduleId) => {
      const lookups = getModuleLookups(moduleId);
      return lookups ? { moduleId, lookups } : null;
    },
  });
}

/**
 * Runs live on the server object rather than in a process-global store, so this
 * source takes its accessors. Every write genuinely advances `updatedAt`, so
 * the value compare below never suppresses a real lifecycle transition.
 */
export function createRunSyncSource(deps: {
  listModuleIds(): string[];
  read(moduleId: string): RunEntity | null;
  consumeDirty(): string[];
}): SyncSource<unknown> {
  return createModuleKeyedSource<RunEntity>({
    entityType: RUN_ENTITY_TYPE,
    listNames: deps.listModuleIds,
    consumeDirty: deps.consumeDirty,
    read: deps.read,
  });
}

/**
 * Shared engine for the module-keyed ephemeral kinds. Their mutators live on
 * hot paths (`enterWait` runs at every awaited callsite), so marking is a bare
 * `Set.add` and the real filter is here: a per-entity serialized compare, so a
 * steady wait loop re-marking the same callsite set never rebroadcasts an
 * identical array. `snapshotAll` deliberately does not touch that cache — it is
 * a read, and a read must not decide what a later tick ships.
 */
function createModuleKeyedSource<E>(options: {
  entityType: string;
  listNames(): string[];
  read(name: string): E | null;
  consumeDirty(): string[];
}): SyncSource<unknown> {
  const lastJson = new Map<string, string>();

  return {
    entityType: options.entityType,
    collectChanges(): EntityChange<unknown>[] | null {
      const dirty = options.consumeDirty();
      if (dirty.length === 0) return null;
      const changes: EntityChange<unknown>[] = [];
      for (const name of dirty.sort((a, b) => a.localeCompare(b))) {
        const entity = options.read(name);
        if (entity === null) {
          // Nothing was ever shipped for this name, so its absence is not news.
          if (!lastJson.has(name)) continue;
          lastJson.delete(name);
          changes.push({ name, entity: null });
          continue;
        }
        const json = safeStringifyEntityValue(entity) ?? "";
        if (lastJson.get(name) === json) continue;
        lastJson.set(name, json);
        changes.push({ name, entity });
      }
      return changes.length > 0 ? changes : null;
    },
    snapshotAll(): unknown[] {
      const all: unknown[] = [];
      for (const name of options.listNames()) {
        const entity = options.read(name);
        if (entity !== null) all.push(entity);
      }
      return all;
    },
  };
}
