// Runtime of the split-sweep sketch: one drone voice per sounding region, the
// level (ramp in/out) and mix (A <-> B sweep) animations, and the frame loop
// that turns them into Six Sines events. Plain objects, no React: the canvas
// reads `display()` each frame.
//
// Timing is core-timing throughout. A Track moves a phase u in 0..1 linearly
// at 1/duration per second; its value at any time is computed from where and
// when it last changed direction, so the frame loop can read it at the frame's
// own time. Each move is a branch of the root context that waits until the
// phase arrives and then fires the arrival callback (the 50% follow-on sweep,
// the note-off after a fade). Reversing a move restarts that branch.
// The visible / audible value is logisticSigmoid(u, sharpness), so a reversal
// mid-sweep retraces the same curve.
import { type MidiInputEvent } from "@avtools/midi/browser";
import { snapshot, subscribe } from "valtio";
import { ClapNoteExpression, SixSinesEventType, type SixSinesEvent } from "../../../../../packages/six-sines/six-sines-node.js";
import { audioContext } from "../../shared/audio";
import { asBrowser, rootContext } from "../../shared/clock";
import { onUpdate } from "../../shared/frameLoop";
import { logisticSigmoid } from "../../shared/logisticSigmoid";
import { setMidiListener } from "../../shared/midiInput";
import { SixSinesSynth } from "../../shared/sixSines/synth";
import { hexToRgb, regionPitches, type Region } from "./model";
import { doc, findRegion, ui } from "./store";

/** Macro 1..3 Level take the colour's R, G, B (0..1); Macro 4 Level takes the fade level. */
const MACRO_LEVEL_IDS = [40000, 40250, 40500, 40750] as const;
const DRONE_VELOCITY = 0.8;
const PITCH_BEND_RANGE = 2;
/** Seconds for a region to fade on (first click) or off (right click); the A/B sweep uses the region's slide duration. */
const FADE_SEC = 0.2;

const now = () => rootContext().scheduler.now();
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

class Track {
  private u0 = 0;
  private t0 = 0;
  private duration = 1;
  /** +1 / -1 while moving, 0 at rest. */
  dir: -1 | 0 | 1 = 0;
  private waiter: { cancel(): void } | null = null;

  value(t = now()): number {
    if (this.dir === 0) return this.u0;
    return clamp01(this.u0 + (this.dir * (t - this.t0)) / this.duration);
  }

  get moving() {
    return this.dir !== 0;
  }

  go(dir: -1 | 1, durationSec: number, onArrive?: () => void) {
    const t = now();
    const u = this.value(t);
    this.waiter?.cancel();
    this.waiter = null;
    this.u0 = u;
    this.t0 = t;
    this.duration = Math.max(0.001, durationSec);
    this.dir = dir;
    const remaining = (dir > 0 ? 1 - u : u) * this.duration;
    const waiter = rootContext().branch(async (ctx) => {
      try {
        await asBrowser(ctx).waitSec(remaining);
      } catch {
        return; // reversed or stopped: a newer move owns the track
      }
      if (this.waiter !== waiter) return;
      this.waiter = null;
      this.u0 = dir > 0 ? 1 : 0;
      this.dir = 0;
      onArrive?.();
    }, "track");
    this.waiter = waiter;
  }

  set(u: number) {
    this.waiter?.cancel();
    this.waiter = null;
    this.u0 = clamp01(u);
    this.dir = 0;
  }
}

class RegionVoice {
  readonly level = new Track();
  readonly mix = new Track();
  /** What clicks aim for: 1 sounding, 0 off (or fading out). */
  levelTarget: 0 | 1 = 0;
  noteId: number | null = null;
  key = 60;
  /** Last values sent: tuning, macro 1..4. NaN forces a send. */
  sent = [NaN, NaN, NaN, NaN, NaN];
  /** Curved values for drawing, refreshed every frame. */
  shown = { level: 0, mix: 0 };
}

export interface RegionDisplay {
  level: number;
  mix: number;
}

const OFF: RegionDisplay = { level: 0, mix: 0 };

class SweepEngine {
  private voices = new Map<string, RegionVoice>();
  private synth: SixSinesSynth | null = null;
  private live: SixSinesSynth | null = null;
  private nextNoteId = 1;
  private previewNote: { noteId: number; key: number } | null = null;
  private liveNotes = new Map<string, { noteId: number; key: number; channel: number }>();
  private liveBend = new Map<number, number>();
  private started = false;

  /** Start audio (from a user gesture) and the frame loop. */
  start() {
    if (this.started) {
      audioContext();
      return;
    }
    this.started = true;
    const context = audioContext();
    this.synth = new SixSinesSynth(context, () => this.retrigger());
    this.live = new SixSinesSynth(context, () => this.liveNotes.clear());
    // Notes sent while the worklet was loading were dropped: sound them now.
    void this.synth.ready.then(() => this.retrigger(), () => {});
    const syncPatch = () => {
      const patch = snapshot(doc).synth;
      this.synth?.setPatch(patch);
      this.live?.setPatch(patch);
    };
    syncPatch();
    subscribe(doc, syncPatch);
    setMidiListener((event) => this.onMidi(event));
  }

