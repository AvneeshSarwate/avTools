import type { Push2 } from "../push2.ts";
import type { MidiOutput } from "../../midi/midi_output.ts";
import type { GridLayout } from "../grid_layout.ts";
import { padIJToN, COLOR } from "../constants.ts";

const IS_SHARP = new Set([1, 3, 6, 8, 10]);

export interface NoteToggleColors {
  c: number;
  natural: number;
  sharp: number;
  on: number;
}

const DEFAULT_COLORS: NoteToggleColors = {
  c: COLOR.BLUE,
  natural: COLOR.LIGHT_GRAY,
  sharp: COLOR.BLACK,
  on: COLOR.GREEN,
};

export class NoteToggleModule {
  private push: Push2;
  private midiOut: MidiOutput;
  private layout: GridLayout;
  private colors: NoteToggleColors;
  private midiChannel: number;
  private visible = false;
  private unsubs: (() => void)[] = [];

  private onNotes = new Map<number, number>(); // MIDI note -> velocity
  private playingNotes = new Map<number, number>(); // currently sounding via MIDI

  constructor(
    push: Push2,
    midiOut: MidiOutput,
    layout: GridLayout,
    options?: { colors?: Partial<NoteToggleColors>; midiChannel?: number },
  ) {
    this.push = push;
    this.midiOut = midiOut;
    this.layout = layout;
    this.colors = { ...DEFAULT_COLORS, ...options?.colors };
    this.midiChannel = options?.midiChannel ?? 0;
  }

  activate(): void {
    this.visible = true;
    this.unsubs = [
      this.push.onPadPressed((_padN, [i, j], velocity) => {
        if (!this.layout.inRange(i)) return;
        const note = this.layout.midiNoteAt(i, j);
        if (note < 0 || note > 127) return;

        // Toggle note and immediately send MIDI
        if (this.onNotes.has(note)) {
          this.onNotes.delete(note);
          this.playingNotes.delete(note);
          this.midiOut.noteOff(this.midiChannel, note, 0);
        } else {
          this.onNotes.set(note, velocity);
          this.playingNotes.set(note, velocity);
          this.midiOut.noteOn(this.midiChannel, note, velocity);
        }

        this.updateLightsForNote(note);
      }),

      this.push.onButtonPressed("Left", () => {
        this.layout.shift(-1);
        this.updateLights();
      }),
      this.push.onButtonPressed("Right", () => {
        this.layout.shift(1);
        this.updateLights();
      }),
      this.push.onButtonPressed("Up", () => {
        this.layout.shift(this.layout.rowInterval);
        this.updateLights();
      }),
      this.push.onButtonPressed("Down", () => {
        this.layout.shift(-this.layout.rowInterval);
        this.updateLights();
      }),
      this.push.onButtonPressed("OctaveUp", () => {
        this.layout.shift(12);
        this.updateLights();
      }),
      this.push.onButtonPressed("OctaveDown", () => {
        this.layout.shift(-12);
        this.updateLights();
      }),
    ];
    this.updateLights();
  }

  deactivate(): void {
    this.visible = false;
    this.unsubs.forEach((fn) => fn());
    this.unsubs = [];
    this.clearPads();
  }

  updateLights(): void {
    if (!this.visible) return;
    for (let i = this.layout.rows[0]; i <= this.layout.rows[1]; i++) {
      for (let j = 0; j < 8; j++) {
        const note = this.layout.midiNoteAt(i, j);
        this.push.setPadColor(padIJToN(i, j), this.colorForNote(note));
      }
    }
  }

  // --- Public API ---

  /** Returns a copy of on-notes as Map<midiNote, velocity>. */
  getOnNotes(): Map<number, number> {
    return new Map(this.onNotes);
  }

  /** Replace the on-notes set. Updates lights if visible. No MIDI sent. */
  setNotes(notes: Map<number, number>): void {
    this.onNotes = new Map(notes);
    if (this.visible) this.updateLights();
  }

  /** Clear all on-notes and send note-off for all currently playing notes. */
  allNotesOff(): void {
    for (const note of this.playingNotes.keys()) {
      this.midiOut.noteOff(this.midiChannel, note, 0);
    }
    this.playingNotes.clear();
    this.onNotes.clear();
    if (this.visible) this.updateLights();
  }

  /**
   * Send MIDI to match onNotes using stored velocities.
   * - Notes in playingNotes but not onNotes get note-off
   * - Notes in onNotes but not playingNotes get note-on
   * Common tones are left untouched (smooth chord transitions for drones).
   */
  playAllOnNotes(): void {
    for (const note of this.playingNotes.keys()) {
      if (!this.onNotes.has(note)) {
        this.midiOut.noteOff(this.midiChannel, note, 0);
      }
    }
    for (const [note, velocity] of this.onNotes) {
      if (!this.playingNotes.has(note)) {
        this.midiOut.noteOn(this.midiChannel, note, velocity);
      }
    }
    this.playingNotes = new Map(this.onNotes);
  }

  // --- Private ---

  private updateLightsForNote(note: number): void {
    if (!this.visible) return;
    const pads = this.layout.padsForNote(note);
    const color = this.colorForNote(note);
    for (const [i, j] of pads) {
      this.push.setPadColor(padIJToN(i, j), color);
    }
  }

  private colorForNote(note: number): number {
    if (note < 0 || note > 127) return COLOR.BLACK;
    if (this.onNotes.has(note)) return this.colors.on;
    const pc = note % 12;
    if (pc === 0) return this.colors.c;
    if (IS_SHARP.has(pc)) return this.colors.sharp;
    return this.colors.natural;
  }

  private clearPads(): void {
    for (let i = this.layout.rows[0]; i <= this.layout.rows[1]; i++) {
      for (let j = 0; j < 8; j++) {
        this.push.setPadColor(padIJToN(i, j), COLOR.BLACK);
      }
    }
  }
}
