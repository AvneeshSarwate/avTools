/// <reference lib="dom" />

// OSC-driven P5GPU sketch with tweakpane-controlled trail decay.
//
// Listens on UDP port 9003 for OSC messages:
//   /noteInfo pitch confidence volume
// use with monophonic_pitch.amxd device
//
// Run from apps/deno-notebooks:
//   deno run --unstable-webgpu --unstable-ffi --allow-all examples/p5gpu_osc_note_trail.ts

import {
  createWindowRenderManager,
  requestWebGpuDevice,
  type PaneContainer,
} from "../../window/mod.ts";
import { P5GPU } from "../../tools/p5gpu.ts";
import { createOSCServer, type OSCMessage } from "../../tools/osc.ts";
import {
  easeInOutQuart,
  installMacros,
  lerp,
  type MacroDef,
} from "../../tools/macros.ts";

const OSC_PORT = 9003;
const OSC_ADDRESS = "/noteInfo";
const PITCH_HISTORY_SIZE = 100;
const MAX_SMOOTHING_WINDOW = 5;
const DELAY_BUFFER_SIZE = 32;
const FILTERED_HISTORY_SIZE = 180;

interface DelayFrame {
  pitch: number;
  confidence: number;
  volume: number;
}

export const state = {
  render: {
    confidenceThreshold: 0.5,
  },
  drawing: {
    r: 255,
    g: 0,
    b: 0,
    circleBaseSize: 10,
    volumeScale: 40,
    strokeWeight: 20,
  },
  path: {
    mode: "history-line" as "linear" | "polar" | "history-line",
  },
  linear: {
    pitchCenter: 60,
    pitchRadius: 600,
    period: 5,
  },
  polar: {
    pitchCenter: 60,
    baseRadius: 200,
    pitchRadiusScale: 300,
    period: 5,
  },
  historyLine: {
    pitchCenter: 60,
    pitchRadius: 600,
    historyLength: 90,
  },
  smooth: {
    smoothingConfidenceThreshold: 0.8,
  },
  reject: {
    delayFrames: 2,
    medianWindow: 3,
    spikeThreshold: 7,
  },
  filter: {
    mode: "smooth" as "smooth" | "delayed-reject",
  },
  note: {
    pitch: 60,
    confidence: 0,
    volume: 0,
  },
  buffers: {
    pitchHistory: new Array<number>(PITCH_HISTORY_SIZE),
    pitchHistoryHead: 0,
    pitchHistoryCount: 0,
    smoothFilteredHistory: new Float64Array(FILTERED_HISTORY_SIZE),
    smoothFilteredHead: 0,
    smoothFilteredCount: 0,
    rejectFilteredHistory: new Float64Array(FILTERED_HISTORY_SIZE),
    rejectFilteredHead: 0,
    rejectFilteredCount: 0,
    delayBuffer: Array.from({ length: DELAY_BUFFER_SIZE }, () => ({
      pitch: 60, confidence: 0, volume: 0,
    })) as DelayFrame[],
    delayHead: 0,
    delayCount: 0,
  },
  runtime: {
    oscServer: null as ReturnType<typeof createOSCServer> | null,
  },
  macros: {} as Record<string, number>,
};

export const macroDefs: MacroDef<number>[] = [
  {
    key: "red",
    defaultValue: 0.5,
    opts: { min: 0, max: 1, step: 0.001, label: "Red" },
    apply: (v) => {
      state.drawing.r = Math.round(lerp(0, 255, easeInOutQuart(v)));
    },
  },
];

