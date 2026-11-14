// Live MIDI input per instance: monitoring (thru to the instance's output and
// the held-key overlay on its source roll) and recording into its bank.
//
// Recording follows Ableton's session view:
// - Rec while the instance plays or runs overdubs: notes land at the loop
//   position they were played at, wrapping at the loop end, and join the bank
//   at their note-off, so the next pass plays them.
// - Rec while idle on a bank with notes starts Play and overdubs.
// - Rec on an empty bank records a free take from the moment Rec was pressed;
//   stopping sets the loop length to the take rounded up to a whole bar.
// The whole take is one undo step in the source roll (when it is open).
//
// Per-note expression is captured the way docs/livecode's recorder does it
// (apps/livecode-tldraw/example-projects/feature-midi-recording): pitch bend,
// channel pressure and CC74 are tracked per channel (MPE gives every note its
// own channel), poly pressure per key, and each note's curves start from the
// values its channel had at note-on.
//
// Hot state (held notes, samples, the clock offset) is plain module state;
// `recordingStore` is the UI projection, written at commit points only.
import type { MidiInputEvent } from "@avtools/midi/browser";
import type { TLShapeId } from "tldraw";
import { proxy } from "valtio";
import { newId } from "../model/types";
import {
  bendToSemitones,
  DEFAULT_BEND_RANGE,
  DEFAULT_ROOT_TOLERANCE_CENTS,
  ROOT_MIN_DWELL_SEC,
  rootCurve,
  MAX_PITCH_OFFSET,
  REST_PRESSURE,
  REST_TIMBRE,
  simplifyCurve,
  TIMBRE_CC,
} from "../model/mpe";
import type { LiveInput, LiveInputKey, LiveInputNote, PianoRollNote } from "../pianoRoll/types";
import { cloneNote } from "../pianoRoll/utils";
import { clampPitch } from "../runners/runnerTypes";
import { getBank, setBankLoopLength, setBankNotes } from "./banks";
import { beatsAtSec, nowSec } from "./clock";
import { getEditor } from "./editorRef";
import { getOutputSync, listenToInput } from "./midi";
import { getRuntime, startPlay } from "./playback";
import { sourceRollHandles } from "./rollHandles";

const PITCH_TOLERANCE_SEMITONES = 0.05;
const VALUE_TOLERANCE = 1;
const BEATS_PER_BAR = 4;
const MIN_DURATION = 1 / 64;

export type TakeKind = "overdub" | "free";

export interface RecordingUi {
  /** The input this instance listens to, once it is open. */
  listening: string | null;
  recording: TakeKind | null;
  /** Notes written by the current (or last) take. */
  recorded: number;
  status: string;
}

export const recordingStore = proxy<{ byShape: Record<string, RecordingUi> }>({ byShape: {} });

function ui(shapeId: string): RecordingUi {
  recordingStore.byShape[shapeId] ??= { listening: null, recording: null, recorded: 0, status: "" };
  return recordingStore.byShape[shapeId];
}

interface Sample {
  sec: number;
  value: number;
}

interface HeldNote {
  channel: number;
  /** The key as played (before transpose). */
  pitch: number;
  velocity: number;
  onSec: number;
  /** The pitch sent to the output for thru, so its note-off matches. */
  thruPitch: number | null;
  thruChannel: number;
  /** Set when the note started inside a take: its position in bank beats. */
  take: Take | null;
  position: number;
  bends: Sample[];
  pressures: Sample[];
  timbres: Sample[];
}

interface Take {
  kind: TakeKind;
  bankId: string;
  startSec: number;
  /** Bank notes when the take started, for the take's undo step. */
  before: PianoRollNote[];
  recorded: number;
  channels: Set<number>;
}

interface Recorder {
  shapeId: string;
  inputName: string;
  unsubscribe: (() => void) | null;
  /** Smallest observed (clock now - device time): the clock offset estimate. */
  clockOffsetSec: number;
  bend: number[];
  pressure: number[];
  timbre: number[];
  held: Map<string, HeldNote>;
  take: Take | null;
}

