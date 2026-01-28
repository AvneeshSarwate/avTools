import {
  KIND_CC,
  KIND_CH_PRESS,
  KIND_NOTE,
  KIND_PB,
  KIND_POLY_PRESS,
  KIND_PROG,
  MAGIC,
  VERSION,
} from "./decode.ts";
import type { MidiBridgeLibrary, MidiCallback } from "./ffi.ts";
import type {
  CCEvent,
  ChannelPressureEvent,
  NoteEvent,
  NoteOffEvent,
  NoteOnEvent,
  PitchBendEvent,
  PolyPressureEvent,
  ProgramChangeEvent,
  TickPayload,
} from "./types.ts";
import type { MPEConfig } from "./mpe.ts";
import { MPEInput } from "./mpe.ts";

export type MidiInputOptions = {
  rateHz?: number;
  flags?: number;
  keepAlive?: boolean;
};

type Listener<T> = (event: T) => void;

export class MidiInput {
  #lib: MidiBridgeLibrary;
  #handle: number;
  #callback: MidiCallback;
  #closed = false;

  #ccListeners = new Set<Listener<CCEvent>>();
  #pbListeners = new Set<Listener<PitchBendEvent>>();
  #chPressureListeners = new Set<Listener<ChannelPressureEvent>>();
  #polyPressureListeners = new Set<Listener<PolyPressureEvent>>();
  #programListeners = new Set<Listener<ProgramChangeEvent>>();
  #noteOnListeners = new Set<Listener<NoteOnEvent>>();
  #noteOffListeners = new Set<Listener<NoteOffEvent>>();
  #noteListeners = new Set<Listener<NoteEvent>>();
  #tickListeners = new Set<Listener<TickPayload>>();

  constructor(lib: MidiBridgeLibrary, handle: number, callback: MidiCallback) {
    this.#lib = lib;
    this.#handle = handle;
    this.#callback = callback;
  }

  close() {
    if (this.#closed) return;
    this.#lib.symbols.midi_close_input(this.#handle);
    this.#callback.close();
    this.#closed = true;
  }

  onCC(fn: Listener<CCEvent>) {
    this.#ccListeners.add(fn);
    return () => this.#ccListeners.delete(fn);
  }

  onPitchBend(fn: Listener<PitchBendEvent>) {
    this.#pbListeners.add(fn);
    return () => this.#pbListeners.delete(fn);
  }

  onChannelPressure(fn: Listener<ChannelPressureEvent>) {
    this.#chPressureListeners.add(fn);
    return () => this.#chPressureListeners.delete(fn);
  }

  onPolyPressure(fn: Listener<PolyPressureEvent>) {
    this.#polyPressureListeners.add(fn);
    return () => this.#polyPressureListeners.delete(fn);
  }

  onProgramChange(fn: Listener<ProgramChangeEvent>) {
    this.#programListeners.add(fn);
    return () => this.#programListeners.delete(fn);
  }

  onNoteOn(fn: Listener<NoteOnEvent>) {
    this.#noteOnListeners.add(fn);
    return () => this.#noteOnListeners.delete(fn);
  }

  onNoteOff(fn: Listener<NoteOffEvent>) {
    this.#noteOffListeners.add(fn);
    return () => this.#noteOffListeners.delete(fn);
  }

  onNote(fn: Listener<NoteEvent>) {
    this.#noteListeners.add(fn);
    return () => this.#noteListeners.delete(fn);
  }

  onTick(fn: Listener<TickPayload>) {
    this.#tickListeners.add(fn);
    return () => this.#tickListeners.delete(fn);
  }

  asMPE(config: MPEConfig) {
    return new MPEInput(this, config);
  }

  _handlePacket(bytes: Uint8Array) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 32) return;
    const magic = view.getUint32(0, true);
    if (magic !== MAGIC) return;
    const version = view.getUint16(4, true);
    if (version !== VERSION) return;

    const dispatchTsUs = Number(view.getBigUint64(8, true));
    const droppedRaw = view.getUint32(16, true);
    const droppedNote = view.getUint32(20, true);
    const recordCount = view.getUint32(24, true);

