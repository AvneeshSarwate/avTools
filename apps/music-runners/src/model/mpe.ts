// Per-note MPE expression: the curve shapes, conversions and thinning shared
// by the recorder (src/store/recording.ts) and playback (src/store/playback.ts).
// The note fields match `docs/livecode`'s piano roll (`PianoRollNoteLike` in
// packages/music-types/ableton_clip.ts) so recorded banks port back as is.
import type { PianoRollNote } from "../pianoRoll/types";

/** One pitch breakpoint; `time` is 0..1 across the note, `pitchOffset` semitones from its pitch. */
export interface MpePitchPoint {
  time: number;
  pitchOffset: number;
  /**
   * The point sits on a pitch (a semitone from the note), not between pitches.
   * Scale-aware transposition (`scaleTransposeMPE` in packages/music-types)
   * maps each run of rooted points through the scale on its own and
   * interpolates the rest, so a slide between scale degrees stays between
   * scale degrees. Chromatic transpose ignores it.
   */
  rooted?: boolean;
}

/** One 0..127 breakpoint (pressure or timbre); `time` is 0..1 across the note. */
export interface MpeValuePoint {
  time: number;
  value: number;
}

/** Rest values: a curve that never leaves them is not stored. */
export const REST_PITCH = 0;
export const REST_PRESSURE = 0;
export const REST_TIMBRE = 64;
/** Auto-root: a recorded pitch point this close to a semitone is marked rooted. */
export const DEFAULT_ROOT_TOLERANCE_CENTS = 15;
/** ...when the pitch rests there at least this long, in seconds. */
export const ROOT_MIN_DWELL_SEC = 0.06;
/** The MPE default bend range (LinnStrument, Roli, most MPE synths). */
export const DEFAULT_BEND_RANGE = 48;
/** The roll's drawable pitch-curve range, in semitones either way. */
export const MAX_PITCH_OFFSET = 24;
export const TIMBRE_CC = 74;
/** MPE lower zone: channel 0 is the master channel, 1..15 are member channels. */
export const MPE_MEMBER_CHANNELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

export function hasExpression(note: PianoRollNote): boolean {
  return Boolean(note.mpePitch?.points.length || note.mpePressure?.points.length || note.mpeTimbre?.points.length);
}

/** Linear interpolation of a curve at `time` (0..1); `rest` when it has no points. */
export function curveAt<P extends { time: number }>(points: readonly P[] | undefined, time: number, read: (point: P) => number, rest: number): number {
  if (!points || points.length === 0) return rest;
  if (time <= points[0].time) return read(points[0]);
  for (let i = 1; i < points.length; i += 1) {
    const b = points[i];
    if (time > b.time) continue;
    const a = points[i - 1];
    const span = b.time - a.time;
    const t = span > 0 ? (time - a.time) / span : 1;
    return read(a) + t * (read(b) - read(a));
  }
  return read(points[points.length - 1]);
}

export const pitchOffsetAt = (note: PianoRollNote, time: number) => curveAt(note.mpePitch?.points, time, (p) => p.pitchOffset, REST_PITCH);
export const pressureAt = (note: PianoRollNote, time: number) => curveAt(note.mpePressure?.points, time, (p) => p.value, REST_PRESSURE);
export const timbreAt = (note: PianoRollNote, time: number) => curveAt(note.mpeTimbre?.points, time, (p) => p.value, REST_TIMBRE);

/** 14-bit signed bend (-8192..8191) to semitones. */
export function bendToSemitones(bend: number, bendRange: number): number {
  return (bend / 8192) * bendRange;
}

/** Semitones to a 14-bit signed bend, clamped. */
export function semitonesToBend(semitones: number, bendRange: number): number {
  if (bendRange <= 0) return 0;
  return Math.max(-8192, Math.min(8191, Math.round((semitones / bendRange) * 8192)));
}

/**
 * Ramer-Douglas-Peucker on value error: keep a point only when dropping it
 * would move the line drawn between its neighbours by more than `tolerance`.
 * Endpoints are always kept. Every point becomes a handle once curves are
 * editable, so recorded curves are thinned to what is audible.
 */
