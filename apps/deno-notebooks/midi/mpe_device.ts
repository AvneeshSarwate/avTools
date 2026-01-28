import { MidiOutput } from "./midi_output.ts";

export type MPEDeviceConfig = {
  zone: "lower" | "upper";
  masterChannel?: number;
  memberChannels?: [number, number];
  timbreCC?: number;
  noteOffVelocity?: number;
  overflow?: "oldest" | "none";
};

export class MPEDevice {
  #output: MidiOutput;
  #timbreCC: number;
  #noteOffVelocity: number;
  #overflow: "oldest" | "none";
  #available: number[];
  #active = new Map<number, ActiveNote>();
  #activeIds = new Set<number>();
  #pitchMap = new Map<number, number[]>();
  #order: number[] = [];
  #nextId = 1;

  constructor(output: MidiOutput, config: MPEDeviceConfig) {
    this.#output = output;
    const defaults = defaultZone(config.zone);
    const memberRange = config.memberChannels ?? defaults.memberChannels;
    const masterChannel = config.masterChannel ?? defaults.masterChannel;
    this.#timbreCC = config.timbreCC ?? 74;
    this.#noteOffVelocity = config.noteOffVelocity ?? 64;
    this.#overflow = config.overflow ?? "oldest";

    const channels: number[] = [];
    const min = Math.max(0, Math.min(15, memberRange[0]));
    const max = Math.max(0, Math.min(15, memberRange[1]));
    for (let ch = min; ch <= max; ch++) {
      if (ch !== masterChannel) channels.push(ch);
    }
    this.#available = channels;
  }

  noteOn(
    noteNum: number,
    velocity: number,
    pitchBend?: number,
    pressure?: number,
    timbre?: number,
  ) {
    const channel = this.#allocateChannel();
    if (channel === null) return null;

    if (pitchBend !== undefined) {
      this.#output.pitchBend(channel, pitchBend);
    }
    if (pressure !== undefined) {
      this.#output.channelPressure(channel, pressure);
    }
    if (timbre !== undefined) {
      this.#output.cc(channel, this.#timbreCC, timbre);
    }

    this.#output.noteOn(channel, noteNum, velocity);

    const id = this.#nextId++;
    const note: ActiveNote = { id, channel, noteNum };
    this.#active.set(id, note);
    this.#activeIds.add(id);
    this.#order.push(id);

    const stack = this.#pitchMap.get(noteNum) ?? [];
    stack.push(id);
    this.#pitchMap.set(noteNum, stack);

    return new MPENoteRef(this, id);
  }

  noteOff(noteNum: number, velocity?: number) {
    const stack = this.#pitchMap.get(noteNum);
    if (!stack || stack.length === 0) return false;
    const id = stack[stack.length - 1];
    return this.#noteOffById(id, velocity);
  }

  pitchBend(noteRef: MPENoteRef, bend: number) {
    return this.#pitchBendById(noteRef.id, bend);
  }

  pressure(noteRef: MPENoteRef, pressure: number) {
    return this.#pressureById(noteRef.id, pressure);
  }

  timbre(noteRef: MPENoteRef, value: number) {
    return this.#timbreById(noteRef.id, value);
  }

  _noteOffById(id: number, velocity?: number) {
    return this.#noteOffById(id, velocity);
  }

  _pitchBendById(id: number, bend: number) {
    return this.#pitchBendById(id, bend);
  }

  _pressureById(id: number, pressure: number) {
    return this.#pressureById(id, pressure);
  }

  _timbreById(id: number, value: number) {
    return this.#timbreById(id, value);
  }

  #noteOffById(id: number, velocity?: number) {
    if (!this.#activeIds.has(id)) return false;
    const note = this.#active.get(id);
    if (!note) return false;

    this.#output.noteOff(note.channel, note.noteNum, velocity ?? this.#noteOffVelocity);
    this.#active.delete(id);
    this.#activeIds.delete(id);

    this.#removeFromOrder(id);
    this.#removeFromPitch(note.noteNum, id);
    this.#available.push(note.channel);
    return true;
  }

  #pitchBendById(id: number, bend: number) {
    if (!this.#activeIds.has(id)) return false;
    const note = this.#active.get(id);
    if (!note) return false;
    this.#output.pitchBend(note.channel, bend);
    return true;
  }

  #pressureById(id: number, pressure: number) {
    if (!this.#activeIds.has(id)) return false;
    const note = this.#active.get(id);
    if (!note) return false;
    this.#output.channelPressure(note.channel, pressure);
    return true;
  }

  #timbreById(id: number, value: number) {
    if (!this.#activeIds.has(id)) return false;
    const note = this.#active.get(id);
    if (!note) return false;
    this.#output.cc(note.channel, this.#timbreCC, value);
    return true;
  }

  #allocateChannel(): number | null {
    if (this.#available.length > 0) {
      return this.#available.shift() ?? null;
    }

    if (this.#overflow === "oldest" && this.#order.length > 0) {
      const oldestId = this.#order[0];
      this.#noteOffById(oldestId, this.#noteOffVelocity);
      return this.#available.shift() ?? null;
    }

    return null;
  }

  #removeFromOrder(id: number) {
    const idx = this.#order.indexOf(id);
    if (idx >= 0) this.#order.splice(idx, 1);
  }

  #removeFromPitch(noteNum: number, id: number) {
    const stack = this.#pitchMap.get(noteNum);
    if (!stack) return;
    const idx = stack.indexOf(id);
    if (idx >= 0) stack.splice(idx, 1);
    if (stack.length === 0) this.#pitchMap.delete(noteNum);
  }
}

export class MPENoteRef {
  #device: MPEDevice;
  #id: number;

  constructor(device: MPEDevice, id: number) {
    this.#device = device;
    this.#id = id;
  }

  get id() {
    return this.#id;
  }

  pitchBend(bend: number) {
    this.#device._pitchBendById(this.#id, bend);
  }

  pressure(value: number) {
    this.#device._pressureById(this.#id, value);
  }

  timbre(value: number) {
    this.#device._timbreById(this.#id, value);
  }

  noteOff(velocity?: number) {
    this.#device._noteOffById(this.#id, velocity);
  }
}

type ActiveNote = {
  id: number;
  channel: number;
  noteNum: number;
};

function defaultZone(zone: "lower" | "upper") {
  if (zone === "upper") {
    return { masterChannel: 15, memberChannels: [0, 14] as [number, number] };
  }
  return { masterChannel: 0, memberChannels: [1, 15] as [number, number] };
}