const recorders = new Map<string, Recorder>();

/** What the recorder reads from the instance shape, live. */
interface InputProps {
  bankId: string;
  midiOutputName: string;
  midiThru: boolean;
  mpe: boolean;
  bendRange: number;
  transpose: number;
  /** Semitones; null when auto-root is off. */
  rootTolerance: number | null;
}

function readProps(shapeId: string): InputProps | null {
  const shape = getEditor()?.getShape(shapeId as TLShapeId);
  if (!shape) return null;
  const props = shape.props as Record<string, unknown>;
  const params = (props.params ?? {}) as Record<string, number>;
  return {
    bankId: typeof props.bankId === "string" ? props.bankId : "",
    midiOutputName: typeof props.midiOutputName === "string" ? props.midiOutputName : "",
    midiThru: props.midiThru !== false,
    mpe: props.mpe === true,
    bendRange: typeof props.bendRange === "number" && props.bendRange > 0 ? props.bendRange : DEFAULT_BEND_RANGE,
    transpose: Math.round(params.transpose ?? 0),
    rootTolerance: props.autoRoot === false
      ? null
      : (typeof props.rootToleranceCents === "number" ? props.rootToleranceCents : DEFAULT_ROOT_TOLERANCE_CENTS) / 100,
  };
}

function newRecorder(shapeId: string, inputName: string): Recorder {
  return {
    shapeId,
    inputName,
    unsubscribe: null,
    clockOffsetSec: Infinity,
    bend: new Array<number>(16).fill(0),
    pressure: new Array<number>(16).fill(REST_PRESSURE),
    timbre: new Array<number>(16).fill(REST_TIMBRE),
    held: new Map(),
    take: null,
  };
}

/**
 * Point the instance at the input named `inputName` ("" for none). Opening
 * is async; a later call wins over an earlier one still opening.
 */
export async function setInstanceInput(shapeId: string, inputName: string): Promise<void> {
  const existing = recorders.get(shapeId);
  if (existing && existing.inputName === inputName && existing.unsubscribe) return;
  closeInput(shapeId);
  if (!inputName) return;
  const recorder = newRecorder(shapeId, inputName);
  recorders.set(shapeId, recorder);
  const unsubscribe = await listenToInput(inputName, (event) => onInputEvent(recorder, event));
  if (recorders.get(shapeId) !== recorder) {
    unsubscribe?.();
    return;
  }
  recorder.unsubscribe = unsubscribe;
  const state = ui(shapeId);
  state.listening = unsubscribe ? inputName : null;
  state.status = unsubscribe ? "" : `input "${inputName}" not found`;
}

/** Stop listening: ends a take (keeping what was recorded) and releases thru notes. */
export function closeInput(shapeId: string): void {
  const recorder = recorders.get(shapeId);
  if (!recorder) return;
  if (recorder.take) stopRecording(shapeId);
  for (const held of recorder.held.values()) releaseThru(recorder, held);
  recorder.held.clear();
  recorder.unsubscribe?.();
  recorders.delete(shapeId);
  const state = recordingStore.byShape[shapeId];
  if (state) state.listening = null;
}

export function isRecording(shapeId: string): boolean {
  return Boolean(recorders.get(shapeId)?.take);
}

export function startRecording(shapeId: string): void {
  const recorder = recorders.get(shapeId);
  const props = readProps(shapeId);
  const state = ui(shapeId);
  if (!recorder || !recorder.unsubscribe) {
    state.status = "pick a MIDI input first";
    return;
  }
  const bank = props ? getBank(props.bankId) : undefined;
  if (!props || !bank) {
    state.status = "no bank";
    return;
  }
  if (recorder.take) return;
  const runtime = getRuntime(shapeId);
  let kind: TakeKind = "overdub";
  if (runtime.mode === "idle") {
    if (bank.notes.length === 0) kind = "free";
    else startPlay(shapeId);
  }
  recorder.take = {
    kind,
    bankId: bank.id,
    startSec: nowSec(),
    before: bank.notes.map((note) => cloneNote(note)),
    recorded: 0,
    channels: new Set(),
  };
  state.recording = kind;
  state.recorded = 0;
  state.status = kind === "free" ? "recording a free take" : "overdubbing";
}

