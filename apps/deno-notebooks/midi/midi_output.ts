import type { MidiBridgeLibrary } from "./ffi.ts";

export class MidiOutput {
  #lib: MidiBridgeLibrary;
  #handle: number;
  #closed = false;

  constructor(lib: MidiBridgeLibrary, handle: number) {
    this.#lib = lib;
    this.#handle = handle;
  }

  close() {
    if (this.#closed) return;
    this.#lib.symbols.midi_close_output(this.#handle);
    this.#closed = true;
  }

  send(bytes: Uint8Array | number[]) {
    const buf = bytes instanceof Uint8Array ? new Uint8Array(bytes) : Uint8Array.from(bytes);
    const ptr = Deno.UnsafePointer.of(buf as Uint8Array<ArrayBuffer>);
    this.#lib.symbols.midi_send(this.#handle, ptr, buf.length);
  }

  cc(channel: number, ctrlNum: number, ctrlVal: number) {
    const status = 0xB0 | (channel & 0x0f);
    this.send([status, ctrlNum & 0x7f, ctrlVal & 0x7f]);
  }

  pitchBend(channel: number, bend: number) {
    const status = 0xE0 | (channel & 0x0f);
    const value = clamp(bend + 8192, 0, 16383);
    const lsb = value & 0x7f;
    const msb = (value >> 7) & 0x7f;
    this.send([status, lsb, msb]);
  }

  noteOn(channel: number, noteNum: number, velocity: number) {
    const status = 0x90 | (channel & 0x0f);
    this.send([status, noteNum & 0x7f, velocity & 0x7f]);
  }

  noteOff(channel: number, noteNum: number, velocity: number) {
    const status = 0x80 | (channel & 0x0f);
    this.send([status, noteNum & 0x7f, velocity & 0x7f]);
  }

  channelPressure(channel: number, pressure: number) {
    const status = 0xD0 | (channel & 0x0f);
    this.send([status, pressure & 0x7f]);
  }

  programChange(channel: number, program: number) {
    const status = 0xC0 | (channel & 0x0f);
    this.send([status, program & 0x7f]);
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
