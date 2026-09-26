import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  bakeDrawingDocument,
  createEmptyDrawingDocument,
  type DrawingDocument,
  findDrawingNode,
  konvaTensionPoints,
  makeCircleNode,
  makeGroupNode,
  makePolygonNode,
  makeStrokeNode,
  normalizeDrawingDocument,
  type PolygonCurveSegment,
  polygonCurveSegments,
  removeDrawingNode,
  sampleCurveSegments,
  transformToMatrix,
  upsertDrawingNode,
} from "@avtools/drawing-document";

const near = (actual: number, expected: number, eps = 1e-9) => {
  assert(
    Math.abs(actual - expected) <= eps,
    `expected ${actual} to be within ${eps} of ${expected}`,
  );
};

Deno.test("an empty document normalizes to itself", () => {
  const empty = createEmptyDrawingDocument();
  assertEquals(normalizeDrawingDocument(empty), empty);
  assertEquals(normalizeDrawingDocument({}), empty);
});

Deno.test("normalization canonicalizes key order and default transforms", () => {
  const a = normalizeDrawingDocument({
    circle: {
      nodes: [{
        metadata: { name: "c" },
        creationTime: 5,
        radius: 10,
        transform: { scaleY: 1, rotation: 0, y: 4, x: 3, offsetX: 0 },
        id: "c1",
        type: "circle",
      }],
      transform: { x: 0, scaleX: 1 },
    },
    polygon: { nodes: [] },
  });
  const b = normalizeDrawingDocument({
    version: 1,
    freehand: { nodes: [] },
    polygon: { nodes: [] },
    circle: {
      nodes: [{
        type: "circle",
        id: "c1",
        radius: 10,
        creationTime: 5,
        transform: { x: 3, y: 4 },
        metadata: { name: "c" },
      }],
    },
  });
  assertEquals(JSON.stringify(a), JSON.stringify(b));
  assertEquals(a.circle.transform, undefined);
  assertEquals(a.circle.nodes[0].transform, { x: 3, y: 4 });
});

Deno.test("a stroke's position defaults to its points' minimum corner", () => {
  const doc = normalizeDrawingDocument({
    freehand: {
      nodes: [
        makeStrokeNode({
          id: "s",
          points: [10, 20, 30, 5],
          transform: { x: 10, y: 5 },
        }),
        makeStrokeNode({
          id: "moved",
          points: [10, 20, 30, 5],
          transform: { x: 11, y: 5 },
        }),
      ],
    },
  });
  assertEquals(doc.freehand.nodes[0].transform, undefined);
  assertEquals(doc.freehand.nodes[1].transform, { x: 11 });
});

Deno.test("normalization rejects malformed documents without partial results", () => {
  const cases: Array<[unknown, string]> = [
    [{ version: 3 }, "version"],
    [{
      freehand: {
        nodes: [{ type: "circle", id: "x", radius: 1, creationTime: 0 }],
      },
    }, "freehand layer"],
    [
      { polygon: { nodes: [{ type: "group", id: "g", children: [] }] } },
      "cannot contain groups",
    ],
    [{
      polygon: {
        nodes: [{
          type: "polygon",
          id: "p",
          points: [1, 2, 3],
          closed: true,
          creationTime: 0,
        }],
      },
    }, "even length"],
    [{
      polygon: {
        nodes: [{
          type: "polygon",
          id: "p",
          points: [0, 0, 1, 0, 1, 1],
          closed: true,
          tension: Infinity,
          creationTime: 0,
        }],
      },
    }, "tension"],
    [{
      freehand: {
        nodes: [{
          type: "stroke",
          id: "s",
          points: [1, 2, 3, 4],
          timestamps: [0],
          creationTime: 0,
          isFreehand: true,
        }],
      },
    }, "one entry per point pair"],
    [{
      circle: {
        nodes: [{ type: "circle", id: "c", radius: 0, creationTime: 0 }],
      },
    }, "positive"],
    [{
      circle: {
        nodes: [{ type: "circle", id: "c", radius: NaN, creationTime: 0 }],
      },
    }, "finite"],
    [{
      circle: {
        nodes: [{
          type: "circle",
          id: "c",
          radius: 1,
          creationTime: 0,
          transform: { x: Infinity },
        }],
      },
    }, "transform.x"],
    [{
      circle: {
        nodes: [{ type: "circle", id: "c", radius: 1, creationTime: 0 }, {
          type: "circle",
          id: "c",
          radius: 1,
          creationTime: 0,
        }],
      },
    }, "more than once"],
    [{
      circle: {
        nodes: [{ type: "circle", id: "", radius: 1, creationTime: 0 }],
      },
    }, "non-empty"],
    [{
      circle: {
        nodes: [{
          type: "circle",
          id: "c",
          radius: 1,
          creationTime: 0,
          metadata: [],
        }],
      },
    }, "metadata"],
  ];
  for (const [input, message] of cases) {
    assertThrows(() => normalizeDrawingDocument(input), Error, message);
  }
});