export function stopRecording(shapeId: string): void {
  const recorder = recorders.get(shapeId);
  const take = recorder?.take;
  if (!recorder || !take) return;
  const props = readProps(shapeId);
  const endSec = nowSec();
  // Notes still held are closed at the stop time; they keep sounding (thru)
  // until their real note-off, they just stop growing in the take.
  for (const held of recorder.held.values()) {
    if (held.take !== take) continue;
    commitNote(recorder, held, endSec, props);
    held.take = null;
  }
  recorder.take = null;
  const state = ui(shapeId);
  state.recording = null;

  if (take.kind === "free") {
    const bars = Math.max(1, Math.ceil((beatsAtSec(endSec) - beatsAtSec(take.startSec)) / BEATS_PER_BAR - 1e-6));
    if (take.recorded > 0) setBankLoopLength(take.bankId, bars * BEATS_PER_BAR);
  }
  const bank = getBank(take.bankId);
  if (bank && take.recorded > 0) {
    // One undo step for the whole take (the per-note commits above were not).
    sourceRollHandles.get(shapeId)?.commitExternalEdit("Record Take", take.before, bank.notes.map((note) => cloneNote(note)));
  }
  const mpeHint = take.channels.size > 1 && props && !props.mpe ? " · played on several channels: turn on MPE out to hear the expression" : "";
  state.status = take.recorded > 0 ? `recorded ${take.recorded} notes${mpeHint}` : "nothing recorded";
}

/** Bank-beat position of `sec` for the take. */
function takePosition(recorder: Recorder, take: Take, sec: number): number {
  if (take.kind === "free") return Math.max(0, beatsAtSec(sec) - beatsAtSec(take.startSec));
  const runtime = getRuntime(recorder.shapeId);
  if (runtime.loopStartBeats === null) return 0;
  const length = runtime.loopLength > 0 ? runtime.loopLength : 1;
  const raw = (beatsAtSec(sec) - runtime.loopStartBeats) * runtime.loopSpeed;
  return ((raw % length) + length) % length;
}

/** Note durations in bank beats: overdubs follow the instance's speed. */
function beatSpan(recorder: Recorder, take: Take, fromSec: number, toSec: number): number {
  const speed = take.kind === "overdub" ? getRuntime(recorder.shapeId).loopSpeed || 1 : 1;
  return Math.max(0, (beatsAtSec(toSec) - beatsAtSec(fromSec)) * speed);
}

function eventSec(recorder: Recorder, event: MidiInputEvent): number {
  // Device timestamps are on the input's own clock. The smallest observed
  // (now - device time) is the best offset estimate; anything above it is
  // delivery delay, so a burst handled late keeps its played spacing.
  const now = nowSec();
  const deviceSec = event.timeMs / 1000;
  recorder.clockOffsetSec = Math.min(recorder.clockOffsetSec, now - deviceSec);
  return Math.min(now, deviceSec + recorder.clockOffsetSec);
}

