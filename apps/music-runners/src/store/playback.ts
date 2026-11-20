// Per-instance run state and the loop that drives a runner. Run state is
// never persisted; it belongs to this page session.
import type { TimeContext } from "@avtools/core-timing";
import type { MidiOutput } from "@avtools/midi/browser";
import { react, type TLShapeId } from "tldraw";
import type { Clip, RunnerEvent } from "../model/types";
import type { GhostNote, PianoRollNote, PlayheadMarker } from "../pianoRoll/types";
import { getRunner } from "../runners/registry";
import {
  clampPitch,
  defaultParams,
  type LoopNotes,
  type LoopPhase,
  notesInLoop,
  numberParam,
  type Params,
  type PlayLoopOptions,
  type RunnerApi,
  type RunnerDefinition,
} from "../runners/runnerTypes";
import { getClip } from "./clips";
import { cursorFromMeta, type RunnerInstanceProps } from "../runners/base/instanceProps";
import { clockStore, getRootContext, nowSec } from "./clock";
import { getEditor } from "./editorRef";
import { emitEvent, onEvent } from "./events";
import { getOutput, getOutputSync } from "./midi";
import { isSixSinesOutput, sendsMpe } from "./sixSines";
import { SixSinesOutput } from "./sixSinesOutput";
import {
  allocateMemberChannel,
  DEFAULT_BEND_RANGE,
  pitchOffsetAt,
  pressureAt,
  releaseMemberChannel,
  semitonesToBend,
  TIMBRE_CC,
  timbreAt,
} from "../model/mpe";
import { proxy } from "valtio";

export type InstanceMode = "idle" | "play" | "run";

export interface InstanceRuntime {
  shapeId: string;
  mode: InstanceMode;
  loopCount: number;
  /** The loop currently sounding (Generated roll). */
  generated: LoopNotes | null;
  /** Live overlay of notes that actually sounded during the current loop. */
  played: GhostNote[];
  /** Output of the last regenerate (Preview roll). */
  preview: LoopNotes | null;
  /** For the playhead: the instance's beat (its own tempo) at the current loop's start, and its speed. */
  loopStartBeats: number | null;
  /** Where the current loop sits on the roll (LoopNotes.start). */
  loopOffset: number;
  loopSpeed: number;
  loopLength: number;
  error: string | null;
  logs: string[];
}

export const playbackStore = proxy<{ instances: Record<string, InstanceRuntime> }>({ instances: {} });

export function getRuntime(shapeId: string): InstanceRuntime {
  return playbackStore.instances[shapeId] ?? emptyRuntime(shapeId);
}

function emptyRuntime(shapeId: string): InstanceRuntime {
  return {
    shapeId,
    mode: "idle",
    loopCount: 0,
    generated: null,
    played: [],
    preview: null,
    loopStartBeats: null,
    loopOffset: 0,
    loopSpeed: 1,
    loopLength: 16,
    error: null,
    logs: [],
  };
}

/** The live (proxy) runtime record, created on first touch. */
function ensureRuntime(shapeId: string): InstanceRuntime {
  if (!playbackStore.instances[shapeId]) playbackStore.instances[shapeId] = emptyRuntime(shapeId);
  return playbackStore.instances[shapeId];
}

function patchRuntime(shapeId: string, patch: Partial<InstanceRuntime> | ((prev: InstanceRuntime) => Partial<InstanceRuntime>)): void {
  const runtime = ensureRuntime(shapeId);
  const next = typeof patch === "function" ? patch(runtime) : patch;
  Object.assign(runtime, next);
}

/**
 * Each running instance's tempo map: its run branch's own clone of the root's
 * (BranchOptions tempo "cloned"), set to the instance's tempo prop. Plain
 * state, not in the store.
 */
const instanceTempos = new Map<string, TimeContext["tempo"]>();

/**
 * The instance's beat position at scheduler time `sec`: on its own tempo map
 * while it runs, else at its tempo prop (a constant rate; only differences of
 * these are used, for recording while stopped).
 */
