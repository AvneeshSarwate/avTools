import { CALLBACK_DEF, openLibrary, readPortList, withPortId } from "./ffi.ts";
import type { MidiBridgeLibrary, MidiCallback } from "./ffi.ts";
import type { PortInfo } from "./types.ts";
import type { MidiInputOptions } from "./midi_input.ts";
import { MidiInput } from "./midi_input.ts";
import { MidiOutput } from "./midi_output.ts";

export type MidiAccessOptions = {
  libPath?: string;
};

export class MidiAccess {
  #lib: MidiBridgeLibrary;

  private constructor(lib: MidiBridgeLibrary) {
    this.#lib = lib;
  }

  static open(options: MidiAccessOptions = {}) {
    return new MidiAccess(openLibrary(options.libPath));
  }

  close() {
    this.#lib.close();
  }

  listInputs(): PortInfo[] {
    return readPortList(this.#lib, "midi_list_inputs");
  }

  listOutputs(): PortInfo[] {
    return readPortList(this.#lib, "midi_list_outputs");
  }

  openInput(portId: string, options: MidiInputOptions = {}) {
    let handler: (bytes: Uint8Array) => void = () => {};
    const callback: MidiCallback = Deno.UnsafeCallback.threadSafe(CALLBACK_DEF, (ptr, len) => {
      try {
        if (ptr === null) return;
        const bytes = new Uint8Array(Number(len));
        Deno.UnsafePointerView.copyInto(ptr, bytes);
        handler(bytes);
      } catch (err) {
        console.error("midi input callback error", err);
      }
    });

    if (options.keepAlive === false) {
      callback.unref();
    }

    const handle = withPortId(portId, (ptr, len) =>
      this.#lib.symbols.midi_open_input(
        ptr,
        len,
        options.rateHz ?? 250,
        options.flags ?? 0,
        callback.pointer,
      )
    );

    if (handle === 0) {
      callback.close();
      throw new Error("Failed to open MIDI input");
    }

    const input = new MidiInput(this.#lib, handle, callback);
    handler = (bytes) => input._handlePacket(bytes);
    return input;
  }

  openOutput(portId: string) {
    const handle = withPortId(portId, (ptr, len) =>
      this.#lib.symbols.midi_open_output(ptr, len)
    );
    if (handle === 0) {
      throw new Error("Failed to open MIDI output");
    }
    return new MidiOutput(this.#lib, handle);
  }
}