function onInputEvent(recorder: Recorder, event: MidiInputEvent): void {
  if (event.type === "programChange") return;
  const sec = eventSec(recorder, event);
  const props = readProps(recorder.shapeId);
  const take = recorder.take;

  switch (event.type) {
    case "pitchBend":
      recorder.bend[event.channel] = event.bend;
      thru(props, (output, channel) => output.pitchBend(channel, event.bend), event.channel);
      for (const held of recorder.held.values()) {
        if (held.channel === event.channel && held.take) held.bends.push({ sec, value: event.bend });
      }
      return;
    case "channelPressure":
      recorder.pressure[event.channel] = event.pressure;
      thru(props, (output, channel) => output.channelPressure(channel, event.pressure), event.channel);
      for (const held of recorder.held.values()) {
        if (held.channel === event.channel && held.take) held.pressures.push({ sec, value: event.pressure });
      }
      return;
    case "polyPressure": {
      const held = recorder.held.get(`${event.channel}:${event.note}`);
      if (held && held.thruPitch !== null) {
        const sounding = held.thruPitch;
        thru(props, (output, channel) => output.polyPressure(channel, sounding, event.pressure), event.channel);
      }
      if (held?.take) held.pressures.push({ sec, value: event.pressure });
      return;
    }
    case "cc":
      thru(props, (output, channel) => output.cc(channel, event.controller, event.value), event.channel);
      if (event.controller !== TIMBRE_CC) return;
      recorder.timbre[event.channel] = event.value;
      for (const held of recorder.held.values()) {
        if (held.channel === event.channel && held.take) held.timbres.push({ sec, value: event.value });
      }
      return;
    case "noteOn":
    case "noteOff": {
      const key = `${event.channel}:${event.note}`;
      const previous = recorder.held.get(key);
      if (previous) {
        releaseThru(recorder, previous);
        if (previous.take) commitNote(recorder, previous, sec, props);
        recorder.held.delete(key);
      }
      if (event.type === "noteOff") return;
      const held: HeldNote = {
        channel: event.channel,
        pitch: event.note,
        velocity: event.velocity,
        onSec: sec,
        thruPitch: null,
        thruChannel: 0,
        take,
        position: take ? takePosition(recorder, take, sec) : 0,
        bends: [{ sec, value: recorder.bend[event.channel] }],
        pressures: [{ sec, value: recorder.pressure[event.channel] }],
        timbres: [{ sec, value: recorder.timbre[event.channel] }],
      };
      if (take) take.channels.add(event.channel);
      if (props?.midiThru) {
        const output = getOutputSync(props.midiOutputName);
        if (output && !output.closed) {
          held.thruPitch = clampPitch(event.note + props.transpose);
          held.thruChannel = props.mpe ? event.channel : 0;
          output.noteOn(held.thruChannel, held.thruPitch, event.velocity);
        }
      }
      recorder.held.set(key, held);
      return;
    }
  }
}

/**
 * Forward an expression message to the instance's output when thru is on.
 * With MPE out the controller's channels pass through (they are already
 * member channels); without it everything goes to channel 0.
 */
function thru(props: InputProps | null, send: (output: NonNullable<ReturnType<typeof getOutputSync>>, channel: number) => void, channel: number): void {
  if (!props?.midiThru) return;
  const output = getOutputSync(props.midiOutputName);
  if (!output || output.closed) return;
  send(output, props.mpe ? channel : 0);
}

function releaseThru(recorder: Recorder, held: HeldNote): void {
  if (held.thruPitch === null) return;
  const props = readProps(recorder.shapeId);
  const output = props ? getOutputSync(props.midiOutputName) : null;
  if (output && !output.closed) output.noteOff(held.thruChannel, held.thruPitch, 0);
  held.thruPitch = null;
}

