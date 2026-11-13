import type { Push2 } from "../push2.ts";
import type { GridLayout } from "../grid_layout.ts";
import { padIJToN, COLOR } from "../constants.ts";

const IS_SHARP = new Set([1, 3, 6, 8, 10]);

export interface KeyboardColors {
  c: number;
  natural: number;
  sharp: number;
  active: number;
}

const DEFAULT_COLORS: KeyboardColors = {
  c: COLOR.BLUE,
  natural: COLOR.LIGHT_GRAY,
  sharp: COLOR.BLACK,
  active: COLOR.GREEN,
};

export interface KeyboardCallbacks {
  noteOn: (note: number, velocity: number) => void;
  noteOff: (note: number) => void;
}

export class KeyboardModule {
  private push: Push2;
  private layout: GridLayout;
  private callbacks: KeyboardCallbacks;
  private colors: KeyboardColors;
  private visible = false;
  private unsubs: (() => void)[] = [];

  // MIDI note -> refcount (multiple pads can map to same note)
  private heldNotes = new Map<number, number>();
  // padN -> MIDI note it was mapped to when pressed
  private padToNote = new Map<number, number>();
  // External highlights: MIDI note -> color index (overrides scale colors)
  private highlights = new Map<number, number>();

  constructor(
    push: Push2,
    layout: GridLayout,
    callbacks: KeyboardCallbacks,
    options?: { colors?: Partial<KeyboardColors> },
  ) {
    this.push = push;
    this.layout = layout;
    this.callbacks = callbacks;
    this.colors = { ...DEFAULT_COLORS, ...options?.colors };
  }

  activate(): void {
    this.visible = true;
    this.unsubs = [
      this.push.onPadPressed((padN, [i, j], velocity) => {
        if (!this.layout.inRange(i)) return;
        const note = this.layout.midiNoteAt(i, j);
        if (note < 0 || note > 127) return;

        this.padToNote.set(padN, note);
        const prev = this.heldNotes.get(note) ?? 0;
        this.heldNotes.set(note, prev + 1);

        if (prev === 0) {
          this.callbacks.noteOn(note, velocity);
        }

        this.updateLightsForNote(note);
      }),

      this.push.onPadReleased((padN, [i]) => {
        if (!this.layout.inRange(i)) return;
        const note = this.padToNote.get(padN);
        if (note === undefined) return;

        this.padToNote.delete(padN);
        const count = this.heldNotes.get(note) ?? 0;
        if (count <= 1) {
          this.heldNotes.delete(note);
          this.callbacks.noteOff(note);
        } else {
          this.heldNotes.set(note, count - 1);
        }

        this.updateLightsForNote(note);
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
    // Release all held notes
    for (const [note] of this.heldNotes) {
      this.callbacks.noteOff(note);
    }
    this.heldNotes.clear();
    this.padToNote.clear();

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

  /** Set highlight colors for specific MIDI notes. Replaces previous highlights. */
  setHighlights(highlights: Map<number, number>): void {
    this.highlights = new Map(highlights);
    this.updateLights();
  }

  /** Remove all highlights, return to normal keyboard colors. */
  clearHighlights(): void {
    this.highlights.clear();
    this.updateLights();
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
    const hl = this.highlights.get(note);
    if (hl !== undefined) return hl;
    if (this.heldNotes.has(note)) return this.colors.active;
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
