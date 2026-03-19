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
  type WindowTweakpane,
} from "../window/mod.ts";
import { FeedbackNode, PassthruEffect, selectShaderFxFormat } from "@avtools/shader-fx/raw";
import { LayerBlendEffect } from "@avtools/shader-fx/generated-raw/shaders/layerBlend.frag.raw.generated.ts";
import { MathOpEffect } from "@avtools/shader-fx/generated-raw/shaders/mathOp.frag.raw.generated.ts";
import { P5GPU } from "../tools/p5gpu.ts";
import { createOSCServer, type OSCMessage } from "../tools/osc.ts";

const WIDTH = 1280;
const HEIGHT = 720;
const CLEAR_COLOR: GPUColor = { r: 0, g: 0, b: 0, a: 0 };
const OSC_PORT = 9003;
const OSC_ADDRESS = "/noteInfo";
const PITCH_HISTORY_SIZE = 100;
const MAX_SMOOTHING_WINDOW = 5;

const params = {
  trailDecay: 0.94,
  pitchCenter: 60,
  pitchRadius: 600,
  confidenceThreshold: 0.5,
  smoothingConfidenceThreshold: 0.8,
  volumeScale: 40,
};

const note = {
  pitch: 60,
  confidence: 0,
  volume: 0,
};
const pitchHistory = new Array<number>(PITCH_HISTORY_SIZE);
let pitchHistoryHead = 0;
let pitchHistoryCount = 0;

const device = await requestWebGpuDevice();
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
    panelHeight: 220,
    setup: setupPane,
  },
});
const p5 = new P5GPU(device, { width: WIDTH, height: HEIGHT });
const trail = await createTrailChain(device, WIDTH, HEIGHT);
const oscServer = createOSCServer(OSC_PORT);

console.log(`Listening for OSC ${OSC_ADDRESS} on udp://0.0.0.0:${OSC_PORT}`);
oscServer.on("message", handleOscMessage);

await renderWindow.run(renderFrame, { cleanup });

function renderFrame() {
  const time = performance.now() * 0.001;

  p5.beginFrame();
  drawNoteCircle(time);
  trail.current.setSrcs({ src: p5.endFrame() });
  trail.decay.setUniforms({ mult: params.trailDecay });
  trail.composite.renderAll();

  return trail.composite;
}

function cleanup(): void {
  oscServer.close();
  trail.composite.disposeAll();
  trail.placeholder.destroy();
  p5.dispose();
}

function setupPane(pane: WindowTweakpane): void {
  pane.addBinding(params, "trailDecay", { min: 0, max: 1, step: 0.001, label: "Trail Decay" });
  pane.addBinding(params, "pitchCenter", { min: 0, max: 127, step: 1, label: "Pitch Center" });
  pane.addBinding(params, "pitchRadius", { min: 0, max: 800, step: 1, label: "Pitch Radius" });
  pane.addBinding(params, "confidenceThreshold", { min: 0, max: 1, step: 0.001, label: "Conf Threshold" });
  pane.addBinding(params, "smoothingConfidenceThreshold", { min: 0, max: 1, step: 0.001, label: "Smooth Conf" });
  pane.addBinding(params, "volumeScale", { min: 0, max: 200, step: 1, label: "Volume Scale" });
}

function handleOscMessage(message: OSCMessage): void {
  const next = parseNoteInfo(message);
  if (!next) {
    return;
  }

  const rawPitch = clamp(next[0], 0, 127);
  note.confidence = clamp(next[1], 0, 1);
  note.volume = clamp(next[2], 0, 1);
  pushPitch(rawPitch);
  note.pitch = getSmoothedPitch(note.confidence);
}

function drawNoteCircle(time: number): void {
  p5.clear();
  p5.noStroke();

  if (note.confidence < params.confidenceThreshold) {
    return;
  }

  const x = WIDTH * ((time % 5) / 5);
  const yOffset = ((note.pitch - params.pitchCenter) / (103 - 24)) * params.pitchRadius * 2;
  const y = clamp(HEIGHT * 0.5 - yOffset, 0, HEIGHT);
  const size = 10 + note.volume * params.volumeScale;
  const colorMix = 0.5 + 0.5 * Math.sin((time / 15) * Math.PI * 2);
  const red = 255 * (1 - colorMix);
  const blue = 255 * colorMix;

  // p5.fill(red, 0, blue);
  p5.fill(255, 0, 0);
  p5.circle(x, y, size);
}

async function createTrailChain(device: GPUDevice, width: number, height: number) {
  const format = await selectShaderFxFormat(device, ["rgba16float", "rgba8unorm"]);
  const placeholder = device.createTexture({
    size: { width: 1, height: 1 },
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING,
  });

  const current = new PassthruEffect(
    device,
    { src: placeholder },
    width,
    height,
    format,
    CLEAR_COLOR,
    "nearest",
  );
  const feedback = new FeedbackNode(
    device,
    current,
    width,
    height,
    format,
    CLEAR_COLOR,
    "linear",
  );
  const decay = new MathOpEffect(
    device,
    { src: feedback },
    width,
    height,
    format,
    CLEAR_COLOR,
  );
  const composite = new LayerBlendEffect(
    device,
    { src1: current, src2: decay },
    width,
    height,
    format,
    CLEAR_COLOR,
  );

  feedback.setFeedbackSrc(composite);

  return {
    placeholder,
    current,
    decay,
    composite,
  };
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
  pitchHistory[pitchHistoryHead] = pitch;
  pitchHistoryHead = (pitchHistoryHead + 1) % PITCH_HISTORY_SIZE;
  pitchHistoryCount = Math.min(pitchHistoryCount + 1, PITCH_HISTORY_SIZE);
}

function getSmoothedPitch(confidence: number): number {
  if (pitchHistoryCount === 0) {
    return note.pitch;
  }

  const threshold = params.smoothingConfidenceThreshold;
  if (threshold <= 0 || confidence >= threshold) {
    return getRecentPitchAverage(1);
  }

  const normalized = 1 - confidence / threshold;
  const windowSize = 1 + Math.round(normalized * (MAX_SMOOTHING_WINDOW - 1));
  return getRecentPitchAverage(windowSize);
}

function getRecentPitchAverage(windowSize: number): number {
  const count = Math.min(windowSize, pitchHistoryCount);
  let sum = 0;

  for (let i = 0; i < count; i++) {
    const index = (pitchHistoryHead - 1 - i + PITCH_HISTORY_SIZE) % PITCH_HISTORY_SIZE;
    sum += pitchHistory[index];
  }

  return sum / count;
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