export function instanceBeatsAtSec(shapeId: string, sec: number): number {
  const tempo = instanceTempos.get(shapeId);
  if (tempo) return tempo.beatsAtTime(sec);
  return (sec * instanceTempo(shapeId)) / 60;
}

/** The instance's tempo setting in BPM (the project BPM if it has none). */
export function instanceTempo(shapeId: string): number {
  const bpm = readInstanceProps(shapeId)?.tempo;
  return bpm && Number.isFinite(bpm) && bpm > 0 ? bpm : clockStore.bpm;
}

export function instanceNowBeats(shapeId: string): number {
  return instanceBeatsAtSec(shapeId, nowSec());
}

/** Where the instance is in its current pass, or null when idle. */
export function loopPhase(runtime: InstanceRuntime): LoopPhase | null {
  if (runtime.loopStartBeats === null || runtime.mode === "idle") return null;
  const elapsed = Math.max(0, (instanceNowBeats(runtime.shapeId) - runtime.loopStartBeats) * runtime.loopSpeed);
  return { elapsed, loopLength: runtime.loopLength, start: runtime.loopOffset, loopCount: runtime.loopCount };
}

/** The sidebar bar without a runner's own `sidebarPhase`: how far through the current pass. */
export function defaultSidebarPhase(phase: LoopPhase): number | null {
  return phase.loopLength > 0 ? Math.min(1, phase.elapsed / phase.loopLength) : null;
}

/** The sidebar row's progress (0..1) or null for no bar: Run asks the runner, Play uses the default. */
export function sidebarPhase(runtime: InstanceRuntime, def: RunnerDefinition | undefined): number | null {
  const phase = loopPhase(runtime);
  if (!phase) return null;
  const value = runtime.mode === "run" && def?.sidebarPhase ? def.sidebarPhase(phase) : defaultSidebarPhase(phase);
  return value === null || !Number.isFinite(value) ? null : Math.max(0, Math.min(1, value));
}

/** Playhead position in roll beats for the instance's current loop, or null. */
export function playheadBeats(runtime: InstanceRuntime): number | null {
  if (runtime.loopStartBeats === null || runtime.mode === "idle") return null;
  const elapsed = (instanceNowBeats(runtime.shapeId) - runtime.loopStartBeats) * runtime.loopSpeed;
  return runtime.loopOffset + Math.max(0, elapsed);
}

/**
 * Lines a runner draws on its source roll while running (api.setMarkers).
 * Read by the shape's playhead tick, so plain state, not a store.
 */
const runnerMarkers = new Map<string, PlayheadMarker[]>();

export function markersFor(shapeId: string): PlayheadMarker[] {
  return runnerMarkers.get(shapeId) ?? [];
}

interface ActiveRun {
  cancel: () => void;
}

const activeRuns = new Map<string, ActiveRun>();
const pendingRuns = new Map<string, symbol>();

/** The shape's props, read live so slider moves land mid-run. */
function readInstanceProps(shapeId: string): RunnerInstanceProps | null {
  const shape = getEditor()?.getShape(shapeId as TLShapeId);
  return shape ? (shape.props as unknown as RunnerInstanceProps) : null;
}

function liveParams(shapeId: string, def: RunnerDefinition): Params {
  const props = readInstanceProps(shapeId);
  return { ...defaultParams(def), ...(props?.params ?? {}) };
}

const NOTE_OFF_VELOCITY = 0;
const CHANNEL = 0;

/** Ticks per second for sending a held MPE note's curves. */
const MPE_TICK_HZ = 100;

/**
 * Put a member channel into the note's state at `time` (0..1). Sent before the
 * note-on (an MPE synth reads the channel's bend/pressure/timbre at note start)
 * and then on every tick; values equal to the last ones sent are skipped.
 */
interface ChannelExpression {
  bend: number;
  pressure: number;
  timbre: number;
}

