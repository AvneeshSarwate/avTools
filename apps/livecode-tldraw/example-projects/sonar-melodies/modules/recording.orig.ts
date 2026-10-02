import type { TimeContext } from "@avtools/core-timing";
import type { MidiInputEvent } from "midi-helpers";

// Recording MIDI notes straight into a melody's source roll (a "bank"). One
// recorder per bank, all fed from the same input, so several banks can record
// at once. Plain functions over input events: the player owns the MIDI port
// and the params toggles, and tests drive these directly. Adapted from
// `feature-midi-recording`, including its per-note MPE expression: pitch
// bend, pressure and timbre (CC74) become the roll's curves.

/** The piano roll's drawable pitch-curve range, in semitones either way. */
const ROLL_PITCH_RANGE = 24;
/** Curve points closer than this to the thinned line are dropped. */
const PITCH_TOLERANCE_SEMITONES = 0.05;
/** The same for pressure and timbre, in 0..127 steps. */
const VALUE_TOLERANCE = 1;
/** MPE rest values; a curve that never leaves them is not written. */
const REST_PRESSURE = 0;
const REST_TIMBRE = 64;

export interface Sample {
  sec: number;
  /** Raw value: 14-bit bend (-8192..8191) or 0..127. */
  value: number;
}

export interface TakeNote {
  pitch: number;
  velocity: number;
  onSec: number;
  offSec: number;
  bends: Sample[];
  pressures: Sample[];
  timbres: Sample[];
}

type HeldNote = Omit<TakeNote, "offSec"> & { channel: number };

/**
 * Maps device timestamps onto the engine clock. The smallest observed
 * (engine now - device time) is the best estimate of the clock offset; any
 * extra is delivery delay, so a burst that arrives late keeps its spacing.
 */
export function createClockMapper(now: () => number) {
  let offsetSec = Infinity;
  return {
    toEngineSec(event: MidiInputEvent): number {
      const deviceSec = event.timeMs / 1000;
      offsetSec = Math.min(offsetSec, now() - deviceSec);
      return deviceSec + offsetSec;
    },
    reset() {
      offsetSec = Infinity;
    },
  };
}

export function createTakeRecorder() {
  let take: {
    startSec: number;
    held: Map<string, HeldNote>;
    notes: TakeNote[];
  } | null = null;

  // Pitch bend, channel pressure and timbre are per channel. With MPE each
  // note has its own channel, so they are per-note expression; on an ordinary
  // keyboard a channel's value applies to every note held on it. Tracked
  // between takes too, because MPE controllers send a note's initial values
  // just before its note-on. Poly pressure targets one note directly.
  const channelBend = new Array<number>(16).fill(0);
  const channelPressure = new Array<number>(16).fill(REST_PRESSURE);
  const channelTimbre = new Array<number>(16).fill(REST_TIMBRE);

  const last = (samples: Sample[]) => samples[samples.length - 1].value;
  const close = (held: HeldNote, offSec: number): TakeNote => {
    const { channel: _channel, ...note } = held;
    note.bends.push({ sec: offSec, value: last(note.bends) });
    note.pressures.push({ sec: offSec, value: last(note.pressures) });
    note.timbres.push({ sec: offSec, value: last(note.timbres) });
    return { ...note, offSec };
  };

  return {
    get recording() {
      return take !== null;
    },
    start(nowSec: number) {
      take = { startSec: nowSec, held: new Map(), notes: [] };
    },
    /** Notes and their expression; everything else is ignored. */
    handle(event: MidiInputEvent, sec: number) {
      if (event.type === "pitchBend") channelBend[event.channel] = event.bend;
      if (event.type === "channelPressure") {
        channelPressure[event.channel] = event.pressure;
      }
      const isTimbre = event.type === "cc" && event.controller === 74;
      if (isTimbre) channelTimbre[event.channel] = event.value;
      if (!take) return;
      const at = Math.max(take.startSec, sec);

      if (event.type === "polyPressure") {
        take.held.get(`${event.channel}:${event.note}`)?.pressures.push({
          sec: at,
          value: event.pressure,
        });
        return;
      }
      if (
        event.type === "pitchBend" || event.type === "channelPressure" ||
        isTimbre
      ) {
        for (const held of take.held.values()) {
          if (held.channel !== event.channel) continue;
          if (event.type === "pitchBend") {
            held.bends.push({ sec: at, value: event.bend });
          } else if (event.type === "channelPressure") {
            held.pressures.push({ sec: at, value: event.pressure });
          } else if (event.type === "cc") {
            held.timbres.push({ sec: at, value: event.value });
          }
        }
        return;
      }
      if (event.type !== "noteOn" && event.type !== "noteOff") return;

      const key = `${event.channel}:${event.note}`;
      const held = take.held.get(key);
      if (held) {
        take.notes.push(close(held, at));
        take.held.delete(key);
      }
      if (event.type === "noteOn") {
        take.held.set(key, {
          channel: event.channel,
          pitch: event.note,
          velocity: event.velocity,
          onSec: at,
          bends: [{ sec: at, value: channelBend[event.channel] }],
          pressures: [{ sec: at, value: channelPressure[event.channel] }],
          timbres: [{ sec: at, value: channelTimbre[event.channel] }],
        });
      }
    },
    /** Ends the take; notes still held close now. Null when nothing was played. */
    finish(nowSec: number): TakeNote[] | null {
      const finished = take;
      take = null;
      if (!finished) return null;
      for (const held of finished.held.values()) {
        finished.notes.push(close(held, nowSec));
      }
      return finished.notes.length > 0 ? finished.notes : null;
    },
    cancel() {
      take = null;
    },
  };
}

