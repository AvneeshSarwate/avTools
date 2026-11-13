import type { TimeContext } from "@avtools/core-timing";
import { AbletonClip } from "@avtools/music-types";
import * as events from "canvas-events";
import * as ui from "ui-events";
import { signal } from "canvas-signals";
import { getPianoRoll } from "piano-roll-store";
import { getPianoRollClip, setPianoRollClip } from "piano-roll-helpers";
import {
  getMidiDevice,
  listMidiInputs,
  type MidiInput,
  type MidiInputEvent,
  openMidiInput,
} from "midi-helpers";
import {
  beatstep,
  declareBeatstep,
  declareTransport,
  melodies,
  transport,
} from "./controls.ts";
import { type MelodyName, melodyNames, sources } from "./sources.ts";
import { createNoteOutput, playClip } from "./playback.ts";
import { createPipeline } from "./pipeline.ts";
import { createBeatstepController } from "./beatstep.ts";
import {
  createClockMapper,
  createTakeRecorder,
  takeToRollNotes,
} from "./recording.ts";

export default async function run(ctx: TimeContext) {
  for (const name of melodyNames) {
    if (!getPianoRoll(`sonar/${name}`)) {
      const s = sources[name];
      setPianoRollClip(
        `sonar/${name}`,
        new AbletonClip(s.name, s.duration, s.notes),
      );
    }
  }
  const outputs = new Map<string, ReturnType<typeof createNoteOutput>>();
  const output = (name: string) => {
    const key = `${transport.dryRun ? "dry" : "midi"}/${name}`;
    if (!outputs.has(key)) {
      outputs.set(
        key,
        createNoteOutput(transport.dryRun ? undefined : getMidiDevice(name)),
      );
    }
    return outputs.get(key)!;
  };
  // These are intentionally three distinct pipeline instances and live objects.
  const pipelines = {
    dscale5: createPipeline(melodies.dscale5),
    dscale7: createPipeline(melodies.dscale7),
    d7mel: createPipeline(melodies.d7mel),
  };
  type Handle = ReturnType<TimeContext["branch"]>;
  const active = new Map<MelodyName, Set<Handle>>(
    melodyNames.map((n) => [n, new Set()]),
  );
  const gates = new Map<string, Handle>();
  const pending: events.LivecodeEvent[] = [];
  events.onEvent((event) => {
    if (
      event.type === "sonar/trigger" || event.type === "sonar/stop" ||
      event.type === "sonar/preview"
    ) {
      pending.push(event);
    }
  });

  // Roll data has no loop-length field: keep the recorded take's length, or
  // the original's trailing silence, extending it if an edit adds notes
  // beyond the phrase.
  const phraseSource = (name: MelodyName) => {
    const source = getPianoRollClip(`sonar/${name}`);
    const minimumBeats = melodies[name].takeLength > 0
      ? melodies[name].takeLength
      : sources[name].duration;
    source.duration = Math.max(source.duration, minimumBeats);
    return source;
  };
  const secondsPerBeatNow = () =>
    60 / Math.max(20, Math.min(300, transport.bpm));
  const channelNow = () =>
    Math.max(0, Math.min(15, Math.round(transport.channel)));

  // Preview: the roll as written on the base output, with a playhead on the
  // roll. A second press restarts it; the melody's stop ends it.
  const previewHeads = new Map(melodyNames.map((name) => {
    const head = signal<number | null>(`sonar/${name}/preview`);
    head.addAnchor({ type: "pianoRoll", name: `sonar/${name}` });
    return [name, head];
  }));
  const previews = new Map<MelodyName, Handle>();
  const startPreview = (name: MelodyName) => {
    previews.get(name)?.cancel();
    const clip = phraseSource(name);
    const out = output(transport.baseOutput);
    const channel = channelNow();
    const secondsPerBeat = secondsPerBeatNow();
    const head = previewHeads.get(name)!;
    const stepBeats = 1 / 16;
    const handle = ctx.branch(async (previewCtx) => {
      await Promise.all([
        previewCtx.branchWait(async (playCtx) => {
          await playClip(playCtx, clip, {
            output: out,
            channel,
            secondsPerBeat,
            gate: 0.98,
          });
        }),
        previewCtx.branchWait(async (headCtx) => {
          for (let beat = 0; beat < clip.duration; beat += stepBeats) {
            head.set(beat);
            await headCtx.waitSec(stepBeats * secondsPerBeat);
          }
        }),
      ]);
    }, `${name}/preview`);
    previews.set(name, handle);
    active.get(name)!.add(handle);
    void handle.finally(() => {
      active.get(name)!.delete(handle);
      if (previews.get(name) !== handle) return;
      previews.delete(name);
      head.set(null);
    }).catch(() => {});
  };

  // MIDI inputs: a keyboard to record from and the BeatStep. Both selectors
  // list the ports visible now and refresh while this runs.
  const now = () => ctx.scheduler.now();
  let inputNames: string[] = [];
  const refreshInputNames = () => {
    const names = listMidiInputs().map((port) => port.name);
    if (names.join("\n") === inputNames.join("\n")) return;
    inputNames = names;
    declareTransport(inputNames);
    declareBeatstep(inputNames);
  };
  refreshInputNames();
  // Pick a connected BeatStep (not a BeatStep Pro) if none is chosen yet.
  if (!beatstep.device) {
    beatstep.device = inputNames.find((name) =>
      /beatstep/i.test(name) && !/pro/i.test(name)
    ) ?? "";
  }

  // Recording: one recorder per bank, all fed by the record input. A toggle
  // left on by an earlier run must not start a take by itself.
  const clock = createClockMapper(now);
  const recorders = new Map(
    melodyNames.map((name) => [name, createTakeRecorder()]),
  );
  for (const name of melodyNames) melodies[name].record = false;
  let recordInput: MidiInput | null = null;
  let recordInputName = "";

  // The BeatStep: pads trigger through the same queue as the canvas buttons.
  let beatstepInput: MidiInput | null = null;
  let beatstepName = "";
  const ledOutput = () => {
    try {
      return beatstep.device ? getMidiDevice(beatstep.device) : null;
    } catch {
      return null;
    }
  };
  const controller = createBeatstepController({
    melodies,
    settings: beatstep,
    trigger: (event) => pending.push(event),
    // A pad lights on a note-on for its note and clears on a real note-off;
    // the BeatStep does not treat a velocity-0 note-on as off.
    setLed: (note, on, channel) =>
      on
        ? ledOutput()?.noteOn(channel, note, 127)
        : ledOutput()?.noteOff(channel, note, 0),
    focusCanvas: (name) =>
      ui.send({
        type: "tldraw.focusEntity",
        body: { type: "params", name: `sonar/${name}`, zoom: "keep" },
      }),
  });

  // Takes the context so the analyzer sees a timed helper; the input closes
  // when the context is cancelled (Stop, Replace, Panic).
  const openInput = async (
    inputCtx: TimeContext,
    name: string,
    onEvent: (event: MidiInputEvent) => void,
  ): Promise<MidiInput | null> => {
    if (!name) return null;
    try {
      const input = await openMidiInput(name, inputCtx);
      input.onMessage(onEvent);
      return input;
    } catch (error) {
      console.warn(`[sonar] could not open MIDI input ${name}`, error);
      return null;
    }
  };

  let nextInputScan = 0;
  try {
    while (true) {
      ctx.setBpm(transport.bpm);

      if (now() >= nextInputScan) {
        nextInputScan = now() + 1;
        refreshInputNames();
      }
      if (transport.recordInput !== recordInputName) {
        recordInput?.close();
        recordInputName = transport.recordInput;
        clock.reset();
        recordInput = await openInput(ctx, recordInputName, (event) => {
          const sec = clock.toEngineSec(event);
          for (const recorder of recorders.values()) {
            recorder.handle(event, sec);
          }
        });
      }
      if (beatstep.device !== beatstepName) {
        controller.allLedsOff();
        beatstepInput?.close();
        beatstepName = beatstep.device;
        beatstepInput = await openInput(ctx, beatstepName, controller.handle);
        beatstep.status = !beatstepName
          ? "no device"
          : !beatstepInput
          ? `could not open ${beatstepName}`
          : ledOutput()
          ? `listening to ${beatstepName}`
          : `listening to ${beatstepName} (no LED output)`;
        controller.resendLeds();
      }

      for (const name of melodyNames) {
        const p = melodies[name];
        const recorder = recorders.get(name)!;
        if (p.record && !recorder.recording) {
          recorder.start(now());
          p.recordStatus = recordInput
            ? "recording"
            : "recording (no record input selected)";
        } else if (!p.record && recorder.recording) {
          const notes = recorder.finish(now());
          if (!notes) {
            p.recordStatus = "no notes recorded; roll unchanged";
            continue;
          }
          const take = takeToRollNotes(notes, {
            secondsPerBeat: secondsPerBeatNow(),
            quantize: transport.recordQuantize,
          });
          const written = setPianoRollClip(`sonar/${name}`, {
            notes: take.notes,
          });
          p.takeLength = take.lengthBeats;
          if (written.ok && transport.fitAfterRecording) {
            // The rev lets each view fit once it has the take, since this
            // event is not ordered against the roll's own sync.
            ui.send({
              type: "tldraw.fitPianoRoll",
              body: { name: `sonar/${name}`, rev: written.roll.rev },
            });
          }
          p.recordStatus =
            `wrote ${take.notes.length} notes, ${take.lengthBeats} beats`;
        }
      }
      controller.refreshLeds();
      for (const event of pending.splice(0)) {
        const body = event.body;
        if (!body || !Object.hasOwn(pipelines, body.melody)) continue;
        const name = body.melody as MelodyName;
        const gateKey = `${name}/${body.origin ?? "ui"}`;
        if (event.type === "sonar/stop") {
          if (body.state === "down") {
            for (const task of active.get(name)!) task.cancel();
          }
          continue;
        }
        if (event.type === "sonar/preview") {
          if (body.state !== "down") continue;
          try {
            startPreview(name);
          } catch (error) {
            console.error(`[sonar] ${name} preview:`, error);
          }
          continue;
        }
        if (body.mode !== "oneShot" && body.mode !== "gate") continue;
        if (body.state === "up") {
          if (body.mode === "gate") {
            gates.get(gateKey)?.cancel();
            gates.delete(gateKey);
          }
          continue;
        }
        if (body.state !== "down") continue;
        if (body.mode === "gate") gates.get(gateKey)?.cancel();
        const pipeline = pipelines[name];
        const base = pipeline.base(phraseSource(name));
        const delayBeats = pipeline.delayBeats();
        const p = melodies[name];
        const secondsPerBeat = secondsPerBeatNow();
        const channel = channelNow();
        try {
          const baseOut = output(transport.baseOutput);
          const delayOut = p.delayEnabled
            ? output(transport.delayOutput)
            : baseOut;
          // Preserve the old external s6 mapping; the rack decides note-length meaning.
          if (!transport.dryRun) {
            getMidiDevice(transport.baseOutput).cc(
              channel,
              76,
              p.noteLength * 127,
            );
          }
          const handle = ctx.branch(async (phraseCtx) => {
            await Promise.all([
              phraseCtx.branchWait(async (baseCtx) => {
                await playClip(baseCtx, base, {
                  output: baseOut,
                  channel,
                  secondsPerBeat,
                  gate: 0.98,
                });
              }),
              phraseCtx.branchWait(async (delayCtx) => {
                if (!p.delayEnabled) return;
                await delayCtx.waitSec(delayBeats * secondsPerBeat);
                // As in the original, delay knobs are sampled when the echo begins.
                const echo = pipeline.delay(base);
                await playClip(delayCtx, echo, {
                  output: delayOut,
                  channel,
                  secondsPerBeat,
                  gate: 0.98,
                });
              }),
            ]);
          }, `${name}/${body.mode}`);
          active.get(name)!.add(handle);
          if (body.mode === "gate") gates.set(gateKey, handle);
          void handle.finally(() => {
            active.get(name)!.delete(handle);
            if (gates.get(gateKey) === handle) gates.delete(gateKey);
          }).catch(() => {});
        } catch (error) {
          console.error(`[sonar] ${name}:`, error);
        }
      }
      await ctx.waitSec(0.005);
    }
  } finally {
    for (const tasks of active.values()) {
      for (const task of tasks) task.cancel();
    }
    for (const port of outputs.values()) port.release();
    pending.length = 0;
    // An unfinished take is discarded; the roll keeps its last saved notes.
    for (const [name, recorder] of recorders) {
      if (recorder.recording) melodies[name].recordStatus = "take discarded";
      recorder.cancel();
      melodies[name].record = false;
    }
    controller.allLedsOff();
    recordInput?.close();
    beatstepInput?.close();
    beatstep.status = "player stopped";
  }
}
