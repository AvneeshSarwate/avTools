import assert from "node:assert/strict";
import { test } from "node:test";
import { applyPatches, createTracked } from "../src/index.js";

test("transport normalizes negative zero without changing live numeric state", () => {
  const tracker = createTracked({ value: -0, items: [-0] });
  let mirror = JSON.parse(JSON.stringify(tracker.snapshot()));
  assert.deepEqual(mirror, tracker.snapshot());
  assert(Object.is(tracker.state.value, -0));
  tracker.state.value = 1;
  mirror = applyPatches(mirror, JSON.parse(JSON.stringify(tracker.drain())));
  tracker.state.value = -0;
  tracker.state.items[0] = 1;
  mirror = applyPatches(mirror, JSON.parse(JSON.stringify(tracker.drain())));
  assert.deepEqual(mirror, tracker.snapshot());
  assert(Object.is(tracker.state.value, -0));
});

test("array subclasses are not accepted as ordinary JSON arrays", () => {
  class CustomArray extends Array<number> {}
  assert.throws(() => createTracked({ items: new CustomArray(1, 2) }));
  const tracker = createTracked({ items: [1, 2] });
  assert.throws(() => {
    tracker.state.items = new CustomArray(3, 4);
  });
  assert.deepEqual(tracker.snapshot(), { items: [1, 2] });
  assert.equal(tracker.dirty, false);
});

test("ordinary writes coalesce and payloads/snapshots detach", () => {
  const t = createTracked({ filter: { cutoff: 0 }, other: 0 });
  let mirror = t.snapshot();
  const held = t.state.filter;
  assert.equal(held, t.state.filter);
  for (let i = 0; i < 100; i++) held.cutoff = i;
  assert.equal(t.drain().length, 1);
  held.cutoff = 101;
  const patches = t.drain();
  mirror = applyPatches(mirror, patches);
  assert.deepEqual(mirror, t.snapshot());
  t.state.filter = { cutoff: 3 };
  const replacement = t.drain();
  t.state.filter.cutoff = 4;
  assert.deepEqual(replacement, [
    { op: "set", path: ["filter"], value: { cutoff: 3 } },
  ]);
  assert.equal(mirror.filter.cutoff, 101);
  assert.equal(held.cutoff, 101);
});

test("unread shared alias, detached references, reattachment and parent coalescing", () => {
  const shared = { x: 0 };
  const t = createTracked<{ a?: typeof shared; b?: typeof shared }>({
    a: shared,
    b: shared,
  });
  const held = t.state.a!;
  held.x = 1;
  assert.deepEqual(
    t
      .drain()
      .map((p) => p.path)
      .sort(),
    [
      ["a", "x"],
      ["b", "x"],
    ],
  );
  assert.equal(t.state.b, held);
  delete t.state.a;
  delete t.state.b;
  t.drain();
  held.x = 2;
  assert.deepEqual(t.drain(), []);
  t.state.a = held;
  held.x = 3;
  assert.deepEqual(t.drain(), [{ op: "set", path: ["a"], value: { x: 3 } }]);
});

test("arrays: root, nested, sparse, truncation, methods, and aliased children", () => {
  const shared = { x: 0 };
  const t = createTracked({ a: [shared, { x: 1 }], b: shared });
  let mirror = t.snapshot();
  const check = () => {
    mirror = applyPatches(mirror, JSON.parse(JSON.stringify(t.drain())));
    assert.deepEqual(mirror, t.snapshot());
  };
  t.state.b.x = 4;
  check();
  const detached = t.state.a[1]!;
  t.state.a.length = 1;
  check();
  detached.x = 9;
  assert.deepEqual(t.drain(), []);
  t.state.a.push({ x: 2 });
  check();
  t.state.a.splice(0, 1, { x: 3 }, { x: 4 });
  check();
  t.state.a.reverse();
  check();
  t.state.a.sort((a, b) => a.x - b.x);
  check();
  delete t.state.a[0];
  check();
  t.state.a.length = 10;
  check();
  const root = createTracked([1, 2]);
  root.state.push(3);
  assert.deepEqual(root.drain(), [{ op: "set", path: [], value: [1, 2, 3] }]);
});

