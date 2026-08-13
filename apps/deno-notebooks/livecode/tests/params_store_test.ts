import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  clearParamsStore,
  getParams,
  makeParamsSnapshot,
  registerParams,
  sampleParamsSnapshot,
  setParamsValues,
} from "../visualizer/params_store.ts";
import type { ParamsValues } from "../visualizer/protocol.ts";

Deno.test("registerParams creates an entity at rev 1 and returns a live clone of the defaults", () => {
  clearParamsStore();
  const defaults = { gain: 0.5, label: "a", on: true, strobe: { rate: 2 } };
  const params = registerParams("test/create", defaults);

  const entity = getParams("test/create");
  assert(entity);
  assertEquals(entity.rev, 1);
  assertEquals(entity.updatedBy, "declare");
  assertEquals(entity.values, {
    gain: 0.5,
    label: "a",
    on: true,
    strobe: { rate: 2 },
  });

  // The declaration object is cloned, so later mutation of it is not a write.
  defaults.gain = 99;
  defaults.strobe.rate = 99;
  assertEquals(getParams("test/create")?.values, {
    gain: 0.5,
    label: "a",
    on: true,
    strobe: { rate: 2 },
  });

  // The returned object IS the store's value: a plain property write shows up
  // in a point-in-time read immediately, before the sampler adopts it as a rev.
  params.gain = 0.75;
  assertEquals(getParams("test/create")?.values.gain, 0.75);
  assertEquals(getParams("test/create")?.rev, 1);
});

Deno.test("registerParams reattaches to the same live object across re-registration", () => {
  clearParamsStore();
  const first = registerParams("test/identity", {
    gain: 1,
    strobe: { rate: 2 },
  });
  const strobeRef = first.strobe;
  first.gain = 5;
  first.strobe.rate = 9;

  const second = registerParams("test/identity", {
    gain: 1,
    strobe: { rate: 2 },
    added: 3,
  });

  assert(first === second, "re-registration must return the same live object");
  assert(
    second.strobe === strobeRef,
    "reconcile must mutate nested objects in place too",
  );
  assertEquals(second.gain, 5);
  assertEquals(second.strobe.rate, 9);
  assertEquals(second.added, 3);
});

Deno.test("reconcile keeps existing values, adds new fields, and drops removed ones", () => {
  clearParamsStore();
  const params = registerParams("test/reconcile", {
    keep: 1,
    strobe: { rate: 1, widthPercent: 10 },
  });
  params.keep = 4;
  params.strobe.rate = 7;

  const next = registerParams("test/reconcile", {
    keep: 1,
    strobe: { rate: 1, jitter: 0.5 },
    color: "#e14a3a",
  });

  assertEquals(next.keep, 4);
  assertEquals(next.strobe.rate, 7);
  assertEquals(next.strobe.jitter, 0.5);
  assertEquals("widthPercent" in next.strobe, false);
  assertEquals(next.color, "#e14a3a");

  const entity = getParams("test/reconcile");
  assertEquals(entity?.rev, 2, "one reconcile bumps rev once");
  assertEquals(entity?.updatedBy, "reconcile");
});

Deno.test("reconcile does not bump rev when the declaration is unchanged", () => {
  clearParamsStore();
  registerParams("test/stable", { gain: 1, strobe: { rate: 2 } });
  registerParams("test/stable", { gain: 1, strobe: { rate: 2 } });
  assertEquals(getParams("test/stable")?.rev, 1);
});

Deno.test("reconcile takes the new default when a declared type changed", () => {
  clearParamsStore();
  const params = registerParams("test/typechange", { x: 1, y: 2 });
  params.x = 7;
  params.y = 8;

  const next = registerParams("test/typechange", { x: "seven", y: { a: 1 } });
  assertEquals(next.x, "seven");
  assertEquals(next.y, { a: 1 });

  const back = registerParams("test/typechange", { x: 0, y: 0 });
  assertEquals(back.x, 0);
  assertEquals(back.y, 0);
});

Deno.test("a dropped field's value is restored when it is declared again with the same type", () => {
  clearParamsStore();
  const params = registerParams("test/tombstone", {
    keep: 1,
    tweaked: 2,
    strobe: { rate: 1, jitter: 0 },
  });
  params.tweaked = 42;
  params.strobe.jitter = 0.25;

  const dropped = registerParams("test/tombstone", {
    keep: 1,
    strobe: { rate: 1 },
  });
  assertEquals("tweaked" in dropped, false);
  assertEquals("jitter" in dropped.strobe, false);

  const restored = registerParams("test/tombstone", {
    keep: 1,
    tweaked: 2,
    strobe: { rate: 1, jitter: 0 },
  });
  assertEquals(restored.tweaked, 42);
  assertEquals(restored.strobe.jitter, 0.25);
});

