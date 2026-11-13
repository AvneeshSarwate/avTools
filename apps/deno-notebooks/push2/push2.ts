// --- Ableton Live coexistence notes ---
//
// Ableton's Live binary has libusb compiled in and scans for Push 2 by USB
// vendor/product ID (0x2982/0x1967) at the C++ level. The Python MIDI Remote
// Scripts alone don't control detection — the C++ core does.
//
// To prevent Ableton from claiming the Push 2 at all, rename:
//   <Ableton .app>/Contents/Helpers/Push3.app
// (e.g. prefix with "zz"). This contains a full copy of the Push 2 control
// surface scripts that Ableton actually loads. Renaming the MIDI Remote
// Scripts/Push2 folder alone is NOT sufficient — Push3.app is what matters.
// The Push 1 folder (MIDI Remote Scripts/Push) can also be renamed but is
// less critical.
//
// Without Ableton Live running, the Push 2 defaults to using the Live Port
// (Port 1, "Ableton Push 2 Live Port") for MIDI. The User button does NOT
// switch it to the User Port — that mode switching is driven by the host
// sending SysEx (F0 00 21 1D 01 01 0A 01 F7). The default midiPortName
// "Ableton Push 2" works because port lookup uses .includes(), matching
// both "Ableton Push 2 Live Port" and "Ableton Push 2 User Port".
//
// The refreshLEDs() method re-sends all tracked pad/button colors. If running
// alongside Ableton (without the Push3.app rename), use User mode + User Port
// and wire push.onButtonReleased("User", () => push.refreshLEDs()) to restore
// LED state when switching back from Live mode.

import { MidiAccess } from "../midi/midi_access.ts";
import type { MidiInput } from "../midi/midi_input.ts";
import type { MidiOutput } from "../midi/midi_output.ts";
import type { P5GPU } from "../tools/p5gpu.ts";
import {
  BUTTONS,
  CC_TO_BUTTON,
  CC_TO_ENCODER,
  padNToIJ,
  TOUCHNOTE_TO_ENCODER,
} from "./constants.ts";
import { Push2Display } from "./display.ts";

export interface Push2Options {
  midiPortName?: string;
  displayFps?: number;
  displayLibPath?: string;
  midiLibPath?: string;
}

export class Push2 {
  private midiAccess: MidiAccess;
  private midiInput: MidiInput;
  private midiOutput: MidiOutput;
  private display: Push2Display | null = null;
  private listeners = new Map<string, Set<Function>>();

  // LED state tracking for refreshLEDs()
  private padState = new Map<number, { colorIndex: number; animation: number }>();
  private buttonState = new Map<string, { colorIndex: number; animation: number }>();

  private constructor(
    midiAccess: MidiAccess,
    midiInput: MidiInput,
    midiOutput: MidiOutput,
  ) {
    this.midiAccess = midiAccess;
    this.midiInput = midiInput;
    this.midiOutput = midiOutput;
    this.setupMidiRouting();
  }

  static create(options: Push2Options = {}): Push2 {
    const midiAccess = MidiAccess.open({ libPath: options.midiLibPath });
    const portName = options.midiPortName ?? "Ableton Push 2";

    // Find matching input and output ports
    const inputs = midiAccess.listInputs();
    const outputs = midiAccess.listOutputs();

    const inputPort = inputs.find((p) => p.name.includes(portName));
    if (!inputPort) {
      const names = inputs.map((p) => p.name).join(", ");
      throw new Error(
        `Push 2 MIDI input not found (looking for "${portName}"). Available: ${names}`,
      );
    }

    const outputPort = outputs.find((p) => p.name.includes(portName));
    if (!outputPort) {
      const names = outputs.map((p) => p.name).join(", ");
      throw new Error(
        `Push 2 MIDI output not found (looking for "${portName}"). Available: ${names}`,
      );
    }

    const midiInput = midiAccess.openInput(inputPort.id, {
      rawCC: true,
      rateHz: 500,
    });
    const midiOutput = midiAccess.openOutput(outputPort.id);

    return new Push2(midiAccess, midiInput, midiOutput);
  }

  close() {
    this.display?.close();
    this.midiInput.close();
    this.midiOutput.close();
    this.midiAccess.close();
    this.listeners.clear();
  }

  // --- Internal event system ---

