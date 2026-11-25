// Runtime of the split-sweep sketch: one drone voice per sounding region, the
// level (ramp in/out) and mix (A <-> B sweep) animations, and the frame loop
// that turns them into Six Sines events. Plain objects, no React: the canvas
// reads `display()` each frame.
//
// Audio: one Six Sines engine plays every region's note; a second plays live
// MIDI and roll previews. Per note, Macro 1..3 take the colour and Macro 4
// the sweep boost: the patch routes Macro 4 Amplitude to Main Amplitude
// (Main Level set below 1 to leave headroom, Output Gain making up for it),
// and while a region sweeps its Macro 4 ramps up to the value that makes the
// note `sweepBoostDb` louder, and back down when the sweep ends.
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
import { audioContext, outputDelay } from "../../shared/audio";
import { asBrowser, rootContext } from "../../shared/clock";
import { onUpdate } from "../../shared/frameLoop";
import { logisticSigmoid } from "../../shared/logisticSigmoid";
import { setMidiListener } from "../../shared/midiInput";
import { SixSinesSynth } from "../../shared/sixSines/synth";
import { DEFAULT_SWEEP_BOOST_DB, DEFAULT_SWEEP_BOOST_RAMP_SEC, hexToRgb, regionPitches, type Region } from "./model";
import { doc, findRegion, ui } from "./store";

/** Macro 1..3 Level take the colour's R, G, B (0..1); Macro 4 Level takes the sweep boost. */
const MACRO_LEVEL_IDS = [40000, 40250, 40500, 40750] as const;
/** Six Sines ids for reading the boost routing out of the patch. */
const MAIN_LEVEL_ID = 500;
const MAIN_MOD_SLOTS = [0, 1, 2].map((i) => ({ source: 620 + 2 * i, depth: 621 + 2 * i, target: 650 + i }));
const MACRO_4_AMPLITUDE_SOURCE = 403;
const MAIN_AMPLITUDE_TARGET = 10;
const DRONE_VELOCITY = 0.8;
const PITCH_BEND_RANGE = 2;
/** Seconds for a region to fade on (first click) or off (right click); the A/B sweep uses the region's slide duration. */
const FADE_SEC = 0.2;

const now = () => rootContext().scheduler.now();
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

interface Segment {
  u0: number;
  t0: number;
  duration: number;
  dir: -1 | 0 | 1;
}

const at = (segment: Segment, t: number) =>
  segment.dir === 0 ? segment.u0 : clamp01(segment.u0 + (segment.dir * (t - segment.t0)) / segment.duration);

class Track {
  private u0 = 0;
  private t0 = 0;
  private duration = 1;
  /** +1 / -1 while moving, 0 at rest. */
  dir: -1 | 0 | 1 = 0;
  private waiter: { cancel(): void } | null = null;
  /** The segment before the current one, so a time shortly before the last change (drawing behind the audio) still reads right. */
  private previous: Segment = { u0: 0, t0: -Infinity, duration: 1, dir: 0 };

  value(t = now()): number {
    if (t < this.t0) return at(this.previous, t);
    return this.dir === 0 ? this.u0 : clamp01(this.u0 + (this.dir * (t - this.t0)) / this.duration);
  }

  private remember(t: number) {
    this.previous = { u0: this.u0, t0: this.t0, duration: this.duration, dir: this.dir };
    this.t0 = t;
  }

  get moving() {
    return this.dir !== 0;
  }

  go(dir: -1 | 1, durationSec: number, onArrive?: () => void) {
    const t = now();
    const u = this.value(t);
    this.waiter?.cancel();
    this.waiter = null;
    this.remember(t);
    this.u0 = u;
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
      this.remember(now());
      this.u0 = dir > 0 ? 1 : 0;
      this.dir = 0;
      onArrive?.();
    }, "track");
    this.waiter = waiter;
  }

  set(u: number) {
    this.waiter?.cancel();
    this.waiter = null;
    this.remember(now());
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
  /** The sweep boost: 0 normal .. 1 at `boostMacro` (the Macro 4 value for the boost). */
  readonly boost = new Track();
  boostMacro = 0;
}

/**
 * The Macro 4 value that makes a note `db` louder under the patch's routing.
 * A voice's amplitude goes as clamp(Main Level + depth * macro)^3, so
 * db = 60 log10((L + D m) / L). 0 when the patch has no Macro 4 -> Amplitude route.
 */
function boostMacroFor(db: number, parameters: Record<string, number>): number {
  const level = parameters[MAIN_LEVEL_ID] ?? 1;
  let depth = 0;
  for (const slot of MAIN_MOD_SLOTS) {
    if (parameters[slot.source] === MACRO_4_AMPLITUDE_SOURCE && parameters[slot.target] === MAIN_AMPLITUDE_TARGET) depth += parameters[slot.depth] ?? 0;
  }
  if (depth <= 0 || level <= 0) return 0;
  return clamp01((level * (10 ** (db / 60) - 1)) / depth);
}

export interface RegionDisplay {
  level: number;
  mix: number;
}

const OFF: RegionDisplay = { level: 0, mix: 0 };

class SweepEngine {
  private voices = new Map<string, RegionVoice>();
  /** Live MIDI and roll previews. */
  private live: SixSinesSynth | null = null;
  private nextNoteId = 1;
  private previewNote: { noteId: number; key: number } | null = null;
  private liveNotes = new Map<string, { noteId: number; key: number; channel: number }>();
  private liveBend = new Map<number, number>();
  private started = false;

