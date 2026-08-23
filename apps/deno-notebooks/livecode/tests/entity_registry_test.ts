import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  allocateEntityDataPath,
  encodeEntityName,
  entityDataPath,
  getDurableEntityType,
  listDurableEntityTypes,
  registerBuiltinDurableEntityTypes,
} from "@avtools/livecode-engine/entity_registry.ts";
import {
  clearPianoRollStore,
  collectPianoRollChanges,
  getPianoRoll,
  makePianoRollSnapshot,
  redoPianoRoll,
  seedDemoPianoRoll,
  setPianoRoll,
  undoPianoRoll,
} from "@avtools/livecode-engine/piano_roll_store.ts";
import {
  clearParamsStore,
  getParams,
  registerParams,
} from "@avtools/livecode-engine/params_store.ts";
import type {
  NoteDataInput,
  SavedParamsEntity,
  SavedPianoRollEntity,
} from "../visualizer/protocol.ts";

registerBuiltinDurableEntityTypes();

const pianoRolls = getDurableEntityType("pianoRoll")!;
const params = getDurableEntityType("params")!;

function resetStores(): void {
  clearPianoRollStore();
  clearParamsStore();
  // Seeding is an explicit server-construction step now, not something a read
  // path does lazily, so a reset reproduces construction rather than relying on
  // the next list/get to conjure `melody` back.
  seedDemoPianoRoll();
  // Drain what the reset and the seed just recorded, the way a broadcast tick
  // does, so the change assertions below start from a quiet store.
  collectPianoRollChanges();
}

Deno.test("the registry exposes exactly the two built-in durable types", () => {
  assertEquals(
    listDurableEntityTypes().map((descriptor) => descriptor.typeId),
    ["params", "pianoRoll"],
  );
  assertEquals(getDurableEntityType("nope"), undefined);
});

Deno.test("pianoRoll create makes an empty roll and rejects an existing name", () => {
  resetStores();
  pianoRolls.create("reg/created");

  assert(pianoRolls.exists("reg/created"));
  assertEquals(getPianoRoll("reg/created")?.data.notes, []);
  assert(pianoRolls.listNames().includes("reg/created"));
  assertThrows(
    () => pianoRolls.create("reg/created"),
    Error,
    "already exists",
  );
});

Deno.test("pianoRoll duplicate clones note data and leaves the source alone", () => {
  resetStores();
  setPianoRoll("reg/source", {
    notes: [{ id: "n1", pitch: 60, position: 0, duration: 1, velocity: 77 }],
  });

  pianoRolls.duplicate("reg/source", "reg/copy");
  const copy = getPianoRoll("reg/copy");
  assertEquals(copy?.data.notes[0].id, "n1");
  assertEquals(copy?.data.notes[0].velocity, 77);

  setPianoRoll("reg/copy", {
    notes: [{ id: "n2", pitch: 64, position: 0, duration: 1 }],
  });
  assertEquals(getPianoRoll("reg/source")?.data.notes[0].id, "n1");

  assertThrows(
    () => pianoRolls.duplicate("reg/missing", "reg/other"),
    Error,
    'No piano roll "reg/missing"',
  );
  assertThrows(
    () => pianoRolls.duplicate("reg/source", "reg/copy"),
    Error,
    "already exists",
  );
});

Deno.test("pianoRoll remove reports whether it removed anything", () => {
  resetStores();
  pianoRolls.create("reg/doomed");
  assertEquals(pianoRolls.remove("reg/doomed"), true);
  assertEquals(pianoRolls.exists("reg/doomed"), false);
  assertEquals(pianoRolls.remove("reg/doomed"), false);
});

Deno.test("deleting the demo roll is honest and defeats a later re-seed", () => {
  resetStores();
  assert(pianoRolls.listNames().includes("melody"), "seeded at construction");

  assertEquals(pianoRolls.remove("melody"), true);
  assertEquals(pianoRolls.listNames().includes("melody"), false);
  assertEquals(getPianoRoll("melody"), undefined);
  assertEquals(pianoRolls.exists("melody"), false);

  // A second construction-time seeding pass must not resurrect it.
  assertEquals(seedDemoPianoRoll(), undefined);
  assertEquals(pianoRolls.exists("melody"), false);

  // Only an explicit write brings the name back.
  pianoRolls.create("melody");
  assert(pianoRolls.exists("melody"));
});

