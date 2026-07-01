import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  clearAllPianoRollLookups,
  clearAllWaits,
  clearModulePianoRollLookups,
  clearModuleWaits,
  enterWait,
  exitWait,
  getActiveWaitsByModule,
  makeActiveWaitSnapshot,
  visualizedAwait,
  visualizedPianoRollLookup,
} from "../visualizer/runtime.ts";

Deno.test("runtime count map keeps ids active until count reaches zero", () => {
  clearAllWaits();
  enterWait("module-a", "id-1");
  enterWait("module-a", "id-1");
  assertEquals(getActiveWaitsByModule(), { "module-a": ["id-1"] });

  exitWait("module-a", "id-1");
  assertEquals(getActiveWaitsByModule(), { "module-a": ["id-1"] });

  exitWait("module-a", "id-1");
  assertEquals(getActiveWaitsByModule(), {});
});

Deno.test("runtime count map isolates modules", () => {
  clearAllWaits();
  enterWait("module-a", "id-1");
  enterWait("module-b", "id-1");
  enterWait("module-b", "id-2");
  assertEquals(getActiveWaitsByModule(), {
    "module-a": ["id-1"],
    "module-b": ["id-1", "id-2"],
  });

  clearModuleWaits("module-b");
  assertEquals(getActiveWaitsByModule(), { "module-a": ["id-1"] });
  clearAllWaits();
});

Deno.test("visualizedAwait clears on resolve and reject", async () => {
  clearAllWaits();

  const resolved = visualizedAwait(
    "module-a",
    "resolve-id",
    Promise.resolve(42),
  );
  assertEquals(getActiveWaitsByModule(), { "module-a": ["resolve-id"] });
  assertEquals(await resolved, 42);
  assertEquals(getActiveWaitsByModule(), {});

  const rejected = visualizedAwait(
    "module-a",
    "reject-id",
    Promise.reject(new Error("boom")),
  );
  assertEquals(getActiveWaitsByModule(), { "module-a": ["reject-id"] });
  await assertRejects(() => rejected, Error, "boom");
  assertEquals(getActiveWaitsByModule(), {});
});

Deno.test("visualizedAwait keeps active while controlled promise is pending", async () => {
  clearAllWaits();
  let resolvePromise!: () => void;
  const pending = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });

  const task = visualizedAwait("module-a", "pending-id", pending);
  assertEquals(getActiveWaitsByModule(), { "module-a": ["pending-id"] });
  resolvePromise();
  await task;
  assertEquals(getActiveWaitsByModule(), {});
  assert(true);
});

Deno.test("visualizedPianoRollLookup records resolved names and returns value", () => {
  clearAllWaits();
  const value = visualizedPianoRollLookup("module-a", "roll-id-1", "melody");
  assertEquals(value, "melody");
  const snapshot = makeActiveWaitSnapshot();
  assertEquals(snapshot.pianoRollLookups, {
    "module-a": { "roll-id-1": "melody" },
  });
});

Deno.test("visualizedPianoRollLookup updates overwrite previous names", () => {
  clearAllWaits();
  visualizedPianoRollLookup("module-a", "roll-id-1", "melody");
  visualizedPianoRollLookup("module-a", "roll-id-1", "bass");
  const snapshot = makeActiveWaitSnapshot();
  assertEquals(snapshot.pianoRollLookups, {
    "module-a": { "roll-id-1": "bass" },
  });
});

Deno.test("clearModulePianoRollLookups clears only piano roll lookups", () => {
  clearAllWaits();
  clearAllPianoRollLookups();
  visualizedPianoRollLookup("module-a", "roll-id-1", "melody");
  enterWait("module-a", "wait-id-1");
  clearModulePianoRollLookups("module-a");
  const snapshot = makeActiveWaitSnapshot();
  assertEquals(snapshot.modules, { "module-a": ["wait-id-1"] });
  assertEquals(snapshot.pianoRollLookups, {});
});
