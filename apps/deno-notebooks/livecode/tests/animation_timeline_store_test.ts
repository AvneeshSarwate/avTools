import { assert, assertEquals } from "jsr:@std/assert@1";
import type {
  AnimationTimelineData,
  AnimationTimelineSetResult,
} from "@avtools/livecode-protocol";
import {
  animationTimeline,
  clearAnimationTimelineStore,
  collectAnimationTimelineChanges,
  getAnimationTimeline,
  removeAnimationTimeline,
  setAnimationTimeline,
} from "@avtools/livecode-engine/animation_timeline_store.ts";

function reset(): void {
  clearAnimationTimelineStore();
  collectAnimationTimelineChanges();
}

function timelineData(): AnimationTimelineData {
  return {
    tracks: [
      {
        id: "gain-track",
        name: "gain",
        fieldType: "number",
        elementData: [
          { id: "gain-10", time: 10, value: 10 },
          { id: "gain-0", time: 0, value: 0 },
        ],
        low: 0,
        high: 10,
      },
      {
        id: "mode-track",
        name: "mode",
        fieldType: "enum",
        elementData: [
          { id: "mode-5", time: 5, value: "run" },
          { id: "mode-0", time: 0, value: "idle" },
        ],
        low: 0,
        high: 1,
        enumOptions: ["idle", "run"],
      },
    ],
    trackOrder: ["gain-track", "mode-track"],
  };
}

function timelineWithFunctions(): AnimationTimelineData {
  const data = timelineData();
  data.tracks.push({
    id: "actions-track",
    name: "actions",
    fieldType: "func",
    elementData: [
      {
        id: "action-2",
        time: 2,
        value: { funcName: "flash", args: [{ strength: 2 }] },
      },
      {
        id: "action-0",
        time: 0,
        value: { funcName: "start", args: [] },
      },
      {
        id: "action-1",
        time: 1,
        value: { funcName: "pulse", args: [4, "wide"] },
      },
    ],
    low: 0,
    high: 1,
  });
  data.trackOrder.push("actions-track");
  return data;
}

function successfulSet(result: AnimationTimelineSetResult) {
  if (!result.ok) throw new Error(result.error);
  return result.timeline;
}

Deno.test("animationTimeline creates once and reattaches to existing data", () => {
  reset();
  const initial = timelineData();
  const first = animationTimeline("  test/reattach  ", initial);

  assertEquals(first.name, "test/reattach");
  assertEquals(getAnimationTimeline(first.name)?.rev, 1);
  assertEquals(getAnimationTimeline(first.name)?.updatedBy, "declare");
  assertEquals(
    first.data().tracks[0].elementData.map((element) => element.time),
    [0, 10],
  );

  initial.tracks[0].name = "caller mutation";
  assertEquals(first.data().tracks[0].name, "gain");

  const second = animationTimeline("test/reattach", {
    tracks: [],
    trackOrder: [],
  });
  assertEquals(second.data(), first.data());

  const edited = second.data();
  edited.tracks[0].elementData[1].value = 8;
  successfulSet(second.set(edited, { originId: "module:test" }));
  assertEquals(first.data().tracks[0].elementData[1].value, 8);
});

Deno.test("invalid timeline writes reject atomically", () => {
  reset();
  const handle = animationTimeline("test/atomic", timelineData());
  const before = handle.data();
  const rev = getAnimationTimeline(handle.name)?.rev;

  const missingFromOrder = handle.data();
  missingFromOrder.trackOrder.pop();
  const missingResult = handle.set(missingFromOrder);
  assertEquals(missingResult.ok, false);

  const wrongValue = handle.data();
  wrongValue.tracks[0].elementData[0].value = "loud" as unknown as number;
  const wrongValueResult = handle.set(wrongValue);
  assertEquals(wrongValueResult.ok, false);

  const nonJsonArgs = timelineWithFunctions();
  const functionTrack = nonJsonArgs.tracks[2];
  assert(functionTrack.fieldType === "func");
  functionTrack.elementData[0].value.args = [1n];
  const nonJsonResult = handle.set(nonJsonArgs);
  assertEquals(nonJsonResult.ok, false);

  assertEquals(handle.data(), before);
  assertEquals(getAnimationTimeline(handle.name)?.rev, rev);
});