/**
 * A take as roll notes. The first note lands on beat 0; with `quantize` > 0
 * (in beats) starts snap to that grid and durations round to it, never below
 * one grid step. `lengthBeats` is the take's extent rounded up to a whole
 * beat, which the player uses as the phrase length. Expression curves use the
 * roll's 0..1 note time, so a quantized note's curves stretch with it;
 * `bendRange` is the controller's full-bend range in semitones.
 */
export function takeToRollNotes(
  notes: TakeNote[],
  options: { secondsPerBeat: number; quantize: number; bendRange: number },
) {
  const spb = options.secondsPerBeat;
  const q = options.quantize > 0 ? options.quantize : 0;
  const snap = (beats: number) => q ? Math.round(beats / q) * q : beats;
  const sorted = [...notes].sort((a, b) => a.onSec - b.onSec);
  const startSec = sorted[0]?.onSec ?? 0;
  const rollNotes = sorted.map((note, index) => {
    const position = snap((note.onSec - startSec) / spb);
    const rawDuration = (note.offSec - note.onSec) / spb;
    const duration = q
      ? Math.max(q, snap(rawDuration))
      : Math.max(0.001, rawDuration);
    return {
      id: `take-${index}`,
      pitch: note.pitch,
      position: Math.max(0, position),
      duration,
      velocity: Math.max(1, Math.min(127, note.velocity)),
      mpePitch: pitchCurve(note, options.bendRange),
      mpePressure: valueCurve(note, note.pressures, REST_PRESSURE),
      mpeTimbre: valueCurve(note, note.timbres, REST_TIMBRE),
    };
  });
  const end = Math.max(0, ...rollNotes.map((n) => n.position + n.duration));
  return { notes: rollNotes, lengthBeats: Math.max(1, Math.ceil(end - 1e-9)) };
}

/** Sample times as 0..1 across the note, the roll's curve time axis. */
function curveTimes(note: TakeNote, samples: Sample[]) {
  const span = note.offSec - note.onSec;
  return samples.map(({ sec, value }) => ({
    time: span > 0 ? Math.min(1, Math.max(0, (sec - note.onSec) / span)) : 0,
    value,
  }));
}

/**
 * `pitchOffset` is semitones from the note's pitch. Undefined for a note that
 * never bent. Samples are thinned because every point becomes a draggable
 * handle in the roll.
 */
function pitchCurve(note: TakeNote, bendRange: number) {
  const points = curveTimes(note, note.bends).map(({ time, value }) => ({
    time,
    value: Math.max(
      -ROLL_PITCH_RANGE,
      Math.min(ROLL_PITCH_RANGE, (value / 8192) * bendRange),
    ),
  }));
  if (points.every((point) => Math.abs(point.value) < 0.01)) return undefined;
  return {
    points: simplifyCurve(points, PITCH_TOLERANCE_SEMITONES).map((point) => ({
      time: point.time,
      pitchOffset: point.value,
    })),
  };
}

/** A 0..127 pressure or timbre curve; undefined when it never left `rest`. */
function valueCurve(note: TakeNote, samples: Sample[], rest: number) {
  if (samples.every((sample) => sample.value === rest)) return undefined;
  return { points: simplifyCurve(curveTimes(note, samples), VALUE_TOLERANCE) };
}

/**
 * Ramer-Douglas-Peucker on value error: keep a point only when dropping it
 * would move the line drawn between its neighbours by more than `tolerance`.
 * Endpoints are always kept.
 */
function simplifyCurve<T extends { time: number; value: number }>(
  points: T[],
  tolerance: number,
): T[] {
  if (points.length <= 2) return points;
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [from, to] = stack.pop()!;
    const a = points[from];
    const b = points[to];
    let worst = -1;
    let worstError = tolerance;
    for (let i = from + 1; i < to; i++) {
      const p = points[i];
      const t = b.time > a.time ? (p.time - a.time) / (b.time - a.time) : 0;
      const error = Math.abs(p.value - (a.value + t * (b.value - a.value)));
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

export default async function describe(ctx: TimeContext) {
  await ctx.waitSec(0.01);
}