export function setupPane(pane: PaneContainer, refresh?: () => void): void {
  const macros = pane.addFolder({ title: "Macros", expanded: true });
  installMacros(macros, state.macros, macroDefs, refresh ?? (() => pane.refresh()));

  const render = pane.addFolder({ title: "Render" });
  render.addBinding(state.render, "confidenceThreshold", { min: 0, max: 1, step: 0.001, label: "Conf Threshold" });

  const drawing = pane.addFolder({ title: "Drawing" });
  drawing.addBinding(state.drawing, "r", { min: 0, max: 255, step: 1, label: "Red" });
  drawing.addBinding(state.drawing, "g", { min: 0, max: 255, step: 1, label: "Green" });
  drawing.addBinding(state.drawing, "b", { min: 0, max: 255, step: 1, label: "Blue" });
  drawing.addBinding(state.drawing, "circleBaseSize", { min: 1, max: 50, step: 1, label: "Circle Size" });
  drawing.addBinding(state.drawing, "volumeScale", { min: 0, max: 200, step: 1, label: "Volume Scale" });
  drawing.addBinding(state.drawing, "strokeWeight", { min: 0.5, max: 30, step: 0.5, label: "Stroke Weight" });

  const path = pane.addFolder({ title: "Path" });
  path.addBinding(state.path, "mode", {
    options: { "Linear": "linear", "Polar": "polar", "History Line": "history-line" },
    label: "Mode",
  });

  const linear = path.addFolder({ title: "Linear" });
  linear.addBinding(state.linear, "pitchCenter", { min: 0, max: 127, step: 1, label: "Pitch Center" });
  linear.addBinding(state.linear, "pitchRadius", { min: 0, max: 800, step: 1, label: "Pitch Radius" });
  linear.addBinding(state.linear, "period", { min: 1, max: 30, step: 0.5, label: "Period (s)" });

  const polar = path.addFolder({ title: "Polar" });
  polar.addBinding(state.polar, "pitchCenter", { min: 0, max: 127, step: 1, label: "Pitch Center" });
  polar.addBinding(state.polar, "baseRadius", { min: 10, max: 400, step: 1, label: "Base Radius" });
  polar.addBinding(state.polar, "pitchRadiusScale", { min: 0, max: 800, step: 1, label: "Pitch Scale" });
  polar.addBinding(state.polar, "period", { min: 1, max: 30, step: 0.5, label: "Period (s)" });

  const histLine = path.addFolder({ title: "History Line" });
  histLine.addBinding(state.historyLine, "pitchCenter", { min: 0, max: 127, step: 1, label: "Pitch Center" });
  histLine.addBinding(state.historyLine, "pitchRadius", { min: 0, max: 800, step: 1, label: "Pitch Radius" });
  histLine.addBinding(state.historyLine, "historyLength", { min: 1, max: 180, step: 1, label: "History Length" });

  const filter = pane.addFolder({ title: "Pitch Filter" });
  filter.addBinding(state.filter, "mode", {
    options: { "Smooth": "smooth", "Delayed Reject": "delayed-reject" },
    label: "Mode",
  });

  const smooth = filter.addFolder({ title: "Smooth Mode" });
  smooth.addBinding(state.smooth, "smoothingConfidenceThreshold", { min: 0, max: 1, step: 0.001, label: "Smooth Conf" });

  const reject = filter.addFolder({ title: "Delayed Reject Mode" });
  reject.addBinding(state.reject, "delayFrames", { min: 1, max: 5, step: 1, label: "Delay Frames" });
  reject.addBinding(state.reject, "medianWindow", { min: 3, max: 7, step: 2, label: "Median Window" });
  reject.addBinding(state.reject, "spikeThreshold", { min: 1, max: 24, step: 1, label: "Spike Thresh (st)" });
}

export function setup(_device: GPUDevice): void {
  state.runtime.oscServer = createOSCServer(OSC_PORT);
  console.log(`Listening for OSC ${OSC_ADDRESS} on udp://0.0.0.0:${OSC_PORT}`);
  state.runtime.oscServer.on("message", handleOscMessage);
}

export function cleanup(): void {
  state.runtime.oscServer?.close();
  state.runtime.oscServer = null;
}

export function draw(p5: P5GPU, time: number, autoClear = true): void {
  if (autoClear) p5.clear();
  if (state.note.confidence === 0) return;
  drawNoteCircle(p5, time);
}

function handleOscMessage(message: OSCMessage): void {
  const next = parseNoteInfo(message);
  if (!next) {
    return;
  }

  const rawPitch = clamp(next[0], 0, 127);
  const rawConfidence = clamp(next[1], 0, 1);
  const rawVolume = clamp(next[2], 0, 1);

  // always push to both buffers
  pushPitch(rawPitch);
  pushDelayFrame(rawPitch, rawConfidence, rawVolume);

  if (state.filter.mode === "delayed-reject") {
    const delayed = getDelayedMedianFrame();
    if (delayed && delayed.confidence >= state.render.confidenceThreshold) {
      state.note.pitch = delayed.pitch;
      state.note.confidence = delayed.confidence;
      state.note.volume = delayed.volume;
    }
    pushFilteredPitch(state.buffers.rejectFilteredHistory, state.buffers.rejectFilteredHead, state.note.pitch);
    state.buffers.rejectFilteredHead = (state.buffers.rejectFilteredHead + 1) % FILTERED_HISTORY_SIZE;
    state.buffers.rejectFilteredCount = Math.min(state.buffers.rejectFilteredCount + 1, FILTERED_HISTORY_SIZE);
  } else {
    if (rawConfidence >= state.render.confidenceThreshold) {
      state.note.confidence = rawConfidence;
      state.note.volume = rawVolume;
      state.note.pitch = getSmoothedPitch(rawConfidence);
    }
    pushFilteredPitch(state.buffers.smoothFilteredHistory, state.buffers.smoothFilteredHead, state.note.pitch);
    state.buffers.smoothFilteredHead = (state.buffers.smoothFilteredHead + 1) % FILTERED_HISTORY_SIZE;
    state.buffers.smoothFilteredCount = Math.min(state.buffers.smoothFilteredCount + 1, FILTERED_HISTORY_SIZE);
  }
}

