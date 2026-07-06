import { MidiAccess, type PortInfo } from "../../midi/mod.ts";
import { clampMidi } from "./midi_math.ts";

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
  readonly port: PortInfo;
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
    readonly port: PortInfo,
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

const access = openMidiAccess();
const outputPorts = access ? safeListOutputs(access) : [];
const openedOutputs = new Map<string, LivecodeMidiOutput>();
const midiDevicesByName = Object.create(null) as Record<
  string,
  LivecodeMidiOutput
>;
const soundingNotes = new Map<
  string,
  { device: LivecodeMidiOutput; channel: number; pitch: number }
>();

for (const port of outputPorts) {
  try {
    const output = new LivecodeMidiOutputImpl(
      port,
      access!.openOutput(port.id),
    );
    registerOpenedOutput(output);
  } catch (error) {
    console.warn(
      `[midi-helpers] failed to open MIDI output "${port.name}"`,
      error,
    );
  }
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

export function listMidiDevices(): PortInfo[] {
  return [...outputPorts];
}

export function getMidiDevice(name: string): LivecodeMidiOutput {
  const output = findOpenedDevice(name);
  if (!output) {
    const available = outputPorts.map((candidate) => `"${candidate.name}"`)
      .join(
        ", ",
      );
    throw new Error(
      `MIDI output not found: "${name}". Available outputs: ${
        available || "none"
      }`,
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
}

export function __testingRegisterMidiOutput(
  port: PortInfo,
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

function openMidiAccess(): MidiAccess | null {
  try {
    return MidiAccess.open();
  } catch (error) {
    console.warn("[midi-helpers] MIDI unavailable", error);
    return null;
  }
}

function safeListOutputs(midiAccess: MidiAccess): PortInfo[] {
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