Deno.test("a pristine demo seed is excluded from save; any real write captures it", () => {
  resetStores();
  assert(pianoRolls.listNames().includes("melody"));
  assertEquals(pianoRolls.serialize("melody"), null);

  setPianoRoll("melody", {
    notes: [{ id: "edited", pitch: 60, position: 0, duration: 1 }],
  }, { source: "client" });

  const saved = pianoRolls.serialize("melody") as SavedPianoRollEntity;
  assertEquals(saved.type, "pianoRoll");
  assertEquals(saved.name, "melody");
  assertEquals(saved.data.notes[0].id, "edited");
});

Deno.test("a roll write rejects unserializable data without creating an entity", () => {
  resetStores();
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const note: NoteDataInput = {
    id: "circular",
    pitch: 60,
    position: 0,
    duration: 1,
    metadata: circular,
  };
  const result = setPianoRoll("reg/hostile", { notes: [note] });

  assertEquals(result.ok, false);
  assertEquals(getPianoRoll("reg/hostile"), undefined);
});

Deno.test("a rejected roll update leaves value, revision, history, and change state intact", () => {
  resetStores();
  const created = setPianoRoll("reg/stable", {
    notes: [{ id: "valid", pitch: 60, position: 0, duration: 1 }],
  }, { source: "client" });
  assert(created.ok);
  collectPianoRollChanges();

  const result = setPianoRoll("reg/stable", {
    notes: [{
      id: "invalid",
      pitch: 72,
      position: 0,
      duration: 1,
      metadata: { value: 1n },
    }],
  }, { source: "client" });

  if (result.ok) throw new Error("expected the update to be rejected");
  assertEquals(result.current, created.roll);
  assertEquals(getPianoRoll("reg/stable"), created.roll);
  assertEquals(collectPianoRollChanges(), null);
});

Deno.test("pianoRoll round-trips through serialize/deserialize", () => {
  resetStores();
  setPianoRoll("reg/trip", {
    notes: [
      { id: "a", pitch: 60, position: 0, duration: 0.5, velocity: 31 },
      { id: "b", pitch: 67, position: 1, duration: 2, velocity: 111 },
    ],
    viewport: { scrollX: 1, scrollY: 2, zoomX: 3, zoomY: 4 },
    grid: { subdivision: 8 },
  }, { source: "client" });

  const saved = pianoRolls.serialize("reg/trip");
  const wire = JSON.parse(JSON.stringify(saved));
  pianoRolls.deserialize("reg/trip-loaded", wire);

  const loaded = getPianoRoll("reg/trip-loaded");
  assertEquals(loaded?.data.notes.map((note) => note.id), ["a", "b"]);
  assertEquals(loaded?.data.notes.map((note) => note.velocity), [31, 111]);
  assertEquals(loaded?.data.viewport, {
    scrollX: 1,
    scrollY: 2,
    zoomX: 3,
    zoomY: 4,
  });
  assertEquals(loaded?.data.grid, { subdivision: 8 });
  assertEquals(
    pianoRolls.latestJson("reg/trip-loaded"),
    pianoRolls.latestJson("reg/trip"),
  );
});

Deno.test("loading a roll clears its undo/redo history", () => {
  resetStores();
  setPianoRoll("reg/history", {
    notes: [{ id: "one", pitch: 60, position: 0, duration: 1 }],
  }, { source: "client" });
  setPianoRoll("reg/history", {
    notes: [{ id: "two", pitch: 62, position: 0, duration: 1 }],
  }, { source: "client" });
  assertEquals(getPianoRoll("reg/history")?.canUndo, true);

  pianoRolls.deserialize("reg/history", {
    type: "pianoRoll",
    name: "reg/history",
    savedAt: new Date().toISOString(),
    data: { notes: [{ id: "saved", pitch: 64, position: 0, duration: 1 }] },
  });

  const loaded = getPianoRoll("reg/history");
  assertEquals(loaded?.data.notes[0].id, "saved");
  assertEquals(loaded?.canUndo, false);
  assertEquals(loaded?.canRedo, false);
});

