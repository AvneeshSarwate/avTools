// A small looping player for a piano-roll clip. Notes are fired from a timer
// against the audio clock; that is accurate enough for auditioning patches.
import { audio } from "./engine";
import type { Instrument } from "./engine";

export interface ClipNote {
  id: string;
  pitch: number;
  position: number;
  duration: number;
  velocity: number;
}

export class Transport {
  private timer?: number;
  private startTime = 0;
  private lastBeat = 0;
  private sounding = new Map<string, number>();
  bpm = 100;
  playing = false;

  constructor(
    private getNotes: () => ClipNote[],
    private getLoop: () => number,
    private getInstrument: () => Instrument | undefined,
    private onNote: (key: number) => void,
  ) {}

  /** Position in beats within the loop, for the playhead. */
  beat() {
    if (!this.playing) return 0;
    const elapsed = audio().context.currentTime - this.startTime;
    return ((elapsed * this.bpm) / 60) % this.getLoop();
  }

  start() {
    if (this.playing) return;
    this.playing = true;
    this.startTime = audio().context.currentTime + 0.05;
    this.lastBeat = -1e-6;
    this.timer = window.setInterval(() => this.tick(), 8);
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    window.clearInterval(this.timer);
    const instrument = this.getInstrument();
    for (const key of this.sounding.values()) instrument?.noteOff(key);
    this.sounding.clear();
  }

  private tick() {
    const instrument = this.getInstrument();
    if (!instrument) return;
    const loop = this.getLoop();
    const elapsed = audio().context.currentTime - this.startTime;
    if (elapsed < 0) return;
    const total = (elapsed * this.bpm) / 60;
    const beat = total % loop;
    const wrapped = beat < this.lastBeat;
    const inWindow = (t: number) =>
      wrapped ? t > this.lastBeat || t <= beat : t > this.lastBeat && t <= beat;
    const notes = this.getNotes();
    // Offs first so a repeated pitch re-triggers cleanly.
    for (const note of notes) {
      const end = Math.min(note.position + note.duration, loop) - 0.01;
      if (this.sounding.has(note.id) && inWindow(end)) {
        instrument.noteOff(note.pitch);
        this.sounding.delete(note.id);
      }
    }
    for (const note of notes) {
      if (note.position < loop && inWindow(note.position)) {
        instrument.noteOn(note.pitch, note.velocity / 127);
        this.sounding.set(note.id, note.pitch);
        this.onNote(note.pitch);
      }
    }
    this.lastBeat = beat;
  }
}