function drawNoteCircle(p5: P5GPU, time: number): void {
  p5.noStroke();

  if (state.path.mode === "history-line") {
    drawHistoryLine(p5);
    return;
  }

  const size = state.drawing.circleBaseSize + state.note.volume * state.drawing.volumeScale;

  let x: number;
  let y: number;

  if (state.path.mode === "polar") {
    const angle = ((time % state.polar.period) / state.polar.period) * Math.PI * 2;
    const pitchOffset = ((state.note.pitch - state.polar.pitchCenter) / (103 - 24)) * state.polar.pitchRadiusScale;
    const r = state.polar.baseRadius + pitchOffset;
    x = p5.width * 0.5 + r * Math.cos(angle);
    y = p5.height * 0.5 + r * Math.sin(angle);
  } else {
    x = p5.width * ((time % state.linear.period) / state.linear.period);
    const yOffset = ((state.note.pitch - state.linear.pitchCenter) / (103 - 24)) * state.linear.pitchRadius * 2;
    y = p5.height * 0.5 - yOffset;
  }

  x = clamp(x, 0, p5.width);
  y = clamp(y, 0, p5.height);

  p5.fill(state.drawing.r, state.drawing.g, state.drawing.b);
  p5.circle(x, y, size);
}

function drawHistoryLine(p5: P5GPU): void {
  const { buf, head, count } = getActiveFilteredHistory();
  const len = Math.min(state.historyLine.historyLength, count);
  if (len < 2) return;

  p5.noFill();
  p5.stroke(state.drawing.r, state.drawing.g, state.drawing.b);
  p5.strokeWeight(state.drawing.strokeWeight);
  p5.beginShape();

  for (let i = 0; i < len; i++) {
    const sampleIdx = (head - len + i + FILTERED_HISTORY_SIZE) % FILTERED_HISTORY_SIZE;
    const pitch = buf[sampleIdx];
    const x = (i / (len - 1)) * p5.width;
    const yOffset = ((pitch - state.historyLine.pitchCenter) / (103 - 24)) * state.historyLine.pitchRadius * 2;
    const y = clamp(p5.height * 0.5 - yOffset, 0, p5.height);
    // repeat first and last points so the spline passes through endpoints
    if (i === 0 || i === len - 1) p5.curveVertex(x, y);
    p5.curveVertex(x, y);
  }

  p5.endShape();
}

function parseNoteInfo(message: OSCMessage): [number, number, number] | null {
  if (!Array.isArray(message) || message[0] !== OSC_ADDRESS || message.length < 4) {
    return null;
  }

  const pitch = toFiniteNumber(message[1]);
  const confidence = toFiniteNumber(message[2]);
  const volume = toFiniteNumber(message[3]);
  if (pitch === null || confidence === null || volume === null) {
    return null;
  }

  return [pitch, confidence, volume];
}

function pushPitch(pitch: number): void {
  state.buffers.pitchHistory[state.buffers.pitchHistoryHead] = pitch;
  state.buffers.pitchHistoryHead = (state.buffers.pitchHistoryHead + 1) % PITCH_HISTORY_SIZE;
  state.buffers.pitchHistoryCount = Math.min(state.buffers.pitchHistoryCount + 1, PITCH_HISTORY_SIZE);
}