function sendExpression(output: MidiOutput, channel: number, note: PianoRollNote, time: number, bendRange: number, last: ChannelExpression | null): ChannelExpression {
  const pitchOffset = pitchOffsetAt(note, time);
  const native = output instanceof SixSinesOutput;
  const next: ChannelExpression = {
    bend: native ? pitchOffset : semitonesToBend(pitchOffset, bendRange),
    pressure: Math.round(pressureAt(note, time)),
    timbre: Math.round(timbreAt(note, time)),
  };
  if (output.closed) return next;
  if (!last || last.bend !== next.bend) {
    if (native) output.setTuning(channel, next.bend);
    else output.pitchBend(channel, next.bend);
  }
  if (!last || last.pressure !== next.pressure) output.channelPressure(channel, next.pressure);
  if (!last || last.timbre !== next.timbre) output.cc(channel, TIMBRE_CC, next.timbre);
  return next;
}

function curveChanges(note: PianoRollNote): boolean {
  return [note.mpePitch, note.mpePressure, note.mpeTimbre].some((curve) => (curve?.points.length ?? 0) > 1);
}

/** Audition a note on the instance's output (Ableton-style click preview). */
export function auditionNote(shapeId: string, pitch: number, velocity: number, durationMs = 180): void {
  const props = readInstanceProps(shapeId);
  if (!props) return;
  const transpose = Math.round(numberParam(props.params, "transpose", 0));
  const sounding = clampPitch(pitch + transpose);
  const play = (output: MidiOutput | null) => {
    if (!output || output.closed) return;
    const mpe = sendsMpe(props);
    const channel = mpe ? allocateMemberChannel(props.midiOutputName) : CHANNEL;
    if (mpe) sendExpression(output, channel, { id: "", pitch, position: 0, duration: 1, velocity }, 0, props.bendRange, null);
    output.noteOn(channel, sounding, velocity);
    window.setTimeout(() => {
      if (!output.closed) output.noteOff(channel, sounding, NOTE_OFF_VELOCITY);
      if (mpe) releaseMemberChannel(props.midiOutputName, channel);
    }, durationMs);
  };
  const open = getOutputSync(props.midiOutputName);
  if (open) play(open);
  else void getOutput(props.midiOutputName).then(play);
}

/** Keys held from a roll's keyboard column: shape id -> the sounding note. */
const pendingKeys = new Map<string, symbol>();
const heldKeys = new Map<string, { output: MidiOutput; channel: number; pitch: number; mpe: boolean; outputName: string }>();

/** Keyboard-column press: sound the key until keyboardKeyUp (Ableton's held key). */
export function keyboardKeyDown(shapeId: string, pitch: number, velocity = 100): void {
  keyboardKeyUp(shapeId);
  const props = readInstanceProps(shapeId);
  if (!props) return;
  const sounding = clampPitch(pitch + Math.round(numberParam(props.params, "transpose", 0)));
  const request = Symbol();
  pendingKeys.set(shapeId, request);
  const play = (output: MidiOutput | null) => {
    if (pendingKeys.get(shapeId) !== request) return;
    pendingKeys.delete(shapeId);
    if (!output || output.closed) return;
    const mpe = sendsMpe(props);
    const channel = mpe ? allocateMemberChannel(props.midiOutputName) : CHANNEL;
    if (mpe) sendExpression(output, channel, { id: "", pitch, position: 0, duration: 1, velocity }, 0, props.bendRange, null);
    output.noteOn(channel, sounding, velocity);
    heldKeys.set(shapeId, { output, channel, pitch: sounding, mpe, outputName: props.midiOutputName });
  };
  const open = getOutputSync(props.midiOutputName);
  if (open) play(open);
  else void getOutput(props.midiOutputName).then(play);
}

export function keyboardKeyUp(shapeId: string): void {
  pendingKeys.delete(shapeId);
  const held = heldKeys.get(shapeId);
  if (!held) return;
  heldKeys.delete(shapeId);
  if (!held.output.closed) held.output.noteOff(held.channel, held.pitch, NOTE_OFF_VELOCITY);
  if (held.mpe) releaseMemberChannel(held.outputName, held.channel);
}

