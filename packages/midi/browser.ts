/// <reference lib="dom" />

import {
  type IMIDIAccess as MidiValAccess,
  type IMIDIInput as MidiValInputPort,
  type IMIDIOutput as MidiValOutputPort,
  MIDIVal,
  MIDIValOutput,
} from "@midival/core";
import {
  decodeMidiMessage,
  type MidiAccess,
  MidiInput,
  MidiOutput,
  type MidiPortInfo,
} from "./api.ts";

export * from "./api.ts";

export interface BrowserMidiAccessOptions {
  /** Test/custom-runtime seam. Normal browser callers should omit this. */
  access?: MidiValAccess;
  /** Test/custom-runtime seam for the underlying Web MIDI port lifecycle. */
  webMidiAccess?: WebMidiPortAccess;
}

interface WebMidiPortAccess {
  readonly outputs: {
    get(portId: string): WebMidiOutputLifecycle | undefined;
  };
}

interface WebMidiOutputLifecycle {
  open(): Promise<unknown>;
  close(): Promise<unknown>;
}

export async function openMidiAccess(
  options: BrowserMidiAccessOptions = {},
): Promise<MidiAccess> {
  const access = options.access ?? await MIDIVal.connect();
  if (options.access) await access.connect();
  return new BrowserMidiAccess(access, options.webMidiAccess);
}

class BrowserMidiAccess implements MidiAccess {
  readonly backend = "browser" as const;
  readonly #opened = new Set<MidiOutput | MidiInput>();
  #closed = false;

  constructor(
    private readonly access: MidiValAccess,
    private webMidiAccess?: WebMidiPortAccess,
  ) {}

  listInputs(): MidiPortInfo[] {
    this.#assertOpen();
    return this.access.inputs.map((port) => portInfo(port, "input"));
  }

  async openInput(portId: string): Promise<MidiInput> {
    this.#assertOpen();
    const port = this.access.inputs.find((candidate) =>
      String(candidate.id) === portId
    );
    if (!port) throw new Error(`MIDI input not found: ${portId}`);

    // MIDIVal's raw onMessage seam hands over the Web MIDI bytes; decoding
    // here (not in MIDIVal's 1-based helpers) keeps the event shape identical
    // to the native backend. Removing the listener on close leaves the DOM
    // port open, since other code in the page may share it.
    const input = await MidiInput.open(
      portInfo(port, "input"),
      async (emit) => {
        const unregister = await port.onMessage((message) => {
          if (!message.data) return;
          const event = decodeMidiMessage(message.data, receiveTime(message));
          if (event) emit(event);
        });
        return { close: () => unregister() };
      },
    );
    this.#opened.add(input);
    return input;
  }

  listOutputs(): MidiPortInfo[] {
    this.#assertOpen();
    return this.access.outputs.map((port) => portInfo(port, "output"));
  }

  async openOutput(portId: string): Promise<MidiOutput> {
    this.#assertOpen();
    const port = this.access.outputs.find((candidate) =>
      String(candidate.id) === portId
    );
    if (!port) throw new Error(`MIDI output not found: ${portId}`);

    // MIDIVal deliberately exposes a small cross-runtime output interface and
    // does not surface Web MIDI's asynchronous port lifecycle. Explicitly
    // opening the corresponding DOM port prevents the first message from
    // being lost while Chrome/CoreMIDI is still opening it.
    this.webMidiAccess ??= await navigator.requestMIDIAccess();
    const webMidiPort = this.webMidiAccess.outputs.get(portId);
    if (!webMidiPort) {
      throw new Error(`Web MIDI output not found: ${portId}`);
    }
    await webMidiPort.open();

    // MIDIVal is the existing browser MIDI dependency. Use its raw send seam
    // so the shared wrapper, not MIDIVal's 1-based helpers, owns semantics.
    const midiValOutput = new MIDIValOutput(port);
    const output = new MidiOutput(portInfo(port, "output"), {
      send: (bytes) => midiValOutput.send(bytes),
      close: () => void webMidiPort.close(),
    });
    this.#opened.add(output);
    return output;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const output of this.#opened) output.close();
    this.#opened.clear();
    // MIDIVal owns one process-wide Web MIDI access object and does not expose
    // a corresponding close operation. Closing this wrapper prevents further
    // sends through outputs obtained from it and detaches its input listeners.
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Browser MIDI access is closed");
  }
}

function portInfo(
  port: MidiValInputPort | MidiValOutputPort,
  direction: "input" | "output",
): MidiPortInfo {
  return {
    id: String(port.id),
    name: normalizeText(port.name, `<unnamed MIDI ${direction}>`),
    manufacturer: normalizeNullableText(port.manufacturer),
  };
}

/**
 * MIDIVal types the browser callback argument as `{ receivedTime, data }`,
 * but its browser wrapper passes the DOM `MIDIMessageEvent` through, which
 * carries `timeStamp` instead. Accept either and fall back to now.
 */
function receiveTime(message: object): number {
  const { timeStamp, receivedTime } = message as {
    timeStamp?: unknown;
    receivedTime?: unknown;
  };
  if (typeof timeStamp === "number") return timeStamp;
  if (typeof receivedTime === "number") return receivedTime;
  return performance.now();
}

function normalizeText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function normalizeNullableText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
