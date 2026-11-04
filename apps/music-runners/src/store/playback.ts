// Per-instance run state and the loop that drives a runner. Run state is
// never persisted; it belongs to this page session.
import type { TimeContext } from "@avtools/core-timing";
import type { MidiOutput } from "@avtools/midi/browser";
import type { TLShapeId } from "tldraw";
import type { Bank, RunnerEvent } from "../model/types";
import type { GhostNote, PianoRollNote } from "../pianoRoll/types";
import { getRunner } from "../runners/registry";
import {
  BASE_PARAMS,
  clampPitch,
  defaultParams,
  type LoopNotes,
  notesInLoop,
  type Params,
  type PlayLoopOptions,
  type RunnerApi,
  type RunnerDefinition,
} from "../runners/runnerTypes";
import { getBank } from "./banks";
import { getRootContext, nowBeats } from "./clock";
import { getEditor } from "./editorRef";
import { emitEvent, onEvent } from "./events";
import { getOutput, getOutputSync } from "./midi";
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
  /** For the playhead: beat position of the current loop's start and its speed. */
  loopStartBeats: number | null;
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

/** Playhead position in roll beats for the instance's current loop, or null. */
export function playheadBeats(runtime: InstanceRuntime): number | null {
  if (runtime.loopStartBeats === null || runtime.mode === "idle") return null;
  const elapsed = (nowBeats() - runtime.loopStartBeats) * runtime.loopSpeed;
  if (elapsed < 0) return 0;
  return elapsed;
}

interface ActiveRun {
  cancel: () => void;
}

const activeRuns = new Map<string, ActiveRun>();

/** What the shape stores; read live so slider moves land mid-run. */
export interface InstanceProps {
  runnerType: string;
  bankId: string;
  midiOutputName: string;
  params: Params;
}

function readInstanceProps(shapeId: string): InstanceProps | null {
  const editor = getEditor();
  const shape = editor?.getShape(shapeId as TLShapeId);
  if (!shape) return null;
  const props = shape.props as Partial<InstanceProps>;
  if (typeof props.runnerType !== "string" || typeof props.bankId !== "string") return null;
  return {
    runnerType: props.runnerType,
    bankId: props.bankId,
    midiOutputName: props.midiOutputName ?? "",
    params: props.params ?? {},
  };
}

function liveParams(shapeId: string, def: RunnerDefinition): Params {
  const props = readInstanceProps(shapeId);
  return { ...defaultParams(def), ...(props?.params ?? {}) };
}

const NOTE_OFF_VELOCITY = 0;
const CHANNEL = 0;

/** Audition a note on the instance's output (Ableton-style click preview). */
export function auditionNote(shapeId: string, pitch: number, velocity: number, durationMs = 180): void {
  const props = readInstanceProps(shapeId);
  if (!props) return;
  const transpose = Math.round(props.params.transpose ?? 0);
  const sounding = clampPitch(pitch + transpose);
  const play = (output: MidiOutput | null) => {
    if (!output || output.closed) return;
    output.noteOn(CHANNEL, sounding, velocity);
    window.setTimeout(() => {
      if (!output.closed) output.noteOff(CHANNEL, sounding, NOTE_OFF_VELOCITY);
    }, durationMs);
  };
  const open = getOutputSync(props.midiOutputName);
  if (open) play(open);
  else void getOutput(props.midiOutputName).then(play);
}