function makeApi(shapeId: string, ctx: TimeContext, def: RunnerDefinition, outputName: string, synthOutput: MidiOutput | null): RunnerApi & { releaseAll(): void } {
  // "channel:pitch" -> the sounding that owns the note-off. A retrigger of a
  // key replaces the entry so the earlier branch's release becomes a no-op.
  // Without MPE every note is on channel 0, so the key is the pitch; with MPE
  // each note has its own channel and same-pitch notes may overlap.
  const active = new Map<string, { token: number; channel: number; pitch: number }>();
  let lastPlayed: PianoRollNote | null = null;
  let playedCounter = 0;
  let soundingCounter = 0;

  const currentOutput = () => synthOutput ?? getOutputSync(outputName);
  const send = (kind: "on" | "off", channel: number, pitch: number, velocity: number) => {
    const output = currentOutput();
    if (!output || output.closed) return;
    if (kind === "on") output.noteOn(channel, pitch, velocity);
    else output.noteOff(channel, pitch, NOTE_OFF_VELOCITY);
  };

  const release = (key: string) => {
    const entry = active.get(key);
    if (!entry) return;
    active.delete(key);
    send("off", entry.channel, entry.pitch, 0);
    if (entry.channel !== CHANNEL) releaseMemberChannel(outputName, entry.channel);
  };

  const transposeNow = () => Math.round(numberParam(liveParams(shapeId, def), "transpose", 0));

  const recordPlayed = (note: PianoRollNote, speed: number, color?: string) => {
    lastPlayed = note;
    const runtime = getRuntime(shapeId);
    const now = instanceNowBeats(shapeId);
    const start = runtime.loopStartBeats ?? now;
    const position = (now - start) * speed;
    const ghost: GhostNote = {
      id: `played_${playedCounter++}`,
      linkTo: note.id,
      pitch: note.pitch,
      position: Math.max(0, position),
      duration: note.duration,
      color: color ?? "#5ad",
      opacity: 0.8,
    };
    ensureRuntime(shapeId).played.push(ghost);
  };

  /** Sound one note as a branch; returns after the note-on has been sent. */
  const soundNote = (note: PianoRollNote, durationBeatsScaled: number, speed: number, color?: string) => {
    const pitch = clampPitch(note.pitch + transposeNow());
    const token = ++soundingCounter;
    const props = readInstanceProps(shapeId);
    const mpe = props ? sendsMpe({ mpe: props.mpe, midiOutputName: outputName }) : false;
    const bendRange = props?.bendRange ?? DEFAULT_BEND_RANGE;
    const channel = mpe ? allocateMemberChannel(outputName) : CHANNEL;
    const key = `${channel}:${pitch}`;
    // Re-triggering a key that is still sounding: release it first.
    release(key);
    const output = currentOutput();
    let sent: ChannelExpression | null = null;
    if (mpe && output) sent = sendExpression(output, channel, note, 0, bendRange, null);
    send("on", channel, pitch, clampPitch(note.velocity));
    active.set(key, { token, channel, pitch });
    recordPlayed(note, speed, color);
    const durationBeats = Math.max(0.01, durationBeatsScaled);
    const handle = ctx.branch(async (noteCtx) => {
      try {
        if (mpe && output && curveChanges(note)) {
          // The note's curves span its duration: step through them while held.
          const seconds = durationBeats * (60 / Math.max(1, noteCtx.bpm ?? 120));
          const steps = Math.max(1, Math.ceil(seconds * MPE_TICK_HZ));
          for (let step = 1; step <= steps; step += 1) {
            await noteCtx.wait(durationBeats / steps);
            if (active.get(key)?.token !== token) return;
            if (step < steps) sent = sendExpression(output, channel, note, step / steps, bendRange, sent);
          }
        } else {
          await noteCtx.wait(durationBeats);
        }
      } finally {
        if (active.get(key)?.token === token) release(key);
      }
    }, `note-${pitch}`);
    handle.finally(() => {}).catch(() => {});
  };

  return {
    ctx,
    shapeId,
    getClip: () => getClip(shapeId)!,
    getParams: () => liveParams(shapeId, def),
    random: () => ctx.random(),
    async playLoop(loop: LoopNotes, options: PlayLoopOptions = {}) {
      const speed = Math.max(0.05, numberParam(liveParams(shapeId, def), "speed", 1));
      const loopLength = loop.loopLength;
      const start = loop.start ?? 0;
      patchRuntime(shapeId, (prev) => ({
        loopStartBeats: instanceNowBeats(shapeId),
        loopOffset: start,
        loopSpeed: speed,
        loopLength,
        played: [],
        loopCount: prev.loopCount + 1,
      }));
      let cursor = start;
      const inWindow = loop.notes.filter((note) => note.position >= start);
      for (const note of notesInLoop(inWindow, start + loopLength)) {
        const delta = note.position - cursor;
        if (delta > 0) await ctx.wait(delta / speed);
        cursor = note.position;
        soundNote(note, note.duration / speed, speed, options.color);
        options.onNoteOn?.(note);
      }
      const tail = start + loopLength - cursor;
      if (tail > 0) await ctx.wait(tail / speed);
    },
    playNote(pitch, velocity, durationBeats, color) {
      const speed = getRuntime(shapeId).loopSpeed || 1;
      const note: PianoRollNote = { id: `adhoc_${playedCounter}`, pitch, velocity, position: 0, duration: durationBeats };
      soundNote(note, durationBeats / speed, speed, color ?? "#e8a");
    },
    publishLoop(loop) {
      patchRuntime(shapeId, loop ? { generated: loop } : { generated: null, loopStartBeats: null, played: [] });
    },
    getCursor() {
      return cursorFromMeta(getEditor()?.getShape(shapeId as TLShapeId)?.meta);
    },
    setMarkers(markers) {
      runnerMarkers.set(shapeId, markers);
    },
    emit(event: RunnerEvent) {
      emitEvent(shapeId as TLShapeId, event);
    },
    onEvent(handler) {
      return onEvent(shapeId, handler);
    },
    lastPlayed: () => lastPlayed,
    log(message) {
      patchRuntime(shapeId, (prev) => ({ logs: [message, ...prev.logs].slice(0, 6) }));
    },
    releaseAll() {
      for (const key of [...active.keys()]) release(key);
    },
  };
}

