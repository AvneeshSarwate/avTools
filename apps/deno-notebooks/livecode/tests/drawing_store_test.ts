import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import type { DrawingSetResult } from "@avtools/livecode-protocol";
import {
  createEmptyDrawingDocument,
  makeCircleNode,
  makeStrokeNode,
  upsertDrawingNode,
} from "@avtools/drawing-document";
import {
  clearDrawingStore,
  collectDrawingChanges,
  createEmptyDrawing,
  drawing,
  duplicateDrawing,
  getDrawing,
  loadDrawing,
  removeDrawing,
  setDrawing,
} from "@avtools/livecode-engine/drawing_store.ts";

function reset(): void {
  clearDrawingStore();
  collectDrawingChanges();
}

function successful(result: DrawingSetResult) {
  if (!result.ok) throw new Error(result.error);
  return result.drawing;
}

function docWithCircle(x = 10) {
  const doc = createEmptyDrawingDocument();
  doc.circle.nodes.push(
    makeCircleNode({ id: "c", x, y: 20, radius: 5, creationTime: 1 }),
  );
  return doc;
}

Deno.test("drawing() creates once, reattaches, and never overwrites content", () => {
  reset();
  const first = drawing("  test/reattach  ", docWithCircle());
  assertEquals(first.name, "test/reattach");
  assertEquals(getDrawing(first.name)?.rev, 1);
  assertEquals(getDrawing(first.name)?.updatedBy, "declare");
  assertEquals(first.document().circle.nodes[0].transform, { x: 10, y: 20 });

  const second = drawing("test/reattach", docWithCircle(99));
  assertEquals(second.document(), first.document());
  assertEquals(second.rev(), 1);

  // The returned document is a copy: mutating it changes nothing until set.
  const copy = first.document();
  copy.circle.nodes = [];
  assertEquals(first.document().circle.nodes.length, 1);
});

Deno.test("set normalizes, detects no-ops, and rejects invalid documents atomically", () => {
  reset();
  const handle = drawing("test/set", docWithCircle());
  const before = getDrawing(handle.name)!;

  // Same content in a different key order and with default transform fields:
  // canonical form is identical, so the write is a no-op.
  const noop = successful(setDrawing(handle.name, {
    version: 1,
    circle: {
      transform: { x: 0 },
      nodes: [{
        creationTime: 1,
        transform: { y: 20, x: 10, scaleX: 1 },
        radius: 5,
        id: "c",
        type: "circle",
      }],
    },
    polygon: { nodes: [] },
    freehand: { nodes: [] },
  }));
  assertEquals(noop.rev, before.rev);

  const invalid = handle.set({
    ...handle.document(),
    polygon: { nodes: [{ type: "group", id: "g", children: [] } as never] },
  });
  assert(!invalid.ok);
  assert(invalid.error.includes("cannot contain groups"));
  assertEquals(invalid.current?.rev, before.rev);
  assertEquals(getDrawing(handle.name)?.data, before.data);

  const moved = successful(handle.update((doc) => {
    upsertDrawingNode(
      doc.circle,
      makeCircleNode({ id: "c", x: 30, y: 20, radius: 5, creationTime: 1 }),
    );
  }, { originId: "module:test" }));
  assertEquals(moved.rev, before.rev + 1);
  assertEquals(moved.updatedBy, "module:test");
  assertEquals(moved.data.circle.nodes[0].transform, { x: 30, y: 20 });
});

Deno.test("compare-and-set rejects a stale revision", () => {
  reset();
  const handle = drawing("test/cas", docWithCircle());
  const rev = handle.rev();
  successful(handle.update((doc) => {
    doc.freehand.nodes.push(makeStrokeNode({ id: "s", points: [0, 0, 1, 1] }));
  }));
  const stale = handle.set(docWithCircle(50), { expectedRev: rev });
  assert(!stale.ok);
  assert(stale.error.includes("changed before this edit"));
  assertEquals(stale.current?.rev, rev + 1);
  const fresh = handle.set(docWithCircle(50), { expectedRev: rev + 1 });
  assert(fresh.ok);
});

Deno.test("render bakes without Konva and caches per revision", () => {
  reset();
  const handle = drawing("test/render", docWithCircle());
  const first = handle.render();
  assertEquals(first.circle[0].center, { x: 10, y: 20 });
  assertEquals(first.circle[0].r, 5);
  assert(handle.render() === first, "unchanged rev returns the cached bake");

  successful(handle.update((doc) => {
    upsertDrawingNode(
      doc.circle,
      makeCircleNode({ id: "c", x: 40, y: 20, radius: 5, creationTime: 1 }),
    );
  }));
  const second = handle.render();
  assert(second !== first);
  assertEquals(second.circle[0].center, { x: 40, y: 20 });
});

Deno.test("create, duplicate, load, remove, and change collection", () => {
  reset();
  const created = createEmptyDrawing("test/crud");
  assertEquals(created.data, createEmptyDrawingDocument());
  assertThrows(() => createEmptyDrawing("test/crud"), Error, "already exists");

  successful(setDrawing("test/crud", docWithCircle()));
  const copy = duplicateDrawing("test/crud", "test/crud-copy");
  assertEquals(copy.data, getDrawing("test/crud")?.data);
  assertEquals(copy.updatedBy, "duplicate");
  assertThrows(
    () => duplicateDrawing("test/crud", "test/crud-copy"),
    Error,
    "already exists",
  );
  assertThrows(
    () => duplicateDrawing("test/missing", "test/x"),
    Error,
    "No drawing",
  );

  const loaded = loadDrawing("test/crud", docWithCircle(7));
  assertEquals(loaded.updatedBy, "load");
  assertEquals(loaded.data.circle.nodes[0].transform, { x: 7, y: 20 });
  assertThrows(
    () => loadDrawing("test/crud", { version: 3 }),
    Error,
    "version",
  );
  const fresh = loadDrawing("test/fresh", docWithCircle());
  assertEquals(fresh.rev, 1);

  const changes = collectDrawingChanges();
  assert(changes);
  assertEquals(
    changes.map((change) => [change.name, change.entity === null]),
    [["test/crud", false], ["test/crud-copy", false], ["test/fresh", false]],
  );
  assertEquals(collectDrawingChanges(), null);

  assertEquals(removeDrawing("test/crud-copy"), true);
  assertEquals(removeDrawing("test/crud-copy"), false);
  assertEquals(
    collectDrawingChanges()?.map((change) => [change.name, change.entity]),
    [["test/crud-copy", null]],
  );
});
