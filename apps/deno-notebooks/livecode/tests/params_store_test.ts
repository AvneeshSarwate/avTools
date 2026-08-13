import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  clearParamsStore,
  createEmptyParams,
  duplicateParams,
  getParams,
  latestParamsJson,
  loadParams,
  makeParamsSnapshot,
  registerParams,
  removeParams,
  sampleParamsChanges,
  setParamsValues,
} from "../visualizer/params_store.ts";
import type { ParamsEntity, ParamsValues } from "../visualizer/protocol.ts";

function resetParams(): void {
  clearParamsStore();
  // Drain the deletions the reset just recorded, the way a broadcast tick does.
  sampleParamsChanges();
}

/**
 * One broadcast tick's changed records keyed by name, so the assertions below
 * read like the old full-snapshot ones. A name that is ABSENT here was not
 * shipped at all; a name mapped to null was deleted.
 */
function sampledParams(): Record<string, ParamsEntity | null> | null {
  const changes = sampleParamsChanges();
  if (!changes) return null;
  return Object.fromEntries(
    changes.map((change) => [change.name, change.entity]),
  );
}

Deno.test("registerParams creates an entity at rev 1 and returns a live clone of the defaults", () => {
  resetParams();
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
  resetParams();
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
  resetParams();
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
  resetParams();
  registerParams("test/stable", { gain: 1, strobe: { rate: 2 } });
  registerParams("test/stable", { gain: 1, strobe: { rate: 2 } });
  assertEquals(getParams("test/stable")?.rev, 1);
});

Deno.test("reconcile takes the new default when a declared type changed", () => {
  resetParams();
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
  resetParams();
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
  resetParams();
  const params = registerParams("test/tombstone-type", { level: 2 });
  params.level = 42;
  registerParams("test/tombstone-type", {});
  const redeclared = registerParams("test/tombstone-type", { level: "loud" });
  assertEquals(redeclared.level, "loud");
});

Deno.test("registerParams rejects values that are not JSON-simple", () => {
  resetParams();

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
  resetParams();
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
  resetParams();
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
  resetParams();
  assertEquals(setParamsValues("test/absent", { gain: 1 }), undefined);
});

Deno.test("no-op detection compares against a fresh serialization, not the cache", () => {
  resetParams();
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
  resetParams();
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
  resetParams();
  const params = registerParams("test/sampler", { gain: 0.5 });

  const created = sampledParams();
  assert(created);
  assertEquals(created["test/sampler"]?.rev, 1);
  assertEquals(sampledParams(), null, "an idle tick sends nothing");

  params.gain = 0.9;
  const adopted = sampledParams();
  assert(adopted);
  assertEquals(adopted["test/sampler"]?.rev, 2);
  assertEquals(adopted["test/sampler"]?.updatedBy, "code");
  assertEquals(adopted["test/sampler"]?.values.gain, 0.9);
  assertEquals(
    Object.keys(adopted),
    ["test/sampler"],
    "a tick ships only the entities that changed",
  );
  assertEquals(sampledParams(), null, "drift is adopted exactly once");

  // A store-level write is already a generation; the sampler must not add one.
  setParamsValues("test/sampler", { gain: 0.1 }, { originId: "pane" });
  const afterSet = sampledParams();
  assertEquals(afterSet?.["test/sampler"]?.rev, 3);
  assertEquals(afterSet?.["test/sampler"]?.updatedBy, "pane");
  assertEquals(sampledParams(), null);
});

Deno.test("a forced snapshot is read-only: it neither consumes the gate nor adopts drift", () => {
  resetParams();
  const params = registerParams("test/forced", { gain: 1 });

  const onOpen = makeParamsSnapshot();
  assertEquals(onOpen.params["test/forced"].rev, 1);
  assert(
    sampledParams(),
    "a forced snapshot must not consume the pending broadcast",
  );

  params.gain = 2;
  const duringDrift = makeParamsSnapshot();
  assertEquals(duringDrift.params["test/forced"].values.gain, 2);
  assertEquals(duringDrift.params["test/forced"].rev, 1);

  const adopted = sampledParams();
  assertEquals(adopted?.["test/forced"]?.rev, 2);
  assertEquals(adopted?.["test/forced"]?.updatedBy, "code");
});

