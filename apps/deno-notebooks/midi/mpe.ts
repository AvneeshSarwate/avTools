import type { MidiInput } from "./midi_input.ts";
import type {
  ChannelPressureEvent,
  CCEvent,
  NoteEvent,
  PitchBendEvent,
  TickPayload,
} from "./types.ts";

export type MPEConfig = {
  zone: "lower" | "upper";
  masterChannel?: number;
  memberChannels?: [number, number];
  timbreCC?: number;
};

export type MPENoteStart = {
  channel: number;
  noteNum: number;
  velocity: number;
  pressure: number;
  timbre: number;
  bend: number;
};

export type MPENoteUpdate = {
  channel: number;
  noteNum: number;
  pressure: number;
  timbre: number;
  bend: number;
};

export type MPENoteEnd = {
  channel: number;
  noteNum: number;
  velocity: number;
};

type Listener<T> = (event: T) => void;

type VoiceState = {
  noteNum: number | null;
  velocity: number;
  bend: number;
  pressure: number;
  timbre: number;
  dirty: boolean;
  started: boolean;
  ended: boolean;
};

type MPERecord =
  | { tsUs: number; kind: "note"; payload: NoteEvent }
  | { tsUs: number; kind: "pb"; payload: PitchBendEvent }
  | { tsUs: number; kind: "pressure"; payload: ChannelPressureEvent }
  | { tsUs: number; kind: "timbre"; payload: CCEvent };

export class MPEInput {
  #input: MidiInput;
  #timbreCC: number;
  #memberSet: Set<number>;
  #voices: VoiceState[];
  #noteStartListeners = new Set<Listener<MPENoteStart>>();
  #noteUpdateListeners = new Set<Listener<MPENoteUpdate>>();
  #noteEndListeners = new Set<Listener<MPENoteEnd>>();
  #unsubscribeTick: () => void;

  constructor(input: MidiInput, config: MPEConfig) {
    this.#input = input;
    const defaults = defaultZone(config.zone);
    const memberRange = config.memberChannels ?? defaults.memberChannels;
    const masterChannel = config.masterChannel ?? defaults.masterChannel;
    this.#timbreCC = config.timbreCC ?? 74;

    const members: number[] = [];
    const min = Math.max(0, Math.min(15, memberRange[0]));
    const max = Math.max(0, Math.min(15, memberRange[1]));
    for (let ch = min; ch <= max; ch++) {
      if (ch !== masterChannel) members.push(ch);
    }
    this.#memberSet = new Set(members);
    this.#voices = new Array(16).fill(0).map(() => ({
      noteNum: null,
      velocity: 0,
      bend: 0,
      pressure: 0,
      timbre: 0,
      dirty: false,
      started: false,
      ended: false,
    }));

    this.#unsubscribeTick = input.onTick((tick) => this.#onTick(tick));
  }

  close() {
    this.#unsubscribeTick();
  }

  onNoteStart(fn: Listener<MPENoteStart>) {
    this.#noteStartListeners.add(fn);
    return () => this.#noteStartListeners.delete(fn);
  }

  onNoteUpdate(fn: Listener<MPENoteUpdate>) {
    this.#noteUpdateListeners.add(fn);
    return () => this.#noteUpdateListeners.delete(fn);
  }

  onNoteEnd(fn: Listener<MPENoteEnd>) {
    this.#noteEndListeners.add(fn);
    return () => this.#noteEndListeners.delete(fn);
  }

  #onTick(tick: TickPayload) {
    const records: MPERecord[] = [];

    for (const note of tick.noteEvents) {
      if (this.#memberSet.has(note.channel)) {
        records.push({ tsUs: note.tsUs, kind: "note", payload: note });
      }
    }
    for (const pb of tick.pbChanges) {
      if (this.#memberSet.has(pb.channel)) {
        records.push({ tsUs: pb.tsUs, kind: "pb", payload: pb });
      }
    }
    for (const pressure of tick.chPressureChanges) {
      if (this.#memberSet.has(pressure.channel)) {
        records.push({ tsUs: pressure.tsUs, kind: "pressure", payload: pressure });
      }
    }
    for (const cc of tick.ccChanges) {
      if (cc.ctrlNum === this.#timbreCC && this.#memberSet.has(cc.channel)) {
        records.push({ tsUs: cc.tsUs, kind: "timbre", payload: cc });
      }
    }

    records.sort((a, b) => a.tsUs - b.tsUs);

    for (const voice of this.#voices) {
      voice.started = false;
      voice.ended = false;
      voice.dirty = false;
    }

    for (const record of records) {
      const channel = record.payload.channel;
      const voice = this.#voices[channel];
      switch (record.kind) {
        case "note": {
          const note = record.payload;
          if (note.on) {
            voice.noteNum = note.noteNum;
            voice.velocity = note.velocity;
            voice.started = true;
          } else if (voice.noteNum === note.noteNum) {
            voice.ended = true;
          }
          break;
        }
        case "pb": {
          voice.bend = record.payload.bend;
          if (voice.noteNum !== null) voice.dirty = true;
          break;
        }
        case "pressure": {
          voice.pressure = record.payload.pressure;
          if (voice.noteNum !== null) voice.dirty = true;
          break;
        }
        case "timbre": {
          voice.timbre = record.payload.ctrlVal;
          if (voice.noteNum !== null) voice.dirty = true;
          break;
        }
      }
    }

    for (const channel of this.#memberSet) {
      const voice = this.#voices[channel];
      if (voice.noteNum === null) continue;
      if (voice.started) {
        const payload: MPENoteStart = {
          channel,
          noteNum: voice.noteNum,
          velocity: voice.velocity,
          pressure: voice.pressure,
          timbre: voice.timbre,
          bend: voice.bend,
        };
        for (const fn of this.#noteStartListeners) fn(payload);
      }
      if (voice.dirty && !voice.ended) {
        const payload: MPENoteUpdate = {
          channel,
          noteNum: voice.noteNum,
          pressure: voice.pressure,
          timbre: voice.timbre,
          bend: voice.bend,
        };
        for (const fn of this.#noteUpdateListeners) fn(payload);
      }
      if (voice.ended) {
        const payload: MPENoteEnd = {
          channel,
          noteNum: voice.noteNum,
          velocity: voice.velocity,
        };
        for (const fn of this.#noteEndListeners) fn(payload);
        voice.noteNum = null;
        voice.velocity = 0;
      }
    }
  }
}

function defaultZone(zone: "lower" | "upper") {
  if (zone === "upper") {
    return { masterChannel: 15, memberChannels: [0, 14] as [number, number] };
  }
  return { masterChannel: 0, memberChannels: [1, 15] as [number, number] };
}
