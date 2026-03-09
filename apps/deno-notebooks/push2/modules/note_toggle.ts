import type { Push2 } from "../push2.ts";
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
  c: COLOR.PURPLE,
  natural: COLOR.DARK_GRAY,
  sharp: COLOR.BLACK,
  on: COLOR.ORANGE,
};

export interface NoteToggleCallbacks {
  noteOn: (note: number, velocity: number) => void;
  noteOff: (note: number) => void;
}

export class NoteToggleModule {
  private push: Push2;
  private layout: GridLayout;
  private callbacks: NoteToggleCallbacks;
  private colors: NoteToggleColors;
  private visible = false;
  private unsubs: (() => void)[] = [];
  private changeListeners: ((notes: Map<number, number>) => void)[] = [];

  private onNotes = new Map<number, number>(); // MIDI note -> velocity
  private playingNotes = new Set<number>(); // currently sounding

  constructor(
    push: Push2,
    layout: GridLayout,
    callbacks: NoteToggleCallbacks,
    options?: { colors?: Partial<NoteToggleColors> },
  ) {
    this.push = push;
    this.layout = layout;
    this.callbacks = callbacks;
    this.colors = { ...DEFAULT_COLORS, ...options?.colors };
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
          this.callbacks.noteOff(note);
        } else {
          this.onNotes.set(note, velocity);
          this.playingNotes.add(note);
          this.callbacks.noteOn(note, velocity);
        }

        this.updateLightsForNote(note);
        this.emitChange();
      }),

      this.push.onButtonPressed("PageLeft", () => {
        this.layout.shift(1);
        this.updateLights();
      }),
      this.push.onButtonPressed("PageRight", () => {
        this.layout.shift(-1);
        this.updateLights();
      }),
      this.push.onButtonPressed("OctaveUp", () => {
        this.layout.shift(-this.layout.rowInterval);
        this.updateLights();
      }),
      this.push.onButtonPressed("OctaveDown", () => {
        this.layout.shift(this.layout.rowInterval);
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

  /** Register a listener for any change to onNotes. Returns unsubscribe fn. */
  onChange(fn: (notes: Map<number, number>) => void): () => void {
    this.changeListeners.push(fn);
    return () => {
      const idx = this.changeListeners.indexOf(fn);
      if (idx >= 0) this.changeListeners.splice(idx, 1);
    };
  }

  /** Returns a copy of on-notes as Map<midiNote, velocity>. */
  getOnNotes(): Map<number, number> {
    return new Map(this.onNotes);
  }

  /** Replace the on-notes set. Updates lights if visible. No MIDI sent. */
  setNotes(notes: Map<number, number>): void {
    this.onNotes = new Map(notes);
    if (this.visible) this.updateLights();
    this.emitChange();
  }

  /** Clear all on-notes and send note-off for all currently playing notes. */
  allNotesOff(): void {
    for (const note of this.playingNotes) {
      this.callbacks.noteOff(note);
    }
    this.playingNotes.clear();
    this.onNotes.clear();
    if (this.visible) this.updateLights();
    this.emitChange();
  }

  /**
   * Send MIDI to match onNotes using stored velocities.
   * When retrigger is false (default), common tones are left untouched.
   * When retrigger is true, all playing notes are silenced and re-triggered.
   */
  playAllOnNotes(retrigger = false): void {
    for (const note of this.playingNotes) {
      if (retrigger || !this.onNotes.has(note)) {
        this.callbacks.noteOff(note);
      }
    }
    for (const [note, velocity] of this.onNotes) {
      if (retrigger || !this.playingNotes.has(note)) {
        this.callbacks.noteOn(note, velocity);
      }
    }
    this.playingNotes = new Set(this.onNotes.keys());
  }

  // --- Private ---

  private emitChange(): void {
    const snapshot = new Map(this.onNotes);
    for (const fn of this.changeListeners) fn(snapshot);
  }

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