function getSmoothedPitch(confidence: number): number {
  if (state.buffers.pitchHistoryCount === 0) {
    return state.note.pitch;
  }

  const threshold = state.smooth.smoothingConfidenceThreshold;
  if (threshold <= 0 || confidence >= threshold) {
    return getRecentPitchAverage(1);
  }

  const normalized = 1 - confidence / threshold;
  const windowSize = 1 + Math.round(normalized * (MAX_SMOOTHING_WINDOW - 1));
  return getRecentPitchAverage(windowSize);
}

function getRecentPitchAverage(windowSize: number): number {
  const count = Math.min(windowSize, state.buffers.pitchHistoryCount);
  let sum = 0;

  for (let i = 0; i < count; i++) {
    const index = (state.buffers.pitchHistoryHead - 1 - i + PITCH_HISTORY_SIZE) % PITCH_HISTORY_SIZE;
    sum += state.buffers.pitchHistory[index];
  }

  return sum / count;
}

function pushFilteredPitch(buf: Float64Array, head: number, pitch: number): void {
  buf[head] = pitch;
}

function getActiveFilteredHistory(): { buf: Float64Array; head: number; count: number } {
  if (state.filter.mode === "delayed-reject") {
    return {
      buf: state.buffers.rejectFilteredHistory,
      head: state.buffers.rejectFilteredHead,
      count: state.buffers.rejectFilteredCount,
    };
  }
  return {
    buf: state.buffers.smoothFilteredHistory,
    head: state.buffers.smoothFilteredHead,
    count: state.buffers.smoothFilteredCount,
  };
}

function pushDelayFrame(pitch: number, confidence: number, volume: number): void {
  state.buffers.delayBuffer[state.buffers.delayHead] = { pitch, confidence, volume };
  state.buffers.delayHead = (state.buffers.delayHead + 1) % DELAY_BUFFER_SIZE;
  state.buffers.delayCount = Math.min(state.buffers.delayCount + 1, DELAY_BUFFER_SIZE);
}

function getDelayedMedianFrame(): DelayFrame | null {
  const delay = state.reject.delayFrames;
  const halfWin = Math.floor(state.reject.medianWindow / 2);
  // need at least delay + halfWin + 1 frames buffered
  if (state.buffers.delayCount < delay + halfWin + 1) {
    return null;
  }

  // the frame we want to emit (delay frames behind the latest)
  const centerIdx = (state.buffers.delayHead - 1 - delay + DELAY_BUFFER_SIZE) % DELAY_BUFFER_SIZE;
  const centerPitch = state.buffers.delayBuffer[centerIdx].pitch;

  // check if the jump from the previous frame exceeds the spike threshold
  const prevIdx = (centerIdx - 1 + DELAY_BUFFER_SIZE) % DELAY_BUFFER_SIZE;
  const prevPitch = state.buffers.delayBuffer[prevIdx].pitch;
  const jump = Math.abs(centerPitch - prevPitch);

  if (jump < state.reject.spikeThreshold) {
    // no spike detected, pass through directly
    return state.buffers.delayBuffer[centerIdx];
  }

  // spike detected — apply median filter over the window
  const windowPitches: number[] = [];
  for (let i = -halfWin; i <= halfWin; i++) {
    const idx = (centerIdx + i + DELAY_BUFFER_SIZE) % DELAY_BUFFER_SIZE;
    windowPitches.push(state.buffers.delayBuffer[idx].pitch);
  }
  windowPitches.sort((a, b) => a - b);
  const medianPitch = windowPitches[Math.floor(windowPitches.length / 2)];

  return {
    pitch: medianPitch,
    confidence: state.buffers.delayBuffer[centerIdx].confidence,
    volume: state.buffers.delayBuffer[centerIdx].volume,
  };
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

if (import.meta.main) {
  const WIDTH = 1280;
  const HEIGHT = 720;
  const device = await requestWebGpuDevice();
  const p5 = new P5GPU(device, { width: WIDTH, height: HEIGHT });

  await setup(device);

  const renderWindow = await createWindowRenderManager({
    device,
    width: WIDTH,
    height: HEIGHT,
    title: "OSC Note Trail",
    syphon: {
      serverName: "P5GPU_OSC_Note_Trail",
      flipY: true,
    },
    pane: {
      title: "OSC Trail",
      panelWidth: 360,
      panelHeight: 420,
      setup: setupPane,
    },
  });

  await renderWindow.run(() => {
    const time = performance.now() * 0.001;
    p5.beginFrame();
    p5.clear();
    draw(p5, time, false);
    return p5.endFrame();
  }, {
    cleanup() {
      cleanup();
      p5.dispose();
    },
  });
}
