import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import type { DrawingSetResult } from "@avtools/livecode-protocol";
import {
  createEmptyDrawingDocument,
  makeCircleNode,
  makeGroupNode,
  makePolygonNode,
  makeStrokeNode,
  upsertDrawingNode,
} from "@avtools/drawing-document";
import {
  clearDrawingStore,
  collectDrawingChanges,
  createEmptyDrawing,
  diffDrawingDocuments,
  drawing,
  duplicateDrawing,
  getDrawing,
  loadDrawing,
  patchDrawing,
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

const paths = (changes: ReturnType<typeof collectDrawingChanges>) =>
  changes!.map((change) =>
    change.patches
      ? change.patches.map((patch) => patch.path.join("/"))
      : change.entity === null
      ? null
      : "full"
  );

Deno.test("a whole-document set ships the changed nodes by index, a reshape ships the layer", () => {
  reset();
  const handle = drawing("test/diff", docWithCircle());
  assertEquals(paths(collectDrawingChanges()), ["full"]);

  successful(handle.update((doc) => {
    upsertDrawingNode(
      doc.circle,
      makeCircleNode({ id: "c", x: 30, y: 20, radius: 5, creationTime: 1 }),
    );
    doc.freehand.transform = { x: 4 };
  }));
  assertEquals(paths(collectDrawingChanges()), [[
    "data/freehand/transform",
    "data/circle/nodes/0",
    "rev",
    "updatedAt",
    "updatedBy",
  ]]);

  // Appending a node reshapes the layer: the node array ships whole. A tension
  // flip also changes the document version.
  successful(handle.update((doc) => {
    doc.polygon.nodes.push(makePolygonNode({
      id: "p",
      points: [0, 0, 1, 0, 1, 1],
      tension: 0.5,
      creationTime: 1,
    }));
    delete doc.freehand.transform;
  }));
  assertEquals(paths(collectDrawingChanges()), [[
    "data/version",
    "data/freehand/transform",
    "data/polygon/nodes",
    "rev",
    "updatedAt",
    "updatedBy",
  ]]);
  const prev = handle.document();
  const next = handle.document();
  next.circle.nodes[0].metadata = { name: "c" };
  assertEquals(
    diffDrawingDocuments(prev, next).map((patch) => patch.path.join("/")),
    ["circle/nodes/0"],
  );
  assertEquals(diffDrawingDocuments(prev, prev), []);

  // Several writes in one tick accumulate; a load in the same tick makes the
  // whole entity ship instead, so a client never applies a patch to a
  // baseline it has not received.
  successful(handle.update((doc) => {
    doc.circle.nodes[0].radius = 6;
  }));
  loadDrawing(handle.name, docWithCircle(1));
  assertEquals(paths(collectDrawingChanges()), ["full"]);
});

Deno.test("node patches replace by id at any depth, append, delete, and validate whole", () => {
  reset();
  const handle = drawing("test/patch", docWithCircle());
  collectDrawingChanges();
  const rev = handle.rev();

  // Upsert an existing top-level node, append a new one on another layer.
  const result = patchDrawing(handle.name, {
    upserts: [
      {
        layer: "circle",
        node: makeCircleNode({
          id: "c",
          x: 50,
          y: 20,
          radius: 5,
          creationTime: 1,
        }),
      },
      {
        layer: "freehand",
        node: makeStrokeNode({
          id: "s",
          points: [0, 0, 1, 1],
          creationTime: 2,
        }),
      },
    ],
  }, { originId: "view" });
  assertEquals(result, { ok: true, rev: rev + 1 });
  assertEquals(getDrawing(handle.name)?.updatedBy, "view");
  assertEquals(handle.document().circle.nodes[0].transform, { x: 50, y: 20 });
  assertEquals(handle.document().freehand.nodes.map((n) => n.id), ["s"]);
  assertEquals(paths(collectDrawingChanges()), [[
    "data/circle/nodes/0",
    "data/freehand/nodes/0",
    "rev",
    "updatedAt",
    "updatedBy",
  ]]);

  // An identical upsert is a no-op: no rev bump, nothing to ship.
  const same = patchDrawing(handle.name, {
    upserts: [{
      layer: "circle",
      node: makeCircleNode({
        id: "c",
        x: 50,
        y: 20,
        radius: 5,
        creationTime: 1,
      }),
    }],
  });
  assertEquals(same, { ok: true, rev: rev + 1 });
  assertEquals(collectDrawingChanges(), null);

  // A stroke inside a group is replaced in place; the top-level group ships.
  successful(handle.update((doc) => {
    doc.freehand.nodes = [makeGroupNode({
      id: "g",
      children: [doc.freehand.nodes[0]],
      transform: { x: 9 },
    })];
  }));
  collectDrawingChanges();
  const nested = patchDrawing(handle.name, {
    upserts: [{
      layer: "freehand",
      node: makeStrokeNode({ id: "s", points: [5, 5, 6, 6], creationTime: 2 }),
    }],
  });
  assert(nested.ok);
  const group = handle.document().freehand.nodes[0];
  assert(group.type === "group" && group.transform?.x === 9);
  assertEquals(
    group.type === "group" && group.children[0].type === "stroke" &&
      group.children[0].points,
    [5, 5, 6, 6],
  );
  assertEquals(paths(collectDrawingChanges()), [[
    "data/freehand/nodes/0",
    "rev",
    "updatedAt",
    "updatedBy",
  ]]);

  // Deleting reshapes the layer; a delete of a missing id changes nothing.
  const deleted = patchDrawing(handle.name, {
    deletes: [{ layer: "freehand", id: "s" }, { layer: "circle", id: "nope" }],
  });
  assert(deleted.ok);
  const emptied = handle.document().freehand.nodes[0];
  assertEquals(emptied.type === "group" && emptied.children, []);
  assertEquals(paths(collectDrawingChanges()), [[
    "data/freehand/nodes",
    "rev",
    "updatedAt",
    "updatedBy",
  ]]);

  // Validation happens before any write: a bad node, a duplicate id, a group
  // on the polygon layer, an unknown layer, and a stale revision all leave
  // the document untouched.
  const before = handle.document();
  const revBefore = handle.rev();
  const cases: Array<Parameters<typeof patchDrawing>[1]> = [
    {
      upserts: [{
        layer: "circle",
        node: { type: "circle", id: "x", radius: -1, creationTime: 0 } as never,
      }],
    },
    {
      upserts: [{
        layer: "polygon",
        node: makeGroupNode({ id: "pg", children: [] }),
      }],
    },
    {
      upserts: [{
        layer: "circle",
        node: makeCircleNode({ id: "g", x: 0, y: 0, radius: 1 }),
      }],
    },
    {
      upserts: [{
        layer: "shapes" as never,
        node: makeCircleNode({ id: "z", x: 0, y: 0, radius: 1 }),
      }],
    },
    { deletes: [{ layer: "circle", id: "" }] },
  ];
  for (const edits of cases) {
    const rejected = patchDrawing(handle.name, edits);
    assert(!rejected.ok && rejected.status === 422, JSON.stringify(edits));
  }
  const stale = patchDrawing(handle.name, {
    upserts: [{
      layer: "circle",
      node: makeCircleNode({ id: "c", x: 1, y: 1, radius: 1 }),
    }],
  }, { expectedRev: revBefore - 1 });
  assert(!stale.ok && stale.status === 409);
  const missing = patchDrawing("test/none", { upserts: [] });
  assert(!missing.ok && missing.status === 404);
  assertEquals(handle.document(), before);
  assertEquals(handle.rev(), revBefore);
  assertEquals(collectDrawingChanges(), null);

  // A tension flip through a patch keeps the document version consistent.
  const curved = patchDrawing(handle.name, {
    upserts: [{
      layer: "polygon",
      node: makePolygonNode({
        id: "p",
        points: [0, 0, 1, 0, 1, 1],
        tension: 0.4,
      }),
    }],
  });
  assert(curved.ok);
  assertEquals(handle.document().version, 2);
  assertEquals(paths(collectDrawingChanges()), [[
    "data/polygon/nodes/0",
    "data/version",
    "rev",
    "updatedAt",
    "updatedBy",
  ]]);
});
