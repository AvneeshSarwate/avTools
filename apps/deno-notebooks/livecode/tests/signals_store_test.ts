import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import type { TimeContext } from "@avtools/core-timing";
import {
  assignSignalOwner,
  clearSignalsStore,
  declareSignal,
  endSignal,
  endSignalsForModule,
  listSignals,
  makeSignalsSnapshot,
  sampleSignalsSnapshot,
  SIGNAL_ENTITY_TYPE,
} from "../visualizer/signals_store.ts";
import {
  sampleRootTime,
  setRootTimeContext,
  visualizedOwnedSignal,
} from "../visualizer/runtime.ts";
import {
  getDurableEntityType,
  listDurableEntityTypes,
  registerBuiltinDurableEntityTypes,
} from "../visualizer/entity_registry.ts";
import type { SignalEntity } from "../visualizer/protocol.ts";

function reset(): void {
  clearSignalsStore();
  setRootTimeContext(null);
}

function findSignal(name: string): SignalEntity | undefined {
  return listSignals().find((entity) => entity.name === name);
}

/** Minimal stand-in for the parent loop's context: the accessor reads two fields. */
function fakeRootContext(timeSec: number, beats: number): TimeContext {
  return { time: timeSec, beats } as unknown as TimeContext;
}

Deno.test("declareSignal creates a signal at rev 1 with a null value", () => {
  reset();
  const handle = declareSignal("test/plain");

  assertEquals(handle.name, "test/plain");
  const entity = findSignal("test/plain");
  assert(entity);
  assertEquals(entity.rev, 1);
  assertEquals(entity.updatedBy, "declare");
  assertEquals(entity.value, null);
  assertEquals(entity.anchor, undefined);
  assertEquals(entity.ended, undefined);
  assertEquals(entity.ownerModuleId, undefined);

  assertThrows(() => declareSignal("   "), Error, "must not be empty");
});

Deno.test("declareSignal reattaches, and a redeclaration clears ended and replaces the anchor", () => {
  reset();
  const first = declareSignal<number>("test/reattach", {
    anchor: { type: "pianoRoll", name: "melody" },
  });
  first.set(4);
  sampleSignalsSnapshot();
  first.end();
  assertEquals(findSignal("test/reattach")?.ended, true);

  const second = declareSignal<number>("test/reattach", {
    anchor: { type: "pianoRoll", name: "bass", path: ["notes"] },
  });
  const reattached = findSignal("test/reattach");
  assertEquals(reattached?.ended, undefined, "redeclare clears ended");
  assertEquals(reattached?.anchor, {
    type: "pianoRoll",
    name: "bass",
    path: ["notes"],
  });
  assertEquals(reattached?.value, 4, "the live value survives a redeclare");
  assertEquals(reattached?.rev, 2, "a redeclare is not a value generation");

  // The old handle still writes to live truth, exactly like a params object
  // kept across a relaunch.
  first.set(9);
  second.set(11);
  assertEquals(sampleSignalsSnapshot()?.signals["test/reattach"].value, 11);
});

Deno.test("set is a pure assignment: nothing is published until the sampler tick", () => {
  reset();
  const position = declareSignal<number>("test/pure");
  assert(sampleSignalsSnapshot(), "the declaration itself is a change");
  assertEquals(sampleSignalsSnapshot(), null, "an idle tick sends nothing");

  position.set(1);
  position.set(2);
  position.set(3);
  assertEquals(
    findSignal("test/pure")?.rev,
    1,
    "writes bypass the store; rev only advances at adoption",
  );

  const adopted = sampleSignalsSnapshot();
  assertEquals(adopted?.signals["test/pure"].value, 3);
  assertEquals(adopted?.signals["test/pure"].rev, 2);
  assertEquals(adopted?.signals["test/pure"].updatedBy, "code");

  // Re-setting a byte-identical value must not broadcast: a set-driven dirty
  // flag would ship the same snapshot on every tick of a re-set loop.
  position.set(3);
  assertEquals(sampleSignalsSnapshot(), null);
  position.set({ position: 3 } as unknown as number);
  assert(sampleSignalsSnapshot(), "a real change is still adopted");
});