test("reconcile preserves matching identity, merge, replace, and silence boundaries", () => {
  const t = createTracked({ a: { x: 0, y: 2 }, items: [{ n: 1 }] });
  const a = t.state.a;
  const items = t.state.items;
  const item = items[0];
  t.reconcile({ a: { x: 3 } }, { mode: "merge" });
  assert.equal(t.state.a, a);
  assert.equal(a.y, 2);
  assert.throws(
    () => t.reconcile({ a: { x: 4 } }, { silent: true, mode: "merge" }),
    /Drain/,
  );
  t.drain();
  t.reconcile({ a: { x: 5, y: 6 }, items: [{ n: 9 }] }, { silent: true });
  assert.equal(t.state.items, items);
  assert.equal(items[0], item);
  assert.equal(a.x, 5);
  assert.deepEqual(t.drain(), []);
  t.reconcile({ a: { x: 7 } } as typeof t.state);
  assert.equal("y" in a, false);
  assert.equal("items" in t.state, false);
});

test("same value, removal/readd, special keys, validation and cycles", () => {
  const t = createTracked<Record<string, unknown>>({ x: 1, child: { x: 1 } });
  t.state.x = 1;
  delete t.state.missing;
  assert.deepEqual(t.drain(), []);
  for (const bad of [undefined, NaN, Infinity, new Date(), new Map(), () => 0])
    assert.throws(() => {
      t.state.x = bad;
    });
  assert.equal(t.state.x, 1);
  assert.throws(() => {
    t.state.self = t.state;
  }, /Cycles/);
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.throws(() => {
    t.state.cyclic = cyclic;
  }, /Cycles/);
  assert.throws(() => Object.freeze(t.state));
  assert.throws(() =>
    Object.defineProperty(t.state, "getter", { get: () => 1 }),
  );
  t.state.__proto__ = { safe: true };
  Reflect.set(t.state, "constructor", { prototype: { safe: true } });
  const mirror = applyPatches({ x: 1, child: { x: 1 } }, t.drain());
  assert.deepEqual(mirror, t.snapshot());
  assert.equal(Object.getPrototypeOf(mirror), Object.prototype);
});

test("raw assignment aliases are adopted and raw writes are found at drain", () => {
  const defaults = { child: { x: 0 } };
  const t = createTracked(defaults);
  defaults.child.x = 8;
  assert.equal(t.state.child.x, 0);
  const raw = { x: 1 };
  t.state.child = raw;
  t.drain();
  raw.x = 9;
  assert.equal(t.state.child.x, 9);
  assert.equal(t.dirty, true);
  assert.deepEqual(t.drain(), [{ op: "set", path: ["child", "x"], value: 9 }]);
  t.state.child.x = 10;
  assert.equal(raw.x, 10);
  assert.equal(t.drain().length, 1);
});

test("dispose separates lifetimes and retained references stay mutable", () => {
  const t = createTracked({ child: { x: 1 } });
  const held = t.state.child;
  held.x = 2;
  t.dispose();
  t.dispose();
  held.x = 3;
  assert.equal(held.x, 3);
  assert.equal(t.dirty, false);
  assert.throws(() => t.drain(), /disposed/);
  assert.throws(() => t.snapshot(), /disposed/);
  assert.throws(() => t.reconcile({}, { mode: "merge" }), /disposed/);
  assert.equal(createTracked({ child: { x: 1 } }).state.child.x, 1);
});

test("deterministic randomized mirror across writes, aliases, arrays and reconcile", () => {
  for (let seed = 1; seed <= 20; seed++) {
    let randomState = seed;
    const random = (n: number) => {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      return randomState % n;
    };
    const t = createTracked<{
      objects: Record<string, { x: number }>;
      items: number[];
    }>({ objects: { a: { x: 0 }, b: { x: 1 } }, items: [1, 2] });
    let mirror = t.snapshot();
    const retained: { x: number }[] = [];
    for (let i = 0; i < 1000; i++) {
      const key = String(random(8));
      switch (random(13)) {
        case 0:
          t.state.objects[key] = { x: random(100) };
          break;
        case 1:
          if (t.state.objects[key]) {
            retained.push(t.state.objects[key]);
            delete t.state.objects[key];
          }
          break;
        case 2:
          if (t.state.objects[key]) t.state.objects[key].x = random(100);
          break;
        case 3:
          if (retained.length)
            retained[random(retained.length)]!.x = random(100);
          break;
        case 4:
          if (retained.length)
            t.state.objects[key] = retained[random(retained.length)]!;
          break;
        case 5:
          t.state.items.push(random(100));
          break;
        case 6:
          t.state.items.splice(random(t.state.items.length + 1), random(3));
          break;
        case 7:
          t.state.items.reverse();
          break;
        case 8:
          t.state.items.length = random(15);
          break;
        case 11:
          t.state.items.unshift(random(100));
          break;
        case 12:
          t.state.items.shift();
          break;
        case 10:
          t.reconcile({
            objects: { a: { x: random(100) } },
            items: [random(100)],
          });
          break;
        case 9:
          t.state.objects = { a: { x: random(100) } };
          break;
      }
      if (random(5) === 0) {
        mirror = applyPatches(mirror, JSON.parse(JSON.stringify(t.drain())));
        assert.deepEqual(mirror, t.snapshot(), `seed ${seed} operation ${i}`);
      }
    }
    mirror = applyPatches(mirror, t.drain());
    assert.deepEqual(mirror, t.snapshot());
  }
});

