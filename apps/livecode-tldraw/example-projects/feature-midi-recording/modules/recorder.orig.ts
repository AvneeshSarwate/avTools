import type { TimeContext } from "@avtools/core-timing";
import { canvasParams } from "canvas-params";
import {
  listMidiInputs,
  type MidiInput,
  type MidiInputEvent,
  openMidiInput,
} from "midi-helpers";
import { setPianoRollClip } from "piano-roll-helpers";

const ROLL = "midi-recording/take";
const NO_INPUT = "";
/** The piano roll's drawable pitch-curve range, in semitones either way. */
const ROLL_PITCH_RANGE = 24;
/** Curve points closer than this to the thinned line are dropped. */
const PITCH_TOLERANCE_SEMITONES = 0.05;

/**
 * The input selector's options are the ports visible right now, so the
 * declaration is repeated whenever that list changes (a hot-plugged device,
 * or browser MIDI permission arriving after launch). Redeclaring keeps the
 * current values and replaces only the dropdown options.
 */
function declareParams(inputNames: string[]) {
  const options: Record<string, string> = { "(none)": NO_INPUT };
  for (const name of inputNames) options[name] = name;
  return canvasParams("midi-recording", {
    input: NO_INPUT,
    recording: false,
    trimStartSilence: true,
    trimEndSilence: true,
    bendRange: 48,
    status: "idle",
    lengthBeats: 0,
  }, {
    input: { label: "MIDI input", options },
    recording: { label: "recording" },
    trimStartSilence: { label: "trim start silence" },
    trimEndSilence: { label: "trim end silence" },
    bendRange: {
      label: "bend range (semitones)",
      min: 1,
      max: 96,
      step: 1,
    },
    status: { label: "status" },
    lengthBeats: { label: "take length (beats)" },
  });
}

interface BendSample {
  sec: number;
  /** Raw 14-bit bend, -8192..8191; scaled by the bend range at take end. */
  bend: number;
}

interface HeldNote {
  channel: number;
  pitch: number;
  velocity: number;
  onSec: number;
  bends: BendSample[];
}

interface RecordedNote extends HeldNote {
  offSec: number;
}

interface Take {
  startSec: number;
  held: Map<string, HeldNote>;
  notes: RecordedNote[];
}

/**
 * Records note on/off from the selected input into `midi-recording/take`.
 * Toggle `recording` on to start a take and off to write it to the roll.
 * Leave this module running while recording; Stop discards an unfinished take.
 */