Deno.test("the sampler ships only changed signals and stamps them with logical time", () => {
  reset();
  const a = declareSignal<number>("test/stamp-a");
  const b = declareSignal<number>("test/stamp-b");
  sampleSignalsSnapshot();

  setRootTimeContext(fakeRootContext(12.5, 25));
  a.set(1);
  const first = sampleSignalsSnapshot();
  assertEquals(first?.signals["test/stamp-a"].timeSec, 12.5);
  assertEquals(first?.signals["test/stamp-a"].beats, 25);
  assertEquals(
    first?.signals["test/stamp-b"].timeSec,
    undefined,
    "an unchanged signal is not restamped",
  );

  setRootTimeContext(fakeRootContext(13.5, 27));
  b.set(2);
  const second = sampleSignalsSnapshot();
  assertEquals(second?.signals["test/stamp-a"].timeSec, 12.5);
  assertEquals(second?.signals["test/stamp-b"].timeSec, 13.5);
  assertEquals(second?.signals["test/stamp-b"].beats, 27);
  assert(second && first && second.seq > first.seq);

  // No registered context: stamps are simply omitted.
  setRootTimeContext(null);
  assertEquals(sampleRootTime(), null);
  const fresh = declareSignal<number>("test/stamp-c");
  fresh.set(5);
  const third = sampleSignalsSnapshot();
  assertEquals(third?.signals["test/stamp-c"].timeSec, undefined);
  assertEquals(third?.signals["test/stamp-c"].beats, undefined);
});

Deno.test("a forced snapshot is read-only: it neither consumes the gate nor adopts a value", () => {
  reset();
  const handle = declareSignal<number>("test/forced");

  const onOpen = makeSignalsSnapshot();
  assertEquals(onOpen.signals["test/forced"].value, null);
  assertEquals(onOpen.signals["test/forced"].rev, 1);
  assert(
    sampleSignalsSnapshot(),
    "a forced snapshot must not consume the pending broadcast",
  );

  handle.set(7);
  const duringDrift = makeSignalsSnapshot();
  assertEquals(duringDrift.signals["test/forced"].value, 7);
  assertEquals(duringDrift.signals["test/forced"].rev, 1);

  const adopted = sampleSignalsSnapshot();
  assertEquals(adopted?.signals["test/forced"].rev, 2);
  assertEquals(adopted?.signals["test/forced"].updatedBy, "code");
});

Deno.test("the sampler flags an unserializable value instead of throwing", () => {
  reset();
  const handle = declareSignal<unknown>("test/unserializable");
  handle.set({ position: 1 });
  sampleSignalsSnapshot();

  handle.set(10n);
  const flagged = sampleSignalsSnapshot();
  assertEquals(flagged?.signals["test/unserializable"].unserializable, true);
  assertEquals(
    flagged?.signals["test/unserializable"].value,
    { position: 1 },
    "the snapshot keeps the last value that did serialize",
  );

  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  handle.set(cyclic);
  assertEquals(sampleSignalsSnapshot(), null, "the flag is set exactly once");

  handle.set({ position: 2 });
  const recovered = sampleSignalsSnapshot();
  assertEquals(
    recovered?.signals["test/unserializable"].unserializable,
    undefined,
  );
  assertEquals(recovered?.signals["test/unserializable"].value, {
    position: 2,
  });
});

Deno.test("ending is sticky: values keep writing and the flag stays until a redeclare", () => {
  reset();
  const handle = declareSignal<number>("test/sticky");
  handle.set(1);
  sampleSignalsSnapshot();

  handle.end();
  const ended = sampleSignalsSnapshot();
  assertEquals(ended?.signals["test/sticky"].ended, true);
  assertEquals(ended?.signals["test/sticky"].rev, 2, "ending is not a value");
  assertEquals(sampleSignalsSnapshot(), null, "ending twice is idempotent");
  assertEquals(endSignal("test/sticky"), false);

  // A user timer that survived cooperative cancellation keeps publishing: the
  // moving-but-ended contradiction is surfaced, not policed.
  handle.set(2);
  const moving = sampleSignalsSnapshot();
  assertEquals(moving?.signals["test/sticky"].value, 2);
  assertEquals(moving?.signals["test/sticky"].ended, true);

  assertEquals(endSignal("test/never-declared"), false);
});

