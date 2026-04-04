/**
 * Temporal contour smoother.
 *
 * Pipeline:
 *   1. Match incoming contours to tracked contours by centroid proximity
 *   2. Resample matched contours to a fixed point count
 *   3. Align starting points (for closed contours) to minimize displacement
 *   4. Apply 1-Euro filter per point coordinate for temporal smoothing
 *   5. Fade in new contours, fade out lost contours
 */

import pkg from "1eurofilter";
const { OneEuroFilter } = pkg;

import type { Point } from "./text_on_path.ts";
import type { ContourFrame, ContourNode } from "./contour_receiver.ts";
import { lap } from "./lap.ts";

// ── Types ────────────────────────────────────────────────────────

export interface SmoothedContour {
  id: number;
  points: Point[];
  parentIndex: number;
  children: number[];
  centroid: Point;
  area: number;
  opacity: number; // 0-1, for fade in/out
}

export interface SmoothedFrame {
  frameNumber: number;
  contours: SmoothedContour[];
}

export interface ContourSmootherParams {
  resampleCount: number;
  matchThreshold: number;
  fadeOutFrames: number;
  fadeInFrames: number;
  mincutoff: number;
  beta: number;
  dcutoff: number;
  fps: number;
  /** Contours alive fewer than this many frames are killed instantly when lost */
  youngMaxAge: number;
  /** New contours within this distance (normalized) of a matched contour are suppressed */
  overlapDist: number;
  /** Average point displacement (normalized) above which filters reset instead of smoothing */
  shapeResetThreshold: number;
}

export const defaultSmootherParams: ContourSmootherParams = {
  resampleCount: 300,
  matchThreshold: 0.15,
  fadeOutFrames: 8,
  fadeInFrames: 4,
  mincutoff: 4.0,
  beta: 0.03,
  dcutoff: 1.0,
  fps: 30,
  youngMaxAge: 3,
  overlapDist: 0.08,
  shapeResetThreshold: 0.05,
};

// ── Internal state per tracked contour ───────────────────────────

interface TrackedContour {
  id: number;
  parentIndex: number;
  children: number[];
  centroid: Point;
  area: number;
  // One 1-Euro filter per resampled point coordinate (x and y interleaved)
  // deno-lint-ignore no-explicit-any
  filters: any[]; // OneEuroFilter instances, length = resampleCount * 2
  smoothedPoints: Point[];
  framesAlive: number;
  framesSinceSeen: number;
}

// ── Resampling ───────────────────────────────────────────────────

function resampleClosed(pts: Point[], n: number): Point[] {
  if (pts.length < 2) return pts;

  // Compute cumulative arc lengths
  const cumDist = [0];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    cumDist.push(cumDist[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  const totalLen = cumDist[pts.length - 1];
  if (totalLen < 1e-6) return Array(n).fill({ x: pts[0].x, y: pts[0].y });

  const step = totalLen / n;
  const result: Point[] = [];
  let seg = 0;

  for (let i = 0; i < n; i++) {
    const targetDist = i * step;
    while (seg < pts.length - 2 && cumDist[seg + 1] < targetDist) seg++;
    const segLen = cumDist[seg + 1] - cumDist[seg];
    const t = segLen > 0 ? (targetDist - cumDist[seg]) / segLen : 0;
    result.push({
      x: pts[seg].x + t * (pts[seg + 1].x - pts[seg].x),
      y: pts[seg].y + t * (pts[seg + 1].y - pts[seg].y),
    });
  }
  return result;
}

/** Find the cyclic rotation offset of `incoming` that minimizes total squared
 *  distance to `reference`. Tests all offsets — O(n²) but n is small (resampleCount). */
function findBestRotation(reference: Point[], incoming: Point[]): number {
  const n = reference.length;
  // For performance, only test every 4th offset when n > 50
  const stride = n > 50 ? 4 : 1;
  let bestOffset = 0;
  let bestDist = Infinity;
  for (let off = 0; off < n; off += stride) {
    let dist = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + off) % n;
      const dx = reference[i].x - incoming[j].x;
      const dy = reference[i].y - incoming[j].y;
      dist += dx * dx + dy * dy;
      if (dist > bestDist) break; // early exit
    }
    if (dist < bestDist) {
      bestDist = dist;
      bestOffset = off;
    }
  }
  return bestOffset;
}

function rotateArray(pts: Point[], offset: number): Point[] {
  if (offset === 0) return pts;
  const n = pts.length;
  return pts.map((_, i) => pts[(i + offset) % n]);
}

// ── LAPJV optimal matching ───────────────────────────────────────

