import {
  createContext,
  useContext,
  useCallback,
  useRef,
  useSyncExternalStore,
  type PropsWithChildren,
} from "react";
import type { SyncEntityByType } from "@avtools/livecode-protocol";
import type { SyncSlice, SyncEntityTypeKey } from "./syncState";
import { SyncStore } from "./syncStore";

const SyncStoreContext = createContext<SyncStore | null>(null);

/** undefined selects a kind; a string selects one entity; null disables it. */
export function useSyncSlice<K extends SyncEntityTypeKey>(
  kind: K,
  name?: string | null,
): SyncSlice<SyncEntityByType[K]> {
  const store = useStore();
  const subscribe = useCallback(
    (listener: () => void) =>
      name === undefined
        ? store.subscribeType(kind, listener)
        : store.subscribeEntity(kind, name, listener),
    [store, kind, name],
  );
  const read = useCallback(
    () =>
      name === undefined
        ? store.getSlice(kind)
        : store.getEntitySlice(kind, name),
    [store, kind, name],
  );
  return useSyncExternalStore(subscribe, read, read);
}

/** Use for lists/menus, not a bound editor's value subscription. */
export function useSyncEntityNames(kind: SyncEntityTypeKey): readonly string[] {
  const store = useStore();
  const subscribe = useCallback(
    (listener: () => void) => store.subscribeNames(kind, listener),
    [store, kind],
  );
  const read = useCallback(() => store.getNames(kind), [store, kind]);
  return useSyncExternalStore(subscribe, read, read);
}

/** Derived views (e.g. anchored playheads) retain their result when unrelated state changes. */
export function useSyncSelector<K extends SyncEntityTypeKey, T>(
  kind: K,
  select: (entities: Record<string, SyncEntityByType[K]>) => T,
  equal: (a: T, b: T) => boolean = Object.is,
): T {
  const store = useStore();
  const cache = useRef<{
    entities: Record<string, SyncEntityByType[K]>;
    select: typeof select;
    value: T;
  } | null>(null);
  const subscribe = useCallback(
    (listener: () => void) => store.subscribeType(kind, listener),
    [store, kind],
  );
  const read = useCallback(() => {
    const entities = store.getSlice(kind).entities;
    const prior = cache.current;
    if (prior && prior.entities === entities && prior.select === select)
      return prior.value;
    const next = select(entities);
    const value = prior && equal(prior.value, next) ? prior.value : next;
    cache.current = { entities, select, value };
    return value;
  }, [store, kind, select, equal]);
  return useSyncExternalStore(subscribe, read, read);
}

export function SyncStoreProvider({
  store,
  children,
}: PropsWithChildren<{ store: SyncStore }>) {
  return (
    <SyncStoreContext.Provider value={store}>
      {children}
    </SyncStoreContext.Provider>
  );
}
function useStore(): SyncStore {
  const store = useContext(SyncStoreContext);
  if (!store) throw new Error("Sync hooks require a SyncStoreProvider");
  return store;
}