  /** Start audio, from a user gesture (the context resumes; the engines are already loading). */
  start() {
    this.warm();
    this.started = true;
    audioContext();
  }

  /**
   * Load the audio engines before any gesture: the context is made suspended
   * and each engine compiles its Wasm now, not during the first notes (a
   * compile on the audio thread stalls it: a delay and crackles, worst in
   * Safari). The region engine first, then the live/preview one.
   */
  warm() {
    if (this.warmed) return;
    this.warmed = true;
    const context = audioContext({ resume: false });
    this.synth = new SixSinesSynth(context, () => this.retriggerAll());
    // A note sent while the worklet was loading was dropped: sound it now.
    const regionsReady = this.synth.ready.then(() => this.retriggerAll(), () => {});
    void regionsReady.then(() => {
      this.live = new SixSinesSynth(context, () => {
        this.liveNotes.clear();
        this.previewNote = null;
      });
      this.live.setPatch(snapshot(doc).synth);
    });
    const sync = () => {
      const patch = snapshot(doc).synth;
      this.synth?.setPatch(patch);
      this.live?.setPatch(patch);
    };
    sync();
    subscribe(doc, sync);
    setMidiListener((event) => this.onMidi(event));
  }

  get audioStarted() {
    return this.started;
  }

  private warmed = false;
  /** Every region's note. */
  private synth: SixSinesSynth | null = null;

  display(id: string): RegionDisplay {
    return this.voices.get(id)?.shown ?? OFF;
  }

  private voice(id: string) {
    let voice = this.voices.get(id);
    if (!voice) this.voices.set(id, (voice = new RegionVoice()));
    return voice;
  }

  /** A region gone (split away, deleted, undone): its note ends. */
  private retire(id: string, voice: RegionVoice) {
    voice.level.set(0);
    voice.mix.set(0);
    voice.boost.set(0);
    this.noteOff(voice);
    this.voices.delete(id);
  }

  /**
   * The sweep boost, `dir` +1 up (a sweep started) or -1 back to normal (it
   * ended, or the region was released), over the ramp time from where it is.
   * The frame loop turns it into the note's Macro 4 (the synth smooths the steps).
   */
  private setBoost(voice: RegionVoice, dir: -1 | 1) {
    const ramp = Math.max(0.001, doc.sweepBoostRampSec ?? DEFAULT_SWEEP_BOOST_RAMP_SEC);
    if (dir > 0) voice.boostMacro = boostMacroFor(doc.sweepBoostDb ?? DEFAULT_SWEEP_BOOST_DB, doc.synth.parameters);
    const u = voice.boost.value();
    if (!voice.boost.moving && ((dir > 0 && u >= 1) || (dir < 0 && u <= 0))) return;
    voice.boost.go(dir, ramp);
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
    // Louder while it moves; back to normal when it arrives (a reversal keeps it up)
    mix.go(dir, region.slideSec, () => this.setBoost(voice, -1));
    this.setBoost(voice, 1);
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
    this.setBoost(voice, -1);
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

  /** A preset load silences the engine (and notes are dropped while it starts): sound the drones again. */
  private retriggerAll() {
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
    // The picture is drawn as of when the sound now being made will be heard
    const shownAt = t - outputDelay();
    for (const [id, voice] of this.voices) {
      const region = findRegion(id);
      if (!region) {
        this.retire(id, voice);
        continue;
      }
      this.update(voice, region, t, shownAt);
    }
  }

  /** Audio values at `t`; the drawn ones at `shownAt` (behind by the output latency). */
  private update(voice: RegionVoice, region: Region, t: number, shownAt = t) {
    const mix = logisticSigmoid(voice.mix.value(t), region.sharpness);
    voice.shown.level = logisticSigmoid(voice.level.value(shownAt), region.sharpness);
    voice.shown.mix = logisticSigmoid(voice.mix.value(shownAt), region.sharpness);
    if (voice.noteId === null) return;
    const { a, b } = regionPitches(region);
    const colorA = hexToRgb(region.colorA);
    const colorB = hexToRgb(region.colorB);
    const values = [
      a + (b - a) * mix - voice.key,
      ...[0, 1, 2].map((i) => (colorA[i] + (colorB[i] - colorA[i]) * mix) / 255),
      voice.boost.value(t) * voice.boostMacro,
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

  /** Keyboard column: hold a key (on the live engine), coloured like the selected region's A. */
  previewKey(pitch: number | null) {
    const synth = this.live;
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
    const synth = this.live;
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
      { type: SixSinesEventType.paramMod, ...identity, paramId: MACRO_LEVEL_IDS[3], value: 0 },
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
      voice.boost.set(0);
    }
    this.synth?.send([{ type: SixSinesEventType.allNotesOff }]);
    this.previewNote = null;
    this.liveNotes.clear();
    this.live?.send([{ type: SixSinesEventType.allNotesOff }]);
  }
}

export const engine = new SweepEngine();
// Engines load with the page (silently, suspended) rather than on the first tap.
engine.warm();
// Animation values update in the page's frame loop (before the grid draws),
// at the frame's time, whether or not audio has started.
onUpdate((time) => engine.frame(time));

// Debug handle for the console and browser checks.
(globalThis as Record<string, unknown>).__splitSweep = { engine, doc, ui };