Deno.test("transformToMatrix composes translate, rotate, skew, scale, and offset like Konva", () => {
  assertEquals(transformToMatrix(undefined), [1, 0, 0, 1, 0, 0]);
  const m = transformToMatrix({ x: 10, y: 20, rotation: 90, scaleX: 2 });
  // Rotating (1, 0) by 90 degrees then scaling x by 2: local (1,0) -> (10, 22).
  near(m[0] * 1 + m[2] * 0 + m[4], 10);
  near(m[1] * 1 + m[3] * 0 + m[5], 22);
  const offset = transformToMatrix({ offsetX: 5, offsetY: 5 });
  assertEquals(offset, [1, 0, 0, 1, -5, -5]);
  const skew = transformToMatrix({ skewX: 1 });
  assertEquals(skew, [1, 0, 1, 1, 0, 0]);
  // Skew applies before scale: Konva 9.3's getTransform() gives these for
  // skew combined with a non-uniform scale and a rotation.
  const skewed = transformToMatrix({ skewX: 0.1, scaleY: 0.6 });
  [1, 0, 0.06, 0.6, 0, 0].forEach((value, i) => near(skewed[i], value));
  const full = transformToMatrix({
    x: 15,
    scaleX: 1.8,
    scaleY: 0.6,
    rotation: 20,
    skewX: 0.1,
  });
  [1.6914, 0.6156, -0.1488, 0.5843, 15, 0]
    .forEach((value, i) => near(full[i], value, 1e-4));
});

Deno.test("baking strokes applies group and layer transforms and keeps timing", () => {
  const doc = normalizeDrawingDocument({
    freehand: {
      transform: { scaleX: 2, scaleY: 2 },
      nodes: [
        makeStrokeNode({
          id: "lone",
          points: [10, 10, 20, 15],
          timestamps: [0, 16],
          metadata: { name: "alpha" },
        }),
        makeGroupNode({
          id: "g",
          transform: { x: 100, rotation: 90 },
          metadata: { name: "letters" },
          children: [
            makeStrokeNode({
              id: "a",
              points: [0, 0, 10, 0],
              timestamps: [0, 8],
            }),
            makeGroupNode({
              id: "inner",
              children: [makeStrokeNode({ id: "b", points: [0, 0, 0, 10] })],
            }),
          ],
        }),
      ],
    },
  });
  const baked = bakeDrawingDocument(doc);

  assertEquals(baked.freehand.length, 2);
  // A top-level stroke is wrapped in a group with the stroke's own id.
  assertEquals(baked.freehand[0].id, "lone");
  assertEquals(baked.freehand[0].children.length, 1);
  const lone = baked.freehand[0].children[0];
  assert(lone.type === "stroke");
  assertEquals(
    lone.points.map((p) => [p.x, p.y, p.ts]),
    [[20, 20, 0], [40, 30, 16]],
  );
  assertEquals(lone.metadata, { name: "alpha" });

  const group = baked.freehand[1];
  assertEquals(group.id, "g");
  assertEquals(group.metadata, { name: "letters" });
  const a = group.children[0];
  assert(a.type === "stroke" && a.id === "a");
  // Local (10, 0) rotated 90 degrees about the group origin at x=100, then the
  // layer doubles it: (100, 10) -> (200, 20).
  near(a.points[1].x, 200);
  near(a.points[1].y, 20);
  assertEquals(a.points[1].ts, 8);
  const inner = group.children[1];
  assert(inner.type === "strokeGroup" && inner.id === "inner");
  const b = inner.children[0];
  assert(b.type === "stroke" && b.id === "b");
  near(b.points[1].x, 180);
  near(b.points[1].y, 0);

  assertEquals(baked.freehandGroupMap, {
    alpha: [0],
    letters: [1, 2],
    inner: [2],
  });
});