    const available = Math.floor((bytes.length - 32) / 16);
    const count = Math.min(recordCount, available);

    const wantTick = this.#tickListeners.size > 0;
    const tick: TickPayload | null = wantTick
      ? {
        tsUs: dispatchTsUs,
        droppedRaw,
        droppedNote,
        ccChanges: [],
        pbChanges: [],
        chPressureChanges: [],
        polyPressureChanges: [],
        programChanges: [],
        noteEvents: [],
      }
      : null;

    let offset = 32;
    for (let i = 0; i < count; i++) {
      const tsUs = Number(view.getBigUint64(offset, true));
      const kind = view.getUint8(offset + 8);
      const channel = view.getUint8(offset + 9);
      const a = view.getUint8(offset + 10);
      const b = view.getUint8(offset + 11);
      const v16 = view.getInt16(offset + 12, true);
      const extra = view.getUint16(offset + 14, true);
      offset += 16;

      switch (kind) {
        case KIND_CC: {
          if (this.#ccListeners.size === 0 && !tick) break;
          const payload: CCEvent = {
            channel,
            ctrlNum: a,
            ctrlVal: b,
            tsUs,
          };
          if (tick) tick.ccChanges.push(payload);
          if (this.#ccListeners.size) {
            for (const fn of this.#ccListeners) fn(payload);
          }
          break;
        }
        case KIND_PB: {
          if (this.#pbListeners.size === 0 && !tick) break;
          const payload: PitchBendEvent = { channel, bend: v16, tsUs };
          if (tick) tick.pbChanges.push(payload);
          if (this.#pbListeners.size) {
            for (const fn of this.#pbListeners) fn(payload);
          }
          break;
        }
        case KIND_CH_PRESS: {
          if (this.#chPressureListeners.size === 0 && !tick) break;
          const payload: ChannelPressureEvent = { channel, pressure: b, tsUs };
          if (tick) tick.chPressureChanges.push(payload);
          if (this.#chPressureListeners.size) {
            for (const fn of this.#chPressureListeners) fn(payload);
          }
          break;
        }
        case KIND_POLY_PRESS: {
          if (this.#polyPressureListeners.size === 0 && !tick) break;
          const payload: PolyPressureEvent = {
            channel,
            noteNum: a,
            pressure: b,
            tsUs,
          };
          if (tick) tick.polyPressureChanges.push(payload);
          if (this.#polyPressureListeners.size) {
            for (const fn of this.#polyPressureListeners) fn(payload);
          }
          break;
        }
        case KIND_PROG: {
          if (this.#programListeners.size === 0 && !tick) break;
          const payload: ProgramChangeEvent = { channel, program: b, tsUs };
          if (tick) tick.programChanges.push(payload);
          if (this.#programListeners.size) {
            for (const fn of this.#programListeners) fn(payload);
          }
          break;
        }
        case KIND_NOTE: {
          const on = (extra & 1) === 1;
          if (this.#noteListeners.size === 0 && this.#noteOnListeners.size === 0 &&
            this.#noteOffListeners.size === 0 && !tick) {
            break;
          }
          const payload: NoteEvent = {
            channel,
            noteNum: a,
            on,
            velocity: b,
            tsUs,
          };
          if (tick) tick.noteEvents.push(payload);
          if (this.#noteListeners.size) {
            for (const fn of this.#noteListeners) fn(payload);
          }
          if (on) {
            if (this.#noteOnListeners.size) {
              const onPayload: NoteOnEvent = {
                channel,
                noteNum: a,
                velocity: b,
                tsUs,
              };
              for (const fn of this.#noteOnListeners) fn(onPayload);
            }
          } else {
            if (this.#noteOffListeners.size) {
              const offPayload: NoteOffEvent = {
                channel,
                noteNum: a,
                velocity: b,
                tsUs,
              };
              for (const fn of this.#noteOffListeners) fn(offPayload);
            }
          }
          break;
        }
        default:
          break;
      }
    }

    if (tick) {
      for (const fn of this.#tickListeners) fn(tick);
    }
  }
}
