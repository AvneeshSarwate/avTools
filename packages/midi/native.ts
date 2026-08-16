import {
  MidiAccess as NativeMidiBridgeAccess,
  type MidiAccessOptions as NativeBridgeOptions,
} from "../../apps/deno-notebooks/midi/mod.ts";
import { type MidiAccess, MidiOutput, type MidiPortInfo } from "./api.ts";

export * from "./api.ts";

export type NativeMidiAccessOptions = NativeBridgeOptions;

export async function openMidiAccess(
  options: NativeMidiAccessOptions = {},
): Promise<MidiAccess> {
  return new NativeMidiAccess(NativeMidiBridgeAccess.open(options));
}

type NativeAccess = ReturnType<typeof NativeMidiBridgeAccess.open>;

class NativeMidiAccess implements MidiAccess {
  readonly backend = "native" as const;
  readonly #opened = new Set<MidiOutput>();
  #closed = false;

  constructor(private readonly access: NativeAccess) {}

  listOutputs(): MidiPortInfo[] {
    this.#assertOpen();
    return this.access.listOutputs().map((port) => ({
      ...port,
      manufacturer: null,
    }));
  }

  async openOutput(portId: string): Promise<MidiOutput> {
    this.#assertOpen();
    const port = this.listOutputs().find((candidate) =>
      candidate.id === portId
    );
    if (!port) throw new Error(`MIDI output not found: ${portId}`);

    const nativeOutput = this.access.openOutput(portId);
    const output = new MidiOutput(port, {
      send: (bytes) => nativeOutput.send(bytes),
      close: () => nativeOutput.close(),
    });
    this.#opened.add(output);
    return output;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const output of this.#opened) output.close();
    this.#opened.clear();
    this.access.close();
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Native MIDI access is closed");
  }
}