  get audioStarted() {
    return this.started;
  }

  display(id: string): RegionDisplay {
    return this.voices.get(id)?.shown ?? OFF;
  }

  private voice(id: string) {
    let voice = this.voices.get(id);
    if (!voice) this.voices.set(id, (voice = new RegionVoice()));
    return voice;
  }

  /** Left click: ramp in A (then maybe sweep to B), or sweep / reverse the sweep. */
  trigger(id: string) {
    const region = findRegion(id);
    if (!region) return;
    const voice = this.voice(id);
    if (voice.levelTarget === 0) {
      if (voice.noteId === null) {
        // From silence it starts on A; caught mid fade-out it keeps its place.
        if (voice.level.value() <= 0) voice.mix.set(0);
        else voice.mix.set(voice.mix.value());
        this.noteOn(voice, region);
      }
      voice.levelTarget = 1;
      voice.level.go(1, FADE_SEC, () => {
        if (rootContext().random() < 0.5) this.sweep(id);
      });
      return;
    }
    if (voice.level.moving) return; // still ramping in
    this.sweep(id);
  }

  private sweep(id: string) {
    const region = findRegion(id);
    const voice = this.voices.get(id);
    if (!region || !voice || voice.levelTarget === 0) return;
    const mix = voice.mix;
    const dir = mix.moving ? (mix.dir > 0 ? -1 : 1) : mix.value() >= 0.5 ? -1 : 1;
    mix.go(dir, region.slideSec);
  }

  /**
   * Right click: release the note now (the patch's release envelope is the
   * audible tail) and fade the colour out over the slide duration.
   */
  release(id: string) {
    const voice = this.voices.get(id);
    if (!voice || voice.levelTarget === 0) return;
    voice.levelTarget = 0;
    this.noteOff(voice);
    voice.level.go(-1, FADE_SEC, () => voice.mix.set(0));
  }

  releaseAll() {
    for (const id of this.voices.keys()) this.release(id);
  }

  /** Release every region except `keep`. */
  releaseOthers(keep: string | null) {
    for (const id of this.voices.keys()) if (id !== keep) this.release(id);
  }

  isOn(id: string) {
    return this.voices.get(id)?.levelTarget === 1;
  }

  // --- audio -----------------------------------------------------------------

  private noteOn(voice: RegionVoice, region: Region) {
    voice.key = regionPitches(region).a;
    voice.noteId = this.nextNoteId++;
    voice.sent.fill(NaN);
    this.synth?.send([{ type: SixSinesEventType.noteOn, noteId: voice.noteId, port: 0, channel: 0, key: voice.key, value: DRONE_VELOCITY }]);
    this.update(voice, region, now());
  }

  private noteOff(voice: RegionVoice) {
    if (voice.noteId === null) return;
    this.synth?.send([{ type: SixSinesEventType.noteOff, noteId: voice.noteId, port: 0, channel: 0, key: voice.key, value: 0 }]);
    voice.noteId = null;
  }

  /** A preset load silences the engine: start the sounding drones again. */
  private retrigger() {
    this.previewNote = null;
    for (const [id, voice] of this.voices) {
      const region = findRegion(id);
      if (voice.noteId !== null && region) {
        voice.noteId = null;
        this.noteOn(voice, region);
      }
    }
  }

  /** Advance to frame time `t`: display values for the grid, and per-voice updates to the synth. */
  frame(t: number) {
    for (const [id, voice] of this.voices) {
      const region = findRegion(id);
      if (!region) {
        // Split away or undone: its voice goes with it.
        voice.level.set(0);
        voice.mix.set(0);
        this.noteOff(voice);
        this.voices.delete(id);
        continue;
      }
      this.update(voice, region, t);
    }
  }

  private update(voice: RegionVoice, region: Region, t: number) {
    const level = logisticSigmoid(voice.level.value(t), region.sharpness);
    const mix = logisticSigmoid(voice.mix.value(t), region.sharpness);
    voice.shown.level = level;
    voice.shown.mix = mix;
    if (voice.noteId === null) return;
    const { a, b } = regionPitches(region);
    const colorA = hexToRgb(region.colorA);
    const colorB = hexToRgb(region.colorB);
    const values = [
      a + (b - a) * mix - voice.key,
      ...[0, 1, 2].map((i) => (colorA[i] + (colorB[i] - colorA[i]) * mix) / 255),
      level,
    ];
    const events: SixSinesEvent[] = [];
    const identity = { noteId: voice.noteId, port: 0, channel: 0, key: voice.key };
    values.forEach((value, index) => {
      if (Math.abs(value - voice.sent[index]) < 1e-4) return;
      voice.sent[index] = value;
      events.push(index === 0
        ? { type: SixSinesEventType.noteExpression, ...identity, expressionId: ClapNoteExpression.tuning, value }
        : { type: SixSinesEventType.paramMod, ...identity, paramId: MACRO_LEVEL_IDS[index - 1], value });
    });
    this.synth?.send(events);
  }