async function launch(shapeId: string, mode: Exclude<InstanceMode, "idle">): Promise<void> {
  stopInstance(shapeId);
  const props = readInstanceProps(shapeId);
  if (!props) return;
  const def = getRunner(props.runnerType);
  const request = Symbol();
  pendingRuns.set(shapeId, request);
  const output = await getOutput(props.midiOutputName);
  if (pendingRuns.get(shapeId) !== request) return;
  pendingRuns.delete(shapeId);
  if (!output || output.closed) {
    const name = props.midiOutputName;
    const error = isSixSinesOutput(name) ? "Six Sines output unavailable"
      : name ? `MIDI output "${name}" not found` : "no output selected";
    patchRuntime(shapeId, { error });
    return;
  }
  patchRuntime(shapeId, { mode, error: null, played: [], loopCount: 0 });
  const root = getRootContext();
  let api: ReturnType<typeof makeApi> | null = null;
  let stopTempo: (() => void) | null = null;
  const handle = root.branch(async (ctx) => {
    // The run's own tempo (a clone of the root's map), following the
    // instance's tempo prop live
    instanceTempos.set(shapeId, ctx.tempo);
    stopTempo = react(`tempo:${shapeId}`, () => {
      const bpm = readInstanceProps(shapeId)?.tempo;
      if (bpm && Number.isFinite(bpm) && bpm > 0 && Math.abs(ctx.bpm - bpm) > 1e-9) ctx.setBpm(bpm);
    });
    api = makeApi(shapeId, ctx, def, props.midiOutputName, isSixSinesOutput(props.midiOutputName) ? output : null);
    if (mode === "run") {
      await def.run(api);
    } else {
      await playVerbatim(api);
    }
  }, `${mode}:${shapeId}`, { tempo: "cloned" });
  const finish = () => {
    api?.releaseAll();
    stopTempo?.();
    stopTempo = null;
    // A cancelled run's branch settles later, possibly after a new run has
    // started (Play straight to Run); the runtime is the new run's then.
    const current = activeRuns.get(shapeId);
    if (current && current.cancel !== cancel) return;
    activeRuns.delete(shapeId);
    runnerMarkers.delete(shapeId);
    instanceTempos.delete(shapeId);
    patchRuntime(shapeId, { mode: "idle", loopStartBeats: null });
  };
  const cancel = () => {
    handle.cancel();
    finish();
  };
  activeRuns.set(shapeId, { cancel });
  handle.finally(finish).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "aborted" || message === "context canceled") return;
    console.error(`[runner ${shapeId}]`, error);
    patchRuntime(shapeId, { error: message });
  });
}

