export type MidiBackend = "browser" | "native";

/** Pure host detection: Web MIDI present means browser backend. */
export function detectMidiBackend(): MidiBackend {
  const candidate = globalThis as typeof globalThis & {
    navigator?: { requestMIDIAccess?: unknown };
  };
  return typeof candidate.navigator?.requestMIDIAccess === "function"
    ? "browser"
    : "native";
}

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
  listInputs(): MidiPortInfo[];
  openInput(portId: string): Promise<MidiInput>;
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

/**
 * A decoded channel-voice message. Channels are zero-based (0..15) and pitch
 * bend is signed (-8192..8191), matching `MidiOutput`. A note-on with velocity
 * 0 is reported as `noteOff` with velocity 0 on every backend.
 *
 * `timeMs` is the backend's receive timestamp in milliseconds. It is monotonic
 * within one input but its origin is backend-specific (`performance.now()` in
 * a browser, midir's clock natively), so use it only for deltas between events
 * from the same input, never to compare against another clock.
 */
export type MidiInputEvent =
  | {
    readonly type: "noteOn";
    readonly channel: number;
    readonly note: number;
    readonly velocity: number;
    readonly timeMs: number;
  }
  | {
    readonly type: "noteOff";
    readonly channel: number;
    readonly note: number;
    readonly velocity: number;
    readonly timeMs: number;
  }
  | {
    readonly type: "polyPressure";
    readonly channel: number;
    readonly note: number;
    readonly pressure: number;
    readonly timeMs: number;
  }
  | {
    readonly type: "cc";
    readonly channel: number;
    readonly controller: number;
    readonly value: number;
    readonly timeMs: number;
  }
  | {
    readonly type: "programChange";
    readonly channel: number;
    readonly program: number;
    readonly timeMs: number;
  }
  | {
    readonly type: "channelPressure";
    readonly channel: number;
    readonly pressure: number;
    readonly timeMs: number;
  }
  | {
    readonly type: "pitchBend";
    readonly channel: number;
    readonly bend: number;
    readonly timeMs: number;
  };

export type MidiInputEventType = MidiInputEvent["type"];

export type MidiInputListener<
  T extends MidiInputEventType = MidiInputEventType,
> = (event: Extract<MidiInputEvent, { type: T }>) => void;

/** Delivers decoded events into a `MidiInput`; returned by a backend's connect. */
export interface MidiInputTransport {
  close?(): void;
}

export type MidiInputConnect = (
  emit: (event: MidiInputEvent) => void,
) => MidiInputTransport | Promise<MidiInputTransport>;

/**
 * Runtime-neutral MIDI input.
 *
 * Only channel-voice messages are surfaced; system messages (SysEx, clock,
 * transport) are dropped because the native bridge does not forward them.
 * Listeners run synchronously in arrival order. A throwing listener is
 * reported and does not prevent the remaining listeners from running.
 */
export class MidiInput {
  readonly name: string;
  readonly #listeners = new Set<MidiInputListener>();
  #transport: MidiInputTransport | null = null;
  #closed = false;

  private constructor(readonly port: MidiPortInfo) {
    this.name = port.name;
  }

  /** Backend seam: `connect` receives the emitter this input dispatches from. */
  static async open(
    port: MidiPortInfo,
    connect: MidiInputConnect,
  ): Promise<MidiInput> {
    const input = new MidiInput(port);
    input.#transport = await connect((event) => input.#dispatch(event));
    return input;
  }

  get closed(): boolean {
    return this.#closed;
  }

  /** Subscribe to every message. Returns an unsubscribe function. */
  onMessage(listener: MidiInputListener): () => void {
    this.#assertOpen();
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Subscribe to one message type. Returns an unsubscribe function. */
  on<T extends MidiInputEventType>(
    type: T,
    listener: MidiInputListener<T>,
  ): () => void {
    return this.onMessage((event) => {
      if (event.type === type) {
        listener(event as Extract<MidiInputEvent, { type: T }>);
      }
    });
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#listeners.clear();
    this.#transport?.close?.();
    this.#transport = null;
  }

  #dispatch(event: MidiInputEvent): void {
    if (this.#closed) return;
    for (const listener of [...this.#listeners]) {
      try {
        listener(event);
      } catch (error) {
        // Not `reportError`: in Deno an unhandled report terminates the
        // process, and an input callback must never take down its host.
        console.error(`MIDI input "${this.name}" listener error`, error);
      }
    }
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new Error(`MIDI input "${this.name}" is closed`);
    }
  }
}

/**
 * Decode one raw channel-voice message. Returns null for system messages,
 * data bytes without a status byte, and truncated messages.
 */
export function decodeMidiMessage(
  bytes: ArrayLike<number>,
  timeMs: number,
): MidiInputEvent | null {
  const status = bytes[0];
  if (status === undefined || status < 0x80 || status >= 0xF0) return null;
  const channel = status & 0x0f;
  const kind = status & 0xf0;
  const expected = kind === 0xC0 || kind === 0xD0 ? 2 : 3;
  if (bytes.length < expected) return null;
  const a = bytes[1] & 0x7f;
  const b = expected === 3 ? bytes[2] & 0x7f : 0;

  switch (kind) {
    case 0x80:
      return { type: "noteOff", channel, note: a, velocity: b, timeMs };
    case 0x90:
      return b === 0
        ? { type: "noteOff", channel, note: a, velocity: 0, timeMs }
        : { type: "noteOn", channel, note: a, velocity: b, timeMs };
    case 0xA0:
      return { type: "polyPressure", channel, note: a, pressure: b, timeMs };
    case 0xB0:
      return { type: "cc", channel, controller: a, value: b, timeMs };
    case 0xC0:
      return { type: "programChange", channel, program: a, timeMs };
    case 0xD0:
      return { type: "channelPressure", channel, pressure: a, timeMs };
    default:
      return {
        type: "pitchBend",
        channel,
        bend: ((b << 7) | a) - 8192,
        timeMs,
      };
  }
}