  // --- previews from the piano roll ---------------------------------------------

  /** Keyboard column: hold a key on the drone synth, coloured like the selected region's A. */
  previewKey(pitch: number | null) {
    const synth = this.synth;
    if (!synth) return;
    if (this.previewNote) {
      synth.send([{ type: SixSinesEventType.noteOff, ...this.previewNote, port: 0, channel: 0, value: 0 }]);
      this.previewNote = null;
    }
    if (pitch === null) return;
    const note = { noteId: this.nextNoteId++, key: pitch };
    this.previewNote = note;
    synth.send(this.previewEvents(note));
  }

  /** A note clicked, added or dragged in the roll: a short audition. */
  audition(pitch: number) {
    const synth = this.synth;
    if (!synth) return;
    const note = { noteId: this.nextNoteId++, key: pitch };
    synth.send(this.previewEvents(note));
    window.setTimeout(() => synth.send([{ type: SixSinesEventType.noteOff, ...note, port: 0, channel: 0, value: 0 }]), 220);
  }

  private previewEvents(note: { noteId: number; key: number }): SixSinesEvent[] {
    const identity = { ...note, port: 0, channel: 0 };
    const region = findRegion(ui.selectedId);
    const rgb = region ? hexToRgb(region.colorA) : [0, 0, 0];
    return [
      { type: SixSinesEventType.noteOn, ...identity, value: DRONE_VELOCITY },
      ...rgb.map((c, i): SixSinesEvent => ({ type: SixSinesEventType.paramMod, ...identity, paramId: MACRO_LEVEL_IDS[i], value: c / 255 })),
      { type: SixSinesEventType.paramMod, ...identity, paramId: MACRO_LEVEL_IDS[3], value: 1 },
    ];
  }

  // --- live MIDI: its own Six Sines instance with the same patch -----------------

  private onMidi(event: MidiInputEvent) {
    const live = this.live;
    if (!live) return;
    if (event.type === "noteOn") {
      const id = `${event.channel}:${event.note}`;
      this.liveNoteOff(id);
      const note = { noteId: this.nextNoteId++, key: event.note, channel: event.channel };
      this.liveNotes.set(id, note);
      live.send([
        { type: SixSinesEventType.noteOn, ...note, port: 0, value: event.velocity / 127 },
        { type: SixSinesEventType.noteExpression, ...note, port: 0, expressionId: ClapNoteExpression.tuning, value: this.liveBend.get(event.channel) ?? 0 },
      ]);
    } else if (event.type === "noteOff") {
      this.liveNoteOff(`${event.channel}:${event.note}`);
    } else if (event.type === "pitchBend") {
      const semis = (event.bend / 8192) * PITCH_BEND_RANGE;
      this.liveBend.set(event.channel, semis);
      const events: SixSinesEvent[] = [];
      for (const note of this.liveNotes.values()) {
        if (note.channel === event.channel) {
          events.push({ type: SixSinesEventType.noteExpression, ...note, port: 0, expressionId: ClapNoteExpression.tuning, value: semis });
        }
      }
      live.send(events);
    } else if (event.type === "cc" && (event.controller === 120 || event.controller === 123)) {
      this.liveNotes.clear();
      live.send([{ type: SixSinesEventType.allNotesOff }]);
    }
  }

  private liveNoteOff(id: string) {
    const note = this.liveNotes.get(id);
    if (!note) return;
    this.liveNotes.delete(id);
    this.live?.send([{ type: SixSinesEventType.noteOff, ...note, port: 0, value: 0 }]);
  }

  panic() {
    for (const voice of this.voices.values()) {
      voice.level.set(0);
      voice.mix.set(0);
      voice.levelTarget = 0;
      voice.noteId = null;
      voice.shown.level = 0;
      voice.shown.mix = 0;
    }
    this.previewNote = null;
    this.liveNotes.clear();
    this.synth?.send([{ type: SixSinesEventType.allNotesOff }]);
    this.live?.send([{ type: SixSinesEventType.allNotesOff }]);
  }
}

export const engine = new SweepEngine();
// Animation values update in the page's frame loop (before the grid draws),
// at the frame's time, whether or not audio has started.
onUpdate((time) => engine.frame(time));

// Debug handle for the console and browser checks.
(globalThis as Record<string, unknown>).__splitSweep = { engine, doc, ui };