  private on(event: string, fn: Function): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
    return () => this.listeners.get(event)?.delete(fn);
  }

  private emit(event: string, ...args: unknown[]) {
    this.listeners.get(event)?.forEach((fn) => fn(...args));
  }

  // --- MIDI routing ---

  private setupMidiRouting() {
    this.midiInput.onCC((evt) => {
      const { ctrlNum: cc, ctrlVal: value } = evt;

      // Button press/release
      const buttonName = CC_TO_BUTTON[cc];
      if (buttonName) {
        if (value === 127) {
          this.emit("button:pressed", buttonName);
          this.emit(`button:${buttonName}:pressed`);
        } else if (value === 0) {
          this.emit("button:released", buttonName);
          this.emit(`button:${buttonName}:released`);
        }
        return;
      }

      // Encoder rotation (relative encoding: 1-63 = CW, 65-127 = CCW)
      const encoderName = CC_TO_ENCODER[cc];
      if (encoderName) {
        const delta = value < 64 ? value : value - 128;
        this.emit("encoder:rotated", encoderName, delta);
        this.emit(`encoder:${encoderName}:rotated`, delta);
        return;
      }
    });

    this.midiInput.onNoteOn((evt) => {
      const { noteNum: note, velocity } = evt;

      // Pad press (notes 36-99)
      if (note >= 36 && note <= 99) {
        const ij = padNToIJ(note);
        this.emit("pad:pressed", note, ij, velocity);
        return;
      }

      // Encoder touch (notes 0-10)
      const encoderName = TOUCHNOTE_TO_ENCODER[note];
      if (encoderName) {
        this.emit("encoder:touched", encoderName);
        this.emit(`encoder:${encoderName}:touched`);
      }
    });

    this.midiInput.onNoteOff((evt) => {
      const { noteNum: note } = evt;

      if (note >= 36 && note <= 99) {
        const ij = padNToIJ(note);
        this.emit("pad:released", note, ij);
        return;
      }

      const encoderName = TOUCHNOTE_TO_ENCODER[note];
      if (encoderName) {
        this.emit("encoder:released", encoderName);
        this.emit(`encoder:${encoderName}:released`);
      }
    });

    this.midiInput.onPitchBend((evt) => {
      this.emit("touchstrip", evt.bend);
    });

    this.midiInput.onChannelPressure((evt) => {
      this.emit("aftertouch:channel", evt.pressure);
    });

    this.midiInput.onPolyPressure((evt) => {
      if (evt.noteNum >= 36 && evt.noteNum <= 99) {
        const ij = padNToIJ(evt.noteNum);
        this.emit("pad:aftertouch", evt.noteNum, ij, evt.pressure);
      }
    });
  }

  // --- Button events ---

  onButtonPressed(name: string, fn: () => void): () => void {
    if (!BUTTONS[name]) throw new Error(`Unknown button: ${name}`);
    return this.on(`button:${name}:pressed`, fn);
  }

  onButtonReleased(name: string, fn: () => void): () => void {
    if (!BUTTONS[name]) throw new Error(`Unknown button: ${name}`);
    return this.on(`button:${name}:released`, fn);
  }

  onAnyButtonPressed(fn: (name: string) => void): () => void {
    return this.on("button:pressed", fn);
  }

  onAnyButtonReleased(fn: (name: string) => void): () => void {
    return this.on("button:released", fn);
  }

  // --- Pad events ---

  onPadPressed(
    fn: (padN: number, padIJ: [number, number], velocity: number) => void,
  ): () => void {
    return this.on("pad:pressed", fn);
  }

  onPadReleased(
    fn: (padN: number, padIJ: [number, number]) => void,
  ): () => void {
    return this.on("pad:released", fn);
  }

  onPadAftertouch(
    fn: (padN: number, padIJ: [number, number], pressure: number) => void,
  ): () => void {
    return this.on("pad:aftertouch", fn);
  }

  // --- Encoder events ---

  onEncoderRotated(name: string, fn: (delta: number) => void): () => void {
    return this.on(`encoder:${name}:rotated`, fn);
  }

  onEncoderTouched(name: string, fn: () => void): () => void {
    return this.on(`encoder:${name}:touched`, fn);
  }

  onEncoderReleased(name: string, fn: () => void): () => void {
    return this.on(`encoder:${name}:released`, fn);
  }

  onAnyEncoderRotated(
    fn: (name: string, delta: number) => void,
  ): () => void {
    return this.on("encoder:rotated", fn);
  }

  onAnyEncoderTouched(fn: (name: string) => void): () => void {
    return this.on("encoder:touched", fn);
  }

  onAnyEncoderReleased(fn: (name: string) => void): () => void {
    return this.on("encoder:released", fn);
  }

  // --- Touchstrip ---

  onTouchstrip(fn: (value: number) => void): () => void {
    return this.on("touchstrip", fn);
  }

  // --- LEDs ---

  setPadColor(padN: number, colorIndex: number, animation: number = 0) {
    this.padState.set(padN, { colorIndex, animation });
    this.midiOutput.noteOn(animation, padN, colorIndex);
  }

  setButtonColor(name: string, colorIndex: number, animation: number = 0) {
    const cc = BUTTONS[name];
    if (cc === undefined) throw new Error(`Unknown button: ${name}`);
    this.buttonState.set(name, { colorIndex, animation });
    this.midiOutput.cc(animation, cc, colorIndex);
  }

  /** Re-send all tracked pad and button LED colors to the Push. */
  refreshLEDs() {
    for (const [padN, { colorIndex, animation }] of this.padState) {
      this.midiOutput.noteOn(animation, padN, colorIndex);
    }
    for (const [name, { colorIndex, animation }] of this.buttonState) {
      const cc = BUTTONS[name];
      if (cc !== undefined) this.midiOutput.cc(animation, cc, colorIndex);
    }
  }

  // --- Display ---

  async startDisplay(
    drawFn: (p5: P5GPU) => void,
    options: { fps?: number; displayLibPath?: string } = {},
  ): Promise<void> {
    this.display = await Push2Display.create(drawFn, options);
  }

  stopDisplay() {
    this.display?.stop();
  }

  // --- Raw MIDI ---

  sendMidi(bytes: Uint8Array | number[]) {
    this.midiOutput.send(bytes);
  }
}
