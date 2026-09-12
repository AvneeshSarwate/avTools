import {
  assertEquals,
  assertNotStrictEquals,
  assertStrictEquals,
} from "jsr:@std/assert@1";
import type { ParamsMeta, ParamsValues } from "@avtools/livecode-protocol";
import {
  applyChangedParamValues,
  type ParamValueEntry,
  retainParamPaneLayout,
} from "../../../livecode-tldraw/src/paramPaneUpdates.ts";

Deno.test("param pane retains its binding layout across value-only updates", () => {
  const values: ParamsValues = { gain: 0.1, nested: { enabled: true } };
  const meta: ParamsMeta = { gain: { min: 0, max: 1 } };
  const initial = retainParamPaneLayout(null, values, meta);
  const scalarUpdate = retainParamPaneLayout(
    initial,
    { gain: 0.2, nested: values.nested },
    meta,
  );
  assertStrictEquals(scalarUpdate.token, initial.token);

  const equivalentReset = retainParamPaneLayout(
    scalarUpdate,
    { nested: { enabled: false }, gain: 0.8 },
    { gain: { max: 1, min: 0 } },
  );
  assertStrictEquals(equivalentReset.token, initial.token);
});

Deno.test("param pane replaces its binding layout for schema and metadata changes", () => {
  const initial = retainParamPaneLayout(
    null,
    { gain: 0.1, nested: { enabled: true } },
    { gain: { min: 0, max: 1 } },
  );
  const changedType = retainParamPaneLayout(
    initial,
    { gain: "quiet", nested: { enabled: true } },
    initial.meta,
  );
  assertNotStrictEquals(changedType.token, initial.token);

  const changedKeys = retainParamPaneLayout(
    initial,
    { gain: 0.1, nested: { enabled: true }, mix: 0.5 },
    initial.meta,
  );
  assertNotStrictEquals(changedKeys.token, initial.token);

  const changedMeta = retainParamPaneLayout(
    initial,
    initial.values,
    { gain: { min: 0, max: 2 } },
  );
  assertNotStrictEquals(changedMeta.token, initial.token);

  const unavailable = retainParamPaneLayout(initial, null, initial.meta);
  assertNotStrictEquals(unavailable.token, initial.token);
  const recreated = retainParamPaneLayout(
    unavailable,
    initial.values,
    initial.meta,
  );
  assertNotStrictEquals(recreated.token, unavailable.token);
});

Deno.test("param pane refreshes only changed eligible leaves", () => {
  const target: ParamsValues = {
    gain: 0.1,
    nested: { enabled: false, label: "old" },
  };
  const entries: ParamValueEntry[] = [
    { path: ["gain"], key: "gain", target, localRev: 0 },
    {
      path: ["nested", "enabled"],
      key: "enabled",
      target: target.nested as ParamsValues,
      localRev: 0,
    },
    {
      path: ["nested", "label"],
      key: "label",
      target: target.nested as ParamsValues,
      localRev: 8,
    },
  ];
  const refreshed: string[] = [];
  const count = applyChangedParamValues(
    entries,
    { gain: 0.1, nested: { enabled: true, label: "new" } },
    5,
    () => false,
    (entry) => refreshed.push(entry.path.join(".")),
  );
  assertEquals(count, 1);
  assertEquals(refreshed, ["nested.enabled"]);
  assertEquals(target, { gain: 0.1, nested: { enabled: true, label: "old" } });
});

Deno.test("param pane leaves busy controls untouched until catch-up", () => {
  const target: ParamsValues = { gain: 0.1 };
  const entry: ParamValueEntry = {
    path: ["gain"],
    key: "gain",
    target,
    localRev: 0,
  };
  assertEquals(
    applyChangedParamValues([entry], { gain: 0.8 }, 2, () => true, () => {}),
    0,
  );
  assertEquals(target.gain, 0.1);
  assertEquals(
    applyChangedParamValues([entry], { gain: 0.8 }, 2, () => false, () => {}),
    1,
  );
  assertEquals(target.gain, 0.8);
});
