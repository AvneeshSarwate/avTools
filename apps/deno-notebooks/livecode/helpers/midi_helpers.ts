import {
  detectMidiBackend,
  type MidiAccess,
  openMidiAccess,
} from "@avtools/midi";
import { clampMidi } from "./midi_math.ts";

/**
 * Port identity as this module exposes it. Structurally compatible with both
 * the package's `MidiPortInfo` and the bare `{ id, name }` rows the old FFI
 * bridge returned, so existing callers and tests keep working.
 */
export interface LivecodePortInfo {
  readonly id: string;
  readonly name: string;
  readonly manufacturer?: string | null;
}

export interface MidiOutputTransport {
  noteOn(channel: number, pitch: number, velocity: number): void;
  noteOff(channel: number, pitch: number, velocity: number): void;
  cc(channel: number, controller: number, value: number): void;
  pitchBend(channel: number, bend: number): void;
  programChange(channel: number, program: number): void;
  send(bytes: Uint8Array | number[]): void;
  close(): void;
}

export interface LivecodeMidiOutput {
  readonly name: string;
  readonly port: LivecodePortInfo;
  noteOn(channel: number, pitch: number, velocity?: number): void;
  noteOff(channel: number, pitch: number, velocity?: number): void;
  cc(channel: number, controller: number, value: number): void;
  pitchBend(channel: number, bend: number): void;
  programChange(channel: number, program: number): void;
  raw(bytes: Uint8Array | number[]): void;
  close(): void;
}

class LivecodeMidiOutputImpl implements LivecodeMidiOutput {
  readonly name: string;

  constructor(
    readonly port: LivecodePortInfo,
    private readonly output: MidiOutputTransport,
  ) {
    this.name = port.name;
  }

  noteOn(channel: number, pitch: number, velocity = 100) {
    const normalized = normalizeNote(channel, pitch);
    try {
      this.output.noteOn(normalized.channel, normalized.pitch, velocity);
      soundingNotes.set(
        noteKey(this.name, normalized.channel, normalized.pitch),
        {
          device: this,
          channel: normalized.channel,
          pitch: normalized.pitch,
        },
      );
    } catch (error) {
      logMidiSendError("noteOn", this.name, error);
    }
  }

  noteOff(channel: number, pitch: number, velocity = 0) {
    const normalized = normalizeNote(channel, pitch);
    try {
      this.output.noteOff(normalized.channel, normalized.pitch, velocity);
    } catch (error) {
      logMidiSendError("noteOff", this.name, error);
    } finally {
      soundingNotes.delete(
        noteKey(this.name, normalized.channel, normalized.pitch),
      );
    }
  }

  cc(channel: number, controller: number, value: number) {
    try {
      this.output.cc(
        clampMidi(channel, 0, 15),
        clampMidi(controller),
        clampMidi(value),
      );
    } catch (error) {
      logMidiSendError("cc", this.name, error);
    }
  }

  pitchBend(channel: number, bend: number) {
    try {
      this.output.pitchBend(clampMidi(channel, 0, 15), bend);
    } catch (error) {
      logMidiSendError("pitchBend", this.name, error);
    }
  }

  programChange(channel: number, program: number) {
    try {
      this.output.programChange(clampMidi(channel, 0, 15), clampMidi(program));
    } catch (error) {
      logMidiSendError("programChange", this.name, error);
    }
  }

  raw(bytes: Uint8Array | number[]) {
    try {
      this.output.send(bytes);
    } catch (error) {
      logMidiSendError("raw", this.name, error);
    }
  }

  close() {
    try {
      this.output.close();
    } catch (error) {
      logMidiSendError("close", this.name, error);
    }
  }
}

let access: MidiAccess | null = null;
let outputPorts: LivecodePortInfo[] = [];
let initPromise: Promise<void> | null = null;
const openedOutputs = new Map<string, LivecodeMidiOutput>();
const midiDevicesByName = Object.create(null) as Record<
  string,
  LivecodeMidiOutput
>;
const soundingNotes = new Map<
  string,
  { device: LivecodeMidiOutput; channel: number; pitch: number }
>();

/**
 * Open MIDI access and every output port. Idempotent; concurrent callers share
 * one pass. Failure degrades to "no devices" with one warning rather than
 * throwing into caller code, matching the old eager-open behavior.
 *
 * On the native (Deno FFI) backend this runs eagerly at module import, below,
 * so existing modules that address `midiDevices` synchronously keep working —
 * including under a plain `deno run`. In a browser, Web MIDI is
 * permission-prompted, so nothing may open at import time: call `initMidi()`
 * from a user gesture before using devices.
 */