Deno.test("pianoRoll deserialize rejects a malformed saved file", () => {
  resetStores();
  assertThrows(
    () => pianoRolls.deserialize("reg/bad", { data: { notes: "nope" } }),
    Error,
    "data.notes must be an array",
  );
  assertThrows(
    () => pianoRolls.deserialize("reg/bad", { data: { notes: [{}] } }),
    Error,
    "note.pitch must be a finite number",
  );
  assertThrows(
    () => pianoRolls.deserialize("reg/bad", "not-an-object"),
    Error,
    "must be a JSON object",
  );
  assertEquals(getPianoRoll("reg/bad"), undefined);
});

Deno.test("getPianoRoll normalizes its name like every other store entry point", () => {
  resetStores();
  setPianoRoll("  reg/spaced  ", {
    notes: [{ id: "n", pitch: 60, position: 0, duration: 1 }],
  });
  assertEquals(getPianoRoll("reg/spaced")?.name, "reg/spaced");
  assertEquals(getPianoRoll("  reg/spaced  ")?.name, "reg/spaced");
});

Deno.test("a snapshot never swallows the pending broadcast", () => {
  resetStores();
  pianoRolls.create("reg/broadcast");

  // An HTTP list (or a socket that just opened) answers one caller only, and
  // every snapshot is read-only with respect to the change gate.
  assert(makePianoRollSnapshot().rolls["reg/broadcast"]);
  const broadcast = collectPianoRollChanges();
  assertEquals(
    broadcast?.map((change) => change.name),
    ["reg/broadcast"],
    "the open views must still receive the new roll",
  );
  assertEquals(collectPianoRollChanges(), null);
});

Deno.test("a deleted roll ships as a deletion and drops its undo history", () => {
  resetStores();
  setPianoRoll("reg/deleted", {
    notes: [{ id: "one", pitch: 60, position: 0, duration: 1 }],
  }, { source: "client" });
  setPianoRoll("reg/deleted", {
    notes: [{ id: "two", pitch: 62, position: 0, duration: 1 }],
  }, { source: "client" });
  assertEquals(getPianoRoll("reg/deleted")?.canUndo, true);
  collectPianoRollChanges();

  assertEquals(pianoRolls.remove("reg/deleted"), true);
  const changes = collectPianoRollChanges();
  assertEquals(changes, [{ name: "reg/deleted", entity: null }]);

  // Recreating the name must not inherit stacks that undo into a state it
  // never held.
  pianoRolls.create("reg/deleted");
  assertEquals(getPianoRoll("reg/deleted")?.canUndo, false);
  assertEquals(getPianoRoll("reg/deleted")?.canRedo, false);
});

Deno.test("undo and redo walk one roll's history and every step is a generation", () => {
  resetStores();
  const first = setPianoRoll("reg/history-walk", {
    notes: [{ id: "one", pitch: 60, position: 0, duration: 1 }],
  }, { source: "client" });
  assert(first.ok);
  assertEquals(
    first.roll.canUndo,
    false,
    "the creating write pushes no history",
  );

  const second = setPianoRoll("reg/history-walk", {
    notes: [{ id: "two", pitch: 62, position: 0, duration: 1 }],
  }, { source: "client", label: "Second" });
  assert(second.ok);
  assertEquals(second.roll.canUndo, true);
  assertEquals(second.roll.canRedo, false);

  const undone = undoPianoRoll("reg/history-walk");
  assertEquals(undone?.data.notes[0].id, "one");
  assertEquals(undone?.updatedBy, "undo");
  assertEquals(undone?.canUndo, false);
  assertEquals(undone?.canRedo, true);
  assert(
    undone && undone.rev > second.roll.rev,
    "an undo is a new generation",
  );

  const redone = redoPianoRoll("reg/history-walk", { originId: "pane" });
  assertEquals(redone?.data.notes[0].id, "two");
  assertEquals(redone?.updatedBy, "pane", "an originId wins over the default");
  assertEquals(redone?.canUndo, true);
  assertEquals(redone?.canRedo, false);

  // A fresh write clears the redo stack, and a non-undoable write records none.
  undoPianoRoll("reg/history-walk");
  assertEquals(getPianoRoll("reg/history-walk")?.canRedo, true);
  setPianoRoll("reg/history-walk", {
    notes: [{ id: "three", pitch: 64, position: 0, duration: 1 }],
  }, { source: "client" });
  assertEquals(getPianoRoll("reg/history-walk")?.canRedo, false);
  setPianoRoll("reg/history-walk", {
    notes: [{ id: "four", pitch: 65, position: 0, duration: 1 }],
  }, { source: "livecode", undoable: false });
  const afterQuiet = undoPianoRoll("reg/history-walk");
  assertEquals(
    afterQuiet?.data.notes[0].id,
    "one",
    "a non-undoable write records no step, so undo reaches the one before it",
  );
});