/** Turn a finished held note into a bank note and add it to the bank. */
function commitNote(recorder: Recorder, held: HeldNote, offSec: number, props: InputProps | null): void {
  const take = held.take;
  if (!take) return;
  const bank = getBank(take.bankId);
  if (!bank) return;
  const last = (samples: Sample[]) => samples[samples.length - 1].value;
  held.bends.push({ sec: offSec, value: recorder.bend[held.channel] });
  held.pressures.push({ sec: offSec, value: last(held.pressures) });
  held.timbres.push({ sec: offSec, value: last(held.timbres) });
  const bendRange = props?.bendRange ?? DEFAULT_BEND_RANGE;
  const span = offSec - held.onSec;
  const toTime = (sec: number) => (span > 0 ? Math.min(1, Math.max(0, (sec - held.onSec) / span)) : 0);

  const note: PianoRollNote = {
    id: newId("rec"),
    pitch: held.pitch,
    position: held.position,
    duration: Math.max(MIN_DURATION, beatSpan(recorder, take, held.onSec, offSec)),
    velocity: held.velocity,
  };
  const pitch = held.bends.map(({ sec, value }) => ({
    time: toTime(sec),
    pitchOffset: Math.max(-MAX_PITCH_OFFSET, Math.min(MAX_PITCH_OFFSET, bendToSemitones(value, bendRange))),
  }));
  if (pitch.some((point) => Math.abs(point.pitchOffset) >= 0.01)) {
    // Auto-root: points where the pitch rests on a semitone are marked rooted
    // (see rootCurve), and each such run keeps its ends through thinning.
    const tolerance = props?.rootTolerance ?? null;
    const rooted = tolerance === null ? null : rootCurve(pitch, tolerance, span > 0 ? ROOT_MIN_DWELL_SEC / span : 0);
    note.mpePitch = {
      points: simplifyCurve(rooted?.points ?? pitch, PITCH_TOLERANCE_SEMITONES, (point) => point.pitchOffset, rooted?.anchors),
    };
  }
  const valueCurve = (samples: Sample[], rest: number) => {
    if (samples.every((sample) => sample.value === rest)) return undefined;
    const points = samples.map(({ sec, value }) => ({ time: toTime(sec), value }));
    return { points: simplifyCurve(points, VALUE_TOLERANCE, (point) => point.value) };
  };
  const pressure = valueCurve(held.pressures, REST_PRESSURE);
  const timbre = valueCurve(held.timbres, REST_TIMBRE);
  if (pressure) note.mpePressure = pressure;
  if (timbre) note.mpeTimbre = timbre;

  setBankNotes(bank.id, [...bank.notes, note]);
  take.recorded += 1;
  ui(recorder.shapeId).recorded = take.recorded;
}

const NO_LIVE_INPUT: LiveInput = { keys: [], notes: [] };

/**
 * The source roll's live overlay for this instance right now: every held key,
 * and the notes of the running take growing to the current time. Read per
 * frame by the shape's playhead tick, which pushes it through the roll handle.
 */
export function liveInputFor(shapeId: string): LiveInput {
  const recorder = recorders.get(shapeId);
  if (!recorder || recorder.held.size === 0) return NO_LIVE_INPUT;
  const props = readProps(shapeId);
  const bendRange = props?.bendRange ?? DEFAULT_BEND_RANGE;
  const now = nowSec();
  const keys: LiveInputKey[] = [];
  const notes: LiveInputNote[] = [];
  for (const [key, held] of recorder.held) {
    const bend = bendToSemitones(recorder.bend[held.channel], bendRange);
    keys.push({ pitch: held.pitch, pitchOffset: bend, velocity: held.velocity });
    const take = held.take;
    if (!take) continue;
    const curve = held.bends.length > 1 || Math.abs(bend) > 0.01
      ? [...held.bends, { sec: now, value: recorder.bend[held.channel] }].map(({ sec, value }) => ({
        position: held.position + beatSpan(recorder, take, held.onSec, sec),
        pitchOffset: bendToSemitones(value, bendRange),
      }))
      : undefined;
    notes.push({
      id: key,
      pitch: held.pitch,
      position: held.position,
      duration: beatSpan(recorder, take, held.onSec, now),
      velocity: held.velocity,
      curve,
    });
  }
  return { keys, notes };
}

/** The free take's playhead in bank beats, or null outside a free take. */
export function freeTakePlayhead(shapeId: string): number | null {
  const take = recorders.get(shapeId)?.take;
  if (!take || take.kind !== "free") return null;
  return Math.max(0, beatsAtSec(nowSec()) - beatsAtSec(take.startSec));
}