interface Match {
  trackedIdx: number;
  incomingIdx: number;
}

/** Cost between a tracked contour and an incoming contour.
 *  Combines centroid distance (dominant) with area-ratio penalty. */
function contourCost(
  tc: { centroid: Point; area: number },
  ic: { centroid: Point; area: number },
): number {
  const dx = tc.centroid.x - ic.centroid.x;
  const dy = tc.centroid.y - ic.centroid.y;
  const centroidDist = Math.sqrt(dx * dx + dy * dy);

  const aMax = Math.max(Math.abs(tc.area), Math.abs(ic.area), 1e-6);
  const areaRatio = Math.abs(Math.abs(tc.area) - Math.abs(ic.area)) / aMax;

  return centroidDist + areaRatio * 0.1;
}

/**
 * Match contours using LAPJV optimal assignment, run separately per tree level.
 * Dummy rows/cols at cost = threshold handle unequal set sizes and reject
 * assignments that exceed the threshold.
 */
function matchContours(
  tracked: TrackedContour[],
  incoming: ContourNode[],
  threshold: number,
): { matches: Match[]; unmatchedTracked: number[]; unmatchedIncoming: number[] } {
  const matches: Match[] = [];
  const matchedTracked = new Set<number>();
  const matchedIncoming = new Set<number>();

  const levels = [
    {
      tIndices: tracked.map((_, i) => i).filter((i) => tracked[i].parentIndex === -1),
      iIndices: incoming.map((_, i) => i).filter((i) => incoming[i].parentIndex === -1),
    },
    {
      tIndices: tracked.map((_, i) => i).filter((i) => tracked[i].parentIndex !== -1),
      iIndices: incoming.map((_, i) => i).filter((i) => incoming[i].parentIndex !== -1),
    },
  ];

  for (const { tIndices, iIndices } of levels) {
    const nT = tIndices.length;
    const nI = iIndices.length;
    if (nT === 0 || nI === 0) continue;

    const dim = Math.max(nT, nI);

    const result = lap(dim, (r, c) => {
      if (r >= nT || c >= nI) return threshold;
      return contourCost(tracked[tIndices[r]], incoming[iIndices[c]]);
    });

    for (let r = 0; r < nT; r++) {
      const c = result.row[r];
      if (c >= nI) continue;
      const cost = contourCost(tracked[tIndices[r]], incoming[iIndices[c]]);
      if (cost >= threshold) continue;
      matches.push({ trackedIdx: tIndices[r], incomingIdx: iIndices[c] });
      matchedTracked.add(tIndices[r]);
      matchedIncoming.add(iIndices[c]);
    }
  }

  const unmatchedTracked = tracked
    .map((_, i) => i)
    .filter((i) => !matchedTracked.has(i));
  const unmatchedIncoming = incoming
    .map((_, i) => i)
    .filter((i) => !matchedIncoming.has(i));

  return { matches, unmatchedTracked, unmatchedIncoming };
}

// ── Main smoother ────────────────────────────────────────────────

/**
 * Create a contour smoother driven by a mutable params object.
 * Tweakpane can bind directly to the params — changes take effect on the next
 * `process()` call. Filter params (mincutoff, beta, dcutoff) trigger a full
 * reset when changed because 1-Euro filters are stateful.
 */
