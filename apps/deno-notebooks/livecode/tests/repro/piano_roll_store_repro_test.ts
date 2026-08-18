// Reproducing tests for piano_roll_store defects found during the 2026-07
// stability review. See docs/livecode/history/stability-review-2026-07.md.
//
// Asserts CURRENT (buggy) behavior; flip the marked assertions after fixing.
//
// Run with:
//   deno test --allow-env livecode/tests/repro/piano_roll_store_repro_test.ts

import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  getPianoRoll,
  setPianoRoll,
} from "@avtools/livecode-engine/piano_roll_store.ts";
import type { NoteDataInput } from "../../visualizer/protocol.ts";

Deno.test("BUG P1: stored notes alias caller-owned nested objects (mpePitch mutates store silently)", () => {
  const note: NoteDataInput = {
    id: "n1",
    pitch: 60,
    position: 0,
    duration: 1,
    velocity: 90,
    mpePitch: { points: [{ time: 0, pitchOffset: 0 }] },
  };
  const setResult = setPianoRoll("repro-alias", { notes: [note] });
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

Deno.test("BUG P4 fixed: non-cloneable note metadata is stripped without throwing into livecode", () => {
  const note: NoteDataInput = {
    id: "fn-note",
    pitch: 60,
    position: 0,
    duration: 1,
    velocity: 90,
    metadata: { fn: () => {} },
  };

  // Must not throw synchronously into caller-owned livecode timing code.
  const stored = setPianoRoll("repro-noncloneable-metadata", { notes: [note] });
  assert(stored);

  const after = getPianoRoll("repro-noncloneable-metadata");
  assert(after);
  assertEquals(after.data.notes.length, 1);
  assertEquals(after.data.notes[0].id, "fn-note");
  assertEquals(after.data.notes[0].pitch, 60);

  const storedMeta = after.data.notes[0].metadata;
  assert(
    !storedMeta || !("fn" in storedMeta),
    "non-cloneable function metadata must not be present in the stored note",
  );
});

Deno.test("BUG P4 addendum: non-JSON-serializable metadata (circular, BigInt) must not throw either", () => {
  // Circular metadata survives structuredClone but makes JSON.stringify throw,
  // so the no-op-compare serialize must guard, not just the clone.
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
  const storedCircular = setPianoRoll("repro-circular-metadata", {
    notes: [circularNote],
  });
  assert(storedCircular);
  assertEquals(storedCircular.data.notes[0].id, "circular-note");

  // Repeat write: no-op detection is disabled for non-serializable data, so
  // this must still not throw (it may bump rev; that is acceptable).
  const repeat = setPianoRoll("repro-circular-metadata", {
    notes: [circularNote],
  });
  assert(repeat);

  const bigintNote: NoteDataInput = {
    id: "bigint-note",
    pitch: 64,
    position: 0,
    duration: 1,
    velocity: 90,
    metadata: { big: 1n },
  };
  const storedBigint = setPianoRoll("repro-bigint-metadata", {
    notes: [bigintNote],
  });
  assert(storedBigint);
  assertEquals(storedBigint.data.notes[0].id, "bigint-note");
});

Deno.test("BUG P2: writes ignore revisions entirely — concurrent UI/livecode writers silently clobber", () => {
  const first = setPianoRoll("repro-conflict", {
    notes: [{ pitch: 60, position: 0, duration: 1 }],
  }, { source: "client" });

  const uiEdit = setPianoRoll("repro-conflict", {
    notes: [{ pitch: 64, position: 0, duration: 1 }],
  }, { source: "livecode" });

  const staleWrite = setPianoRoll("repro-conflict", {
    notes: [{ pitch: 67, position: 0, duration: 1 }],
  }, { source: "livecode", expectedRev: first.rev });

  assertEquals(staleWrite.conflict, true);
  assertEquals(staleWrite.rev, uiEdit.rev);
  assertEquals(staleWrite.data.notes[0].pitch, 64);

  const freshWrite = setPianoRoll("repro-conflict", {
    notes: [{ pitch: 69, position: 0, duration: 1 }],
  }, { source: "livecode", expectedRev: uiEdit.rev });
  assertEquals(freshWrite.conflict, undefined);
  assert(freshWrite.rev > uiEdit.rev);
  assertEquals(freshWrite.data.notes[0].pitch, 69);
});
