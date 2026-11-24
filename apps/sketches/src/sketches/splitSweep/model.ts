// The document of the split-sweep sketch: the unit square cut into
// axis-aligned rectangles (only the leaves are stored; the lines are their
// edges), each with its own colours, notes and slide; plus the synth patch.
import type { PianoRollNote } from "../../shared/pianoRoll/types";
import type { SynthPatch } from "../../shared/sixSines/synth";

export interface Region {
  id: string;
  /** Unit-square coordinates, y down. */
  x: number;
  y: number;
  w: number;
  h: number;
  colorA: string;
  colorB: string;
  /** The roll's notes; the first two (by position, then pitch) are A and B. */
  notes: PianoRollNote[];
  /** Seconds for a full ramp-in, ramp-out or A/B sweep. */
  slideSec: number;
  /** logisticSigmoid sharpness, 0 (linear) .. 1 (step). */
  sharpness: number;
}

export interface SketchDoc {
  version: 1;
  regions: Region[];
  synth: SynthPatch;
}

export type SplitAxis = "vertical" | "horizontal";

/** Smallest side a split may leave, in unit-square terms. */
export const MIN_SIDE = 0.02;

export const newId = () => Math.random().toString(36).slice(2, 10);

const note = (pitch: number, position: number): PianoRollNote => ({ id: newId(), pitch, position, duration: 1, velocity: 100 });

export function defaultRegion(): Region {
  return {
    id: newId(),
    x: 0, y: 0, w: 1, h: 1,
    colorA: "#e4572e",
    colorB: "#2e86ab",
    notes: [note(60, 0), note(67, 1)],
    slideSec: 2,
    sharpness: 0.5,
  };
}

export function defaultDoc(): SketchDoc {
  return { version: 1, regions: [defaultRegion()], synth: { parameters: {} } };
}

export function regionAt(regions: readonly Region[], x: number, y: number): Region | undefined {
  // Half-open on the far edges so a point on a shared edge picks one region.
  return regions.find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) ??
    regions.find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
}

/** Clamp an anchor inside a region so both halves keep MIN_SIDE. */
export function clampAnchor(region: Region, x: number, y: number) {
  const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
  return {
    x: clamp(x, region.x + MIN_SIDE, region.x + region.w - MIN_SIDE),
    y: clamp(y, region.y + MIN_SIDE, region.y + region.h - MIN_SIDE),
  };
}

export function canSplit(region: Region, axis: SplitAxis) {
  return (axis === "vertical" ? region.w : region.h) >= 2 * MIN_SIDE;
}

/** Both halves keep the parent's properties (notes get fresh ids). */
export function splitRegion(region: Region, axis: SplitAxis, anchor: { x: number; y: number }): [Region, Region] {
  // JSON copy: the region may be a valtio proxy, which structuredClone rejects.
  const plain = JSON.parse(JSON.stringify(region)) as Region;
  const copy = (r: Partial<Region>): Region => ({
    ...plain,
    notes: plain.notes.map((n) => ({ ...n, id: newId() })),
    id: newId(),
    ...r,
  });
  if (axis === "vertical") {
    const left = anchor.x - region.x;
    return [copy({ w: left }), copy({ x: anchor.x, w: region.w - left })];
  }
  const top = anchor.y - region.y;
  return [copy({ h: top }), copy({ y: anchor.y, h: region.h - top })];
}

/** The A and B pitches: the first two notes in time (ties: lower first). One note is both. */
export function regionPitches(region: Region): { a: number; b: number } {
  const sorted = [...region.notes].sort((p, q) => p.position - q.position || p.pitch - q.pitch);
  const a = sorted[0]?.pitch ?? 60;
  return { a, b: sorted[1]?.pitch ?? a };
}

export function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