function makeApi(shapeId: string, ctx: TimeContext, def: RunnerDefinition, outputName: string): RunnerApi & { releaseAll(): void } {
  // pitch -> token of the sounding that owns the note-off. A retrigger of a
  // pitch replaces the token so the earlier branch's release becomes a no-op.
  const active = new Map<number, number>();
  let lastPlayed: PianoRollNote | null = null;
  let playedCounter = 0;
  let soundingCounter = 0;

  const send = (kind: "on" | "off", pitch: number, velocity: number) => {
    const output = getOutputSync(outputName);
    if (!output || output.closed) return;
    if (kind === "on") output.noteOn(CHANNEL, pitch, velocity);
    else output.noteOff(CHANNEL, pitch, NOTE_OFF_VELOCITY);
  };

  const transposeNow = () => Math.round(liveParams(shapeId, def).transpose ?? 0);

  const recordPlayed = (note: PianoRollNote, speed: number, color?: string) => {
    lastPlayed = note;
    const runtime = getRuntime(shapeId);
    const start = runtime.loopStartBeats ?? nowBeats();
    const position = (nowBeats() - start) * speed;
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
    // Re-triggering a pitch that is still sounding: release it first.
    if (active.has(pitch)) send("off", pitch, 0);
    send("on", pitch, clampPitch(note.velocity));
    active.set(pitch, token);
    recordPlayed(note, speed, color);
    const handle = ctx.branch(async (noteCtx) => {
      try {
        await noteCtx.wait(Math.max(0.01, durationBeatsScaled));
      } finally {
        if (active.get(pitch) === token) {
          active.delete(pitch);
          send("off", pitch, 0);
        }
      }
    }, `note-${pitch}`);
    handle.finally(() => {}).catch(() => {});
  };

  return {
    ctx,
    shapeId,
    getBank: () => {
      const props = readInstanceProps(shapeId);
      const bank = props ? getBank(props.bankId) : undefined;
      if (!bank) throw new Error("instance has no bank");
      return bank;
    },
    getParams: () => liveParams(shapeId, def),
    random: () => ctx.random(),
    async playLoop(loop: LoopNotes, options: PlayLoopOptions = {}) {
      const speed = Math.max(0.05, liveParams(shapeId, def).speed ?? 1);
      const loopLength = loop.loopLength;
      patchRuntime(shapeId, (prev) => ({
        loopStartBeats: nowBeats(),
        loopSpeed: speed,
        loopLength,
        played: [],
        loopCount: prev.loopCount + 1,
      }));
      let cursor = 0;
      for (const note of notesInLoop(loop.notes, loopLength)) {
        const delta = note.position - cursor;
        if (delta > 0) await ctx.wait(delta / speed);
        cursor = note.position;
        soundNote(note, note.duration / speed, speed, options.color);
        options.onNoteOn?.(note);
      }
      const tail = loopLength - cursor;
      if (tail > 0) await ctx.wait(tail / speed);
    },
    playNote(pitch, velocity, durationBeats, color) {
      const speed = getRuntime(shapeId).loopSpeed || 1;
      const note: PianoRollNote = { id: `adhoc_${playedCounter}`, pitch, velocity, position: 0, duration: durationBeats };
      soundNote(note, durationBeats / speed, speed, color ?? "#e8a");
    },
    publishLoop(loop) {
      patchRuntime(shapeId, { generated: loop });
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
      for (const pitch of active.keys()) send("off", pitch, 0);
      active.clear();
    },
  };
}

async function launch(shapeId: string, mode: Exclude<InstanceMode, "idle">): Promise<void> {
  stopInstance(shapeId);
  const props = readInstanceProps(shapeId);
  if (!props) return;
  const def = getRunner(props.runnerType);
  const bank = getBank(props.bankId);
  if (!bank) {
    patchRuntime(shapeId, { error: "no bank selected" });
    return;
  }
  const output = await getOutput(props.midiOutputName);
  if (!output) {
    patchRuntime(shapeId, { error: props.midiOutputName ? `MIDI output "${props.midiOutputName}" not found` : "no MIDI output selected" });
    return;
  }
  // The await above may have raced a Stop or another Start.
  if (activeRuns.has(shapeId)) return;
  patchRuntime(shapeId, { mode, error: null, played: [], loopCount: 0 });
  const root = getRootContext();
  let api: ReturnType<typeof makeApi> | null = null;
  const handle = root.branch(async (ctx) => {
    api = makeApi(shapeId, ctx, def, props.midiOutputName);
    if (mode === "run") {
      await def.run(api);
    } else {
      await playVerbatim(api);
    }
  }, `${mode}:${shapeId}`);
  const finish = () => {
    api?.releaseAll();
    if (activeRuns.get(shapeId)?.cancel === cancel) activeRuns.delete(shapeId);
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

/** The plain transport: the bank's notes verbatim, looping, transpose applied. */
async function playVerbatim(api: RunnerApi): Promise<void> {
  while (true) {
    const bank = api.getBank();
    const loop = { notes: bank.notes, loopLength: bank.loopLength };
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
  activeRuns.get(shapeId)?.cancel();
}

export function stopAll(): void {
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
  const bank = getBank(props.bankId);
  if (!bank) return;
  const preview = def.generate(bank, Math.random);
  patchRuntime(shapeId, { preview });
}

export function clearRuntime(shapeId: string): void {
  stopInstance(shapeId);
  delete playbackStore.instances[shapeId];
}

export { BASE_PARAMS };
export type { Bank };