test("alias reconciliation conflicts reject before mutation", () => {
  const shared = { x: 0 };
  const t = createTracked({ a: shared, b: shared });
  assert.throws(() => t.reconcile({ a: { x: 1 }, b: { x: 2 } }), /Conflicting/);
  assert.equal(t.state.a.x, 0);
  assert.equal(t.dirty, false);
  t.reconcile({ a: { x: 1 }, b: { x: 1 } });
  assert.equal(t.state.a, t.state.b);
  assert.equal(t.state.a.x, 1);
});

test("reflection returns stable proxies and nested proxy adoption stays connected", () => {
  const t = createTracked({ child: { x: 1 }, holder: { child: { x: 0 } } });
  const reflected = Object.getOwnPropertyDescriptor(t.state, "child")!.value;
  assert.equal(reflected, t.state.child);
  reflected.x = 2;
  assert.equal(t.drain().length, 1);
  t.state.holder = { child: t.state.child };
  t.drain();
  t.state.child.x = 3;
  assert.equal(t.drain().length, 2);
});

test("invalid defaults/root and runtime values reject eagerly without corrupting state", () => {
  for (const value of [null, 2, "x", new Date(), { x: 10n }, { x: Infinity }])
    assert.throws(() => createTracked(value as object));
  const t = createTracked({ x: 1 });
  assert.throws(() => Reflect.set(t.state, "x", 10n));
  assert.throws(() => {
    t.state.x = Infinity;
  });
  assert.equal(t.state.x, 1);
  assert.deepEqual(t.drain(), []);
});

test("patch application invokes receiver set traps for UI reactivity", () => {
  let notifications = 0;
  const ui = new Proxy(
    { cutoff: 0 },
    {
      set(target, key, value) {
        notifications++;
        return Reflect.set(target, key, value);
      },
    },
  );
  applyPatches(ui, [{ op: "set", path: ["cutoff"], value: 0.7 }]);
  assert.equal(notifications, 1);
  assert.equal(ui.cutoff, 0.7);
});

test("sparse array edits emit indexed/leaf patches; dense and structural edits replace", () => {
  const t = createTracked({
    items: Array.from({ length: 10000 }, (_, x) => ({ x })),
    numbers: Array.from({ length: 10000 }, (_, x) => x),
  });
  let mirror = t.snapshot();
  t.state.items[500]!.x = -1;
  t.state.numbers[900] = -2;
  const patches = t.drain();
  assert.deepEqual(patches, [
    { op: "set", path: ["items", "500", "x"], value: -1 },
    { op: "set", path: ["numbers", "900"], value: -2 },
  ]);
  mirror = applyPatches(mirror, patches);
  assert.deepEqual(mirror, t.snapshot());
  for (let i = 0; i < 100; i++) t.state.numbers[i] = -i;
  assert.deepEqual(
    t.drain().map((p) => p.path),
    [["numbers"]],
  );
  t.state.numbers[20000] = 1;
  assert.deepEqual(
    t.drain().map((p) => p.path),
    [["numbers"]],
  );
  delete t.state.items[1];
  assert.deepEqual(
    t.drain().map((p) => p.path),
    [["items"]],
  );
});

test("front shifting preserves mirrors and held object identity at scale", () => {
  for (const size of [1000, 10000]) {
    const t = createTracked({
      items: Array.from({ length: size }, (_, x) => ({ x })),
    });
    let mirror = t.snapshot();
    const held = t.state.items[0]!;
    t.state.items.unshift({ x: -1 });
    held.x = 42;
    assert.equal(t.state.items[1], held);
    mirror = applyPatches(mirror, t.drain());
    assert.deepEqual(mirror, t.snapshot());
    t.state.items.shift();
    assert.equal(t.state.items[0], held);
    mirror = applyPatches(mirror, t.drain());
    assert.deepEqual(mirror, t.snapshot());
  }
});
