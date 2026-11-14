// Run: cd apps/music-runners && npx tsx --test src/model/mpe.test.ts
import { test } from "node:test";
import { deepStrictEqual, strictEqual } from "node:assert";
import {
  allocateMemberChannel,
  bendToSemitones,
  curveAt,
  rootCurve,
  releaseMemberChannel,
  semitonesToBend,
  simplifyCurve,
} from "./mpe.ts";

test("curveAt interpolates and holds the ends", () => {
  const points = [{ time: 0.2, value: 10 }, { time: 0.6, value: 50 }];
  const read = (p: { value: number }) => p.value;
  strictEqual(curveAt(points, 0, read, 0), 10);
  strictEqual(Math.round(curveAt(points, 0.4, read, 0) * 1e9) / 1e9, 30);
  strictEqual(curveAt(points, 1, read, 0), 50);
  strictEqual(curveAt([], 0.5, read, 64), 64);
});

test("bend conversion round-trips within a step", () => {
  strictEqual(semitonesToBend(48, 48), 8191);
  strictEqual(semitonesToBend(-48, 48), -8192);
  strictEqual(semitonesToBend(100, 48), 8191);
  const bend = semitonesToBend(2, 48);
  strictEqual(Math.abs(bendToSemitones(bend, 48) - 2) < 0.01, true);
});

test("simplifyCurve drops points on a straight line", () => {
  const line = [0, 0.25, 0.5, 0.75, 1].map((time) => ({ time, value: time * 100 }));
  deepStrictEqual(simplifyCurve(line, 1, (p) => p.value).map((p) => p.time), [0, 1]);
  const bump = [{ time: 0, value: 0 }, { time: 0.5, value: 50 }, { time: 1, value: 0 }];
  strictEqual(simplifyCurve(bump, 1, (p) => p.value).length, 3);
});

test("member channels: distinct while held, least recently released reused", () => {
  const port = "test-port";
  const held = Array.from({ length: 15 }, () => allocateMemberChannel(port));
  deepStrictEqual([...held].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  // All busy: the oldest allocation is shared, and survives one release.
  const shared = allocateMemberChannel(port);
  strictEqual(shared, held[0]);
  releaseMemberChannel(port, shared);
  for (const channel of held.slice(1)) releaseMemberChannel(port, channel);
  // held[0] is still owned once, so the next free pick is the earliest released.
  strictEqual(allocateMemberChannel(port), held[1]);
});

test("rootCurve roots resting runs, not slides passing a semitone", () => {
  // rest on 0 | slide through 1 | rest on 2 | a brief touch of 3
  const curve: [number, number][] = [
    [0, 0], [0.1, 0.02], [0.2, -0.01], [0.3, 0.6], [0.32, 1.0], [0.34, 1.4], [0.4, 1.99], [0.5, 2.0], [0.8, 2.01], [0.81, 3.0], [0.82, 2.5],
  ];
  const points = curve.map(([time, pitchOffset]) => ({ time, pitchOffset }));
  const { points: out, anchors } = rootCurve(points, 0.15, 0.05);
  deepStrictEqual(out.map((p) => Boolean(p.rooted)), [true, true, true, false, false, false, true, true, true, false, false]);
  deepStrictEqual(anchors, [0, 2, 6, 8]);
  strictEqual("rooted" in out[3], false);
});

test("simplifyCurve keeps anchors on a straight plateau", () => {
  const flat = [0, 0.25, 0.5, 0.75, 1].map((time) => ({ time, value: 2 }));
  deepStrictEqual(simplifyCurve(flat, 0.05, (p) => p.value).map((p) => p.time), [0, 1]);
  deepStrictEqual(simplifyCurve(flat, 0.05, (p) => p.value, [2]).map((p) => p.time), [0, 0.5, 1]);
});

