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
    status: "idle",
    lengthBeats: 0,
  }, {
    input: { label: "MIDI input", options },
    recording: { label: "recording" },
    trimStartSilence: { label: "trim start silence" },
    trimEndSilence: { label: "trim end silence" },
    status: { label: "status" },
    lengthBeats: { label: "take length (beats)" },
  });
}

interface HeldNote {
  pitch: number;
  velocity: number;
  onSec: number;
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

  const onEvent = (event: MidiInputEvent) => {
    if (event.type !== "noteOn" && event.type !== "noteOff") return;
    const at = eventSec(event);
    if (!take) return;
    const sec = Math.max(take.startSec, at);
    const key = `${event.channel}:${event.note}`;
    const held = take.held.get(key);
    if (held) {
      take.notes.push({ ...held, offSec: sec });
      take.held.delete(key);
    }
    if (event.type === "noteOn") {
      take.held.set(key, {
        pitch: event.note,
        velocity: event.velocity,
        onSec: sec,
      });
    }
  };

  const finishTake = (finished: Take) => {
    const endSec = now();
    for (const held of finished.held.values()) {
      finished.notes.push({ ...held, offSec: endSec });
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
