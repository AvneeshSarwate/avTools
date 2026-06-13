import type { TimeContext } from "@avtools/core-timing";
import {
  AbletonClip,
  type AbletonNote,
  abletonNoteToPianoRollNote,
  pianoRollNoteToAbletonNote,
} from "@avtools/music-types";
import {
  getPianoRoll,
  setPianoRoll,
  type SetPianoRollOptions,
} from "../visualizer/piano_roll_store.ts";
import type {
  NoteDataInput,
  PianoRollData,
  PianoRollObject,
} from "../visualizer/protocol.ts";

export interface PianoRollNoteOutput {
  readonly name?: string;
  noteOn(channel: number, pitch: number, velocity?: number): void;
  noteOff(channel: number, pitch: number, velocity?: number): void;
}

export interface PlayPianoRollOptions {
  channel?: number;
  output?: PianoRollNoteOutput;
  outputName?: string;
  secondsPerBeat?: number;
  gate?: number;
  velocity?: number;
  log?: boolean;
}

export interface SetPianoRollClipOptions extends SetPianoRollOptions {
  duration?: number;
}

export type PianoRollLike = AbletonClip | PianoRollData | PianoRollObject;

const DEFAULT_MIDI_OUTPUT_NAME = "IAC Driver Bus 1";
let warnedNoMidiOutput = false;

export function getPianoRollClip(name: string): AbletonClip {
  const roll = getPianoRoll(name);
  if (!roll) throw new Error(`Piano roll not found: ${name}`);
  return pianoRollDataToClip(name, roll.data);
}

export function setPianoRollClip(
  name: string,
  clip: PianoRollLike,
  options: SetPianoRollClipOptions = {},
): PianoRollObject {
  return setPianoRoll(name, pianoRollLikeToData(clip), {
    label: options.label ?? `Set ${name}`,
    source: options.source ?? "livecode",
    originId: options.originId ?? "livecode",
    undoable: options.undoable,
  });
}

export function pianoRollDataToClip(
  name: string,
  data: PianoRollData,
): AbletonClip {
  const notes = data.notes
    .map((note) =>
      pianoRollNoteToAbletonNote({
        ...note,
        velocity: note.velocity ?? 100,
      })
    )
    .sort((a, b) => a.position - b.position);
  const duration = inferClipDuration(notes);
  return new AbletonClip(name, duration, notes);
}

export function clipToPianoRollData(clip: AbletonClip): PianoRollData {
  return {
    notes: clip.notes.map((note, index) => {
      const id = note.noteId ?? `note_${index}`;
      const converted = abletonNoteToPianoRollNote(note, id);
      return {
        ...converted,
        id,
        mpePitch: converted.mpePitch
          ? {
            points: converted.mpePitch.points.map((point) => ({ ...point })),
          }
          : undefined,
      };
    }),
  };
}

export function pianoRollLikeToData(roll: PianoRollLike): PianoRollData {
  if (roll instanceof AbletonClip) return clipToPianoRollData(roll);
  if ("data" in roll) return roll.data;
  return roll;
}

export async function playPianoRoll(
  ctx: TimeContext,
  roll: PianoRollLike,
  options: PlayPianoRollOptions = {},
): Promise<void> {
  const output = options.output ?? await resolveMidiOutput(options);
  if ((options.log ?? true) && output?.name) {
    console.log("[piano-roll]", "midi output", output.name);
  }
  const clip = roll instanceof AbletonClip
    ? roll
    : pianoRollDataToClip("piano roll", "data" in roll ? roll.data : roll);
  const notes = clip.notes
    .filter((note) => note.isEnabled !== false)
    .sort((a, b) => a.position - b.position);
  const secondsPerBeat = options.secondsPerBeat ?? 0.25;
  const gate = options.gate ?? 0.9;
  let cursorBeat = 0;

  for (const note of notes) {
    const waitBeats = Math.max(0, note.position - cursorBeat);
    if (waitBeats > 0) await ctx.waitSec(waitBeats * secondsPerBeat);

    startNote(ctx, note, secondsPerBeat, gate, { ...options, output });
    cursorBeat = note.position;
  }

  const tailBeats = Math.max(0, clip.duration - cursorBeat);
  if (tailBeats > 0) await ctx.waitSec(tailBeats * secondsPerBeat);
}

function startNote(
  ctx: TimeContext,
  note: AbletonNote,
  secondsPerBeat: number,
  gate: number,
  options: PlayPianoRollOptions,
) {
  const channel = options.channel ?? 0;
  const pitch = clampMidi(note.pitch);
  const velocity = clampMidi(options.velocity ?? note.velocity ?? 100);
  const durationSec = Math.max(0.01, note.duration * secondsPerBeat * gate);

  if (options.log ?? true) {
    console.log("[piano-roll]", "note", pitch, "velocity", velocity);
  }

  options.output?.noteOn(channel, pitch, velocity);
  const handle = ctx.branch(async (noteCtx) => {
    try {
      await noteCtx.waitSec(durationSec);
    } finally {
      options.output?.noteOff(channel, pitch, 0);
    }
  }, `piano-roll-note-${pitch}`);

  handle.handleCancel(() => {
    options.output?.noteOff(channel, pitch, 0);
  });
}

async function resolveMidiOutput(
  options: PlayPianoRollOptions,
): Promise<PianoRollNoteOutput | undefined> {
  const { getMidiDevice, listMidiDevices } = await import("./midi_helpers.ts");
  const requestedName = options.outputName ?? readMidiOutputEnv();
  if (requestedName) return getMidiDevice(requestedName);

  const outputs = listMidiDevices();
  const defaultOutput =
    outputs.find((port) => port.name.includes(DEFAULT_MIDI_OUTPUT_NAME)) ??
      outputs[0];

  if (!defaultOutput) {
    if ((options.log ?? true) && !warnedNoMidiOutput) {
      warnedNoMidiOutput = true;
      console.warn("[piano-roll]", "no MIDI output available");
    }
    return undefined;
  }

  return getMidiDevice(defaultOutput.name);
}

function readMidiOutputEnv(): string | undefined {
  try {
    return Deno.env.get("LIVECODE_MIDI_OUTPUT") ?? undefined;
  } catch {
    return undefined;
  }
}

function inferClipDuration(notes: AbletonNote[]): number {
  return notes.reduce(
    (duration, note) => Math.max(duration, note.position + note.duration),
    0,
  );
}

function clampMidi(value: number): number {
  return Math.max(0, Math.min(127, Math.round(value)));
}
