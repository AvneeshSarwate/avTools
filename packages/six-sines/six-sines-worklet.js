import createSixSinesModule from "./six-sines.js";

const EVENT_SIZE = 40;
const DEFAULT_QUEUE_CAPACITY = 4096;
const DEFAULT_EVENTS_PER_QUANTUM = 256;
const DEFAULT_MAX_FRAMES = 2048;

class SixSinesProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const processorOptions = options.processorOptions ?? {};
    this.maxFrames = processorOptions.maxFrames ?? DEFAULT_MAX_FRAMES;
    this.maxEventsPerQuantum = processorOptions.maxEventsPerQuantum ?? DEFAULT_EVENTS_PER_QUANTUM;
    this.queueCapacity = processorOptions.queueCapacity ?? DEFAULT_QUEUE_CAPACITY;
    this.renderFrame = Number(globalThis.currentFrame ?? 0);
    this.ready = false;
    this.failed = false;
    this.lateEventCount = 0;
    this.overflowEventCount = 0;
    this.outOfOrderEventCount = 0;
    this.memoryGrowthCount = 0;

    this.scheduledQueue = this.createQueue(true);
    this.immediateQueue = this.createQueue(false);

    this.port.onmessage = ({ data }) => this.onMessage(data);
    this.initialize(processorOptions).catch((error) => {
      this.failed = true;
      this.port.postMessage({ type: "error", message: String(error?.stack ?? error) });
    });
  }

  createQueue(hasFrame) {
    return {
      frame: hasFrame ? new Float64Array(this.queueCapacity) : undefined,
      type: new Uint32Array(this.queueCapacity),
      noteId: new Int32Array(this.queueCapacity),
      port: new Int16Array(this.queueCapacity),
      channel: new Int16Array(this.queueCapacity),
      key: new Int16Array(this.queueCapacity),
      paramId: new Uint32Array(this.queueCapacity),
      expressionId: new Int32Array(this.queueCapacity),
      value: new Float64Array(this.queueCapacity),
      head: 0,
      count: 0,
    };
  }

  async initialize(options) {
    if (!options.wasmBytes) throw new Error("SixSinesProcessor requires processorOptions.wasmBytes");
    this.wasm = await createSixSinesModule({ wasmBinary: new Uint8Array(options.wasmBytes) });
    this.handle = this.wasm._sx_create(sampleRate);
    if (!this.handle) throw new Error("sx_create failed");
    if (this.wasm._sx_event_sizeof() !== EVENT_SIZE) throw new Error("unexpected sx_event ABI");
    this.buildId = this.wasm.UTF8ToString(this.wasm._sx_get_build_id());

    this.inputLeftPointer = this.wasm._malloc(this.maxFrames * 4);
    this.inputRightPointer = this.wasm._malloc(this.maxFrames * 4);
    this.outputLeftPointer = this.wasm._malloc(this.maxFrames * 4);
    this.outputRightPointer = this.wasm._malloc(this.maxFrames * 4);
    this.eventPointer = this.wasm._malloc(this.maxEventsPerQuantum * EVENT_SIZE);
    this.paramInfoSize = this.wasm._sx_param_info_sizeof();
    this.paramInfoPointer = this.wasm._malloc(this.paramInfoSize);
    if (!this.inputLeftPointer || !this.inputRightPointer || !this.outputLeftPointer ||
        !this.outputRightPointer || !this.eventPointer || !this.paramInfoPointer) {
      throw new Error("worklet buffer allocation failed");
    }
    if (options.presetBytes) this.loadPreset(new Uint8Array(options.presetBytes));
    this.refreshEventView();
    this.ready = true;
    this.port.postMessage({ type: "ready", frame: this.renderFrame, buildId: this.buildId });
  }

  loadPreset(bytes) {
    const pointer = this.wasm._malloc(bytes.byteLength);
    if (!pointer) throw new Error("preset allocation failed");
    try {
      this.wasm.HEAPU8.set(bytes, pointer);
      if (!this.wasm._sx_load_preset_utf8(this.handle, pointer, bytes.byteLength)) {
        throw new Error("sx_load_preset_utf8 failed");
      }
    } finally {
      this.wasm._free(pointer);
    }
    if (this.eventPointer) this.refreshEventView();
  }

  refreshEventView() {
    this.eventView = new DataView(this.wasm.HEAPU8.buffer, this.eventPointer,
      this.maxEventsPerQuantum * EVENT_SIZE);
  }

  onMessage(message) {
    try {
      if (message?.type === "events" || message?.type === "eventsNow") {
        const immediate = message.type === "eventsNow";
        let accepted = 0;
        for (const event of message.events ?? []) {
          accepted += this.enqueue(event, immediate) ? 1 : 0;
        }
        this.port.postMessage({
          type: "eventsQueued",
          requestId: message.requestId,
          accepted,
          rejected: (message.events?.length ?? 0) - accepted,
        });
      } else if (message?.type === "loadPreset") {
        if (!this.ready) throw new Error("cannot load a replacement preset before ready");
        this.loadPreset(new Uint8Array(message.bytes));
        this.port.postMessage({ type: "presetLoaded", requestId: message.requestId });
      } else if (message?.type === "stats") {
        this.postStats(message.requestId);
      } else if (message?.type === "parameterInfo") {
        this.port.postMessage({
          type: "parameterInfo",
          requestId: message.requestId,
          parameters: this.getParameterInfo(),
        });
      } else if (message?.type === "dispose" && this.ready) {
        for (const pointer of [this.paramInfoPointer, this.eventPointer,
          this.outputRightPointer, this.outputLeftPointer,
          this.inputRightPointer, this.inputLeftPointer]) {
          this.wasm._free(pointer);
        }
        this.wasm._sx_destroy(this.handle);
        this.ready = false;
        this.port.postMessage({ type: "disposed", requestId: message.requestId });
      }
    } catch (error) {
      this.port.postMessage({
        type: "error",
        requestId: message?.requestId,
        message: String(error?.stack ?? error),
      });
    }
  }

  getParameterInfo() {
    const parameters = [];
    const count = this.wasm._sx_get_param_count(this.handle);
    for (let index = 0; index < count; ++index) {
      if (!this.wasm._sx_get_param_info(this.handle, index, this.paramInfoPointer)) {
        throw new Error(`sx_get_param_info failed at index ${index}`);
      }
      const view = new DataView(this.wasm.HEAPU8.buffer, this.paramInfoPointer,
        this.paramInfoSize);
      let nameEnd = 32;
      while (nameEnd < this.paramInfoSize && view.getUint8(nameEnd)) ++nameEnd;
      let name = "";
      for (let at = 32; at < nameEnd; ++at) name += String.fromCharCode(view.getUint8(at));
      parameters.push({
        id: view.getUint32(0, true),
        flags: view.getUint32(4, true),
        minValue: view.getFloat64(8, true),
        maxValue: view.getFloat64(16, true),
        defaultValue: view.getFloat64(24, true),
        name,
      });
    }
    return parameters;
  }

  enqueue(event, immediate) {
    const queue = immediate ? this.immediateQueue : this.scheduledQueue;
    if (this.immediateQueue.count + this.scheduledQueue.count === this.queueCapacity) {
      ++this.overflowEventCount;
      return false;
    }
    let frame;
    if (!immediate) {
      frame = Number(event.frame);
      if (!Number.isSafeInteger(frame) || frame < 0) {
        throw new Error(`invalid event frame ${event.frame}`);
      }
      if (queue.count) {
        const last = (queue.head + queue.count - 1) % this.queueCapacity;
        if (frame < queue.frame[last]) {
          ++this.outOfOrderEventCount;
          return false;
        }
      }
    }
    const at = (queue.head + queue.count) % this.queueCapacity;
    if (!immediate) queue.frame[at] = frame;
    queue.type[at] = event.type;
    queue.noteId[at] = event.noteId ?? -1;
    queue.port[at] = event.port ?? 0;
    queue.channel[at] = event.channel ?? 0;
    queue.key[at] = event.key ?? -1;
    queue.paramId[at] = event.paramId ?? 0;
    queue.expressionId[at] = event.expressionId ?? 0;
    queue.value[at] = event.value ?? 0;
    ++queue.count;
    return true;
  }

  writeEvent(queue, source, destination, localFrame) {
    const at = destination * EVENT_SIZE;
    this.eventView.setUint32(at + 0, localFrame, true);
    this.eventView.setUint32(at + 4, queue.type[source], true);
    this.eventView.setInt32(at + 8, queue.noteId[source], true);
    this.eventView.setInt16(at + 12, queue.port[source], true);
    this.eventView.setInt16(at + 14, queue.channel[source], true);
    this.eventView.setInt16(at + 16, queue.key[source], true);
    this.eventView.setInt16(at + 18, 0, true);
    this.eventView.setUint32(at + 20, queue.paramId[source], true);
    this.eventView.setInt32(at + 24, queue.expressionId[source], true);
    this.eventView.setFloat64(at + 32, queue.value[source], true);
  }

  postStats(requestId) {
    this.port.postMessage({
      type: "stats",
      requestId,
      renderFrame: this.renderFrame,
      queuedEventCount: this.immediateQueue.count + this.scheduledQueue.count,
      immediateQueuedEventCount: this.immediateQueue.count,
      scheduledQueuedEventCount: this.scheduledQueue.count,
      lateEventCount: this.lateEventCount,
      overflowEventCount: this.overflowEventCount,
      outOfOrderEventCount: this.outOfOrderEventCount,
      memoryGrowthCount: this.memoryGrowthCount,
    });
  }

  process(inputs, outputs) {
    const output = outputs[0];
    const frames = output?.[0]?.length ?? 0;
    if (!frames) return true;
    if (!this.ready || this.failed || frames > this.maxFrames) {
      for (const channel of output) channel.fill(0);
      this.renderFrame += frames;
      return true;
    }

    const input = inputs[0];
    const heap = this.wasm.HEAPF32;
    const inputLeftAt = this.inputLeftPointer >> 2;
    const inputRightAt = this.inputRightPointer >> 2;
    for (let frame = 0; frame < frames; ++frame) {
      heap[inputLeftAt + frame] = input?.[0]?.[frame] ?? 0;
      heap[inputRightAt + frame] = input?.[1]?.[frame] ?? input?.[0]?.[frame] ?? 0;
    }

    const quantumEnd = this.renderFrame + frames;
    let eventCount = 0;
    while (this.immediateQueue.count && eventCount < this.maxEventsPerQuantum) {
      const queue = this.immediateQueue;
      this.writeEvent(queue, queue.head, eventCount++, 0);
      queue.head = (queue.head + 1) % this.queueCapacity;
      --queue.count;
    }
    const queue = this.scheduledQueue;
    while (queue.count && queue.frame[queue.head] < quantumEnd &&
           eventCount < this.maxEventsPerQuantum) {
      const absoluteFrame = queue.frame[queue.head];
      const localFrame = absoluteFrame < this.renderFrame ? 0 : absoluteFrame - this.renderFrame;
      if (absoluteFrame < this.renderFrame) ++this.lateEventCount;
      this.writeEvent(queue, queue.head, eventCount++, localFrame);
      queue.head = (queue.head + 1) % this.queueCapacity;
      --queue.count;
    }
    if ((this.immediateQueue.count && eventCount === this.maxEventsPerQuantum) ||
        (queue.count && queue.frame[queue.head] < quantumEnd)) {
      ++this.overflowEventCount;
    }

    const ok = this.wasm._sx_process(this.handle, frames, this.inputLeftPointer,
      this.inputRightPointer, this.outputLeftPointer, this.outputRightPointer,
      this.eventPointer, eventCount);
    if (!ok) {
      this.failed = true;
      for (const channel of output) channel.fill(0);
      this.port.postMessage({ type: "error", message: "sx_process failed" });
      return true;
    }

    const outputHeap = this.wasm.HEAPF32;
    if (outputHeap.buffer !== heap.buffer) {
      ++this.memoryGrowthCount;
      this.refreshEventView();
    }
    const leftAt = this.outputLeftPointer >> 2;
    const rightAt = this.outputRightPointer >> 2;
    for (let frame = 0; frame < frames; ++frame) {
      output[0][frame] = outputHeap[leftAt + frame];
      if (output[1]) output[1][frame] = outputHeap[rightAt + frame];
    }
    this.renderFrame = quantumEnd;
    return true;
  }
}

registerProcessor("six-sines", SixSinesProcessor);