Deno.test("a tombstoned value is not restored into a field of a different type", () => {
  clearParamsStore();
  const params = registerParams("test/tombstone-type", { level: 2 });
  params.level = 42;
  registerParams("test/tombstone-type", {});
  const redeclared = registerParams("test/tombstone-type", { level: "loud" });
  assertEquals(redeclared.level, "loud");
});

Deno.test("registerParams rejects values that are not JSON-simple", () => {
  clearParamsStore();

  assertThrows(
    () =>
      registerParams(
        "test/invalid",
        { items: [1, 2, 3] } as unknown as ParamsValues,
      ),
    Error,
    "arrays are not supported",
  );
  assertThrows(
    () =>
      registerParams(
        "test/invalid",
        { strobe: { rate: () => 1 } } as unknown as ParamsValues,
      ),
    Error,
    'field "strobe.rate"',
  );
  assertThrows(
    () => registerParams("test/invalid", { gain: Number.NaN }),
    Error,
    "must be a finite number",
  );
  assertThrows(
    () =>
      registerParams("test/invalid", { gain: null } as unknown as ParamsValues),
    Error,
    "received null",
  );
  assertThrows(
    () => registerParams("   ", { gain: 1 }),
    Error,
    "must not be empty",
  );
  assertEquals(getParams("test/invalid"), undefined);
});

Deno.test("setParamsValues merges nested leaf patches into the live object", () => {
  clearParamsStore();
  const params = registerParams("test/set", {
    gain: 0.5,
    strobe: { rate: 1, widthPercent: 10 },
  });

  const result = setParamsValues(
    "test/set",
    { strobe: { rate: 4 } },
    { originId: "param-pane-shape:1" },
  );

  assert(result);
  assertEquals(result.rev, 2);
  assertEquals(result.updatedBy, "param-pane-shape:1");
  assertEquals(params.strobe.rate, 4);
  assertEquals(params.strobe.widthPercent, 10);
  assertEquals(params.gain, 0.5);
});

Deno.test("setParamsValues ignores undeclared fields and type mismatches", () => {
  clearParamsStore();
  const params = registerParams("test/set-invalid", { gain: 0.5 });

  const result = setParamsValues("test/set-invalid", {
    gain: "loud",
    unknown: 1,
  } as unknown as ParamsValues);

  assertEquals(result?.rev, 1);
  assertEquals(params.gain, 0.5);
  assertEquals("unknown" in params, false);
});

Deno.test("setParamsValues never creates an entity", () => {
  clearParamsStore();
  assertEquals(setParamsValues("test/absent", { gain: 1 }), undefined);
});

Deno.test("no-op detection compares against a fresh serialization, not the cache", () => {
  clearParamsStore();
  const params = registerParams("test/noop", { gain: 0.5 });

  assertEquals(setParamsValues("test/noop", { gain: 0.5 })?.rev, 1);

  // A code write the sampler has not adopted yet leaves the cached string
  // stale; a real edit against it must still be applied.
  params.gain = 0.9;
  const applied = setParamsValues("test/noop", { gain: 0.25 });
  assertEquals(applied?.rev, 2);
  assertEquals(params.gain, 0.25);

  // ...and a patch equal to the un-sampled live value is still a no-op.
  params.gain = 0.7;
  assertEquals(setParamsValues("test/noop", { gain: 0.7 })?.rev, 2);
  assertEquals(params.gain, 0.7);
});

Deno.test("setParamsValues honours expectedRev as a compare-and-set", () => {
  clearParamsStore();
  registerParams("test/cas", { gain: 1 });

  const conflict = setParamsValues("test/cas", { gain: 2 }, {
    expectedRev: 99,
  });
  assertEquals(conflict?.conflict, true);
  assertEquals(conflict?.rev, 1);
  assertEquals(getParams("test/cas")?.values.gain, 1);

  const applied = setParamsValues("test/cas", { gain: 2 }, { expectedRev: 1 });
  assertEquals(applied?.conflict, undefined);
  assertEquals(applied?.rev, 2);
  assertEquals(getParams("test/cas")?.values.gain, 2);
});

