import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  getPianoRoll,
  setPianoRoll,
} from "@avtools/livecode-engine/piano_roll_store.ts";
import type { NoteDataInput } from "../../visualizer/protocol.ts";

function successfulSet(result: ReturnType<typeof setPianoRoll>) {
  if (!result.ok) throw new Error(result.error);
  return result.roll;
}

Deno.test("piano-roll writes detach nested note data from caller-owned objects", () => {
  const note: NoteDataInput = {
    id: "n1",
    pitch: 60,
    position: 0,
    duration: 1,
    velocity: 90,
    mpePitch: { points: [{ time: 0, pitchOffset: 0 }] },
  };
  const setResult = successfulSet(
    setPianoRoll("repro-alias", { notes: [note] }),
  );
  const revAfterSet = setResult.rev;

  const before = getPianoRoll("repro-alias");
  assert(before);
  assertEquals(before.data.notes[0].mpePitch?.points.length, 1);

  // Caller keeps its reference (a realistic livecode pattern) and mutates the
  // nested object AFTER the write.
  note.mpePitch!.points.push({ time: 1, pitchOffset: 5 });

  const after = getPianoRoll("repro-alias");
  assert(after);
  assertEquals(after.data.notes[0].mpePitch?.points.length, 1);
  assertEquals(
    after.rev,
    revAfterSet,
    "rev did not change despite store data changing",
  );
});

Deno.test("non-cloneable note metadata rejects the write without throwing", () => {
  const note: NoteDataInput = {
    id: "fn-note",
    pitch: 60,
    position: 0,
    duration: 1,
    velocity: 90,
    metadata: { fn: () => {} },
  };

  const result = setPianoRoll("repro-noncloneable-metadata", { notes: [note] });
  assertEquals(result.ok, false);
  assertEquals(getPianoRoll("repro-noncloneable-metadata"), undefined);
});

Deno.test("circular and BigInt metadata reject writes without creating rolls", () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const circularNote: NoteDataInput = {
    id: "circular-note",
    pitch: 62,
    position: 0,
    duration: 1,
    velocity: 90,
    metadata: circular,
  };
  const circularResult = setPianoRoll("repro-circular-metadata", {
    notes: [circularNote],
  });
  assertEquals(circularResult.ok, false);
  assertEquals(getPianoRoll("repro-circular-metadata"), undefined);

  const bigintNote: NoteDataInput = {
    id: "bigint-note",
    pitch: 64,
    position: 0,
    duration: 1,
    velocity: 90,
    metadata: { big: 1n },
  };
  const bigintResult = setPianoRoll("repro-bigint-metadata", {
    notes: [bigintNote],
  });
  assertEquals(bigintResult.ok, false);
  assertEquals(getPianoRoll("repro-bigint-metadata"), undefined);
});

Deno.test("piano-roll compare-and-set rejects stale revisions", () => {
  const first = successfulSet(
    setPianoRoll("repro-conflict", {
      notes: [{ pitch: 60, position: 0, duration: 1 }],
    }, { source: "client" }),
  );

  const uiEdit = successfulSet(
    setPianoRoll("repro-conflict", {
      notes: [{ pitch: 64, position: 0, duration: 1 }],
    }, { source: "livecode" }),
  );

  const staleWrite = successfulSet(
    setPianoRoll("repro-conflict", {
      notes: [{ pitch: 67, position: 0, duration: 1 }],
    }, { source: "livecode", expectedRev: first.rev }),
  );

  assertEquals(staleWrite.conflict, true);
  assertEquals(staleWrite.rev, uiEdit.rev);
  assertEquals(staleWrite.data.notes[0].pitch, 64);

  const freshWrite = successfulSet(
    setPianoRoll("repro-conflict", {
      notes: [{ pitch: 69, position: 0, duration: 1 }],
    }, { source: "livecode", expectedRev: uiEdit.rev }),
  );
  assertEquals(freshWrite.conflict, undefined);
  assert(freshWrite.rev > uiEdit.rev);
  assertEquals(freshWrite.data.notes[0].pitch, 69);
});
