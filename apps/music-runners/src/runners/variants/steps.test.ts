// Run: cd apps/music-runners && deno test --no-check --sloppy-imports src/runners/variants/steps.test.ts
// (Deno, not tsx: it imports packages/music-types/scale.ts, see steps.ts)
import { test } from "node:test";
import { deepStrictEqual, strictEqual } from "node:assert";
import { parseVariantSteps, resolveVariantStep } from "./steps.ts";

const C_MAJOR = { root: 60, degrees: [0, 2, 4, 5, 7, 9, 11, 12] };
const D_DORIAN = { root: 62, degrees: [0, 2, 3, 5, 7, 9, 10, 12] };
const step = (text: string) => parseVariantSteps(text).steps[0];

test("parse: degrees, signs, semitone suffixes", () => {
  const { steps, invalid } = parseVariantSteps("+1 -5 3 +2+ +2+2 -1- +0+ x 2++");
  deepStrictEqual(steps.map((s) => [s.degrees, s.semitones]), [[1, 0], [-5, 0], [3, 0], [2, 1], [2, 2], [-1, -1], [0, 1]]);
  deepStrictEqual(invalid, ["x", "2++"]);
  deepStrictEqual(parseVariantSteps("+1, -2").steps.map((s) => s.degrees), [1, -2]);
});

test("resolve in C major: degrees follow the scale, suffix adds semitones", () => {
  strictEqual(resolveVariantStep(60, step("+1"), C_MAJOR), 62);
  strictEqual(resolveVariantStep(60, step("+2"), C_MAJOR), 64);
  strictEqual(resolveVariantStep(64, step("+1"), C_MAJOR), 65, "E up a degree is F");
  strictEqual(resolveVariantStep(60, step("-1"), C_MAJOR), 59);
  strictEqual(resolveVariantStep(60, step("-7"), C_MAJOR), 48);
  strictEqual(resolveVariantStep(60, step("+2+"), C_MAJOR), 65);
  strictEqual(resolveVariantStep(60, step("+2+2"), C_MAJOR), 66);
  strictEqual(resolveVariantStep(60, step("+0+"), C_MAJOR), 61);
  strictEqual(resolveVariantStep(60, step("-1-"), C_MAJOR), 58);
  strictEqual(resolveVariantStep(67, step("+1"), undefined), 69, "no scale: C major");
});

test("a note out of the scale counts from its nearest scale note", () => {
  // C#4 (61) is halfway between C and D: rounds to D (the upper one)
  strictEqual(resolveVariantStep(61, step("+0"), C_MAJOR), 62);
  strictEqual(resolveVariantStep(61, step("+1"), C_MAJOR), 64);
  // A#3 (58) sits between A (57) and B (59): to B
  strictEqual(resolveVariantStep(58, step("+1"), C_MAJOR), 60);
});

test("another scale: D dorian", () => {
  strictEqual(resolveVariantStep(62, step("+2"), D_DORIAN), 65, "D up two degrees is F");
  strictEqual(resolveVariantStep(64, step("+5"), D_DORIAN), 72, "E up five is C");
});