Deno.test("endSignalsForModule ends exactly the signals that module owns", () => {
  reset();
  declareSignal("test/owned-a");
  declareSignal("test/owned-b");
  declareSignal("test/other");
  declareSignal("test/unowned");
  assignSignalOwner("test/owned-a", "module-1");
  assignSignalOwner("test/owned-b", "module-1");
  assignSignalOwner("test/other", "module-2");
  assertEquals(assignSignalOwner("test/absent", "module-1"), false);
  sampleSignalsSnapshot();

  assertEquals(endSignalsForModule("module-1"), 2);
  const snapshot = sampleSignalsSnapshot();
  assertEquals(snapshot?.signals["test/owned-a"].ended, true);
  assertEquals(snapshot?.signals["test/owned-b"].ended, true);
  assertEquals(snapshot?.signals["test/other"].ended, undefined);
  assertEquals(snapshot?.signals["test/unowned"].ended, undefined);

  assertEquals(endSignalsForModule("module-1"), 0);
  assertEquals(sampleSignalsSnapshot(), null);
  assertEquals(endSignalsForModule("module-never-ran"), 0);

  // Redeclaring after the run ended is how the next run takes the name back.
  declareSignal("test/owned-a");
  assertEquals(
    sampleSignalsSnapshot()?.signals["test/owned-a"].ended,
    undefined,
  );
});

Deno.test("__tcvOwnedSignal stamps ownership on the handle and returns it unchanged", () => {
  reset();
  const handle = visualizedOwnedSignal(
    "module-1",
    "callsite-1",
    declareSignal<number>("test/wrapped"),
  );

  assertEquals(findSignal("test/wrapped")?.ownerModuleId, "module-1");
  handle.set(3);
  assertEquals(sampleSignalsSnapshot()?.signals["test/wrapped"].value, 3);
  endSignalsForModule("module-1");
  assertEquals(sampleSignalsSnapshot()?.signals["test/wrapped"].ended, true);

  // A later run of another module re-owns the name through its own declaration.
  visualizedOwnedSignal(
    "module-2",
    "callsite-1",
    declareSignal<number>("test/wrapped"),
  );
  assertEquals(findSignal("test/wrapped")?.ownerModuleId, "module-2");
  assertEquals(findSignal("test/wrapped")?.ended, undefined);

  // Transparent for anything that is not a handle: an untransformed or
  // shadowed call must never fail a run.
  assertEquals(visualizedOwnedSignal("module-1", "callsite-2", 42), 42);
  assertEquals(visualizedOwnedSignal("module-1", "callsite-3", null), null);
  assertEquals(
    visualizedOwnedSignal("module-1", "callsite-4", undefined),
    undefined,
  );
});

Deno.test("signals are invisible to the durable entity registry", () => {
  reset();
  registerBuiltinDurableEntityTypes();
  declareSignal<number>("test/ephemeral").set(1);
  sampleSignalsSnapshot();

  // `/project/save`, `/project/status` data rows, project open, and
  // `/entities/*` all iterate the registry, so not registering the type is the
  // whole ephemeral guarantee: no filter anywhere has to remember signals.
  assertEquals(
    listDurableEntityTypes().map((descriptor) => descriptor.typeId),
    ["params", "pianoRoll"],
  );
  assertEquals(getDurableEntityType(SIGNAL_ENTITY_TYPE), undefined);
  for (const descriptor of listDurableEntityTypes()) {
    assertEquals(descriptor.listNames().includes("test/ephemeral"), false);
    assertEquals(descriptor.exists("test/ephemeral"), false);
  }
  assert(findSignal("test/ephemeral"), "the signal itself is still live");
});
