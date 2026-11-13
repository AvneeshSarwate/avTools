/** JSON wire values. Sparse array holes become null in snapshots and patches. */
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type Snapshot<T> = T extends readonly (infer E)[]
  ? (Snapshot<E> | null)[]
  : T extends object
    ? { [K in keyof T]: Snapshot<T[K]> }
    : T;
export type Path = readonly string[];
export type Patch =
  { op: "set"; path: Path; value: JsonValue } | { op: "delete"; path: Path };
export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;
export interface ReconcileOptions {
  /** Replace removes absent keys; merge leaves them alone. Arrays always replace contents. */
  mode?: "replace" | "merge";
  /** Requires no pending dirty writes. Host must drain and deliver them first. */
  silent?: boolean;
}
export interface Tracked<T extends object> {
  readonly state: T;
  /** Conservative: true while reachable externally mutable objects need scanning. */
  readonly dirty: boolean;
  drain(): Patch[];
  snapshot(): Snapshot<T>;
  reconcile(value: T, options?: ReconcileOptions & { mode?: "replace" }): void;
  reconcile(
    value: DeepPartial<T>,
    options: ReconcileOptions & { mode: "merge" },
  ): void;
  dispose(): void;
}
type RecordObject = Record<string, unknown>;
interface Edge {
  parent: WeakRef<Node>;
  key: string;
}
interface Node {
  raw: RecordObject;
  proxy: RecordObject;
  parents: Set<Edge>;
  children: Map<string, { node: Node; edge: Edge }>;
  observed?: Map<string, unknown>;
}
const own = (object: object, key: PropertyKey): boolean =>
  Object.hasOwn(object, key);
const objectValue = (value: unknown): value is RecordObject =>
  value !== null && typeof value === "object";
const put = (object: object, key: string, value: unknown): void => {
  Object.defineProperty(object, key, {
    value,
    writable: true,
    configurable: true,
    enumerable: true,
  });
};
const indexKey = (key: string): boolean =>
  String(Number(key) >>> 0) === key && Number(key) < 4294967295;

/** Validate without invoking getters; aliases are allowed, cycles are not. */
function validate(
  value: unknown,
  active = new Set<object>(),
  done = new Set<object>(),
): void {
  if (!objectValue(value)) {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    )
      return;
    throw new TypeError("Expected finite JSON data");
  }
  if (active.has(value)) throw new TypeError("Cycles are not supported");
  if (done.has(value)) return;
  const prototype = Object.getPrototypeOf(value);
  if (
    (Array.isArray(value)
      ? prototype !== Array.prototype
      : prototype !== Object.prototype && prototype !== null) ||
    !Object.isExtensible(value)
  )
    throw new TypeError("Expected extensible plain objects or arrays");
  active.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === "length") {
      if (!Object.getOwnPropertyDescriptor(value, key)!.writable)
        throw new TypeError("Expected a writable array length");
      continue;
    }
    if (typeof key !== "string" || (Array.isArray(value) && !indexKey(key)))
      throw new TypeError(
        "Only string object keys and array indices are supported",
      );
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (
      !("value" in descriptor) ||
      !descriptor.enumerable ||
      !descriptor.configurable ||
      !descriptor.writable
    )
      throw new TypeError("Expected ordinary writable data properties");
    validate(descriptor.value, active, done);
  }
  active.delete(value);
  done.add(value);
}

/** Clone to transport tree: deliberately expands aliases and normalizes holes. */
function wire(value: unknown): JsonValue {
  // JSON has one zero representation; keep local and serialized mirrors equal.
  if (typeof value === "number" && value === 0) return 0;
  if (!objectValue(value)) return value as JsonValue;
  if (Array.isArray(value))
    return Array.from(value, (child) =>
      child === undefined ? null : wire(child),
    );
  const result: Record<string, JsonValue> = {};
  for (const key of Object.keys(value)) {
    const child = wire(value[key]);
    if (key === "__proto__") put(result, key, child);
    else result[key] = child;
  }
  return result;
}