Deno.test("the sampler flags an unserializable value instead of throwing", () => {
  resetParams();
  const params = registerParams("test/unserializable", { gain: 1 });
  sampledParams();

  (params as Record<string, unknown>).gain = 10n;
  const flagged = sampledParams();
  assertEquals(flagged?.["test/unserializable"]?.unserializable, true);
  assertEquals(
    flagged?.["test/unserializable"]?.values.gain,
    1,
    "the change keeps the last values that did serialize",
  );

  params.gain = 3;
  const recovered = sampledParams();
  assertEquals(
    recovered?.["test/unserializable"]?.unserializable,
    undefined,
  );
  assertEquals(recovered?.["test/unserializable"]?.values.gain, 3);
});

Deno.test("non-finite code writes serialize to null and drops read as shape changes", () => {
  resetParams();
  const params = registerParams("test/lossy", { gain: 1, extra: 2 });
  sampledParams();

  params.gain = Number.POSITIVE_INFINITY;
  assertEquals(sampledParams()?.["test/lossy"]?.values.gain, null);

  delete (params as Record<string, unknown>).extra;
  const afterDelete = sampledParams();
  assertEquals(
    "extra" in (afterDelete?.["test/lossy"]?.values ?? {}),
    false,
  );
  assertEquals(afterDelete?.["test/lossy"]?.updatedBy, "code");
});

Deno.test("loadParams mutates the live object in place at every depth", () => {
  resetParams();
  const live = registerParams("test/load", {
    gain: 1,
    strobe: { rate: 2, jitter: 0 },
  });
  const strobeRef = live.strobe;
  live.gain = 9;

  const loaded = loadParams("test/load", {
    gain: 0.25,
    strobe: { rate: 8 },
    added: true,
  });

  assertEquals(loaded.rev, 2);
  assertEquals(loaded.updatedBy, "load");
  // A module that kept the reference (or a nested one) keeps observing truth.
  assertEquals(live.gain, 0.25);
  assert(live.strobe === strobeRef, "nested identity must survive a load");
  assertEquals(live.strobe.rate, 8);
  assertEquals("jitter" in live.strobe, false);
  assertEquals((live as ParamsValues).added, true);

  // Open is an explicit operator action, so the rev always advances: a pane
  // whose localRev outlived the pre-load value must never echo-suppress it.
  assertEquals(
    loadParams("test/load", { gain: 0.25, strobe: { rate: 8 }, added: true })
      .rev,
    3,
  );
});

Deno.test("loadParams creates an absent entity and the declaration still wins later", () => {
  resetParams();
  const loaded = loadParams("test/load-new", { gain: 3 }, {
    gain: { min: 0, max: 4 },
  });
  assertEquals(loaded.rev, 1);
  assertEquals(loaded.updatedBy, "load");
  assertEquals(getParams("test/load-new")?.values, { gain: 3 });
  assertEquals(getParams("test/load-new")?.meta, { gain: { min: 0, max: 4 } });

  const declared = registerParams("test/load-new", { gain: 1, extra: 2 });
  assertEquals(declared.gain, 3, "the loaded value survives reconcile");
  assertEquals(declared.extra, 2);
});

Deno.test("loadParams clears tombstones so a pre-load value cannot resurrect", () => {
  resetParams();
  const live = registerParams("test/load-tombstone", { keep: 1, tweaked: 2 });
  live.tweaked = 42;
  registerParams("test/load-tombstone", { keep: 1 });

  loadParams("test/load-tombstone", { keep: 5 });

  const restored = registerParams("test/load-tombstone", {
    keep: 1,
    tweaked: 2,
  });
  assertEquals(restored.keep, 5);
  assertEquals(restored.tweaked, 2, "the pre-load tombstone is gone");
});

Deno.test("loadParams rejects values that are not JSON-simple", () => {
  resetParams();
  assertThrows(
    () =>
      loadParams(
        "test/load-invalid",
        { items: [1, 2] } as unknown as ParamsValues,
      ),
    Error,
    "arrays are not supported",
  );
  assertEquals(getParams("test/load-invalid"), undefined);
});