Deno.test("undo and redo are no-ops without history and undefined without a roll", () => {
  resetStores();
  assertEquals(undoPianoRoll("reg/history-absent"), undefined);
  assertEquals(redoPianoRoll("reg/history-absent"), undefined);

  const created = setPianoRoll("reg/history-empty", { notes: [] });
  assert(created.ok);
  const undone = undoPianoRoll("reg/history-empty");
  assertEquals(
    undone?.rev,
    created.roll.rev,
    "nothing to undo is not a generation",
  );
  assertEquals(redoPianoRoll("reg/history-empty")?.rev, created.roll.rev);
});

Deno.test("params create makes an empty entity and rejects an existing name", () => {
  resetStores();
  params.create("reg/empty");

  assertEquals(getParams("reg/empty")?.values, {});
  assert(params.listNames().includes("reg/empty"));
  assertThrows(() => params.create("reg/empty"), Error, "already exists");
});

Deno.test("params duplicate deep-copies values and meta but not tombstones", () => {
  resetStores();
  const live = registerParams("reg/params-src", {
    gain: 1,
    strobe: { rate: 2 },
    dropped: 3,
  }, { gain: { min: 0, max: 2 } });
  live.gain = 0.25;
  live.strobe.rate = 9;
  live.dropped = 42;
  // Dropping a field leaves a tombstone on the SOURCE only. The declaration
  // always wins for meta, so it is repeated here.
  registerParams("reg/params-src", { gain: 1, strobe: { rate: 2 } }, {
    gain: { min: 0, max: 2 },
  });

  params.duplicate("reg/params-src", "reg/params-copy");
  const copy = getParams("reg/params-copy");
  assertEquals(copy?.values, { gain: 0.25, strobe: { rate: 9 } });
  assertEquals(copy?.meta, { gain: { min: 0, max: 2 } });

  // The copy must not inherit the source's dropped-field history.
  const redeclaredCopy = registerParams("reg/params-copy", {
    gain: 1,
    strobe: { rate: 2 },
    dropped: 3,
  });
  assertEquals(redeclaredCopy.dropped, 3);
  const redeclaredSource = registerParams("reg/params-src", {
    gain: 1,
    strobe: { rate: 2 },
    dropped: 3,
  });
  assertEquals(redeclaredSource.dropped, 42);

  assertThrows(
    () => params.duplicate("reg/params-missing", "reg/x"),
    Error,
    'No params entity "reg/params-missing"',
  );
  assertThrows(
    () => params.duplicate("reg/params-src", "reg/params-copy"),
    Error,
    "already exists",
  );
});

Deno.test("params remove reports whether it removed anything", () => {
  resetStores();
  registerParams("reg/params-doomed", { gain: 1 });
  assertEquals(params.remove("reg/params-doomed"), true);
  assertEquals(params.exists("reg/params-doomed"), false);
  assertEquals(params.remove("reg/params-doomed"), false);
});