Deno.test("the sampler adopts code writes as store generations", () => {
  clearParamsStore();
  const params = registerParams("test/sampler", { gain: 0.5 });

  const created = sampleParamsSnapshot();
  assert(created);
  assertEquals(created.params["test/sampler"].rev, 1);
  assertEquals(sampleParamsSnapshot(), null, "an idle tick sends nothing");

  params.gain = 0.9;
  const adopted = sampleParamsSnapshot();
  assert(adopted);
  assertEquals(adopted.params["test/sampler"].rev, 2);
  assertEquals(adopted.params["test/sampler"].updatedBy, "code");
  assertEquals(adopted.params["test/sampler"].values.gain, 0.9);
  assert(adopted.seq > created.seq);
  assertEquals(sampleParamsSnapshot(), null, "drift is adopted exactly once");

  // A store-level write is already a generation; the sampler must not add one.
  setParamsValues("test/sampler", { gain: 0.1 }, { originId: "pane" });
  const afterSet = sampleParamsSnapshot();
  assertEquals(afterSet?.params["test/sampler"].rev, 3);
  assertEquals(afterSet?.params["test/sampler"].updatedBy, "pane");
  assertEquals(sampleParamsSnapshot(), null);
});

Deno.test("a forced snapshot is read-only: it neither consumes the gate nor adopts drift", () => {
  clearParamsStore();
  const params = registerParams("test/forced", { gain: 1 });

  const onOpen = makeParamsSnapshot();
  assertEquals(onOpen.params["test/forced"].rev, 1);
  assert(
    sampleParamsSnapshot(),
    "a forced snapshot must not consume the pending broadcast",
  );

  params.gain = 2;
  const duringDrift = makeParamsSnapshot();
  assertEquals(duringDrift.params["test/forced"].values.gain, 2);
  assertEquals(duringDrift.params["test/forced"].rev, 1);

  const adopted = sampleParamsSnapshot();
  assertEquals(adopted?.params["test/forced"].rev, 2);
  assertEquals(adopted?.params["test/forced"].updatedBy, "code");
});

Deno.test("the sampler flags an unserializable value instead of throwing", () => {
  clearParamsStore();
  const params = registerParams("test/unserializable", { gain: 1 });
  sampleParamsSnapshot();

  (params as Record<string, unknown>).gain = 10n;
  const flagged = sampleParamsSnapshot();
  assertEquals(flagged?.params["test/unserializable"].unserializable, true);
  assertEquals(
    flagged?.params["test/unserializable"].values.gain,
    1,
    "the snapshot keeps the last values that did serialize",
  );

  params.gain = 3;
  const recovered = sampleParamsSnapshot();
  assertEquals(
    recovered?.params["test/unserializable"].unserializable,
    undefined,
  );
  assertEquals(recovered?.params["test/unserializable"].values.gain, 3);
});

Deno.test("non-finite code writes serialize to null and drops read as shape changes", () => {
  clearParamsStore();
  const params = registerParams("test/lossy", { gain: 1, extra: 2 });
  sampleParamsSnapshot();

  params.gain = Number.POSITIVE_INFINITY;
  assertEquals(sampleParamsSnapshot()?.params["test/lossy"].values.gain, null);

  delete (params as Record<string, unknown>).extra;
  const afterDelete = sampleParamsSnapshot();
  assertEquals(
    "extra" in (afterDelete?.params["test/lossy"].values ?? {}),
    false,
  );
  assertEquals(afterDelete?.params["test/lossy"].updatedBy, "code");
});

Deno.test("meta comes from the declaration and a meta-only change broadcasts without a rev bump", () => {
  clearParamsStore();
  registerParams("test/meta", { gain: 1 }, {
    gain: { min: 0, max: 2, step: 0.1, label: "Gain" },
  });
  const declared = sampleParamsSnapshot();
  assertEquals(declared?.params["test/meta"].meta, {
    gain: { min: 0, max: 2, step: 0.1, label: "Gain" },
  });

  registerParams("test/meta", { gain: 1 }, { gain: { min: 0, max: 4 } });
  const updated = sampleParamsSnapshot();
  assertEquals(updated?.params["test/meta"].meta, { gain: { min: 0, max: 4 } });
  assertEquals(updated?.params["test/meta"].rev, 1);
});
