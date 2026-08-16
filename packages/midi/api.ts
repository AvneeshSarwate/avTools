export type MidiBackend = "browser" | "native";

export interface MidiPortInfo {
  readonly id: string;
  readonly name: string;
  readonly manufacturer: string | null;
}

export interface MidiOutputTransport {
  send(bytes: Uint8Array | number[]): void;
  close?(): void;
}

export interface MidiAccess {
  readonly backend: MidiBackend;
  listOutputs(): MidiPortInfo[];
  openOutput(portId: string): Promise<MidiOutput>;
  close(): void;
}

/**
 * Runtime-neutral MIDI output.
 *
 * Channels are always zero-based (0..15). Seven-bit values are rounded and
 * clamped to 0..127. Pitch bend is a signed integer from -8192..8191.
 */
export class MidiOutput {
  readonly name: string;
  #closed = false;

  constructor(
    readonly port: MidiPortInfo,
    private readonly transport: MidiOutputTransport,
  ) {
    this.name = port.name;
  }

  get closed(): boolean {
    return this.#closed;
  }

  send(bytes: Uint8Array | number[]): void {
    this.#assertOpen();
    const message = bytes instanceof Uint8Array
      ? new Uint8Array(bytes)
      : Uint8Array.from(bytes);
    if (message.length === 0) {
      throw new RangeError("A MIDI message must contain at least one byte");
    }
    this.transport.send(message);
  }

  noteOn(channel: number, note: number, velocity = 100): void {
    this.send([
      0x90 | midiChannel(channel),
      midi7Bit(note),
      midi7Bit(velocity),
    ]);
  }

  noteOff(channel: number, note: number, velocity = 0): void {
    this.send([
      0x80 | midiChannel(channel),
      midi7Bit(note),
      midi7Bit(velocity),
    ]);
  }

  polyPressure(channel: number, note: number, pressure: number): void {
    this.send([
      0xA0 | midiChannel(channel),
      midi7Bit(note),
      midi7Bit(pressure),
    ]);
  }

  cc(channel: number, controller: number, value: number): void {
    this.send([
      0xB0 | midiChannel(channel),
      midi7Bit(controller),
      midi7Bit(value),
    ]);
  }

  programChange(channel: number, program: number): void {
    this.send([0xC0 | midiChannel(channel), midi7Bit(program)]);
  }

  channelPressure(channel: number, pressure: number): void {
    this.send([0xD0 | midiChannel(channel), midi7Bit(pressure)]);
  }

  pitchBend(channel: number, bend: number): void {
    const value = clampInteger(bend, -8192, 8191) + 8192;
    this.send([
      0xE0 | midiChannel(channel),
      value & 0x7f,
      (value >> 7) & 0x7f,
    ]);
  }

  allSoundOff(channel: number): void {
    this.cc(channel, 120, 0);
  }

  allNotesOff(channel: number): void {
    this.cc(channel, 123, 0);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.transport.close?.();
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new Error(`MIDI output "${this.name}" is closed`);
    }
  }
}

function midiChannel(value: number): number {
  return clampInteger(value, 0, 15);
}

function midi7Bit(value: number): number {
  return clampInteger(value, 0, 127);
}

function clampInteger(value: number, min: number, max: number): number {
  const finite = Number.isFinite(value) ? value : 0;
  return Math.max(min, Math.min(max, Math.round(finite)));
}
