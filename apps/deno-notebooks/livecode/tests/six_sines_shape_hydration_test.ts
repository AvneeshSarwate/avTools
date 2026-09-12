import {
  planSixSinesHydration,
  recordDisplayedSixSinesParameters,
  sixSinesHydrationState,
} from "../../../livecode-tldraw/src/sixSinesHydration.ts";
import type { SixSinesData } from "@avtools/livecode-protocol";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, message: string) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  assert(
    actualJson === expectedJson,
    `${message}: expected ${expectedJson}, got ${actualJson}`,
  );
}

function data(
  values: Record<string, number>,
  preset = "<preset>A</preset>",
): SixSinesData {
  return { preset, values };
}

Deno.test("six sines hydration applies only a changed scalar", () => {
  const prior = sixSinesHydrationState(data({ "1": 0.1, "2": 0.2 }));
  const plan = planSixSinesHydration(
    prior,
    data({ "1": 0.1, "2": 0.7 }),
  );

  assert(!plan.reloadPreset, "a scalar edit must not reload the preset");
  assertEquals(plan.changes, [{ id: 2, value: 0.7 }], "scalar changes");
});

Deno.test("six sines scalar hydration enumerates incoming values once", () => {
  const prior = sixSinesHydrationState(data({ "1": 0.1, "2": 0.2 }));
  let enumerations = 0;
  const values = new Proxy({ "1": 0.1, "2": 0.7 }, {
    ownKeys(target) {
      enumerations++;
      return Reflect.ownKeys(target);
    },
  });

  const plan = planSixSinesHydration(prior, data(values));

  assertEquals(enumerations, 1, "incoming value enumerations");
  assertEquals(plan.changes, [{ id: 2, value: 0.7 }], "scalar changes");
});

Deno.test("six sines hydration skips the accepted echo of a displayed edit", () => {
  const prior = sixSinesHydrationState(data({ "1": 0.1, "2": 0.2 }));
  recordDisplayedSixSinesParameters(prior, [{ id: 2, value: 0.7 }]);
  const plan = planSixSinesHydration(
    prior,
    data({ "1": 0.1, "2": 0.7 }),
  );

  assert(
    !plan.reloadPreset,
    "an accepted parameter echo must stay incremental",
  );
  assertEquals(plan.changes, [], "accepted parameter echo changes");
});

Deno.test("six sines hydration skips the accepted echo of a displayed preset", () => {
  const displayed = data({ "1": 0.8, "3": 0.4 }, "<preset>B</preset>");
  const plan = planSixSinesHydration(
    sixSinesHydrationState(displayed),
    data({ "1": 0.8, "3": 0.4 }, "<preset>B</preset>"),
  );

  assert(!plan.reloadPreset, "an accepted preset echo must not reload");
  assertEquals(plan.changes, [], "accepted preset echo changes");
});

Deno.test("six sines hydration reloads a same-preset parameter removal", () => {
  const prior = sixSinesHydrationState(data({ "1": 0.1, "2": 0.2 }));
  const plan = planSixSinesHydration(prior, data({ "2": 0.7 }));

  assert(
    plan.reloadPreset,
    "parameter removal must restore the preset baseline",
  );
  assertEquals(plan.changes, [{ id: 2, value: 0.7 }], "post-reload values");
});

Deno.test("six sines hydration detects replacement keys in a bulk edit", () => {
  const prior = sixSinesHydrationState(data({ "1": 0.1, "2": 0.2 }));
  const plan = planSixSinesHydration(prior, data({ "2": 0.2, "3": 0.3 }));

  assert(plan.reloadPreset, "replacing a parameter key must reload the preset");
  assertEquals(
    plan.changes,
    [{ id: 2, value: 0.2 }, { id: 3, value: 0.3 }],
    "replacement values",
  );
});

Deno.test("six sines forced recovery reloads and reapplies every value", () => {
  const prior = sixSinesHydrationState(data({ "1": 0.1, "2": 0.2 }));
  const plan = planSixSinesHydration(
    prior,
    data({ "1": 0.1, "2": 0.2 }),
    true,
  );

  assert(plan.reloadPreset, "recovery must reload the preset");
  assertEquals(
    plan.changes,
    [{ id: 1, value: 0.1 }, { id: 2, value: 0.2 }],
    "recovery values",
  );
});
