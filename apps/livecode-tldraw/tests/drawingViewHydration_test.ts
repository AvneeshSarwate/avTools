import type {
  DrawingDocument,
  DrawingEntity,
} from "@avtools/livecode-protocol";
import {
  type AppliedDrawingView,
  decideDrawingHydration,
} from "../src/drawingViewHydration.ts";

const originId = "drawing-view-shape:1";
const firstElement = {};
const secondElement = {};

function document(label: string): DrawingDocument {
  return {
    version: 1,
    freehand: { type: "freehand", name: label, children: [] },
    polygon: { type: "polygon", name: label, children: [] },
    circle: { type: "circle", name: label, children: [] },
  } as unknown as DrawingDocument;
}

function entity(
  rev: number,
  data: DrawingDocument,
  updatedBy = "module",
): DrawingEntity {
  return { name: "drawing", rev, data, updatedAt: rev, updatedBy };
}

function applied(
  drawingName: string,
  element: object,
  rev: number,
  data: DrawingDocument,
): AppliedDrawingView {
  return {
    drawingName,
    element,
    rev,
    documentJson: JSON.stringify(data),
  };
}

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

Deno.test("drawing hydration ignores the already applied revision", () => {
  const data = document("a");
  const decision = decideDrawingHydration(
    applied("drawing", firstElement, 2, data),
    "drawing",
    firstElement,
    entity(2, data),
    originId,
  );
  assertEquals(decision.kind, "ignore");
});

Deno.test("drawing hydration accepts own and document-equal revisions silently", () => {
  const data = document("a");
  const own = decideDrawingHydration(
    applied("drawing", firstElement, 2, data),
    "drawing",
    firstElement,
    entity(3, document("b"), originId),
    originId,
  );
  const metadataOnly = decideDrawingHydration(
    applied("drawing", firstElement, 2, data),
    "drawing",
    firstElement,
    entity(3, document("a"), "other-view"),
    originId,
  );
  assertEquals(own.kind, "accept");
  assertEquals(metadataOnly.kind, "accept");
});

Deno.test("drawing hydration rebuilds for foreign document changes", () => {
  const decision = decideDrawingHydration(
    applied("drawing", firstElement, 2, document("a")),
    "drawing",
    firstElement,
    entity(3, document("b"), "other-view"),
    originId,
  );
  assertEquals(decision.kind, "hydrate");
});

Deno.test("drawing hydration always initializes a recreated or rebound view", () => {
  const prior = applied("drawing", firstElement, 2, document("a"));
  const recreated = decideDrawingHydration(
    prior,
    "drawing",
    secondElement,
    entity(2, document("a"), originId),
    originId,
  );
  const rebound = decideDrawingHydration(
    prior,
    "other-drawing",
    firstElement,
    { ...entity(2, document("b"), originId), name: "other-drawing" },
    originId,
  );
  assertEquals(recreated.kind, "hydrate");
  assertEquals(rebound.kind, "hydrate");
});