Deno.test("sets use normalized no-op detection and compare-and-set revisions", () => {
  reset();
  const handle = animationTimeline("test/cas", timelineData());

  const noOp = successfulSet(handle.set(timelineData(), {
    expectedRev: 1,
    originId: "shape:1",
  }));
  assertEquals(noOp.rev, 1);
  assertEquals(noOp.updatedBy, "declare");

  const edited = handle.data();
  edited.tracks[0].elementData[1].value = 6;
  const applied = successfulSet(handle.set(edited, {
    expectedRev: 1,
    originId: "shape:1",
  }));
  assertEquals(applied.rev, 2);
  assertEquals(applied.updatedBy, "shape:1");

  const staleData = handle.data();
  staleData.tracks[0].elementData[1].value = 9;
  const stale = handle.set(staleData, { expectedRev: 1 });
  assertEquals(stale.ok, false);
  if (stale.ok) throw new Error("expected a revision conflict");
  assertEquals(stale.current?.rev, 2);
  assertEquals(handle.data().tracks[0].elementData[1].value, 6);
});

Deno.test("number tracks interpolate and enum tracks step", () => {
  reset();
  const handle = animationTimeline("test/sample", timelineData());

  assertEquals(handle.sample(-1), {
    numbers: { gain: 0 },
    enums: { mode: "idle" },
  });
  assertEquals(handle.sample(2.5), {
    numbers: { gain: 2.5 },
    enums: { mode: "idle" },
  });
  assertEquals(handle.sample(5), {
    numbers: { gain: 5 },
    enums: { mode: "run" },
  });
  assertEquals(handle.sample(20), {
    numbers: { gain: 10 },
    enums: { mode: "run" },
  });
});

Deno.test("function hits use the forward interval (fromTime, toTime]", () => {
  reset();
  const handle = animationTimeline("test/functions", timelineWithFunctions());

  assertEquals(handle.functionHits(0, 2), [
    {
      trackName: "actions",
      time: 1,
      funcName: "pulse",
      args: [4, "wide"],
    },
    {
      trackName: "actions",
      time: 2,
      funcName: "flash",
      args: [{ strength: 2 }],
    },
  ]);
  assertEquals(handle.functionHits(2, 0), []);
  assertEquals(handle.functionHits(1, 1), []);
  assertEquals(handle.functionHits(-1, 0), [
    {
      trackName: "actions",
      time: 0,
      funcName: "start",
      args: [],
    },
  ]);

  const hits = handle.functionHits(1, 2);
  (hits[0].args[0] as { strength: number }).strength = 99;
  assertEquals(handle.functionHits(1, 2)[0].args, [{ strength: 2 }]);
});

Deno.test("change collection drains writes and reports deletion", () => {
  reset();
  const handle = animationTimeline("test/changes", timelineData());

  const created = collectAnimationTimelineChanges();
  assertEquals(created?.length, 1);
  assertEquals(created?.[0].name, handle.name);
  assertEquals(created?.[0].entity?.rev, 1);
  assertEquals(collectAnimationTimelineChanges(), null);

  successfulSet(handle.set(timelineData()));
  assertEquals(
    collectAnimationTimelineChanges(),
    null,
    "a no-op does not publish",
  );

  const edited = handle.data();
  edited.tracks[1].elementData[1].value = "pause";
  successfulSet(setAnimationTimeline(handle.name, edited));
  const changed = collectAnimationTimelineChanges();
  assertEquals(changed?.length, 1);
  assertEquals(changed?.[0].entity?.rev, 2);

  assertEquals(removeAnimationTimeline(handle.name), true);
  assertEquals(collectAnimationTimelineChanges(), [{
    name: handle.name,
    entity: null,
  }]);
  assertEquals(collectAnimationTimelineChanges(), null);
});