/** Defaults are cloned once (preserving aliases); later assignments adopt objects. */
export function createTracked<T extends object>(defaults: T): Tracked<T> {
  validate(defaults);
  if (!objectValue(defaults))
    throw new TypeError("Root must be an object or array");
  const nodes = new WeakMap<object, Node>();
  const proxies = new WeakMap<object, Node>();
  const dirty = new Map<Node, Set<string>>();
  const external = new Set<WeakRef<Node>>();
  let disposed = false;
  let silent = false;
  let root: Node | undefined;
  const unwrap = (value: unknown): unknown =>
    objectValue(value) ? (proxies.get(value)?.raw ?? value) : value;
  function capture(node: Node): Map<string, unknown> {
    const values = new Map<string, unknown>();
    for (const key of Object.keys(node.raw))
      values.set(key, unwrap(node.raw[key]));
    if (Array.isArray(node.raw)) values.set("length", node.raw.length);
    return values;
  }
  function expose(node: Node): void {
    if (node.observed) return;
    node.observed = capture(node);
    external.add(new WeakRef(node));
    for (const child of node.children.values()) expose(child.node);
  }
  function unlink(node: Node, key: string): void {
    const child = node.children.get(key);
    if (child) {
      child.node.parents.delete(child.edge);
      node.children.delete(key);
    }
  }
  function link(node: Node, key: string, value: unknown): void {
    if (!objectValue(value)) return;
    const child = adopt(value, node.observed !== undefined);
    const edge = { parent: new WeakRef(node), key };
    child.parents.add(edge);
    node.children.set(key, { node: child, edge });
  }
  function mark(node: Node, key: string): void {
    if (disposed || silent) return;
    let keys = dirty.get(node);
    if (!keys) dirty.set(node, (keys = new Set()));
    if (Array.isArray(node.raw)) {
      if (keys.has("length")) return;
      // Bound dense mutation bookkeeping, without copying an array in a setter.
      if (key === "length" || (keys.size >= 64 && !keys.has(key))) {
        keys.clear();
        keys.add("length");
        return;
      }
    }
    keys.add(key);
  }
  function wouldCycle(
    parent: Node,
    child: Node,
    seen = new Set<Node>(),
  ): boolean {
    if (parent === child) return true;
    if (seen.has(parent)) return false;
    seen.add(parent);
    for (const edge of parent.parents) {
      const ancestor = edge.parent.deref();
      if (ancestor && wouldCycle(ancestor, child, seen)) return true;
    }
    return false;
  }
  function set(
    node: Node,
    key: PropertyKey,
    incoming: unknown,
    ownedInput = false,
  ): boolean {
    if (disposed) return Reflect.set(node.raw, key, unwrap(incoming));
    if (
      typeof key !== "string" ||
      (Array.isArray(node.raw) && key !== "length" && !indexKey(key))
    )
      throw new TypeError("Unsupported property key");
    const oldLength = Array.isArray(node.raw) ? node.raw.length : undefined;
    const value = unwrap(incoming);
    if (own(node.raw, key) && Object.is(node.raw[key], value)) return true;
    if (Array.isArray(node.raw) && key === "length") {
      if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < 0 ||
        value > 4294967295
      )
        throw new RangeError("Invalid array length");
      // Only object-valued indices have links. No leaf scan on length writes.
      for (const childKey of node.children.keys())
        if (Number(childKey) >= value) unlink(node, childKey);
      Reflect.set(node.raw, key, value);
    } else {
      if (objectValue(value)) {
        if (!nodes.has(value) || external.size) validate(value);
        const child = adopt(value);
        // Raw edits may have changed reverse links since the last drain.
        // Structural assignments may traverse their input; scalar writes never do.
        function containsTarget(
          data: RecordObject,
          seen = new Set<object>(),
        ): boolean {
          const raw = unwrap(data) as RecordObject;
          if (raw === node.raw) return true;
          if (seen.has(raw)) return false;
          seen.add(raw);
          return Object.keys(raw).some(
            (key) =>
              objectValue(raw[key]) &&
              containsTarget(raw[key] as RecordObject, seen),
          );
        }
        if (external.size ? containsTarget(value) : wouldCycle(node, child))
          throw new TypeError("Cycles are not supported");
        if (!ownedInput && !proxies.has(incoming as object)) expose(child);
      } else validate(value);
      unlink(node, key);
      put(node.raw, key, value);
      link(node, key, value);
    }
    mark(
      node,
      Array.isArray(node.raw) && node.raw.length !== oldLength ? "length" : key,
    );
    return true;
  }
  function remove(node: Node, key: PropertyKey): boolean {
    if (!own(node.raw, key)) return true;
    const result = Reflect.deleteProperty(node.raw, key);
    if (result && typeof key === "string") {
      unlink(node, key);
      mark(node, Array.isArray(node.raw) ? "length" : key);
    }
    return result;
  }
  function adopt(input: RecordObject, externallyMutable = false): Node {
    const raw = unwrap(input) as RecordObject;
    const existing = nodes.get(raw) ?? proxies.get(raw);
    if (existing) {
      if (externallyMutable) expose(existing);
      return existing;
    }
    const node: Node = {
      raw,
      proxy: raw,
      parents: new Set(),
      children: new Map(),
    };
    nodes.set(raw, node);
    if (externallyMutable) expose(node);
    node.proxy = new Proxy(raw, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver);
        return objectValue(value) && own(target, key)
          ? adopt(value, node.observed !== undefined).proxy
          : value;
      },
      getOwnPropertyDescriptor(target, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
        if (
          descriptor &&
          descriptor.configurable &&
          "value" in descriptor &&
          objectValue(descriptor.value)
        ) {
          return {
            ...descriptor,
            value: adopt(descriptor.value, node.observed !== undefined).proxy,
          };
        }
        return descriptor;
      },
      set(_target, key, value) {
        return set(node, key, value);
      },
      deleteProperty(_target, key) {
        return remove(node, key);
      },
      defineProperty(_target, key, descriptor) {
        if (
          !("value" in descriptor) ||
          descriptor.get ||
          descriptor.set ||
          descriptor.writable !== true ||
          descriptor.enumerable !== true ||
          descriptor.configurable !== true
        )
          throw new TypeError(
            "Use ordinary assignments or fully writable data descriptors",
          );
        return set(node, key, descriptor.value);
      },
      setPrototypeOf() {
        throw new TypeError("Prototype changes are not supported");
      },
      preventExtensions() {
        throw new TypeError("Freezing tracked objects is not supported");
      },
    });
    proxies.set(node.proxy, node);
    for (const key of Object.keys(raw)) {
      link(node, key, raw[key]);
    }
    return node;
  }
  root = adopt(structuredClone(defaults) as RecordObject);
  const state = root.proxy as T;
  function assertActive(): void {
    if (disposed) throw new Error("Tracker is disposed");
  }
  function reachable(node: Node, visited = new Set<Node>()): boolean {
    if (node === root) return true;
    if (visited.has(node)) return false;
    visited.add(node);
    for (const edge of node.parents) {
      const parent = edge.parent.deref();
      if (!parent) {
        node.parents.delete(edge);
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(parent.raw, edge.key);
      if (
        descriptor &&
        "value" in descriptor &&
        unwrap(descriptor.value) === node.raw &&
        reachable(parent, visited)
      )
        return true;
    }
    return false;
  }
  function externalRoots(): Node[] {
    const result: Node[] = [];
    for (const reference of external) {
      const node = reference.deref();
      if (!node) external.delete(reference);
      else if (reachable(node)) result.push(node);
    }
    return result;
  }
  function scanExternal(): void {
    if (!external.size) return;
    const candidates = externalRoots();
    // Validate all reachable input before changing any baseline. Invalid raw
    // writes are reported explicitly and can be repaired before retrying.
    const validated = new Set<object>();
    for (const node of candidates) validate(node.raw, new Set(), validated);
    const visited = new Set<Node>();
    function refresh(node: Node): void {
      if (visited.has(node)) return;
      visited.add(node);
      expose(node);
      const previous = node.observed!;
      const current = capture(node);
      for (const [key, value] of current)
        if (!previous.has(key) || !Object.is(previous.get(key), value))
          mark(node, key);
      for (const key of previous.keys())
        if (!current.has(key))
          mark(node, Array.isArray(node.raw) ? "length" : key);
      for (const [key, child] of node.children)
        if (current.get(key) !== child.node.raw) unlink(node, key);
      for (const [key, value] of current) {
        if (!objectValue(value)) continue;
        if (!node.children.has(key)) link(node, key, value);
        refresh(node.children.get(key)!.node);
      }
      node.observed = current;
    }
    for (const node of candidates) refresh(node);
  }
  function paths(
    node: Node,
    suffix: string[],
    emit: (path: string[]) => void,
  ): void {
    if (node === root) {
      emit(suffix);
      return;
    }
    for (const edge of node.parents) {
      const parent = edge.parent.deref();
      if (!parent) {
        node.parents.delete(edge);
        continue;
      }
      if (external.size) {
        // Detached raw objects are not scanned. Their cached edges may be stale
        // or even cyclic after edits, so only follow actual live parent links.
        const descriptor = Object.getOwnPropertyDescriptor(
          parent.raw,
          edge.key,
        );
        if (
          !descriptor ||
          !("value" in descriptor) ||
          unwrap(descriptor.value) !== node.raw ||
          !reachable(parent)
        )
          continue;
      }
      paths(parent, [edge.key, ...suffix], emit);
    }
  }
  function reconcile(
    target: RecordObject,
    incoming: RecordObject,
    mode: "replace" | "merge",
  ): void {
    target = unwrap(target) as RecordObject;
    for (const key of Object.keys(incoming)) {
      const next = incoming[key];
      const current = own(target, key) ? target[key] : undefined;
      if (
        objectValue(current) &&
        objectValue(next) &&
        Array.isArray(current) === Array.isArray(next)
      )
        reconcile(current, next, Array.isArray(next) ? "replace" : mode);
      else set(adopt(target), key, next, true);
    }
    if (mode === "replace" || Array.isArray(target)) {
      for (const key of Object.keys(target))
        if (!own(incoming, key)) remove(adopt(target), key);
      if (Array.isArray(target))
        set(adopt(target), "length", (incoming as unknown as unknown[]).length);
    }
  }
  return {
    state,
    get dirty() {
      return dirty.size > 0 || (!disposed && externalRoots().length > 0);
    },
    drain() {
      assertActive();
      scanExternal();
      if (!dirty.size) return [];
      // A trie coalesces parents/children without quadratic patch comparisons.
      interface Trie {
        terminal: boolean;
        children: Map<string, Trie>;
      }
      const trie: Trie = { terminal: false, children: new Map() };
      for (const [node, keys] of dirty)
        for (const key of keys)
          paths(
            node,
            Array.isArray(node.raw) && key === "length" ? [] : [key],
            (path) => {
              let cursor = trie;
              for (const part of path) {
                if (cursor.terminal) return;
                let next = cursor.children.get(part);
                if (!next)
                  cursor.children.set(
                    part,
                    (next = { terminal: false, children: new Map() }),
                  );
                cursor = next;
              }
              cursor.terminal = true;
              cursor.children.clear();
            },
          );
      const patches: Patch[] = [];
      function collect(
        cursor: Trie,
        path: string[],
        value: unknown,
        exists: boolean,
      ): void {
        if (cursor.terminal) {
          patches.push(
            exists
              ? { op: "set", path, value: wire(value) }
              : { op: "delete", path },
          );
          return;
        }
        for (const [key, child] of cursor.children)
          collect(
            child,
            [...path, key],
            (value as RecordObject)[key],
            own(value as object, key),
          );
      }
      collect(trie, [], root!.raw, true);
      dirty.clear();
      return patches;
    },
    snapshot() {
      assertActive();
      scanExternal();
      return wire(root!.raw) as Snapshot<T>;
    },
    reconcile(value, options = {}) {
      assertActive();
      scanExternal();
      if (options.silent && dirty.size)
        throw new Error("Drain pending writes before silent reconciliation");
      validate(value);
      if (
        !objectValue(value) ||
        Array.isArray(value) !== Array.isArray(root!.raw)
      )
        throw new TypeError("Root container kind must match");
      // Copy once before applying: incoming references cannot be changed underneath traversal.
      const incoming = wire(value) as RecordObject;
      // Matching target identity cannot represent divergent incoming trees.
      // Preflight the whole reconciliation before modifying any target.
      const matched = new Map<object, RecordObject>();
      function checkAliases(target: RecordObject, next: RecordObject): void {
        target = unwrap(target) as RecordObject;
        const canonical = (data: unknown): unknown => {
          if (!objectValue(data)) return data;
          if (Array.isArray(data)) return data.map(canonical);
          return Object.fromEntries(
            Object.keys(data)
              .sort()
              .map((key) => [key, canonical(data[key])]),
          );
        };
        const previous = matched.get(target);
        if (previous !== undefined) {
          if (
            JSON.stringify(canonical(previous)) !==
            JSON.stringify(canonical(next))
          )
            throw new TypeError("Conflicting reconciliation of shared alias");
          return;
        }
        matched.set(target, next);
        for (const key of Object.keys(next)) {
          const current = own(target, key) ? target[key] : undefined;
          const child = next[key];
          if (
            objectValue(current) &&
            objectValue(child) &&
            Array.isArray(current) === Array.isArray(child)
          )
            checkAliases(current, child);
        }
      }
      checkAliases(root!.raw, incoming);
      silent = options.silent ?? false;
      try {
        reconcile(root!.raw, incoming, options.mode ?? "replace");
        if (silent) scanExternal();
      } finally {
        silent = false;
      }
    },
    dispose() {
      disposed = true;
      dirty.clear();
      external.clear();
      root = undefined;
    },
  };
}

/** Apply trusted library patches to an independent plain snapshot; returns the root. */
export function applyPatches<T extends object>(
  snapshot: T,
  patches: readonly Patch[],
): T {
  let root = snapshot as RecordObject;
  for (const patch of patches) {
    if (!patch.path.length) {
      if (patch.op !== "set" || !objectValue(patch.value))
        throw new TypeError("Root must remain a container");
      root = wire(patch.value) as RecordObject;
      continue;
    }
    let target = root;
    for (const key of patch.path.slice(0, -1)) {
      if (!own(target, key) || !objectValue(target[key]))
        throw new TypeError("Patch parent does not exist");
      target = target[key] as RecordObject;
    }
    const key = patch.path[patch.path.length - 1]!;
    if (patch.op === "delete") delete target[key];
    else if (key === "__proto__") put(target, key, wire(patch.value));
    else if (!Reflect.set(target, key, wire(patch.value)))
      throw new TypeError("Patch target rejected assignment");
  }
  return root as T;
}
