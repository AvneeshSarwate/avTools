import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  collectSixSinesChanges,
  getSixSines,
  listSixSinesNames,
  registerSixSines,
  removeSixSines,
  setSixSinesParameters,
  setSixSinesPreset,
  subscribeSixSinesChanges,
} from "@avtools/livecode-engine/six_sines_store.ts";
import { registerBuiltinEntityKinds } from "@avtools/livecode-engine/entity_kinds.ts";
import { getDurableEntityType } from "@avtools/livecode-engine/entity_registry.ts";
import { SyncSourceRegistry } from "@avtools/livecode-engine/sync_sources.ts";
import {
  applySyncMessageToState,
  emptySyncState,
  materializeEntityPatches,
} from "../../../livecode-tldraw/src/syncState.ts";
import { createLivecodeVisualizerServer } from "../visualizer/server.ts";
import { SyncClient } from "./test_helpers.ts";
function reset() {
  for (const n of listSixSinesNames()) removeSixSines(n);
  collectSixSinesChanges();
}
const defaults = () => ({
  preset: "<native.sxsnp/>",
  values: Object.fromEntries(
    Array.from({ length: 2554 }, (_, i) => [String(i), i]),
  ),
});
Deno.test("Six Sines sparse hot writes, identity, snapshots, local fanout and monotonic recreation", () => {
  reset();
  const live = registerSixSines("test", defaults());
  const values = live.values;
  assert(registerSixSines("test", { preset: "ignored", values: {} }) === live);
  const initial = getSixSines("test")!;
  assertEquals(collectSixSinesChanges()![0].entity, initial);
  const state = emptySyncState();
  applySyncMessageToState(state, {
    type: "sync",
    seq: 1,
    timestampMs: 0,
    resets: { sixSines: [initial] },
  });
  let calls = 0;
  const unsubscribe = subscribeSixSinesChanges("test", (patches, data) => {
    calls++;
    assert(data === live);
    assertEquals(patches.length, 5);
  });
  // A hot write+collect must not JSON serialize/snapshot the full value tree.
  const stringify = JSON.stringify;
  const keys = Object.keys;
  Object.keys = ((object: object) => {
    const result = keys(object);
    if (result.length >= 2554) throw new Error("Unexpected whole values scan");
    return result;
  }) as typeof Object.keys;
  JSON.stringify = (() => {
    throw new Error("Unexpected serialization");
  }) as typeof JSON.stringify;
  let changes;
  try {
    live.values["2"] = 42;
    live.values["3"] = 43;
    changes = collectSixSinesChanges()!;
  } finally {
    JSON.stringify = stringify;
    Object.keys = keys;
  }
  assertEquals(calls, 1);
  unsubscribe();
  assertEquals(collectSixSinesChanges(), null);
  assert(changes[0].patches);
  assertEquals(changes[0].patches.length, 5);
  assert(JSON.stringify(changes).length < 600);
  applySyncMessageToState(state, {
    type: "sync",
    seq: 2,
    timestampMs: 0,
    changes: changes.map((c) => ({ ...c, entityType: "sixSines" })),
  });
  assertEquals(state.sixSines.entities.test, getSixSines("test"));
  assertEquals(initial.data.values["2"], 2);
  assertThrows(() => {
    live.values["bad"] = 1;
  });
  assertThrows(() => {
    live.values["4"] = Infinity;
  });
  const rev = getSixSines("test")!.rev;
  assertEquals(
    setSixSinesParameters("test", { "4": 5 }, { expectedRev: rev - 1 }).ok,
    false,
  );
  assertEquals(
    setSixSinesPreset("test", { preset: "new", values: { "7": 7 } }).ok,
    true,
  );
  assert(live.values === values);
  assertEquals(live.values["7"], 7);
  removeSixSines("test");
  registerSixSines("test", { preset: "recreated", values: {} });
  assert(getSixSines("test")!.rev > rev);
  assert(collectSixSinesChanges()![0].entity);
  reset();
});
Deno.test("Six Sines registry bulk load and save preserve live identity and copies", () => {
  reset();
  registerBuiltinEntityKinds(new SyncSourceRegistry());
  const descriptor = getDurableEntityType("sixSines")!;
  const live = registerSixSines("saved", defaults());
  const values = live.values;
  const saved = descriptor.serialize("saved");
  live.values["0"] = 99;
  descriptor.deserialize("saved", saved);
  assertEquals(live.values["0"], 0);
  assert(live.values === values);
  descriptor.duplicate("saved", "copy");
  setSixSinesParameters("copy", { "0": 88 });
  assertEquals(live.values["0"], 0);
  assertEquals(
    JSON.parse(descriptor.latestJson("saved")!),
    getSixSines("saved")!.data,
  );
  reset();
});
Deno.test("patch materializer preserves untouched branches and protects inherited parents", () => {
  const original = {
    data: { values: { "1": 1 }, other: { keep: true } },
    rev: 1,
  };
  const next = materializeEntityPatches(original, [{
    op: "set",
    path: ["data", "values", "1"],
    value: 2,
  }, { op: "set", path: ["rev"], value: 2 }]) as typeof original;
  assert(next.data.other === original.data.other);
  assert(next.data !== original.data);
  assertEquals(original.data.values["1"], 1);
  assertThrows(() =>
    materializeEntityPatches({}, [{
      op: "set",
      path: ["__proto__", "polluted"],
      value: true,
    }])
  );
});
Deno.test("Six Sines HTTP edits, subscribed sparse transport and reconnect reset", async () => {
  reset();
  const sessionRoot = await Deno.makeTempDir();
  const server = await createLivecodeVisualizerServer({ port: 0, sessionRoot });
  let a: SyncClient | undefined;
  let b: SyncClient | undefined;
  try {
    registerSixSines("wire", defaults());
    a = await SyncClient.open(server.baseUrl);
    const first = await a.subscribe(["sixSines"]);
    assertEquals(first.resets!.sixSines.length, 1);
    // Ensure creation's full change has drained before asserting sparse edits.
    await new Promise((r) => setTimeout(r, 100));
    const from = a.messages.length;
    const response = await fetch(server.baseUrl + "/six-sines/parameters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "wire",
        changes: { "1": 123 },
        originId: "ui",
      }),
    });
    assertEquals(response.status, 200);
    assertEquals((await response.json()).ok, true);
    await a.waitForChange(
      from,
      "sixSines",
      (c) => !!c.patches,
      "sparse parameter edit",
    );
    const patch = a.changesSince(from, "sixSines").find((c) => c.patches)!;
    assert(patch.patches);
    assert(JSON.stringify(patch).length < 600);
    b = await SyncClient.open(server.baseUrl);
    const reconnect = await b.subscribe(["sixSines"]);
    assertEquals(reconnect.resets!.sixSines[0], getSixSines("wire"));
    const conflict = await fetch(server.baseUrl + "/entities/patch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "sixSines",
        name: "wire",
        expectedRev: 0,
        patches: [{ op: "set", path: ["data", "values", "1"], value: 0 }],
      }),
    });
    assertEquals(conflict.status, 409);
    await conflict.json();
    const bulk = await fetch(server.baseUrl + "/six-sines/preset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "wire",
        data: { preset: "loaded", values: { "3": 33 } },
      }),
    });
    assertEquals((await bulk.json()).ok, true);
    assertEquals(getSixSines("wire")!.data, {
      preset: "loaded",
      values: { "3": 33 },
    });
  } finally {
    await a?.close();
    await b?.close();
    await server.close();
    await Deno.remove(sessionRoot, { recursive: true });
    reset();
  }
});

