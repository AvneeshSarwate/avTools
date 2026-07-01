// Reproducing tests for piano_roll_store defects found during the 2026-07
// stability review. See livecode/timeContextVisualizerPlans/stability-fix-plan.md.
//
// Asserts CURRENT (buggy) behavior; flip the marked assertions after fixing.
//
// Run with:
//   deno test --allow-env livecode/tests/repro/piano_roll_store_repro_test.ts

import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  getPianoRoll,
  setPianoRoll,
} from "../../visualizer/piano_roll_store.ts";
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
  // BUGGY BEHAVIOR: the store's internal record shares the caller's nested
  // mpePitch object (shallow spread in normalizeNote), so store state changed
  // with NO rev bump and NO dirty flag — the UI never hears about it and undo
  // history diverges. AFTER FIX (deep-clone on write): flip to expect 1 point
  // and unchanged content.
  assertEquals(after.data.notes[0].mpePitch?.points.length, 2);
  assertEquals(after.rev, revAfterSet, "rev did not change despite store data changing");
});

Deno.test("BUG P2: writes ignore revisions entirely — concurrent UI/livecode writers silently clobber", () => {
  const first = setPianoRoll("repro-conflict", {
    notes: [{ pitch: 60, position: 0, duration: 1 }],
  }, { source: "client" });

  // A livecode loop writes based on a STALE read (rev captured before the UI
  // edit). The store has no revision argument and no conflict signal — the
  // write just wins.
  const second = setPianoRoll("repro-conflict", {
    notes: [{ pitch: 64, position: 0, duration: 1 }],
  }, { source: "livecode" });

  // BUGGY-BY-OMISSION BEHAVIOR: last write wins unconditionally; there is no
  // way for a caller to say "only apply this if the roll is still at rev N".
  // AFTER FIX (optional expectedRev with conflict response): update to assert
  // the conflict path.
  assert(second.rev > first.rev);
  assertEquals(second.data.notes[0].pitch, 64);
});
