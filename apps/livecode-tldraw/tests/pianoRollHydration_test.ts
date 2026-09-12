import type { PianoRollObject } from "@avtools/livecode-protocol";
import {
  type AppliedPianoRollView,
  decidePianoRollHydration,
} from "../src/pianoRollHydration.ts";

const originId = "piano-roll-view-shape:1";
const firstElement = {};
const secondElement = {};

function entity(
  rev: number,
  updatedBy = "module",
  data: PianoRollObject["data"] = {
    notes: [{ id: `note-${rev}`, pitch: 60, position: 0, duration: 1 }],
  },
): PianoRollObject {
  return {
    name: "roll",
    rev,
    data,
    canUndo: false,
    canRedo: false,
    updatedAt: rev,
    updatedBy,
  };
}

function applied(
  rollName: string,
  element: object,
  value: PianoRollObject,
): AppliedPianoRollView {
  return { rollName, element, entity: value };
}

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

Deno.test("piano roll hydration ignores the entity already in the element", () => {
  const value = entity(2);
  const decision = decidePianoRollHydration(
    applied("roll", firstElement, value),
    "roll",
    firstElement,
    value,
    originId,
  );
  assertEquals(decision.kind, "ignore");
});

Deno.test("piano roll hydration silently accepts own and metadata-only updates", () => {
  const prior = entity(2);
  const own = decidePianoRollHydration(
    applied("roll", firstElement, prior),
    "roll",
    firstElement,
    entity(3, originId),
    originId,
  );
  const metadataOnly = decidePianoRollHydration(
    applied("roll", firstElement, prior),
    "roll",
    firstElement,
    { ...prior, rev: 3, canUndo: true },
    originId,
  );
  assertEquals(own.kind, "accept");
  assertEquals(metadataOnly.kind, "accept");
});

Deno.test("piano roll hydration applies a foreign data update", () => {
  const prior = entity(2);
  const decision = decidePianoRollHydration(
    applied("roll", firstElement, prior),
    "roll",
    firstElement,
    entity(3, "other-view"),
    originId,
  );
  assertEquals(decision.kind, "hydrate");
});

Deno.test("piano roll hydration initializes recreated and rebound elements", () => {
  const value = entity(2, originId);
  const prior = applied("roll", firstElement, value);
  const recreated = decidePianoRollHydration(
    prior,
    "roll",
    secondElement,
    value,
    originId,
  );
  const rebound = decidePianoRollHydration(
    prior,
    "other-roll",
    firstElement,
    value,
    originId,
  );
  assertEquals(recreated.kind, "hydrate");
  assertEquals(rebound.kind, "hydrate");
});