Deno.test("baking an empty group drops it, as the canvas does", () => {
  const baked = bakeDrawingDocument(normalizeDrawingDocument({
    freehand: { nodes: [makeGroupNode({ id: "empty", children: [] })] },
  }));
  assertEquals(baked.freehand, []);
});

Deno.test("baking polygons transforms points and keeps metadata", () => {
  const baked = bakeDrawingDocument(normalizeDrawingDocument({
    polygon: {
      nodes: [makePolygonNode({
        id: "p",
        points: [0, 0, 10, 0, 10, 10],
        transform: { x: 5, y: 5, scaleX: 2 },
        metadata: { kind: "zone" },
      })],
    },
  }));
  assertEquals(baked.polygon, [{
    type: "polygon",
    id: "p",
    points: [{ x: 5, y: 5 }, { x: 25, y: 5 }, { x: 25, y: 15 }],
    metadata: { kind: "zone" },
  }]);
});

Deno.test("baking circles reduces the transform stack to an ellipse", () => {
  const baked = bakeDrawingDocument(normalizeDrawingDocument({
    circle: {
      nodes: [
        makeCircleNode({
          id: "round",
          x: 50,
          y: 60,
          radius: 20,
          metadata: { name: "dot" },
        }),
        makeGroupNode({
          id: "pair",
          transform: { rotation: 30 },
          children: [
            makeCircleNode({
              id: "squashed",
              x: 100,
              y: 0,
              radius: 10,
              transform: { scaleY: 0.5 },
            }),
          ],
        }),
      ],
    },
  }));
  const round = baked.circle[0];
  assertEquals(round.id, "round");
  assertEquals(round.center, { x: 50, y: 60 });
  assertEquals(round.r, 20);
  assertEquals(round.rotation, 0);
  assertEquals(round.metadata, { name: "dot" });

  const squashed = baked.circle[1];
  assertEquals(squashed.id, "squashed");
  assertEquals(squashed.r, undefined);
  near(squashed.rx, 10);
  near(squashed.ry, 5);
  near(squashed.rotation, Math.PI / 6);
  near(squashed.center.x, 100 * Math.cos(Math.PI / 6));
  near(squashed.center.y, 100 * Math.sin(Math.PI / 6));

  assertEquals(baked.circleGroupMap, { dot: [0], pair: [1] });
});

Deno.test("node constructors and layer helpers", () => {
  const doc: DrawingDocument = createEmptyDrawingDocument();
  const circle = makeCircleNode({ id: "c", x: 1, y: 2, radius: 3 });
  assertEquals(circle.transform, { x: 1, y: 2 });
  assertEquals(upsertDrawingNode(doc.circle, circle), false);
  assertEquals(
    upsertDrawingNode(
      doc.circle,
      makeCircleNode({ id: "c", x: 9, y: 9, radius: 3 }),
    ),
    true,
  );
  assertEquals(doc.circle.nodes.length, 1);
  assertEquals(findDrawingNode(doc, "c")?.transform, { x: 9, y: 9 });

  const stroke = makeStrokeNode({ points: [0, 0, 1, 1, 2, 2] });
  assertEquals(stroke.timestamps, [0, 0, 0]);
  assertEquals(stroke.isFreehand, false);
  const timed = makeStrokeNode({ points: [0, 0, 1, 1], timestamps: [0, 12] });
  assertEquals(timed.isFreehand, true);
  assert(stroke.id.startsWith("stroke_"));

  const group = makeGroupNode({ id: "g", children: [stroke] });
  doc.freehand.nodes.push(group);
  assertEquals(findDrawingNode(doc.freehand, stroke.id)?.id, stroke.id);
  assertEquals(removeDrawingNode(doc.freehand, stroke.id), true);
  assertEquals(group.children.length, 0);
  assertEquals(removeDrawingNode(doc.freehand, stroke.id), false);

  // Constructed documents are valid documents.
  doc.polygon.nodes.push(makePolygonNode({ points: [0, 0, 1, 0, 1, 1] }));
  normalizeDrawingDocument(doc);
});

