import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  clearPianoRollStore,
  collectPianoRollChanges,
  getPianoRoll,
  redoPianoRoll,
  setPianoRoll,
  setPianoRollCursor,
  undoPianoRoll,
} from "@avtools/livecode-engine/piano_roll_store.ts";
import { pianoRollEntityType } from "@avtools/livecode-engine/entity_registry.ts";
import { executeEngineOp } from "@avtools/livecode-engine/host_ops.ts";

Deno.test("cursor commits preserve current notes, skip history, and drain only on changes", () => {
  clearPianoRollStore();
  setPianoRoll("cursor", {
    notes: [{ id: "a", pitch: 60, position: 0, duration: 4 }],
  }, { undoable: false });
  collectPianoRollChanges();
  assert(setPianoRollCursor("cursor", 2).ok);
  assertEquals(getPianoRoll("cursor")?.data.playStartPosition, 2);
  assertEquals(getPianoRoll("cursor")?.data.notes[0].pitch, 60);
  assertEquals(getPianoRoll("cursor")?.canUndo, false);
  assertEquals(collectPianoRollChanges()?.length, 1);
  const rev = getPianoRoll("cursor")!.rev;
  setPianoRollCursor("cursor", 2);
  assertEquals(getPianoRoll("cursor")!.rev, rev);
  assertEquals(collectPianoRollChanges(), null);
  for (const value of [NaN, Infinity, -1]) {
    assertEquals(setPianoRollCursor("cursor", value).ok, false);
  }
  assertEquals(setPianoRollCursor("missing", 1).ok, false);
  clearPianoRollStore();
});
Deno.test("note edits and history preserve the independently committed cursor", () => {
  clearPianoRollStore();
  setPianoRoll("cursor", { notes: [], playStartPosition: 1 }, {
    undoable: false,
  });
  setPianoRoll("cursor", {
    notes: [{ id: "new", pitch: 67, position: 0, duration: 4 }],
  });
  assertEquals(getPianoRoll("cursor")!.data.playStartPosition, 1);
  setPianoRollCursor("cursor", 3);
  assertEquals(undoPianoRoll("cursor")!.data, {
    notes: [],
    playStartPosition: 3,
  });
  assertEquals(redoPianoRoll("cursor")!.data.playStartPosition, 3);
  clearPianoRollStore();
});
Deno.test("portable cursor op, saved data, and restored entity share one value", async () => {
  clearPianoRollStore();
  setPianoRoll("cursor", { notes: [] }, { undoable: false });
  const result = await executeEngineOp({} as never, {
    kind: "pianoRollCursorSet",
    request: { name: "cursor", position: 5.5 },
  });
  assert((result as { ok: boolean }).ok);
  const kind = pianoRollEntityType;
  const saved = kind.serialize("cursor");
  assert(saved);
  kind.remove("cursor");
  kind.deserialize("cursor", saved);
  assertEquals(getPianoRoll("cursor")!.data.playStartPosition, 5.5);
  clearPianoRollStore();
});