/** The plain transport: the clip's notes verbatim, looping, transpose applied. */
async function playVerbatim(api: RunnerApi): Promise<void> {
  while (true) {
    const clip = api.getClip();
    const loop = { notes: clip.notes, loopLength: clip.loopLength };
    api.publishLoop(loop);
    await api.playLoop(loop);
  }
}

export function startRun(shapeId: string): void {
  void launch(shapeId, "run");
}

export function startPlay(shapeId: string): void {
  void launch(shapeId, "play");
}

export function stopInstance(shapeId: string): void {
  pendingRuns.delete(shapeId);
  activeRuns.get(shapeId)?.cancel();
}

export function stopAll(): void {
  pendingRuns.clear();
  for (const run of [...activeRuns.values()]) run.cancel();
}

export function isActive(shapeId: string): boolean {
  return activeRuns.has(shapeId);
}

/** Dry-run the algorithm into the Preview roll. */
export function regenerate(shapeId: string): void {
  const props = readInstanceProps(shapeId);
  if (!props) return;
  const def = getRunner(props.runnerType);
  const cursor = cursorFromMeta(getEditor()?.getShape(shapeId as TLShapeId)?.meta);
  const preview = def.generate(getClip(shapeId)!, Math.random, liveParams(shapeId, def), { cursor });
  patchRuntime(shapeId, { preview });
}

/**
 * Per-instance throttle state for regenerateThrottled. Kept here rather than
 * in a view so every mounted view of one instance shares a single rate.
 */
const regenerateThrottles = new Map<string, { last: number; timer: ReturnType<typeof setTimeout> | null; stillWanted: () => boolean }>();

/**
 * regenerate at most once per `intervalMs`: a call after a quiet spell runs
 * now, calls within the interval collapse into one trailing run (which reads
 * the live clip and params, so it lands on the latest input). The trailing
 * run is skipped when the latest `stillWanted` says no.
 */
export function regenerateThrottled(shapeId: string, intervalMs: number, stillWanted: () => boolean = () => true): void {
  let state = regenerateThrottles.get(shapeId);
  if (!state) regenerateThrottles.set(shapeId, (state = { last: -Infinity, timer: null, stillWanted }));
  const throttle = state;
  throttle.stillWanted = stillWanted;
  const run = () => {
    throttle.timer = null;
    throttle.last = performance.now();
    regenerate(shapeId);
  };
  if (throttle.timer) return;
  const wait = intervalMs - (performance.now() - throttle.last);
  if (wait <= 0) run();
  else
    throttle.timer = setTimeout(() => {
      if (throttle.stillWanted()) run();
      else throttle.timer = null;
    }, wait);
}

/** Drop a pending trailing run from regenerateThrottled. */
export function cancelThrottledRegenerate(shapeId: string): void {
  const state = regenerateThrottles.get(shapeId);
  if (state?.timer) clearTimeout(state.timer);
  regenerateThrottles.delete(shapeId);
}

export function clearRuntime(shapeId: string): void {
  cancelThrottledRegenerate(shapeId);
  keyboardKeyUp(shapeId);
  stopInstance(shapeId);
  delete playbackStore.instances[shapeId];
}

export type { Clip };
