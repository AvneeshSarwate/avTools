/// <reference lib="dom" />

import {
  type IMIDIAccess as MidiValAccess,
  type IMIDIOutput as MidiValOutputPort,
  MIDIVal,
  MIDIValOutput,
} from "@midival/core";
import { type MidiAccess, MidiOutput, type MidiPortInfo } from "./api.ts";

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
  readonly #opened = new Set<MidiOutput>();
  #closed = false;

  constructor(
    private readonly access: MidiValAccess,
    private webMidiAccess?: WebMidiPortAccess,
  ) {}

  listOutputs(): MidiPortInfo[] {
    this.#assertOpen();
    return this.access.outputs.map(portInfo);
  }

  async openOutput(portId: string): Promise<MidiOutput> {
    this.#assertOpen();
    const port = this.access.outputs.find((candidate) =>
      candidate.id === portId
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
    const output = new MidiOutput(portInfo(port), {
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
    // sends through outputs obtained from it.
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Browser MIDI access is closed");
  }
}

function portInfo(port: MidiValOutputPort): MidiPortInfo {
  return {
    id: String(port.id),
    name: normalizeText(port.name, "<unnamed MIDI output>"),
    manufacturer: normalizeNullableText(port.manufacturer),
  };
}

function normalizeText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function normalizeNullableText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
