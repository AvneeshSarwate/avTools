import type { TimeContext } from "@avtools/core-timing";
import { canvasParams } from "canvas-params";
import { SixSinesNode } from "@avtools/six-sines";
import { registerSixSines, subscribeSixSinesChanges } from "six-sines-store";
import type { SixSinesData } from "six-sines-store";

export const SYNTH_NAME = "sound-design/lead";
const FALLBACK = {
  preset:
    '<patch id="org.baconpaul.six-sines" version="12" name="Init"><params/></patch>',
  values: {},
};
export function soundState(): SixSinesData {
  return registerSixSines(SYNTH_NAME, FALLBACK);
}
// Project Open restores the saved entity; registration also works headlessly.
soundState();

interface PianoRollNote {
  id?: string;
  pitch: number;
  position: number;
  duration: number;
  velocity?: number;
}

interface PianoRollLike {
  data: { notes: PianoRollNote[] };
}

export interface SixSinesStartOptions {
  presetUrl?: string | URL;
  presetBytes?: ArrayBuffer | ArrayBufferView | Blob;
}

export interface SixSinesPianoRollOptions {
  secondsPerBeat?: number;
  gate?: number;
  velocity?: number;
}

type SynthState = "idle" | "starting" | "ready" | "failed";

let audioContext: AudioContext | undefined;
let synth: SixSinesNode | undefined;
let state: SynthState = "idle";
let initializationError: Error | undefined;
let generation = 0;
let nextNoteId = 1;
const activeNotes = new Map<number, number>();
let unsubscribe: (() => void) | undefined;
let parameterLane: Promise<void> = Promise.resolve();

function sendState(
  target: SixSinesNode,
  data: SixSinesData,
  ids?: string[],
): Promise<void> {
  const preset = data.preset;
  const events = (ids ?? Object.keys(data.values)).map((id) => ({
    type: 4,
    paramId: Number(id),
    value: data.values[id],
  }));
  const currentGeneration = generation;
  parameterLane = parameterLane.then(async () => {
    if (generation !== currentGeneration) return;
    if (!ids) await target.loadPreset(new TextEncoder().encode(preset));
    if (generation !== currentGeneration) return;
    if (events.length) await target.send(events);
  });
  return parameterLane;
}

function bindParameters(target: SixSinesNode): Promise<void> {
  parameterLane = Promise.resolve();
  unsubscribe = subscribeSixSinesChanges(SYNTH_NAME, (patches, data) => {
    const bulk = patches.some(
      (p) =>
        p.path[0] === "data" &&
        (p.path.length < 3 || p.path[1] === "preset" || p.op === "delete"),
    );
    const ids = [
      ...new Set(
        patches
          .filter(
            (p) =>
              p.path[0] === "data" &&
              p.path[1] === "values" &&
              p.path.length === 3,
          )
          .map((p) => p.path[2]!),
      ),
    ];
    if (bulk || ids.length)
      reportFailure(
        "parameter update",
        sendState(target, data, bulk ? undefined : ids),
      );
  });
  return sendState(target, soundState());
}

function reportFailure(operation: string, promise: Promise<unknown>): void {
  void promise.catch((error) => {
    console.error(`[six-sines] ${operation} failed`, error);
  });
}

function closeCandidate(
  candidate: SixSinesNode | undefined,
  context: AudioContext,
): void {
  try {
    candidate?.disconnect();
  } catch {
    // A candidate which failed before connect has nothing to disconnect.
  }
  const closeContext = () => {
    reportFailure("AudioContext close", context.close());
  };
  if (!candidate) {
    closeContext();
    return;
  }
  // Let the worklet acknowledge disposal before closing the context which
  // drives it. Closing both concurrently can strand the dispose response.
  void candidate.dispose().then(closeContext, (error) => {
    console.error("[six-sines] dispose failed", error);
    closeContext();
  });
}

/**
 * Start loading the worklet/Wasm without blocking livecode logical time.
 * Calling this again while ready/starting is a no-op. Supply a native `.sxsnp`
 * URL or bytes here to use a preset saved by the paired CLAP build.
 */
export function startSixSines(options: SixSinesStartOptions = {}): void {
  if (state === "starting" || state === "ready") return;

  const thisGeneration = ++generation;
  const context = new AudioContext({ latencyHint: "interactive" });
  audioContext = context;
  state = "starting";
  initializationError = undefined;
  let candidate: SixSinesNode | undefined;

  void SixSinesNode.create(context, options)
    .then((created) => {
      candidate = created;
      if (generation !== thisGeneration) {
        closeCandidate(candidate, context);
        return undefined;
      }
      created.connect(context.destination);
      return context.resume();
    })
    .then(async () => {
      if (!candidate || generation !== thisGeneration) return;
      if (context.state !== "running") {
        throw new Error(
          "AudioContext is suspended; click once in the ENGINE tab and run the player again",
        );
      }
      await bindParameters(candidate);
      if (generation !== thisGeneration) return;
      synth = candidate;
      state = "ready";
      console.log(
        `[six-sines] AudioWorklet ready (${candidate.readyInfo.buildId})`,
      );
    })
    .catch((error) => {
      if (generation !== thisGeneration) return;
      initializationError =
        error instanceof Error ? error : new Error(String(error));
      state = "failed";
      closeCandidate(candidate, context);
    });
}

function requireSynth(): SixSinesNode {
  if (!synth) {
    throw initializationError ?? new Error("Six Sines is not ready");
  }
  return synth;
}

