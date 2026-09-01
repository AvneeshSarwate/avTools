const registeredWorklets = new WeakMap();

export const SixSinesEventType = Object.freeze({
  noteOn: 1,
  noteOff: 2,
  noteExpression: 3,
  paramValue: 4,
  paramMod: 5,
  allNotesOff: 6,
});

export const ClapNoteExpression = Object.freeze({
  volume: 0,
  pan: 1,
  tuning: 2,
  vibrato: 3,
  expression: 4,
  brightness: 5,
  pressure: 6,
});

function workletRegistration(context, url) {
  let registrations = registeredWorklets.get(context);
  if (!registrations) {
    registrations = new Map();
    registeredWorklets.set(context, registrations);
  }
  if (!registrations.has(url)) registrations.set(url, context.audioWorklet.addModule(url));
  return registrations.get(url);
}

async function bytesFrom(value, url, description) {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  if (value && typeof value.arrayBuffer === "function") return value.arrayBuffer();
  if (url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${description} fetch failed: ${response.status}`);
    return response.arrayBuffer();
  }
  return undefined;
}

function withTimeout(promise, milliseconds, description) {
  let timeout;
  const expired = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`timeout waiting for ${description}`)), milliseconds);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timeout));
}

export class SixSinesNode {
  static async create(context, options = {}) {
    const workletUrl = String(options.workletUrl ??
      new URL("./six-sines-worklet.js", import.meta.url));
    const wasmUrl = String(options.wasmUrl ?? new URL("./six-sines.wasm", import.meta.url));
    const [wasmBytes, presetBytes] = await Promise.all([
      bytesFrom(options.wasmBytes, wasmUrl, "Six Sines Wasm"),
      bytesFrom(options.presetBytes, options.presetUrl, "Six Sines preset"),
      workletRegistration(context, workletUrl),
    ]);
    const audioNode = new AudioWorkletNode(context, "six-sines", {
      numberOfInputs: options.numberOfInputs ?? 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: {
        wasmBytes,
        presetBytes,
        maxFrames: options.maxFrames,
        maxEventsPerQuantum: options.maxEventsPerQuantum,
        queueCapacity: options.queueCapacity,
      },
    });
    const synth = new SixSinesNode(context, audioNode);
    await withTimeout(synth.ready, options.readyTimeoutMs ?? 15_000, "Six Sines worklet");
    return synth;
  }

  constructor(context, audioNode) {
    this.context = context;
    this.node = audioNode;
    this.port = audioNode.port;
    this.nextRequestId = 1;
    this.requests = new Map();
    this.lastQueuedFrame = -1;
    this.lastError = undefined;
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.port.onmessage = ({ data }) => this.onMessage(data);
    this.port.start();
  }

  connect(...args) {
    return this.node.connect(...args);
  }

  disconnect(...args) {
    return this.node.disconnect(...args);
  }

  onMessage(message) {
    if (message?.type === "ready") {
      this.readyInfo = message;
      this.resolveReady(message);
      return;
    }
    if (message?.type === "error") {
      const error = new Error(message.message);
      this.lastError = error;
      if (message.requestId && this.requests.has(message.requestId)) {
        this.requests.get(message.requestId).reject(error);
        this.requests.delete(message.requestId);
      } else {
        this.rejectReady(error);
      }
      return;
    }
    if (message?.requestId && this.requests.has(message.requestId)) {
      this.requests.get(message.requestId).resolve(message);
      this.requests.delete(message.requestId);
    }
  }

  request(type, payload = {}) {
    const requestId = this.nextRequestId++;
    const result = new Promise((resolve, reject) => this.requests.set(requestId, { resolve, reject }));
    this.port.postMessage({ type, requestId, ...payload });
    return result;
  }

  frameFor(event) {
    if (event.frame !== undefined) return Number(event.frame);
    if (event.time !== undefined) return Math.round(event.time * this.context.sampleRate);
    throw new Error("scheduled events require an explicit frame or time");
  }

  async send(events) {
    if (events.some((event) => event.frame !== undefined || event.time !== undefined)) {
      throw new Error("send() is immediate; use schedule() for explicit frame/time events");
    }
    if (!events.length) return { accepted: 0, rejected: 0 };
    const response = await this.request("eventsNow", { events });
    if (response.rejected) throw new Error(`worklet rejected ${response.rejected} event(s)`);
    return response;
  }

  async schedule(events) {
    const normalized = events.map((event, order) => ({
      ...event,
      frame: this.frameFor(event),
      order,
    })).sort((a, b) => a.frame - b.frame || a.order - b.order)
      .map(({ order: _, time: __, ...event }) => event);
    if (!normalized.length) return { accepted: 0, rejected: 0 };
    if (normalized[0].frame < this.lastQueuedFrame) {
      throw new Error(`event frame ${normalized[0].frame} precedes already queued frame ${this.lastQueuedFrame}`);
    }
    const response = await this.request("events", { events: normalized });
    if (response.rejected) throw new Error(`worklet rejected ${response.rejected} event(s)`);
    this.lastQueuedFrame = normalized.at(-1).frame;
    return response;
  }

  deliver(events) {
    const timed = events.some((event) => event.frame !== undefined || event.time !== undefined);
    return timed ? this.schedule(events) : this.send(events);
  }

  noteOn({ noteId = -1, port = 0, channel = 0, key, velocity = 1, ...when }) {
    return this.deliver([{ type: SixSinesEventType.noteOn, noteId, port, channel,
      key, value: velocity, ...when }]);
  }

  noteOff({ noteId = -1, port = 0, channel = 0, key, velocity = 0, ...when }) {
    return this.deliver([{ type: SixSinesEventType.noteOff, noteId, port, channel,
      key, value: velocity, ...when }]);
  }

  noteExpression({ noteId = -1, port = 0, channel = 0, key = -1,
    expressionId, value, ...when }) {
    return this.deliver([{ type: SixSinesEventType.noteExpression, noteId, port, channel,
      key, expressionId, value, ...when }]);
  }

  paramValue({ paramId, value, ...when }) {
    return this.deliver([{ type: SixSinesEventType.paramValue, paramId, value, ...when }]);
  }

  paramMod({ noteId, port = 0, channel = 0, key = -1, paramId, amount, ...when }) {
    if (!Number.isInteger(noteId) || noteId < 0) {
      throw new Error("the initial Six Sines paramMod API requires a non-negative noteId");
    }
    return this.deliver([{ type: SixSinesEventType.paramMod, noteId, port, channel,
      key, paramId, value: amount, ...when }]);
  }

  allNotesOff(when = {}) {
    return this.deliver([{ type: SixSinesEventType.allNotesOff, ...when }]);
  }

  async loadPreset(preset) {
    const bytes = await bytesFrom(preset, undefined, "Six Sines preset");
    if (!bytes) throw new Error("loadPreset requires an ArrayBuffer, typed array, Blob, or File");
    return this.request("loadPreset", { bytes });
  }

  async getParameterInfo() {
    return (await this.request("parameterInfo")).parameters;
  }

  stats() {
    return this.request("stats");
  }

  async dispose() {
    const result = await this.request("dispose");
    this.port.close();
    return result;
  }
}