export function createContourSmoother(params: ContourSmootherParams) {
  let tracked: TrackedContour[] = [];
  let nextId = 0;

  // Track previous filter params to detect changes
  let prevMincutoff = params.mincutoff;
  let prevBeta = params.beta;
  let prevDcutoff = params.dcutoff;
  let prevResampleCount = params.resampleCount;

  function makeFilters(): InstanceType<typeof OneEuroFilter>[] {
    const filters = [];
    for (let i = 0; i < params.resampleCount * 2; i++) {
      filters.push(new OneEuroFilter(params.fps, params.mincutoff, params.beta, params.dcutoff));
    }
    return filters;
  }

  function initFilters(
    filters: InstanceType<typeof OneEuroFilter>[],
    points: Point[],
  ) {
    for (let i = 0; i < points.length; i++) {
      filters[i * 2].filter(points[i].x, undefined);
      filters[i * 2 + 1].filter(points[i].y, undefined);
    }
  }

  function filterPoints(
    filters: InstanceType<typeof OneEuroFilter>[],
    points: Point[],
  ): Point[] {
    const result: Point[] = new Array(points.length);
    for (let i = 0; i < points.length; i++) {
      result[i] = {
        x: filters[i * 2].filter(points[i].x, undefined),
        y: filters[i * 2 + 1].filter(points[i].y, undefined),
      };
    }
    return result;
  }

  function resetIfParamsChanged() {
    if (
      params.mincutoff !== prevMincutoff ||
      params.beta !== prevBeta ||
      params.dcutoff !== prevDcutoff ||
      params.resampleCount !== prevResampleCount
    ) {
      tracked = [];
      nextId = 0;
      prevMincutoff = params.mincutoff;
      prevBeta = params.beta;
      prevDcutoff = params.dcutoff;
      prevResampleCount = params.resampleCount;
    }
  }

  return {
    process(frame: ContourFrame): SmoothedFrame {
      resetIfParamsChanged();

      const incoming = frame.contours;

      const { matches, unmatchedTracked, unmatchedIncoming } = matchContours(
        tracked,
        incoming,
        params.matchThreshold,
      );

      // Update matched tracked contours
      for (const m of matches) {
        const tc = tracked[m.trackedIdx];
        const ic = incoming[m.incomingIdx];

        let resampled = resampleClosed(ic.points, params.resampleCount);
        const offset = findBestRotation(tc.smoothedPoints, resampled);
        resampled = rotateArray(resampled, offset);

        // Detect large shape change: if average point displacement exceeds
        // a threshold, reset filters to avoid slow morphing artifacts
        let totalDisp = 0;
        for (let i = 0; i < resampled.length; i++) {
          const dx = resampled[i].x - tc.smoothedPoints[i].x;
          const dy = resampled[i].y - tc.smoothedPoints[i].y;
          totalDisp += Math.sqrt(dx * dx + dy * dy);
        }
        const avgDisp = totalDisp / resampled.length;

        if (avgDisp > params.shapeResetThreshold) {
          // Shape changed too much — reinitialize filters from new shape
          tc.filters = makeFilters();
          initFilters(tc.filters, resampled);
          tc.smoothedPoints = resampled;
        } else {
          tc.smoothedPoints = filterPoints(tc.filters, resampled);
        }

        tc.centroid = ic.centroid;
        tc.area = ic.area;
        tc.parentIndex = ic.parentIndex;
        tc.children = ic.children;
        tc.framesAlive++;
        tc.framesSinceSeen = 0;
      }

      // Age unmatched tracked contours (fade out)
      for (const idx of unmatchedTracked) {
        tracked[idx].framesSinceSeen++;
      }

      // Create new tracked contours for unmatched incoming,
      // but skip ones that overlap an already-matched tracked contour
      // (these are likely transient splits of an existing contour)
      const matchedCentroids = matches.map((m) => incoming[m.incomingIdx].centroid);

      for (const idx of unmatchedIncoming) {
        const ic = incoming[idx];

        // Check if this incoming contour overlaps any matched contour
        const overlaps = matchedCentroids.some((mc) => {
          const dx = mc.x - ic.centroid.x;
          const dy = mc.y - ic.centroid.y;
          return Math.sqrt(dx * dx + dy * dy) < params.overlapDist;
        });
        if (overlaps) continue;

        const resampled = resampleClosed(ic.points, params.resampleCount);
        const filters = makeFilters();
        initFilters(filters, resampled);

        tracked.push({
          id: nextId++,
          parentIndex: ic.parentIndex,
          children: ic.children,
          centroid: ic.centroid,
          area: ic.area,
          filters,
          smoothedPoints: resampled,
          framesAlive: 0,
          framesSinceSeen: 0,
        });
      }

      // Kill young contours immediately (transient splits), fade out mature ones
      tracked = tracked.filter((tc) =>
        tc.framesAlive < params.youngMaxAge
          ? tc.framesSinceSeen === 0
          : tc.framesSinceSeen <= params.fadeOutFrames
      );

      const contours: SmoothedContour[] = tracked.map((tc) => {
        let opacity: number;
        if (tc.framesSinceSeen > 0) {
          opacity = 1.0 - tc.framesSinceSeen / params.fadeOutFrames;
        } else if (tc.framesAlive < params.fadeInFrames) {
          opacity = (tc.framesAlive + 1) / params.fadeInFrames;
        } else {
          opacity = 1.0;
        }

        return {
          id: tc.id,
          points: tc.smoothedPoints,
          parentIndex: tc.parentIndex,
          children: tc.children,
          centroid: tc.centroid,
          area: tc.area,
          opacity: Math.max(0, Math.min(1, opacity)),
        };
      });

      return { frameNumber: frame.frameNumber, contours };
    },

    reset() {
      tracked = [];
      nextId = 0;
    },
  };
}
