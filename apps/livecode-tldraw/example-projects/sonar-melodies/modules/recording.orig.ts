import type { TimeContext } from "@avtools/core-timing";
import type { MidiInputEvent } from "midi-helpers";

// Recording MIDI notes straight into a melody's source roll (a "bank"). One
// recorder per bank, all fed from the same input, so several banks can record
// at once. Plain functions over input events: the player owns the MIDI port
// and the params toggles, and tests drive these directly. Adapted from
// `feature-midi-recording`, without the MPE expression curves, which the sonar
// pipeline would drop anyway.

export interface TakeNote {
  pitch: number;
  velocity: number;
  onSec: number;
  offSec: number;
}

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
    held: Map<string, { pitch: number; velocity: number; onSec: number }>;
    notes: TakeNote[];
  } | null = null;

  return {
    get recording() {
      return take !== null;
    },
    start(nowSec: number) {
      take = { startSec: nowSec, held: new Map(), notes: [] };
    },
    /** Note on/off only; everything else is ignored. */
    handle(event: MidiInputEvent, sec: number) {
      if (!take) return;
      if (event.type !== "noteOn" && event.type !== "noteOff") return;
      const at = Math.max(take.startSec, sec);
      const key = `${event.channel}:${event.note}`;
      const held = take.held.get(key);
      if (held) {
        take.notes.push({ ...held, offSec: at });
        take.held.delete(key);
      }
      if (event.type === "noteOn") {
        take.held.set(key, {
          pitch: event.note,
          velocity: event.velocity,
          onSec: at,
        });
      }
    },
    /** Ends the take; notes still held close now. Null when nothing was played. */
    finish(nowSec: number): TakeNote[] | null {
      const finished = take;
      take = null;
      if (!finished) return null;
      for (const held of finished.held.values()) {
        finished.notes.push({ ...held, offSec: nowSec });
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
 * beat, which the player uses as the phrase length.
 */
export function takeToRollNotes(
  notes: TakeNote[],
  options: { secondsPerBeat: number; quantize: number },
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
    };
  });
  const end = Math.max(0, ...rollNotes.map((n) => n.position + n.duration));
  return { notes: rollNotes, lengthBeats: Math.max(1, Math.ceil(end - 1e-9)) };
}

export default async function describe(ctx: TimeContext) {
  await ctx.waitSec(0.01);
}
