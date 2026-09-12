import {
  moduleLookupValuesEqual,
  moduleLookupViewEqual,
  retainModuleLookupValues,
} from "../src/moduleLookupView.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

Deno.test("module lookup equality retains an equivalent publication", () => {
  const previous = { callsiteA: "melody", callsiteB: "bass" };
  const reordered = { callsiteB: "bass", callsiteA: "melody" };

  assert(
    moduleLookupValuesEqual(previous, reordered),
    "values should be equal",
  );
  assert(
    retainModuleLookupValues(previous, reordered) === previous,
    "an equivalent publication should preserve the rendered reference",
  );
});

Deno.test("module lookup equality observes resolved-name changes", () => {
  const previous = { callsiteA: "melody" };
  const changed = { callsiteA: "harmony" };

  assert(
    !moduleLookupValuesEqual(previous, changed),
    "changed lookup was skipped",
  );
  assert(
    retainModuleLookupValues(previous, changed) === changed,
    "a changed resolved name should use the new publication",
  );
});

Deno.test("module lookup equality observes removal and empty reset", () => {
  const previous = { callsiteA: "melody", callsiteB: "bass" };
  const removed = { callsiteA: "melody" };
  const reset = {};

  assert(
    !moduleLookupValuesEqual(previous, removed),
    "removed lookup was skipped",
  );
  assert(!moduleLookupValuesEqual(removed, reset), "empty reset was skipped");
  assert(
    retainModuleLookupValues(previous, removed) === removed,
    "removal was not adopted",
  );
  assert(
    retainModuleLookupValues(removed, reset) === reset,
    "reset was not adopted",
  );
});

Deno.test("module binding remains part of the consumer selection", () => {
  const lookups = { callsiteA: "melody" };
  const previous = { moduleId: "module-a", lookups };
  const rebound = { moduleId: "module-b", lookups };

  assert(
    !moduleLookupViewEqual(previous, rebound),
    "module rebinding was skipped",
  );
});
