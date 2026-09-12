import assert from "node:assert/strict";
import { test } from "node:test";
import { createTracked, type Patch, type Tracked } from "../src/index.js";

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));

// Independent receiver: do not let a matching bug in applyPatches mask a bad batch.
function receive(root: unknown, patches: Patch[]): unknown {
  for (const patch of json(patches)) {
    if (patch.path.length === 0) {
      assert.equal(patch.op, "set");
      if (patch.op === "set") root = patch.value;
      continue;
    }
    let parent = root as Record<string, unknown>;
    for (const key of patch.path.slice(0, -1)) {
      assert(
        Object.hasOwn(parent, key),
        `missing parent ${patch.path.join("/")}`,
      );
      assert(parent[key] !== null && typeof parent[key] === "object");
      parent = parent[key] as Record<string, unknown>;
    }
    const key = patch.path.at(-1)!;
    if (patch.op === "delete") delete parent[key];
    else
      Object.defineProperty(parent, key, {
        value: patch.value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
  }
  return root;
}

function receiver<T extends object>(tracker: Tracked<T>) {
  let mirror: unknown = json(tracker.snapshot());
  return {
    flush(label = "mirror after transport") {
      const patches = tracker.drain();
      mirror = receive(mirror, patches);
      assert.deepEqual(mirror, tracker.snapshot(), label);
      assert.deepEqual(json(mirror), mirror, "receiver remains JSON wire data");
      return patches;
    },
    // A silent host update must also be installed in the recipient baseline.
    hydrate() {
      mirror = json(tracker.snapshot());
    },
  };
}

test("external assignment preserves raw identity and a dirty-gated consumer sees later writes", () => {
  const t = createTracked({ child: { x: 0 } });
  const r = receiver(t);
  const raw = { x: 1 };
  t.state.child = raw;
  r.flush();
  raw.x = 2;
  assert.equal(t.state.child.x, 2, "ordinary assignment must not clone");
  assert.equal(t.dirty, true, "dirty gate must allow external scanning");
  assert(r.flush().length > 0);
  t.state.child.x = 3;
  assert.equal(raw.x, 3, "proxy and raw must mutate the same storage");
  r.flush();
  assert.deepEqual(
    t.drain(),
    [],
    "unchanged external data does not emit repeatedly",
  );
});

test("unread raw subtrees detect nested addition, deletion, replacement and multiple writes", () => {
  type Branch = { x: number; nested?: Branch; removed?: number };
  const t = createTracked<{ child?: Branch; tick: number }>({ tick: 0 });
  const r = receiver(t);
  const raw: Branch = { x: 1, nested: { x: 2, removed: 3 } };
  t.state.child = raw;
  r.flush();
  raw.nested!.x = 4;
  delete raw.nested!.removed;
  raw.nested!.nested = { x: 5 };
  t.state.tick++;
  r.flush();
  const old = raw.nested!;
  raw.nested = { x: 10, nested: { x: 11 } };
  old.x = 99;
  raw.nested.nested!.x = 12;
  r.flush();
  old.x = 100;
  assert.deepEqual(r.flush(), [], "detached raw data is irrelevant");
  delete raw.nested;
  r.flush();
  raw.nested = old;
  old.nested!.x = 13;
  r.flush();
});

test("raw alias topology changes route held proxy writes to all and only live paths", () => {
  type Leaf = { x: number };
  const t = createTracked<{ graph: Record<string, Leaf> }>({ graph: {} });
  const r = receiver(t);
  const leaf = { x: 1 };
  const graph: Record<string, Leaf> = { a: leaf, b: leaf };
  t.state.graph = graph;
  r.flush();
  leaf.x = 2; // Neither alias was read through the tracker.
  r.flush();
  const held = t.state.graph.a!;
  delete graph.a;
  graph.c = leaf;
  graph.b = { x: 20 };
  held.x = 3; // Parent links must refresh before resolving this pending write.
  r.flush();
  assert.equal(t.state.graph.c, held);
  delete graph.c;
  held.x = 4;
  r.flush();
  leaf.x = 5;
  held.x = 6;
  assert.deepEqual(r.flush(), []);
  graph.d = leaf;
  held.x = 7;
  r.flush();
  assert.equal(t.state.graph.d, held);
  leaf.x = 8;
  r.flush();
});

test("detached external roots can grow and reattach through retained proxies", () => {
  type Branch = { x: number; child?: { x: number } };
  const t = createTracked<{ a?: Branch; b?: Branch }>({});
  const r = receiver(t);
  const raw: Branch = { x: 1 };
  t.state.a = raw;
  const held = t.state.a;
  r.flush();
  delete t.state.a;
  r.flush();
  raw.child = { x: 2 };
  raw.x = 3;
  assert.deepEqual(r.flush(), []);
  t.state.b = held;
  raw.child.x = 4;
  r.flush();
  assert.equal(t.state.b, held);
  raw.child.x = 5;
  r.flush();
  held.child!.x = 6;
  assert.equal(raw.child.x, 6);
  r.flush();
});

test("external arrays track holes, length, reorder, replacements and moved retained elements", () => {
  const t = createTracked<{ items: { x: number }[] }>({ items: [] });
  const r = receiver(t);
  const first = { x: 1 };
  const raw = [first, { x: 2 }, { x: 3 }];
  t.state.items = raw;
  const held = t.state.items[0]!;
  r.flush();
  raw.unshift({ x: 0 });
  raw.reverse();
  held.x = 10;
  raw.push(first); // Alias at two array indices.
  r.flush();
  delete raw[1];
  raw[8] = { x: 8 };
  raw[8].x = 9;
  r.flush();
  raw.splice(0, 3, { x: 20 });
  t.state.items.push({ x: 30 });
  raw.length = 2;
  held.x = 11;
  r.flush();
  raw.length = 6;
  r.flush();
  raw[5] = first;
  first.x = 12;
  r.flush();
  assert.equal(t.state.items[5], held);
});

test("external discovery keeps growing after assignment without a fixed node cutoff", () => {
  const t = createTracked<{ graph: Record<string, { x: number }> }>({
    graph: {},
  });
  const r = receiver(t);
  const raw: Record<string, { x: number }> = {};
  t.state.graph = raw;
  r.flush();
  for (let batch = 0; batch < 4; batch++) {
    for (let i = 0; i < 1024; i++) raw[String(batch * 1024 + i)] = { x: i };
    r.flush();
    raw[String(batch * 1024 + 1023)]!.x = -batch - 1;
    raw["0"]!.x = -batch - 10;
    r.flush();
  }
  raw["4095"]!.x = 42;
  r.flush();
});

test("external array sparse edits keep payloads proportional to changed leaves", () => {
  const t = createTracked<{ items: { x: number }[]; numbers: number[] }>({
    items: [],
    numbers: [],
  });
  const r = receiver(t);
  const items = Array.from({ length: 10000 }, (_, x) => ({ x }));
  const numbers = Array.from({ length: 10000 }, (_, x) => x);
  t.state.items = items;
  t.state.numbers = numbers;
  r.flush();
  items[9000]!.x = -1;
  numbers[9999] = -2;
  const patches = r.flush();
  assert(
    JSON.stringify(patches).length < 512,
    "two leaf edits must not ship whole arrays",
  );
  assert.deepEqual(patches.map((patch) => patch.path).sort(), [
    ["items", "9000", "x"],
    ["numbers", "9999"],
  ]);
});

test("snapshot does not acknowledge pending raw or proxy changes; batches stay detached", () => {
  const t = createTracked({ child: { x: 0, nested: { x: 0 } }, tick: 0 });
  const r = receiver(t);
  const raw = { x: 1, nested: { x: 2 } };
  t.state.child = raw;
  const initial = r.flush();
  const frozenBatch = json(initial);
  raw.x = 3;
  t.state.tick = 1;
  const snap = t.snapshot();
  assert.deepEqual(snap.child, { x: 3, nested: { x: 2 } });
  raw.nested.x = 4;
  t.state.child.x = 5;
  r.flush();
  assert.deepEqual(initial, frozenBatch);
  assert.deepEqual(snap.child, { x: 3, nested: { x: 2 } });
  raw.x = 6;
  t.snapshot();
  r.flush();
});

test("silent reconciliation rejects pending raw changes and accepts clean external baselines", () => {
  const t = createTracked({ child: { x: 0 }, tick: 0 });
  const r = receiver(t);
  const raw = { x: 1 };
  t.state.child = raw;
  r.flush();
  raw.x = 2;
  assert.throws(() =>
    t.reconcile({ tick: 9 }, { mode: "merge", silent: true }),
  );
  assert.equal(
    t.state.tick,
    0,
    "rejected silent reconciliation must not apply",
  );
  r.flush();
  t.reconcile({ tick: 3 }, { mode: "merge", silent: true });
  r.hydrate();
  assert.deepEqual(r.flush(), []);
  raw.x = 4;
  r.flush();
  t.reconcile({ child: { x: 5 }, tick: 4 }, { silent: true });
  r.hydrate();
  assert.deepEqual(r.flush(), []);
  raw.x = 6;
  assert.equal(
    t.state.child.x,
    6,
    "matching reconcile containers retain identity",
  );
  r.flush();
});

test("ordinary reconciliation merges with pending external edits without losing either", () => {
  const t = createTracked({ child: { x: 0, y: 0 }, tick: 0 });
  const r = receiver(t);
  const raw = { x: 1, y: 1 };
  t.state.child = raw;
  r.flush();
  raw.x = 2;
  t.reconcile({ child: { y: 3 } }, { mode: "merge" });
  t.state.tick = 4;
  r.flush();
  assert.deepEqual(t.snapshot(), { child: { x: 2, y: 3 }, tick: 4 });
  raw.x = 5;
  t.reconcile({ child: { x: 6, y: 7 }, tick: 8 });
  raw.y = 9;
  r.flush();
});

test("defaults and new reconcile bulk inputs are cloned owned data", () => {
  const defaults = { branches: {} as Record<string, { x: number }> };
  const t = createTracked(defaults);
  const r = receiver(t);
  defaults.branches.bad = { x: 99 };
  assert.deepEqual(t.snapshot(), { branches: {} });
  const incoming = { branches: { a: { x: 1 } } };
  t.reconcile(incoming);
  r.flush();
  incoming.branches.a.x = 2;
  assert.equal(t.state.branches.a!.x, 1);
  assert.equal(
    t.dirty,
    false,
    "owned-only data retains a clean cheap dirty gate",
  );
  const merge = { branches: { b: { x: 3 } } };
  t.reconcile(merge, { mode: "merge", silent: true });
  r.hydrate();
  merge.branches.b.x = 4;
  assert.equal(t.state.branches.b!.x, 3);
  assert.equal(t.dirty, false);
  assert.deepEqual(r.flush(), []);
});

for (const [name, bad] of [
  ["undefined", undefined],
  ["NaN", NaN],
  ["Infinity", Infinity],
  ["bigint", 1n],
  ["function", () => 1],
  ["Date", new Date(0)],
] as const) {
  test(`invalid raw ${name} throws explicitly on drain and snapshot and recovers`, () => {
    const t = createTracked<{ raw: Record<string, unknown>; tick: number }>({
      raw: {},
      tick: 0,
    });
    const r = receiver(t);
    const raw: Record<string, unknown> = { valid: 1 };
    t.state.raw = raw;
    r.flush();
    raw.valid = 2;
    raw.bad = bad;
    t.state.tick = 3;
    assert.throws(() => t.drain(), TypeError);
    assert.throws(() => t.snapshot(), TypeError);
    assert.throws(
      () => t.drain(),
      TypeError,
      "failure cannot silently acknowledge invalid data",
    );
    delete raw.bad;
    r.flush();
    raw.valid = 4;
    r.flush();
  });
}

test("raw accessors are rejected without invocation and recover after repair", () => {
  const t = createTracked<{ raw: Record<string, unknown> }>({ raw: {} });
  const r = receiver(t);
  const raw: Record<string, unknown> = {};
  t.state.raw = raw;
  r.flush();
  let calls = 0;
  Object.defineProperty(raw, "bad", {
    configurable: true,
    enumerable: true,
    get() {
      calls++;
      return 1;
    },
  });
  assert.throws(() => t.drain(), TypeError);
  assert.throws(() => t.snapshot(), TypeError);
  assert.equal(calls, 0);
  delete raw.bad;
  raw.good = 2;
  r.flush();
});

test("raw cycles fail explicitly, preserve pending writes, and recover after repair", () => {
  const t = createTracked<{ raw: Record<string, unknown>; tick: number }>({
    raw: {},
    tick: 0,
  });
  const r = receiver(t);
  const raw: Record<string, unknown> = { child: {} };
  t.state.raw = raw;
  r.flush();
  const child = raw.child as Record<string, unknown>;
  child.back = raw;
  t.state.tick = 1;
  assert.throws(
    () => t.drain(),
    TypeError,
    "cycle detection must precede recursion overflow",
  );
  assert.throws(() => t.snapshot(), TypeError);
  delete child.back;
  child.x = 2;
  r.flush();
  raw.self = raw;
  assert.throws(() => t.drain(), TypeError);
  delete raw.self;
  raw.x = 3;
  r.flush();
});

test("new raw children read and written through proxies before drain acquire live paths", () => {
  const t = createTracked<{ graph: Record<string, { x: number }> }>({
    graph: {},
  });
  const r = receiver(t);
  const graph: Record<string, { x: number }> = {};
  t.state.graph = graph;
  r.flush();
  const raw = { x: 1 };
  graph.a = raw;
  const held = t.state.graph.a!;
  held.x = 2;
  graph.b = raw;
  delete graph.a;
  r.flush();
  held.x = 3;
  r.flush();
  raw.x = 4;
  r.flush();
});

test("invalid raw array values and custom properties reject, while holes remain valid", () => {
  const t = createTracked<{ items: unknown[] }>({ items: [] });
  const r = receiver(t);
  const raw: unknown[] = [1, 2];
  t.state.items = raw;
  r.flush();
  raw[0] = undefined;
  assert.throws(() => t.drain(), TypeError);
  delete raw[0];
  r.flush();
  Object.defineProperty(raw, "extra", {
    value: 1,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  assert.throws(() => t.drain(), TypeError);
  Reflect.deleteProperty(raw, "extra");
  raw.push(3);
  r.flush();
});

test("raw symbol and non-enumerable properties cannot silently disappear from transport", () => {
  const t = createTracked<{ raw: Record<string, unknown> }>({ raw: {} });
  const r = receiver(t);
  const raw: Record<string, unknown> = {};
  t.state.raw = raw;
  r.flush();
  for (const key of [Symbol("invalid"), "hidden"]) {
    Object.defineProperty(raw, key, {
      value: 1,
      enumerable: typeof key === "symbol",
      writable: true,
      configurable: true,
    });
    assert.throws(() => t.drain(), TypeError);
    assert.throws(() => t.snapshot(), TypeError);
    Reflect.deleteProperty(raw, key);
    raw.valid = String(key);
    r.flush();
  }
});

test("detached invalid raw data does not poison reachable state, and repaired data reattaches", () => {
  const t = createTracked<{ child?: Record<string, unknown>; tick: number }>({
    tick: 0,
  });
  const r = receiver(t);
  const raw: Record<string, unknown> = { x: 1 };
  t.state.child = raw;
  r.flush();
  delete t.state.child;
  raw.self = raw;
  t.state.tick = 2;
  r.flush();
  assert.deepEqual(t.snapshot(), { tick: 2 });
  delete raw.self;
  t.state.child = raw;
  r.flush();
  raw.x = 3;
  r.flush();
});

test("detached raw topology reversal does not leave cycles in cached parent paths", () => {
  type Branch = { x: number; child?: Branch; parent?: Branch };
  const t = createTracked<{ tree?: Branch }>({});
  const r = receiver(t);
  const child: Branch = { x: 2 };
  const raw: Branch = { x: 1, child };
  t.state.tree = raw;
  const heldParent = t.state.tree;
  const heldChild = heldParent.child!;
  r.flush();
  delete t.state.tree;
  r.flush();

  // The actual graph is now child -> parent, with neither reachable from root.
  // A stale cached parent -> child edge must not make dirty path traversal loop.
  delete raw.child;
  heldChild.parent = heldParent;
  assert.doesNotThrow(() => assert.deepEqual(r.flush(), []));

  t.state.tree = heldChild;
  r.flush();
  assert.deepEqual(t.snapshot(), { tree: { x: 2, parent: { x: 1 } } });
  raw.x = 3;
  heldChild.x = 4;
  r.flush();
});

test("mixed raw and proxy aliases reject divergent reconciliation before mutation", () => {
  const t = createTracked<{
    a: { x: number };
    external?: { child: { x: number } };
  }>({ a: { x: 1 } });
  const r = receiver(t);
  const held = t.state.a;
  const external = { child: held };
  t.state.external = external;
  assert.equal(
    external.child,
    held,
    "adoption must not rewrite the raw wrapper",
  );
  assert.equal(external.child, t.state.a);
  assert.equal(t.state.external.child, held);
  r.flush();

  for (const mode of ["replace", "merge"] as const) {
    const before = t.snapshot();
    const incoming = { a: { x: 2 }, external: { child: { x: 3 } } };
    assert.throws(() => {
      if (mode === "merge") t.reconcile(incoming, { mode });
      else t.reconcile(incoming);
    }, TypeError);
    assert.deepEqual(
      t.snapshot(),
      before,
      `${mode} must reject before any mutation`,
    );
    assert.deepEqual(r.flush(), []);
    assert.equal(external.child, held);
  }

  t.reconcile({ a: { x: 4 }, external: { child: { x: 4 } } });
  r.flush();
  assert.equal(held.x, 4);
  assert.equal(t.state.a, held);
  assert.equal(external.child, held);
  assert.equal(t.state.external!.child, held);
  t.reconcile(
    { a: { x: 5 }, external: { child: { x: 5 } } },
    { mode: "merge", silent: true },
  );
  r.hydrate();
  assert.deepEqual(r.flush(), []);
  assert.equal(held.x, 5);
  assert.equal(external.child, held);
  external.child.x = 6;
  r.flush();
});

test("external arrays with non-writable length reject explicitly during scanning", () => {
  const t = createTracked({ items: [0], tick: 0 });
  const r = receiver(t);
  const raw = [1, 2];
  t.state.items = raw;
  r.flush();
  Object.defineProperty(raw, "length", { writable: false });
  t.state.tick = 1;
  assert.throws(() => t.drain(), TypeError);
  assert.throws(() => t.snapshot(), TypeError);
  assert.throws(() => t.drain(), TypeError);
  // Array length cannot be made writable again; detach the invalid input.
  t.state.items = [3];
  r.flush();
  assert.deepEqual(t.snapshot(), { items: [3], tick: 1 });
});

test("seeded batches mix raw and proxy mutations, unread aliases, detachments and snapshots", () => {
  type Leaf = { x: number; extra?: number; child?: { x: number } };
  for (const seed of [1, 7, 42, 12345, 0xdeadbeef]) {
    let rng = seed >>> 0;
    const random = (n: number) => {
      rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
      return Math.floor((rng / 0x100000000) * n);
    };
    const t = createTracked<{
      graph: Record<string, Leaf>;
      items: Leaf[];
      tick: number;
    }>({ graph: {}, items: [], tick: 0 });
    const r = receiver(t);
    const graph: Record<string, Leaf> = {};
    const items: Leaf[] = [];
    const retained: Leaf[] = [{ x: 0 }];
    const held: Leaf[] = [];
    t.state.graph = graph;
    t.state.items = items;
    r.flush();
    for (let batch = 0; batch < 120; batch++) {
      for (let step = 0; step < 8; step++) {
        const key = String(random(12));
        const leaf = retained[random(retained.length)]!;
        const value = random(10000);
        switch (random(18)) {
          case 0: {
            const next = { x: value };
            retained.push(next);
            graph[key] = next;
            break;
          }
          case 1:
            graph[key] = leaf;
            break;
          case 2:
            delete graph[key];
            break;
          case 3:
            leaf.x = value;
            break;
          case 4:
            leaf.extra = value;
            break;
          case 5:
            delete leaf.extra;
            break;
          case 6:
            leaf.child = { x: value };
            break;
          case 7:
            if (leaf.child) leaf.child.x = value;
            break;
          case 8:
            if (t.state.graph[key]) {
              held.push(t.state.graph[key]!);
              t.state.graph[key]!.x = value;
            }
            break;
          case 9:
            if (held.length) held[random(held.length)]!.x = value;
            break;
          case 10:
            if (held.length) t.state.graph[key] = held[random(held.length)]!;
            break;
          case 11:
            items.push(leaf);
            break;
          case 12:
            items.splice(random(items.length + 1), random(3), leaf);
            break;
          case 13:
            items.reverse();
            break;
          case 14:
            items.length = random(12);
            break;
          case 15:
            if (items.length) delete items[random(items.length)];
            break;
          case 16:
            if (t.state.items.length) {
              const item = t.state.items[random(items.length)];
              if (item) item.x = value;
            }
            break;
          case 17:
            t.state.tick = value;
            t.snapshot();
            break;
        }
      }
      r.flush(`seed ${seed}, batch ${batch} (8 operations before drain)`);
    }
    assert.deepEqual(r.flush(), [], `seed ${seed}: stable final baseline`);
    t.dispose();
  }
});