// Konva 9.3.22 `Line#getTensionPoints()` for these inputs, captured from the
// real library. The port must match exactly, including the skipped control
// points of a vertex whose neighbours coincide (the last case).
const KONVA_TENSION_CASES: Array<{
  points: number[];
  tension: number;
  closed: boolean;
  expected: number[];
}> = [
  {
    points: [0, 0, 10, 5, 20, 0, 30, 10],
    tension: 0.5,
    closed: false,
    expected: [
      5,
      5,
      10,
      5,
      15,
      5,
      15.584815598877471,
      -1.1037961002806322,
      20,
      0,
      25.58481559887747,
      1.3962038997193678,
    ],
  },
  {
    points: [0, 0, 40, 0, 40, 30],
    tension: 0.4,
    closed: true,
    expected: [
      0,
      -5.333333333333334,
      30.857142857142858,
      -6.857142857142857,
      40,
      0,
      46.85714285714286,
      5.142857142857143,
      46,
      30,
      40,
      30,
      30,
      30,
      0,
      6.666666666666666,
      0,
      0,
    ],
  },
  {
    points: [0, 0, 40, 0, 40, 30, 10, 35],
    tension: -0.3,
    closed: true,
    expected: [
      -4.712007997436608,
      5.497342663676043,
      46.85714285714286,
      5.142857142857143,
      40,
      0,
      34.85714285714286,
      -3.8571428571428568,
      35.53082336389613,
      35.21403940878784,
      40,
      30,
      44.53082336389614,
      24.71403940878784,
      4.537615261773206,
      30.903211446329905,
      10,
      35,
      16.537615261773205,
      39.903211446329905,
      4.287992002563392,
      -5.002657336323957,
      0,
      0,
    ],
  },
  {
    points: [0, 0, 10, 10, 10, 10, 10, 10, 20, 0],
    tension: 0.5,
    closed: false,
    expected: [5, 5, 10, 10, 10, 10, 10, 10, 10, 10, 15, 5],
  },
];

Deno.test("konvaTensionPoints matches Konva's own output", () => {
  for (const { points, tension, closed, expected } of KONVA_TENSION_CASES) {
    assertEquals(konvaTensionPoints(points, tension, closed), expected);
  }
});

const segmentEnds = (segments: PolygonCurveSegment[]) =>
  segments.map((segment) => [
    segment.type,
    segment.from.x,
    segment.from.y,
    segment.to.x,
    segment.to.y,
  ]);

Deno.test("curve segments run vertex to vertex like Konva's scene function", () => {
  // Open: quadratic first and last spans, cubics between.
  const open = polygonCurveSegments([0, 0, 10, 5, 20, 0, 30, 10], 0.5, false)!;
  assertEquals(segmentEnds(open), [
    ["quadratic", 0, 0, 10, 5],
    ["cubic", 10, 5, 20, 0],
    ["quadratic", 20, 0, 30, 10],
  ]);
  assertEquals(open[0].type === "quadratic" && open[0].control, { x: 5, y: 5 });
  // Closed: cubics throughout, one per edge including the closing one.
  const closed = polygonCurveSegments([0, 0, 40, 0, 40, 30], 0.4, true)!;
  assertEquals(segmentEnds(closed), [
    ["cubic", 0, 0, 40, 0],
    ["cubic", 40, 0, 40, 30],
    ["cubic", 40, 30, 0, 0],
  ]);
  // Straight: zero tension, or too few points for Konva to curve.
  assertEquals(polygonCurveSegments([0, 0, 10, 5, 20, 0], 0, false), null);
  assertEquals(polygonCurveSegments([0, 0, 10, 5], 0.5, false), null);
});