Deno.test("params round-trip preserves values and meta", () => {
  resetStores();
  const live = registerParams("reg/params-trip", {
    gain: 0.5,
    label: "a",
    on: true,
    strobe: { rate: 2, jitter: 0.25 },
  }, { gain: { min: 0, max: 1, step: 0.01, label: "Gain" } });
  live.gain = 0.75;

  const saved = params.serialize("reg/params-trip") as SavedParamsEntity;
  assertEquals(saved.type, "params");
  assertEquals(saved.values.gain, 0.75, "save captures the live value");
  assertEquals(saved.meta, {
    gain: { min: 0, max: 1, step: 0.01, label: "Gain" },
  });

  const wire = JSON.parse(JSON.stringify(saved));
  params.deserialize("reg/params-loaded", wire);
  const loaded = getParams("reg/params-loaded");
  assertEquals(loaded?.values, {
    gain: 0.75,
    label: "a",
    on: true,
    strobe: { rate: 2, jitter: 0.25 },
  });
  assertEquals(loaded?.meta, {
    gain: { min: 0, max: 1, step: 0.01, label: "Gain" },
  });
  assertEquals(loaded?.updatedBy, "load");
  assertEquals(
    params.latestJson("reg/params-loaded"),
    params.latestJson("reg/params-trip"),
  );
});

Deno.test("params serialization fails for an unavailable live value", () => {
  resetStores();
  const live = registerParams("reg/params-hostile", { gain: 1 });
  (live as Record<string, unknown>).gain = 10n;

  assertThrows(
    () => params.serialize("reg/params-hostile"),
    Error,
    "cannot be serialized",
  );
  assertEquals(params.latestJson("reg/params-hostile"), null);
  assertEquals(params.latestJson("reg/params-absent"), null);
});

Deno.test("params deserialize rejects a malformed saved file", () => {
  resetStores();
  assertThrows(
    () => params.deserialize("reg/params-bad", { values: [] }),
    Error,
    "must be a JSON object",
  );
  assertThrows(
    () => params.deserialize("reg/params-bad", { values: { items: [1, 2] } }),
    Error,
    "arrays are not supported",
  );
  assertEquals(getParams("reg/params-bad"), undefined);
});

Deno.test("entity names encode to collision-free file names", () => {
  assertEquals(encodeEntityName("melody"), "melody");
  assertEquals(encodeEntityName("e2e/params"), "e2e%2Fparams");
  assertEquals(encodeEntityName("kinaree/rects"), "kinaree%2Frects");
  assertEquals(encodeEntityName("a.b_c-d"), "a.b_c-d");
  // `%` itself is encoded, so an encoded name can never collide with a literal.
  assertEquals(encodeEntityName("100%"), "100%25");
  assertEquals(encodeEntityName("e2e%2Fparams"), "e2e%252Fparams");
  assertEquals(encodeEntityName("mélodie"), "m%C3%A9lodie");
  assertEquals(encodeEntityName("鍵盤"), "%E9%8D%B5%E7%9B%A4");
  assertEquals(encodeEntityName("a b"), "a%20b");
  assertEquals(encodeEntityName(".."), "..");
  assertEquals(
    entityDataPath("params", "e2e/params"),
    "data/params/e2e%2Fparams.json",
  );
});

Deno.test("a long name is capped and disambiguated by a hash of the full name", () => {
  const base = "roll/".concat("x".repeat(300));
  const encoded = encodeEntityName(base);
  assert(encoded.length <= 100, `expected <= 100, got ${encoded.length}`);
  assert(/-[0-9a-f]{8}$/.test(encoded), encoded);
  // Stable per name, and different for two names sharing a long prefix.
  assertEquals(encoded, encodeEntityName(base));
  assert(encoded !== encodeEntityName(`${base}y`));

  // Truncation never leaves a half-written percent escape behind.
  const unicode = encodeEntityName("é".repeat(200));
  assert(unicode.length <= 100, unicode);
  assertEquals(unicode.match(/%[0-9A-F]{2}/g)?.join(""), unicode.slice(0, -9));
});

Deno.test("save-time path allocation disambiguates case-insensitive collisions", () => {
  const used = new Set<string>();
  assertEquals(
    allocateEntityDataPath("pianoRoll", "Melody", used),
    "data/pianoRoll/Melody.json",
  );
  assertEquals(
    allocateEntityDataPath("pianoRoll", "melody", used),
    "data/pianoRoll/melody-2.json",
  );
  assertEquals(
    allocateEntityDataPath("pianoRoll", "MELODY", used),
    "data/pianoRoll/MELODY-3.json",
  );
  // A different type is a different directory, so it does not collide.
  assertEquals(
    allocateEntityDataPath("params", "melody", used),
    "data/params/melody.json",
  );
});