Deno.test("removeParams drops the record and its tombstones", () => {
  resetParams();
  const live = registerParams("test/remove", { keep: 1, tweaked: 2 });
  live.tweaked = 42;
  registerParams("test/remove", { keep: 1 });

  assertEquals(removeParams("test/remove"), true);
  assertEquals(getParams("test/remove"), undefined);
  assertEquals(removeParams("test/remove"), false);

  const fresh = registerParams("test/remove", { keep: 1, tweaked: 2 });
  assertEquals(fresh.tweaked, 2, "a deleted entity keeps no editing history");
});

Deno.test("revs are monotonic per name across delete and recreate", () => {
  resetParams();
  registerParams("test/revfloor", { gain: 1 });
  setParamsValues("test/revfloor", { gain: 2 });
  assertEquals(getParams("test/revfloor")?.rev, 2);

  removeParams("test/revfloor");
  assertEquals(createEmptyParams("test/revfloor").rev, 3);

  removeParams("test/revfloor");
  registerParams("test/revfloor", { gain: 1 });
  assertEquals(getParams("test/revfloor")?.rev, 4);

  removeParams("test/revfloor");
  loadParams("test/revfloor", { gain: 7 });
  assertEquals(getParams("test/revfloor")?.rev, 5);

  // The floor is per name: an unrelated name still starts at 1.
  assertEquals(createEmptyParams("test/revfloor-other").rev, 1);
});

Deno.test("duplicateParams deep-copies the live values under a new name", () => {
  resetParams();
  const live = registerParams("test/dup", { gain: 1, strobe: { rate: 2 } });
  live.strobe.rate = 9;

  const copy = duplicateParams("test/dup", "test/dup-copy");
  assertEquals(copy.rev, 1);
  assertEquals(copy.updatedBy, "duplicate");
  assertEquals(copy.values, { gain: 1, strobe: { rate: 9 } });

  // Deep copy: writing one entity never touches the other.
  const copyLive = registerParams("test/dup-copy", {
    gain: 1,
    strobe: { rate: 2 },
  });
  copyLive.strobe.rate = 100;
  assertEquals(live.strobe.rate, 9);
});

Deno.test("latestParamsJson is a fresh serialization of the live value", () => {
  resetParams();
  const live = registerParams("test/latest", { gain: 1 });
  assertEquals(latestParamsJson("test/latest"), '{"gain":1}');

  // A code write the sampler has not adopted yet is still what a save writes,
  // so the saved-state compare can never latch a permanent false "unsaved".
  live.gain = 2;
  assertEquals(latestParamsJson("test/latest"), '{"gain":2}');

  assertEquals(latestParamsJson("test/absent"), null);
  (live as Record<string, unknown>).gain = 1n;
  assertEquals(latestParamsJson("test/latest"), null);
});

Deno.test("meta comes from the declaration and a meta-only change broadcasts without a rev bump", () => {
  resetParams();
  registerParams("test/meta", { gain: 1 }, {
    gain: { min: 0, max: 2, step: 0.1, label: "Gain" },
  });
  const declared = sampledParams();
  assertEquals(declared?.["test/meta"]?.meta, {
    gain: { min: 0, max: 2, step: 0.1, label: "Gain" },
  });

  registerParams("test/meta", { gain: 1 }, { gain: { min: 0, max: 4 } });
  const updated = sampledParams();
  assertEquals(updated?.["test/meta"]?.meta, { gain: { min: 0, max: 4 } });
  assertEquals(updated?.["test/meta"]?.rev, 1);
});

Deno.test("a removed entity ships as a deletion, which no serialize-compare could see", () => {
  resetParams();
  registerParams("test/deleted", { gain: 1 });
  assert(sampledParams());

  assertEquals(removeParams("test/deleted"), true);
  const tick = sampledParams();
  assert(tick, "a deletion is a change");
  assertEquals(
    "test/deleted" in tick,
    true,
    "the deleted name must be reported, not merely disappear",
  );
  assertEquals(tick["test/deleted"], null);
  assertEquals(sampledParams(), null, "a deletion is reported exactly once");
});
