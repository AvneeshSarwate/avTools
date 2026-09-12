import type { TimeContext } from "@avtools/core-timing";
import { type SixSinesEvent, SixSinesNode } from "@avtools/six-sines";
import { registerSixSines, subscribeSixSinesChanges } from "six-sines-store";
import type { SixSinesData } from "six-sines-store";

export const SYNTH_NAME = "cursor-chords/synth";
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

export interface SixSinesStartOptions {
  presetUrl?: string | URL;
  presetBytes?: ArrayBuffer | ArrayBufferView | Blob;
}

type SynthState = "idle" | "starting" | "ready" | "failed";

let audioContext: AudioContext | undefined;
let synth: SixSinesNode | undefined;
let state: SynthState = "idle";
let initializationError: Error | undefined;
let generation = 0;
let nextNoteId = 1;
// These are host voice-allocation choices for this chord instrument, reflected
// in the entity/UI too. Disable repeated-pitch reuse even for imported presets.
const VOICE_POLICY = { 523: 0, 526: 64, 529: 0 };
let unsubscribe: (() => void) | undefined;
let parameterLane: Promise<void> = Promise.resolve();

function sendState(
  target: SixSinesNode,
  data: SixSinesData,
  ids?: string[],
): Promise<void> {
  for (const [id, value] of Object.entries(VOICE_POLICY)) {
    data.values[id] = value;
  }
  const preset = data.preset;
  const events = (ids ?? Object.keys(data.values)).map((id) => ({
    type: 4,
    paramId: Number(id),
    value: data.values[id],
  }));
  events.push(
    ...Object.entries(VOICE_POLICY).map(([id, value]) => ({
      type: 4,
      paramId: Number(id),
      value,
    })),
  );
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
    if (bulk || ids.length) {
      reportFailure(
        "parameter update",
        sendState(target, data, bulk ? undefined : ids),
      );
    }
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
      initializationError = error instanceof Error
        ? error
        : new Error(String(error));
      state = "failed";
      closeCandidate(candidate, context);
    });
}

/** Poll startup on the piece's TimeContext, without awaiting browser I/O there. */
export function isSixSinesReady(): boolean {
  if (state === "failed") throw initializationError;
  return state === "ready";
}

/** IDs identify voice instances, never pitches; allocation survives player replacement. */
export function allocateNoteId(): number {
  return nextNoteId++;
}

/** One ordered next-quantum batch for chord edges or all per-note LFO changes. */
export function sendSixSinesEvents(events: SixSinesEvent[]): void {
  if (!synth) throw new Error("Six Sines is not ready");
  if (events.some((event) => event.type === 1)) {
    events = [
      ...Object.entries(VOICE_POLICY).map(([id, value]) => ({
        type: 4,
        paramId: Number(id),
        value,
      })),
      ...events,
    ];
  }
  if (events.length) reportFailure("voice events", synth.send(events));
}

export async function synthStats() {
  return await synth?.stats();
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

  if (activeSynth) {
    reportFailure("all notes off", activeSynth.allNotesOff());
  }
  if (context) {
    closeCandidate(activeSynth, context);
  } else if (activeSynth) {
    reportFailure("dispose", activeSynth.dispose());
  }
}

/** Imports provide the audio helper; only the player owns its running lifetime. */
export default async function describe(ctx: TimeContext) {
  console.log(
    "Run the Cursor chord player; this module provides its audio bridge.",
  );
  await ctx.waitSec(0.05);
}