Deno.test("reflected writes and reentrant listener writes remain tracked; errors do not lose delivery", () => {
  reset();
  const live = registerSixSines("listeners", {
    preset: "",
    values: { "1": 1 },
  });
  collectSixSinesChanges();
  const reflected = Object.getOwnPropertyDescriptor(live, "values")!.value;
  assert(reflected === live.values);
  reflected["1"] = 2;
  let errors = 0;
  const log = console.error;
  console.error = () => {
    errors++;
  };
  const unsubscribe = subscribeSixSinesChanges("listeners", () => {
    live.values["1"] = 3;
    throw new Error("listener failure");
  });
  try {
    const batch = collectSixSinesChanges()!;
    assert(batch[0].patches);
    assertEquals(batch[0].patches[0], {
      op: "set",
      path: ["data", "values", "1"],
      value: 2,
    });
    assertEquals(errors, 1);
  } finally {
    unsubscribe();
    console.error = log;
  }
  const followup = collectSixSinesChanges()!;
  assertEquals(followup[0].patches![0], {
    op: "set",
    path: ["data", "values", "1"],
    value: 3,
  });
  assertEquals(collectSixSinesChanges(), null);
  reset();
});
Deno.test("Six Sines project save/open preserves entity and canvas views", async () => {
  reset();
  const sessionRoot = await Deno.makeTempDir();
  const projectRoot = await Deno.makeTempDir();
  const server = await createLivecodeVisualizerServer({ port: 0, sessionRoot });
  async function post(path: string, body: unknown) {
    const response = await fetch(server.baseUrl + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    assertEquals(response.status, 200, JSON.stringify(result));
    return result;
  }
  try {
    await post("/project/create", {
      projectPath: projectRoot,
      name: "six-save",
    });
    registerSixSines("project-synth", {
      preset: "native xml",
      values: { "7": 0.5 },
    });
    const views = [{
      id: "view",
      synthName: "project-synth",
      x: 1,
      y: 2,
      w: 300,
      h: 200,
    }];
    await post("/project/canvas", { canvas: { sixSinesViews: views } });
    await post("/project/save", {});
    setSixSinesParameters("project-synth", { "7": 0.9 });
    const opened = await post("/project/open", { projectPath: projectRoot });
    assertEquals(opened.project.manifest.canvas.sixSinesViews, views);
    assertEquals(getSixSines("project-synth")!.data, {
      preset: "native xml",
      values: { "7": 0.5 },
    });
  } finally {
    await server.close();
    await Deno.remove(sessionRoot, { recursive: true });
    await Deno.remove(projectRoot, { recursive: true });
    reset();
  }
});
