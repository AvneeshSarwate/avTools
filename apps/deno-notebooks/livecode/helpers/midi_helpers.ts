import { MidiAccess, MidiOutput, type PortInfo } from "../../midi/mod.ts";

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

  constructor(readonly port: PortInfo, private readonly output: MidiOutput) {
    this.name = port.name;
  }

  noteOn(channel: number, pitch: number, velocity = 100) {
    this.output.noteOn(channel, pitch, velocity);
  }

  noteOff(channel: number, pitch: number, velocity = 0) {
    this.output.noteOff(channel, pitch, velocity);
  }

  cc(channel: number, controller: number, value: number) {
    this.output.cc(channel, controller, value);
  }

  pitchBend(channel: number, bend: number) {
    this.output.pitchBend(channel, bend);
  }

  programChange(channel: number, program: number) {
    this.output.programChange(channel, program);
  }

  raw(bytes: Uint8Array | number[]) {
    this.output.send(bytes);
  }

  close() {
    this.output.close();
  }
}

const access = MidiAccess.open();
const outputPorts = access.listOutputs();
const openedOutputs = new Map<string, LivecodeMidiOutput>();
const midiDevicesByName = Object.create(null) as Record<
  string,
  LivecodeMidiOutput
>;

for (const port of outputPorts) {
  const output = new LivecodeMidiOutputImpl(port, access.openOutput(port.id));
  openedOutputs.set(port.name, output);
  midiDevicesByName[port.name] = output;
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

export function closeMidiDevices() {
  for (const output of openedOutputs.values()) {
    output.close();
  }
  openedOutputs.clear();
  for (const name of Object.keys(midiDevicesByName)) {
    delete midiDevicesByName[name];
  }
  access.close();
}
