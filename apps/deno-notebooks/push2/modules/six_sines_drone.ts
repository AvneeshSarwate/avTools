// Adapted from NoteToggleModule: shared GridLayout and pitch-based duplicate-pad
// highlighting, extended with CLAP note IDs and a persistent per-note editor.
import { GridLayout } from "../grid_layout.ts";
import { COLOR, padIJToN } from "../constants.ts";
import {
  DEFAULT_MACROS,
  MACRO_IDS,
  type OscMessage,
  param,
  type Send,
} from "../six_sines_osc.ts";

export type DroneVoice = { id: number; key: number; macros: number[] };
export const noteName = (key: number) =>
  ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][key % 12] +
  (Math.floor(key / 12) - 1);

export class SixSinesDrone {
  readonly layout = new GridLayout({
    rows: [0, 7],
    baseNote: 36,
    rowInterval: 5,
  });
  readonly voices = new Map<number, DroneVoice>();
  selected: number | null = null;
  shift = false;
  volume = 0.12;
  status = "Tap: drone | Shift+pad: select";
  private nextId = 1;
  onChange = () => {};

  constructor(private send: Send) {}

  get selection() {
    return this.selected === null ? undefined : this.voices.get(this.selected);
  }

  press(key: number, velocity = 80, select = this.shift) {
    if (!Number.isInteger(key) || key < 0 || key > 127) return;
    if (select) {
      if (this.voices.has(key)) {
        this.selected = key;
        this.status = `Editing ${noteName(key)}; encoders 1-6`;
      } else this.status = "Select a sounding (orange) note";
    } else if (this.voices.has(key)) {
      const voice = this.voices.get(key)!;
      this.send([{
        address: "/note/off",
        types: "iifii",
        args: [voice.id, key, 0, 0, 0],
      }]);
      this.voices.delete(key);
      if (this.selected === key) {
        this.selected = this.voices.keys().next().value ?? null;
      }
      this.status = `${noteName(key)} off`;
    } else if (this.voices.size >= 12) {
      this.status = "12-note limit; turn off a drone first";
    } else {
      const voice = { id: this.nextId++, key, macros: [...DEFAULT_MACROS] };
      this.voices.set(key, voice);
      this.selected = key;
      this.send([
        {
          address: "/note/on",
          types: "iifii",
          args: [
            voice.id,
            key,
            Math.max(0.1, Math.min(0.8, velocity / 127)),
            0,
            0,
          ],
        },
        ...voice.macros.map((_, i) => this.mod(voice, i)),
      ]);
      this.status = `${noteName(key)} on; encoders edit this note`;
    }
    this.onChange();
  }

  private mod(voice: DroneVoice, index: number): OscMessage {
    return {
      address: "/param/mod",
      types: "iidiii",
      args: [voice.id, MACRO_IDS[index], voice.macros[index], voice.key, 0, 0],
    };
  }

  setMacro(index: number, amount: number) {
    if (
      !Number.isInteger(index) || index < 0 || index >= 6 ||
      !Number.isFinite(amount)
    ) return;
    const voice = this.selection;
    if (!voice) this.status = "Start a drone, then select it with Shift+pad";
    else {
      voice.macros[index] = Math.max(-1, Math.min(1, amount));
      this.send([this.mod(voice, index)]);
      this.status = `${noteName(voice.key)} Macro ${index + 1}: ${
        voice.macros[index].toFixed(3)
      }`;
    }
    this.onChange();
  }

  rotate(index: number, delta: number) {
    if (this.selection) {
      this.setMacro(
        index,
        this.selection.macros[index] + delta * (this.shift ? 0.001 : 0.01),
      );
    }
  }

  reset(index?: number) {
    for (const i of index === undefined ? [0, 1, 2, 3, 4, 5] : [index]) {
      this.setMacro(i, DEFAULT_MACROS[i]);
    }
  }

  move(semitones: number) {
    // Keep the entire 8x8 grid in MIDI range. Navigation never retunes held voices.
    this.layout.baseNote = Math.max(
      0,
      Math.min(85, this.layout.baseNote + semitones),
    );
    this.onChange();
  }

  nextSelection(delta: number) {
    const keys = [...this.voices.keys()].sort((a, b) => a - b);
    if (keys.length) {
      const index = keys.indexOf(this.selected ?? -1);
      this.selected = keys[(index + delta + keys.length) % keys.length];
      this.onChange();
    }
  }

  setVolume(value: number) {
    if (!Number.isFinite(value)) return;
    this.volume = Math.max(0, Math.min(0.3, value));
    this.send([param(500, this.volume)]);
    this.onChange();
  }

  panic() {
    // This synth implements NOTE_OFF, but not NOTE_CHOKE. Wildcards also stop
    // release tails/voices whose local bookkeeping may already have been removed.
    this.send([{
      address: "/note/off",
      types: "iifii",
      args: [-1, -1, 0, 0, 0],
    }]);
    this.voices.clear();
    this.selected = null;
    this.status = "All drones off";
    this.onChange();
  }

  lights(setPadColor: (pad: number, color: number) => void) {
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        const key = this.layout.midiNoteAt(i, j);
        const color = key === this.selected
          ? COLOR.GREEN
          : this.voices.has(key)
          ? COLOR.ORANGE
          : key % 12 === 0
          ? COLOR.PURPLE
          : [1, 3, 6, 8, 10].includes(key % 12)
          ? COLOR.BLACK
          : COLOR.DARK_GRAY;
        setPadColor(padIJToN(i, j), color);
      }
    }
  }
}