export function initMidi(): Promise<void> {
  initPromise ??= (async () => {
    try {
      access = await openMidiAccess();
    } catch (error) {
      console.warn("[midi-helpers] MIDI unavailable", error);
      access = null;
      outputPorts = [];
      // Clear the latch: in a browser this path is a denied or dismissed
      // permission prompt, and a later initMidi() from a real user gesture
      // must be able to re-prompt instead of replaying this failure forever.
      initPromise = null;
      return;
    }
    outputPorts = safeListOutputs(access);
    for (const port of outputPorts) {
      try {
        const transport = await access.openOutput(port.id);
        registerOpenedOutput(new LivecodeMidiOutputImpl(port, transport));
      } catch (error) {
        console.warn(
          `[midi-helpers] failed to open MIDI output "${port.name}"`,
          error,
        );
      }
    }
  })();
  return initPromise;
}

if (detectMidiBackend() === "native") {
  await initMidi();
}

export const midiDevices = new Proxy(midiDevicesByName, {
  get(target, property, receiver) {
    if (typeof property !== "string") {
      return Reflect.get(target, property, receiver);
    }
    if (property in target) return Reflect.get(target, property, receiver);
    if (
      property === "then" || property === "toJSON" || property === "inspect" ||
      property === "toString" || property === "valueOf"
    ) {
      return undefined;
    }
    return getMidiDevice(property);
  },
}) as Record<string, LivecodeMidiOutput>;

export function listMidiDevices(): LivecodePortInfo[] {
  return [...outputPorts];
}

/** True once MIDI access opened, even with zero output ports — lets a host
 * distinguish "no devices" from "init failed / never ran". */
export function hasMidiAccess(): boolean {
  return access !== null;
}

export function getMidiDevice(name: string): LivecodeMidiOutput {
  const output = findOpenedDevice(name);
  if (!output) {
    const available = outputPorts.map((candidate) => `"${candidate.name}"`)
      .join(
        ", ",
      );
    const hint = initPromise
      ? ""
      : " (MIDI is not initialized; browser hosts must call initMidi() from a user gesture first)";
    throw new Error(
      `MIDI output not found: "${name}". Available outputs: ${
        available || "none"
      }${hint}`,
    );
  }
  return output;
}

function findOpenedDevice(name: string): LivecodeMidiOutput | undefined {
  return openedOutputs.get(name) ??
    [...openedOutputs.entries()].find(([candidateName]) =>
      candidateName.includes(name)
    )?.[1];
}

export const requireMidiDevice = getMidiDevice;

export function panicMidi(): void {
  const entries = [...soundingNotes.values()];
  const channelsByDevice = new Map<LivecodeMidiOutput, Set<number>>();
  for (const output of openedOutputs.values()) {
    channelsByDevice.set(output, new Set([0]));
  }
  for (const entry of entries) {
    const channels = channelsByDevice.get(entry.device) ?? new Set([0]);
    channels.add(entry.channel);
    channelsByDevice.set(entry.device, channels);
  }

  for (const output of openedOutputs.values()) {
    for (const entry of entries) {
      if (entry.device !== output) continue;
      output.noteOff(entry.channel, entry.pitch, 0);
    }
    const channels = channelsByDevice.get(output) ?? new Set([0]);
    for (const channel of channels) {
      output.cc(channel, 123, 0);
      output.cc(channel, 120, 0);
    }
  }

  soundingNotes.clear();
}

export function closeMidiDevices() {
  panicMidi();
  for (const output of openedOutputs.values()) {
    output.close();
  }
  openedOutputs.clear();
  for (const name of Object.keys(midiDevicesByName)) {
    delete midiDevicesByName[name];
  }
  try {
    access?.close();
  } catch (error) {
    console.warn("[midi-helpers] failed to close MIDI access", error);
  }
  access = null;
  outputPorts = [];
  // A later initMidi() may open fresh access (Web MIDI can be re-requested;
  // the native bridge reopens its library handle).
  initPromise = null;
}

export function __testingRegisterMidiOutput(
  port: LivecodePortInfo,
  output: MidiOutputTransport,
): () => void {
  const device = new LivecodeMidiOutputImpl(port, output);
  registerOpenedOutput(device);
  return () => {
    openedOutputs.delete(port.name);
    delete midiDevicesByName[port.name];
    for (const [key, note] of soundingNotes) {
      if (note.device === device) soundingNotes.delete(key);
    }
  };
}

export function __testingSoundingNoteCount(): number {
  return soundingNotes.size;
}

function safeListOutputs(midiAccess: MidiAccess): LivecodePortInfo[] {
  try {
    return midiAccess.listOutputs();
  } catch (error) {
    console.warn("[midi-helpers] failed to list MIDI outputs", error);
    return [];
  }
}

function registerOpenedOutput(output: LivecodeMidiOutput): void {
  openedOutputs.set(output.name, output);
  midiDevicesByName[output.name] = output;
}

function normalizeNote(
  channel: number,
  pitch: number,
): { channel: number; pitch: number } {
  return {
    channel: clampMidi(channel, 0, 15),
    pitch: clampMidi(pitch),
  };
}

function noteKey(deviceName: string, channel: number, pitch: number): string {
  return `${deviceName}:${channel}:${pitch}`;
}

function logMidiSendError(action: string, deviceName: string, error: unknown) {
  console.error(
    `[midi-helpers] MIDI ${action} failed on "${deviceName}"`,
    error,
  );
}