Deno.test("sampling curve segments starts and ends on the vertices", () => {
  const segments = polygonCurveSegments([0, 0, 40, 0, 40, 30], 0.4, true)!;
  const samples = sampleCurveSegments(segments, 8);
  assertEquals(samples.length, 1 + 3 * 8);
  assertEquals(samples[0], { x: 0, y: 0 });
  assertEquals(samples[8], { x: 40, y: 0 });
  assertEquals(samples[16], { x: 40, y: 30 });
  assertEquals(samples[24], { x: 0, y: 0 });
  assertEquals(sampleCurveSegments([]), []);
});

Deno.test("tension is canonical and marks the document as version 2", () => {
  const straight = normalizeDrawingDocument({
    version: 1,
    polygon: {
      nodes: [{
        type: "polygon",
        id: "p",
        points: [0, 0, 10, 0, 10, 10],
        closed: true,
        tension: 0,
        creationTime: 0,
      }],
    },
  });
  // A zero tension is dropped, so straight drawings stay version 1 and their
  // canonical JSON is unchanged.
  assertEquals(straight.version, 1);
  assertEquals("tension" in straight.polygon.nodes[0], false);

  const curved = normalizeDrawingDocument({
    version: 1,
    polygon: {
      nodes: [
        makePolygonNode({
          id: "p",
          points: [0, 0, 10, 0, 10, 10],
          tension: 0.5,
        }),
      ],
    },
  });
  assertEquals(curved.version, 2);
  assertEquals(
    curved.polygon.nodes[0].type === "polygon" &&
      curved.polygon.nodes[0].tension,
    0.5,
  );
  assertEquals(normalizeDrawingDocument(curved), curved);
  assertEquals(
    "tension" in makePolygonNode({ points: [0, 0, 1, 1], tension: 0 }),
    false,
  );
});

Deno.test("baking a curved polygon computes the curve locally, then transforms it", () => {
  const points = [0, 0, 40, 0, 40, 30, 10, 35];
  const transform = { x: 5, y: -2, scaleX: 2.5, scaleY: 0.5, rotation: 30 };
  const baked = bakeDrawingDocument(normalizeDrawingDocument({
    polygon: {
      transform: { skewX: 0.2 },
      nodes: [makePolygonNode({ id: "p", points, tension: 0.5, transform })],
    },
  })).polygon[0];
  const matrix = (() => {
    const [a, b, c, d, e, f] = transformToMatrix({ skewX: 0.2 });
    const [a2, b2, c2, d2, e2, f2] = transformToMatrix(transform);
    return [
      a * a2 + c * b2,
      b * a2 + d * b2,
      a * c2 + c * d2,
      b * c2 + d * d2,
      a * e2 + c * f2 + e,
      b * e2 + d * f2 + f,
    ];
  })();
  const toWorld = (p: { x: number; y: number }) => ({
    x: matrix[0] * p.x + matrix[2] * p.y + matrix[4],
    y: matrix[1] * p.x + matrix[3] * p.y + matrix[5],
  });
  const local = polygonCurveSegments(points, 0.5, true)!;
  const segments = baked.segments!;
  assertEquals(segments.length, local.length);
  segments.forEach((segment, index) => {
    const expected = local[index];
    assertEquals(segment.type, expected.type);
    if (segment.type !== "cubic" || expected.type !== "cubic") return;
    for (const key of ["from", "control1", "control2", "to"] as const) {
      const want = toWorld(expected[key]);
      near(segment[key].x, want.x);
      near(segment[key].y, want.y);
    }
  });
  // Segment ends are the baked vertices.
  segments.forEach((segment, index) => {
    near(segment.from.x, baked.points[index].x);
    near(segment.from.y, baked.points[index].y);
  });
  // Recomputing the curve from world vertices would be wrong under
  // non-uniform scale and skew: that is why the bake carries segments.
  const worldFlat = baked.points.flatMap((p) => [p.x, p.y]);
  const fromWorld = polygonCurveSegments(worldFlat, 0.5, true)!;
  const first = fromWorld[0];
  assert(
    first.type === "cubic" && segments[0].type === "cubic" &&
      Math.abs(first.control1.x - segments[0].control1.x) > 1e-3,
  );
  // A straight polygon has no segments.
  const straight = bakeDrawingDocument(normalizeDrawingDocument({
    polygon: { nodes: [makePolygonNode({ id: "q", points })] },
  })).polygon[0];
  assertEquals("segments" in straight, false);
});