export default async function run(ctx: TimeContext) {
  let inputNames = listMidiInputs().map((port) => port.name);
  let params = declareParams(inputNames);

  let input: MidiInput | null = null;
  let openedName = NO_INPUT;
  let take: Take | null = null;
  let wasRecording = false;
  // A take can only start from an edge seen by this run, not a stale toggle.
  params.recording = false;

  // Device timestamps are on the backend's own clock. The smallest observed
  // (engine now - device time) is the best estimate of the offset between the
  // two clocks: any extra is delivery delay (a busy engine thread, the native
  // bridge's dispatch tick). Mapping through it keeps a burst delivered late
  // at its true spacing instead of stamping it with arrival time.
  let clockOffsetSec = Infinity;
  const now = () => ctx.scheduler.now();
  const eventSec = (event: MidiInputEvent) => {
    const deviceSec = event.timeMs / 1000;
    clockOffsetSec = Math.min(clockOffsetSec, now() - deviceSec);
    return deviceSec + clockOffsetSec;
  };

  // Pitch bend is per channel. With MPE each note has its own channel, so
  // this is per-note pitch; on an ordinary keyboard a channel's bend applies
  // to every note held on it. Tracked even between takes, because MPE
  // controllers send a note's initial bend just before its note-on.
  const channelBend = new Array<number>(16).fill(0);

  const onEvent = (event: MidiInputEvent) => {
    if (
      event.type !== "noteOn" && event.type !== "noteOff" &&
      event.type !== "pitchBend"
    ) return;
    const at = eventSec(event);
    if (event.type === "pitchBend") channelBend[event.channel] = event.bend;
    if (!take) return;
    const sec = Math.max(take.startSec, at);

    if (event.type === "pitchBend") {
      for (const held of take.held.values()) {
        if (held.channel === event.channel) {
          held.bends.push({ sec, bend: event.bend });
        }
      }
      return;
    }

    const key = `${event.channel}:${event.note}`;
    const held = take.held.get(key);
    if (held) {
      endNote(take, held, sec);
      take.held.delete(key);
    }
    if (event.type === "noteOn") {
      take.held.set(key, {
        channel: event.channel,
        pitch: event.note,
        velocity: event.velocity,
        onSec: sec,
        bends: [{ sec, bend: channelBend[event.channel] }],
      });
    }
  };

  const endNote = (into: Take, held: HeldNote, offSec: number) => {
    held.bends.push({ sec: offSec, bend: channelBend[held.channel] });
    into.notes.push({ ...held, offSec });
  };

  const finishTake = (finished: Take) => {
    const endSec = now();
    for (const held of finished.held.values()) {
      endNote(finished, held, endSec);
    }
    if (finished.notes.length === 0) {
      params.status = "no notes recorded; roll unchanged";
      return;
    }

    const beats = (sec: number) => ctx.tempo.beatsAtTime(sec);
    const notes = finished.notes.sort((a, b) => a.onSec - b.onSec);
    const startBeat = params.trimStartSilence
      ? beats(notes[0].onSec)
      : beats(finished.startSec);
    const endBeat = params.trimEndSilence
      ? Math.max(...notes.map((note) => beats(note.offSec)))
      : beats(endSec);

    setPianoRollClip(ROLL, {
      notes: notes.map((note, index) => ({
        id: `take-${index}`,
        pitch: note.pitch,
        position: beats(note.onSec) - startBeat,
        duration: Math.max(0.001, beats(note.offSec) - beats(note.onSec)),
        velocity: note.velocity,
        mpePitch: pitchCurve(note, params.bendRange, beats),
      })),
    });
    // The roll stores notes only and has no length field, so the take's loop
    // length (which is what trimming the end changes) is reported here.
    params.lengthBeats = Math.round((endBeat - startBeat) * 1000) / 1000;
    params.status = `wrote ${notes.length} notes`;
  };

  try {
    while (true) {
      const names = listMidiInputs().map((port) => port.name);
      if (names.join("\n") !== inputNames.join("\n")) {
        inputNames = names;
        params = declareParams(inputNames);
      }

      if (params.input !== openedName) {
        input?.close();
        input = null;
        openedName = params.input;
        clockOffsetSec = Infinity;
        if (openedName !== NO_INPUT) {
          try {
            input = await openMidiInput(openedName, ctx);
            input.onMessage(onEvent);
            if (!take) params.status = `listening to ${openedName}`;
          } catch (error) {
            params.status = `could not open ${openedName}`;
            console.warn("[midi-recording]", error);
          }
        } else if (!take) {
          params.status = "idle";
        }
      }

      if (params.recording && !wasRecording) {
        take = { startSec: now(), held: new Map(), notes: [] };
        params.status = input ? "recording" : "recording (no input selected)";
      } else if (!params.recording && wasRecording && take) {
        const finished = take;
        take = null;
        finishTake(finished);
      }
      wasRecording = params.recording;

      await ctx.waitSec(1 / 60);
    }
  } finally {
    input?.close();
  }
}

/**
 * The roll's per-note pitch curve: `time` is 0..1 across the note and
 * `pitchOffset` is semitones from the note's pitch. Returns undefined for a
 * note that never bent. Samples are thinned because every point becomes a
 * draggable handle in the roll.
 */
function pitchCurve(
  note: RecordedNote,
  bendRange: number,
  beats: (sec: number) => number,
): { points: { time: number; pitchOffset: number }[] } | undefined {
  const onBeat = beats(note.onSec);
  const span = beats(note.offSec) - onBeat;
  const points = note.bends.map(({ sec, bend }) => ({
    time: span > 0 ? Math.min(1, Math.max(0, (beats(sec) - onBeat) / span)) : 0,
    pitchOffset: Math.max(
      -ROLL_PITCH_RANGE,
      Math.min(ROLL_PITCH_RANGE, (bend / 8192) * bendRange),
    ),
  }));
  if (points.every((point) => Math.abs(point.pitchOffset) < 0.01)) {
    return undefined;
  }
  return { points: simplifyCurve(points, PITCH_TOLERANCE_SEMITONES) };
}

/**
 * Ramer-Douglas-Peucker on pitch error: keep a point only when dropping it
 * would move the line drawn between its neighbours by more than `tolerance`
 * semitones. Endpoints are always kept.
 */
function simplifyCurve<T extends { time: number; pitchOffset: number }>(
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
      const expected = a.pitchOffset + t * (b.pitchOffset - a.pitchOffset);
      const error = Math.abs(p.pitchOffset - expected);
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