/** Fire a note now and return the CLAP-style note identity used to address it. */
export function noteOnSixSines(key: number, velocity = 1): number {
  const activeSynth = requireSynth();
  const noteId = nextNoteId++;
  const clampedKey = Math.max(0, Math.min(127, Math.round(key)));
  activeNotes.set(noteId, clampedKey);
  reportFailure(
    "note on",
    activeSynth.noteOn({
      noteId,
      key: clampedKey,
      velocity: Math.max(0, Math.min(1, velocity)),
    }),
  );
  return noteId;
}

/** Release one note by the identity returned from `noteOnSixSines`. */
export function noteOffSixSines(noteId: number): void {
  const key = activeNotes.get(noteId);
  if (key === undefined) return;
  activeNotes.delete(noteId);
  if (synth) reportFailure("note off", synth.noteOff({ noteId, key }));
}

/** Address one active note with native CLAP `CLAP_EVENT_PARAM_MOD` semantics. */
export function modulateSixSinesNote(
  noteId: number,
  paramId: number,
  amount: number,
): void {
  const key = activeNotes.get(noteId);
  if (key === undefined) {
    throw new Error(`Six Sines note ${noteId} is not active`);
  }
  reportFailure(
    "per-note parameter modulation",
    requireSynth().paramMod({
      noteId,
      key,
      paramId,
      amount,
    }),
  );
}

/** Set one global parameter immediately by its stable CLAP parameter ID. */
export function setSixSinesParameter(paramId: number, value: number): void {
  reportFailure(
    "parameter value",
    requireSynth().paramValue({ paramId, value }),
  );
}

/**
 * Play an editable livecode piano roll with untimed, next-quantum synth calls.
 * Startup polling uses the project scheduler, while note timing stays in the
 * caller's TimeContext. Each note-off is also registered as cancel cleanup.
 */
export async function playPianoRollWithSixSines(
  ctx: TimeContext,
  roll: PianoRollLike,
  options: SixSinesPianoRollOptions = {},
): Promise<void> {
  startSixSines();
  let startupPolls = 0;
  while (state === "starting" || state === "idle") {
    if (startupPolls++ >= 100) {
      throw new Error("Timed out waiting for the Six Sines AudioWorklet");
    }
    await ctx.waitSec(0.05);
  }
  if (state === "failed") throw initializationError;

  const notes = roll.data.notes
    .filter((note) => note.duration > 0)
    .slice()
    .sort((a, b) => a.position - b.position);
  const secondsPerBeat = options.secondsPerBeat ?? 0.25;
  const gate = options.gate ?? 0.9;
  const clipDuration = notes.reduce(
    (duration, note) => Math.max(duration, note.position + note.duration),
    0,
  );
  let cursorBeat = 0;

  for (const note of notes) {
    const waitBeats = Math.max(0, note.position - cursorBeat);
    if (waitBeats > 0) await ctx.waitSec(waitBeats * secondsPerBeat);

    const velocity127 = options.velocity ?? note.velocity ?? 100;
    const noteId = noteOnSixSines(note.pitch, velocity127 / 127);
    const durationSec = Math.max(0.01, note.duration * secondsPerBeat * gate);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      noteOffSixSines(noteId);
    };
    const handle = ctx.branch(async (noteCtx) => {
      try {
        await noteCtx.waitSec(durationSec);
      } finally {
        release();
      }
    }, `six-sines-note-${noteId}`);
    handle.handleCancel(release);
    cursorBeat = note.position;
  }

  const tailBeats = Math.max(0, clipDuration - cursorBeat);
  if (tailBeats > 0) await ctx.waitSec(tailBeats * secondsPerBeat);
}

/** Panic, dispose the worklet, and close the owning AudioContext. Idempotent. */
export function stopSixSines(): void {
  ++generation;
  unsubscribe?.();
  unsubscribe = undefined;
  const activeSynth = synth;
  const context = audioContext;
  synth = undefined;
  audioContext = undefined;
  state = "idle";
  initializationError = undefined;
  activeNotes.clear();

  if (activeSynth) {
    reportFailure("all notes off", activeSynth.allNotesOff());
  }
  if (context) {
    closeCandidate(activeSynth, context);
  } else if (activeSynth) {
    reportFailure("dispose", activeSynth.dispose());
  }
}

/**
 * Canvas-visible helper module. Its timed root is intentionally a no-op:
 * player imports use the stable `./six-sines.ts` instance and own lifecycle.
 */
export default async function describeSixSinesHelpers(ctx: TimeContext) {
  console.log("[six-sines] helper module; run the Six Sines loop player");
  await ctx.waitSec(0.05);
}

export function getControls() {
  return canvasParams(
    "sound-design/controls",
    {
      playback: { secondsPerBeat: 0.3, gate: 0.85 },
      pan: {
        op1: false,
        op2: false,
        op3: false,
        op4: false,
        op5: false,
        op6: false,
        rateHz: 0.3,
        depth: 0.85,
      },
    },
    {
      playback: {
        secondsPerBeat: {
          label: "seconds per beat",
          min: 0.1,
          max: 1,
          step: 0.01,
        },
        gate: { min: 0.1, max: 1, step: 0.01 },
      },
      pan: {
        op1: { label: "Operator 1 pan LFO" },
        op2: { label: "Operator 2 pan LFO" },
        op3: { label: "Operator 3 pan LFO" },
        op4: { label: "Operator 4 pan LFO" },
        op5: { label: "Operator 5 pan LFO" },
        op6: { label: "Operator 6 pan LFO" },
        rateHz: { label: "LFO rate (Hz)", min: 0.02, max: 4, step: 0.01 },
        depth: { label: "pan depth", min: 0, max: 1, step: 0.01 },
      },
    },
  );
}
