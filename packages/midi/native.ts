import {
  MidiAccess as NativeMidiBridgeAccess,
  type MidiAccessOptions as NativeBridgeOptions,
} from "../../apps/deno-notebooks/midi/mod.ts";
import {
  type MidiAccess,
  MidiInput,
  MidiOutput,
  type MidiPortInfo,
} from "./api.ts";

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
  readonly #opened = new Set<MidiOutput | MidiInput>();
  #closed = false;

  constructor(private readonly access: NativeAccess) {}

  listInputs(): MidiPortInfo[] {
    this.#assertOpen();
    return this.access.listInputs().map((port) => ({
      ...port,
      manufacturer: null,
    }));
  }

  async openInput(portId: string): Promise<MidiInput> {
    this.#assertOpen();
    const port = this.listInputs().find((candidate) => candidate.id === portId);
    if (!port) throw new Error(`MIDI input not found: ${portId}`);

    const input = await MidiInput.open(port, (emit) => {
      // rawCC disables the bridge's per-tick CC coalescing so every CC edge
      // arrives. Pitch bend, pressure and program change have no raw mode in
      // the bridge and stay "latest wins" per dispatch tick (4 ms at 250 Hz).
      // Note edges are never coalesced. Records within a tick arrive sorted
      // by timestamp, and each typed listener fires in record order, so
      // subscribing per type preserves cross-type ordering.
      const native = this.access.openInput(portId, {
        rateHz: 250,
        rawCC: true,
      });
      const at = (tsUs: number) => tsUs / 1000;
      native.onNote(({ channel, noteNum, on, velocity, tsUs }) =>
        emit({
          type: on ? "noteOn" : "noteOff",
          channel,
          note: noteNum,
          velocity,
          timeMs: at(tsUs),
        })
      );
      native.onCC(({ channel, ctrlNum, ctrlVal, tsUs }) =>
        emit({
          type: "cc",
          channel,
          controller: ctrlNum,
          value: ctrlVal,
          timeMs: at(tsUs),
        })
      );
      native.onPitchBend(({ channel, bend, tsUs }) =>
        emit({ type: "pitchBend", channel, bend, timeMs: at(tsUs) })
      );
      native.onPolyPressure(({ channel, noteNum, pressure, tsUs }) =>
        emit({
          type: "polyPressure",
          channel,
          note: noteNum,
          pressure,
          timeMs: at(tsUs),
        })
      );
      native.onChannelPressure(({ channel, pressure, tsUs }) =>
        emit({ type: "channelPressure", channel, pressure, timeMs: at(tsUs) })
      );
      native.onProgramChange(({ channel, program, tsUs }) =>
        emit({ type: "programChange", channel, program, timeMs: at(tsUs) })
      );
      return { close: () => native.close() };
    });
    this.#opened.add(input);
    return input;
  }

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
