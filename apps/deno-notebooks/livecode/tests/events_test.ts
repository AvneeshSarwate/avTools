import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { launch, type TimeContext } from "@avtools/core-timing";
import {
  createLivecodeEngine,
  executeEngineOp,
} from "@avtools/livecode-engine";
import { cloneEvent, emit, onEvent } from "@avtools/livecode-engine/events.ts";
import { button, canvasParams } from "../helpers/canvas_params.ts";
import {
  duplicateParams,
  getParams,
  loadParams,
  sampleParamsChanges,
} from "@avtools/livecode-engine/params_store.ts";
import { waitFor } from "./test_helpers.ts";

Deno.test("buttons infer ordinary values and survive metadata save/load and duplication", () => {
  const message = { type: "trigger", body: { melody: "dscale5" } };
  const play = button(message);
  message.body.melody = "changed";
  const params = canvasParams("events/test", {
    gain: 0.5,
    nested: { enabled: true, play },
  }, { gain: { min: 0, max: 1 }, nested: { play: { label: "Play" } } });
  params.gain = 0.75;
  params.nested.enabled = false;
  // @ts-expect-error buttons are metadata, not mutable live fields
  params.nested.play;
  // @ts-expect-error numeric fields retain their inferred type
  const wrong: string = params.gain;
  void wrong;
  const entity = getParams("events/test")!;
  assertEquals(entity.values, { gain: 0.75, nested: { enabled: false } });
  assertEquals(entity.meta?.nested, {
    play: {
      label: "Play",
      button: {
        type: "trigger",
        body: { melody: "dscale5" },
      },
    },
  });
  const saved = JSON.parse(JSON.stringify(entity));
  loadParams("events/restored", saved.values, saved.meta);
  assertEquals(getParams("events/restored")?.meta, entity.meta);
  assertEquals(
    duplicateParams("events/restored", "events/copy").meta,
    entity.meta,
  );
  sampleParamsChanges();
  const same = canvasParams("events/test", {
    gain: 0.1,
    nested: { enabled: true, play: button({ type: "other", body: {} }) },
  });
  assert(same === params);
  assertEquals(params.gain, 0.75);
  assert(
    sampleParamsChanges()?.some((change) => change.name === "events/test"),
  );
  assertThrows(() => button({ type: "x", body: { state: "down" } }));
  assertThrows(() => button({ type: "x", body: { callback() {} } }));
});

Deno.test("global events deliver every edge, isolate payloads and handlers, and unsubscribe", async () => {
  const seen: string[] = [];
  let stop!: () => void;
  const originalError = console.error;
  const errors: unknown[] = [];
  console.error = (...args) => {
    errors.push(args);
  };
  const handle = launch(async (ctx) => {
    onEvent((event) => {
      event.body.state = "mutated";
      throw Error("expected");
    }, ctx);
    onEvent(async () => {
      throw Error("async expected");
    }, ctx);
    stop = onEvent((event) => seen.push(event.body.state), ctx);
    while (true) await ctx.waitSec(0.01);
  });
  try {
    const event = { type: "trigger", body: { state: "down" } };
    assertEquals(emit(event).delivered, 3);
    assertEquals(emit({ ...event, body: { state: "up" } }).delivered, 3);
    assertEquals(seen, ["down", "up"]);
    assertEquals(event.body.state, "down");
    stop();
    stop();
    assertEquals(emit(event).delivered, 2);
    await Promise.resolve();
    assert(errors.length >= 6);
  } finally {
    handle.cancel();
    await handle.catch(() => {});
    console.error = originalError;
  }
  assertEquals(emit({ type: "after", body: null }).delivered, 0);
  assertThrows(() => cloneEvent({ type: "x", body: { value: undefined } }));
  assertThrows(() => cloneEvent({ type: "x", body: NaN }));
  assertThrows(() => cloneEvent({ type: "", body: {} }));
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assertThrows(() => cloneEvent({ type: "x", body: cyclic }));
});

Deno.test("event handlers retire on natural completion, Replace, Stop, and Panic", async () => {
  const seen: number[] = [];
  let starts = 0;
  let finish = false;
  let oldCtx: TimeContext | undefined;
  const engine = createLivecodeEngine({
    log: () => {},
    onSyncTick: () => {},
    seedDemoRoll: false,
    importModule: async () => ({
      default: async (ctx: TimeContext) => {
        const generation = ++starts;
        oldCtx ??= ctx;
        onEvent(() => seen.push(generation), ctx);
        while (!finish) await ctx.waitSec(0.01);
      },
    }),
  });
  const request = {
    moduleId: "events/lifecycle",
    generatedRunId: "same-build",
    transformedModuleUri: "file:///events.ts",
  };
  const send = () =>
    executeEngineOp(engine, {
      kind: "emitEvent",
      event: { type: "test", body: {} },
    });
  try {
    await engine.launchModule(request);
    await waitFor(() => starts === 1, "first subscription");
    assertEquals(await send(), { delivered: 1 });
    await engine.launchModule({ ...request, replaceRunning: true });
    await waitFor(() => starts === 2, "replacement subscription");
    onEvent(() => seen.push(-1), oldCtx!); // A late predecessor cannot re-register.
    assertEquals(await send(), { delivered: 1 });
    assertEquals(seen, [1, 2]);
    await engine.stopModule(request.moduleId, "test");
    assertEquals(await send(), { delivered: 0 });
    await engine.launchModule(request);
    await waitFor(() => starts === 3, "third subscription");
    await engine.panicRuntime("test");
    assertEquals(await send(), { delivered: 0 });
    await engine.launchModule(request);
    await waitFor(() => starts === 4, "fourth subscription");
    finish = true;
    await waitFor(
      () => engine.activeModuleIds().length === 0,
      "natural completion",
    );
    assertEquals(await send(), { delivered: 0 });
  } finally {
    await engine.close();
  }
});
