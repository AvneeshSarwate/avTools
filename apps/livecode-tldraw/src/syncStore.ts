import {
  SYNC_ENTITY_TYPES,
  type SyncEntityByType,
} from "@avtools/livecode-protocol";
import {
  emptySyncState,
  type SyncEntityTypeKey,
  type SyncSlice,
  type SyncState,
} from "./syncState";

type Listener = () => void;
const EMPTY_NAMES: readonly string[] = Object.freeze([]);

/** Frame-published entity state. React subscribes to values, never transport ticks. */
export class SyncStore {
  private state = emptySyncState();
  private readonly typeListeners = new Map<SyncEntityTypeKey, Set<Listener>>();
  private readonly entityListeners = new Map<
    SyncEntityTypeKey,
    Map<string, Set<Listener>>
  >();
  private readonly nameListeners = new Map<SyncEntityTypeKey, Set<Listener>>();
  private readonly names = new Map<SyncEntityTypeKey, readonly string[]>();
  private readonly entitySlices = new Map<
    SyncEntityTypeKey,
    Map<string, SyncSlice<unknown>>
  >();
  private readonly emptySlices = emptySyncState();

  getSlice<K extends SyncEntityTypeKey>(
    kind: K,
  ): SyncSlice<SyncEntityByType[K]> {
    return this.state[kind] as SyncSlice<SyncEntityByType[K]>;
  }

  getEntitySlice<K extends SyncEntityTypeKey>(
    kind: K,
    name: string | null,
  ): SyncSlice<SyncEntityByType[K]> {
    if (name === null)
      return this.emptySlices[kind] as SyncSlice<SyncEntityByType[K]>;
    let byName = this.entitySlices.get(kind);
    if (!byName) this.entitySlices.set(kind, (byName = new Map()));
    let slice = byName.get(name);
    if (!slice) {
      const entity = this.getSlice(kind).entities[name];
      slice = {
        entities: entity === undefined ? {} : { [name]: entity },
        latestSeq: entity === undefined ? null : this.state[kind].latestSeq,
      };
      byName.set(name, slice);
    }
    return slice as SyncSlice<SyncEntityByType[K]>;
  }

  getNames(kind: SyncEntityTypeKey): readonly string[] {
    return this.names.get(kind) ?? EMPTY_NAMES;
  }

  subscribeType(kind: SyncEntityTypeKey, listener: Listener): () => void {
    return this.listen(this.typeListeners, kind, listener);
  }

  subscribeNames(kind: SyncEntityTypeKey, listener: Listener): () => void {
    return this.listen(this.nameListeners, kind, listener);
  }

  subscribeEntity(
    kind: SyncEntityTypeKey,
    name: string | null,
    listener: Listener,
  ): () => void {
    if (name === null) return () => {};
    let byName = this.entityListeners.get(kind);
    if (!byName) this.entityListeners.set(kind, (byName = new Map()));
    const stop = this.listen(byName, name, listener);
    return () => {
      stop();
      if (!byName!.has(name)) this.entitySlices.get(kind)?.delete(name);
      if (!byName!.size) this.entityListeners.delete(kind);
    };
  }

  /** Adopt all kinds before notifying, so combined selectors see one frame. */
  publish(next: SyncState): void {
    const prior = this.state;
    this.state = next;
    const notify = new Set<Listener>();
    for (const kind of SYNC_ENTITY_TYPES) {
      if (prior[kind] === next[kind]) continue;
      const before = prior[kind].entities as Record<string, unknown>;
      const after = next[kind].entities as Record<string, unknown>;
      for (const [name] of this.entitySlices.get(kind) ?? []) {
        if (Object.is(before[name], after[name])) continue;
        this.entitySlices.get(kind)!.set(name, {
          entities: after[name] === undefined ? {} : { [name]: after[name] },
          latestSeq: next[kind].latestSeq,
        });
      }
      for (const [name, listeners] of this.entityListeners.get(kind) ?? []) {
        if (!Object.is(before[name], after[name]))
          for (const fn of listeners) notify.add(fn);
      }
      const names = Object.keys(after).sort();
      const oldNames = this.getNames(kind);
      if (
        names.length !== oldNames.length ||
        names.some((name, i) => name !== oldNames[i])
      ) {
        this.names.set(kind, names);
        for (const fn of this.nameListeners.get(kind) ?? []) notify.add(fn);
      }
      for (const fn of this.typeListeners.get(kind) ?? []) notify.add(fn);
    }
    for (const fn of notify) fn();
  }

  private listen<K>(
    map: Map<K, Set<Listener>>,
    key: K,
    listener: Listener,
  ): () => void {
    let set = map.get(key);
    if (!set) map.set(key, (set = new Set()));
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (!set!.size) map.delete(key);
    };
  }
}