export function simplifyCurve<T extends { time: number }>(
  points: T[],
  tolerance: number,
  read: (point: T) => number,
  /** Indices that must survive (kept, and the line is split at them). */
  anchors?: Iterable<number>,
): T[] {
  if (points.length <= 2) return points;
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  for (const index of anchors ?? []) if (index >= 0 && index < points.length) keep[index] = true;
  const fixed = keep.flatMap((kept, index) => (kept ? [index] : []));
  const stack: [number, number][] = fixed.slice(1).map((to, i) => [fixed[i], to]);
  while (stack.length > 0) {
    const [from, to] = stack.pop()!;
    const a = points[from];
    const b = points[to];
    let worst = -1;
    let worstError = tolerance;
    for (let i = from + 1; i < to; i += 1) {
      const p = points[i];
      const t = b.time > a.time ? (p.time - a.time) / (b.time - a.time) : 0;
      const error = Math.abs(read(p) - (read(a) + t * (read(b) - read(a))));
      if (error > worstError) {
        worst = i;
        worstError = error;
      }
    }
    if (worst >= 0) {
      keep[worst] = true;
      stack.push([from, worst], [worst, to]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * Member-channel allocation per output port. Each sounding MPE note owns a
 * channel so its bend, pressure and timbre do not touch other notes. A free
 * channel released longest ago is preferred (its release tail is quietest);
 * with all fifteen busy the one allocated longest ago is shared.
 */
interface ChannelPool {
  busy: Map<number, { stamp: number; count: number }>;
  releasedAt: Map<number, number>;
}

const pools = new Map<string, ChannelPool>();
let stamp = 0;

export function allocateMemberChannel(outputName: string): number {
  let pool = pools.get(outputName);
  if (!pool) {
    pool = { busy: new Map(), releasedAt: new Map() };
    pools.set(outputName, pool);
  }
  stamp += 1;
  let best = -1;
  let bestStamp = Infinity;
  for (const channel of MPE_MEMBER_CHANNELS) {
    if (pool.busy.has(channel)) continue;
    const released = pool.releasedAt.get(channel) ?? -1;
    if (released < bestStamp) {
      best = channel;
      bestStamp = released;
    }
  }
  if (best < 0) {
    for (const [channel, allocated] of pool.busy) {
      if (allocated.stamp < bestStamp) {
        best = channel;
        bestStamp = allocated.stamp;
      }
    }
  }
  const existing = pool.busy.get(best);
  pool.busy.set(best, { stamp, count: (existing?.count ?? 0) + 1 });
  return best;
}

export function releaseMemberChannel(outputName: string, channel: number): void {
  const pool = pools.get(outputName);
  const entry = pool?.busy.get(channel);
  if (!pool || !entry) return;
  if (entry.count > 1) {
    entry.count -= 1;
    return;
  }
  pool.busy.delete(channel);
  stamp += 1;
  pool.releasedAt.set(channel, stamp);
}

/** Whether a pitch offset is within `toleranceSemitones` of a whole semitone. */
export function nearSemitone(pitchOffset: number, toleranceSemitones: number): boolean {
  return Math.abs(pitchOffset - Math.round(pitchOffset)) <= toleranceSemitones;
}

/**
 * Auto-root a recorded pitch curve (before thinning). A run of consecutive
 * points within `toleranceSemitones` of one semitone is rooted when the pitch
 * rests there for at least `minDwell` (same time units as `time`): a value is
 * held until the next point, so a run lasts until the first point after it
 * (or the curve's end at time 1). A slide that merely passes a semitone is
 * not rooted; the note's start and a held target are.
 *
 * Returns the points with `rooted` set on rooted runs, and each rooted run's
 * first and last index as thinning anchors, so a held target keeps its start
 * and end even where it is straight enough for thinning to drop them.
 */
export function rootCurve(
  points: readonly MpePitchPoint[],
  toleranceSemitones: number,
  minDwell: number,
): { points: MpePitchPoint[]; anchors: number[] } {
  const out = points.map(({ rooted: _previous, ...point }) => point as MpePitchPoint);
  const anchors: number[] = [];
  let start = -1;
  let semitone = NaN;
  const close = (end: number) => {
    if (start < 0) return;
    const until = end + 1 < points.length ? points[end + 1].time : 1;
    if (until - points[start].time >= minDwell) {
      for (let i = start; i <= end; i += 1) out[i] = { ...out[i], rooted: true };
      anchors.push(start);
      if (end !== start) anchors.push(end);
    }
    start = -1;
  };
  points.forEach((point, index) => {
    const near = nearSemitone(point.pitchOffset, toleranceSemitones);
    const nearest = Math.round(point.pitchOffset);
    if (near && start >= 0 && nearest === semitone) return;
    close(index - 1);
    if (near) {
      start = index;
      semitone = nearest;
    }
  });
  close(points.length - 1);
  return { points: out, anchors };
}
