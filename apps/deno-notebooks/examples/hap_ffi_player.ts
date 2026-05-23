/// <reference lib="dom" />

// Run from apps/deno-notebooks:
//   ./scripts/build_hap_decoder.sh
//   deno run --unstable-webgpu --unstable-ffi --allow-all examples/hap_ffi_player.ts /path/to/video.happack

import { P5GPU } from "../tools/p5gpu.ts";
import { createAlphaBlitPipeline, alphaBlit } from "../window/blit.ts";
import {
  createWindowRenderManager,
  type WindowTweakpane,
} from "../window/mod.ts";
import type { WindowEvent } from "../window/events.ts";
import {
  HapVideoSource,
  requestHapWebGpuDevice,
  type HapVideoSourceFrameStats,
} from "../hap/mod.ts";

const OUTPUT_WIDTH = 1280;
const OUTPUT_HEIGHT = 720;
const VIDEO_OUTPUT_FORMAT: GPUTextureFormat = "rgba8unorm";
const DEFAULT_HAPPACK_PATH = `${Deno.env.get("HOME") ?? ""}/Downloads/Local_dialect_avneesh_promo_chunk4.happack`;

const initialPath = readStringArg("path") ?? Deno.args.find((arg) => !arg.startsWith("--")) ??
  DEFAULT_HAPPACK_PATH;
const initialWorkers = readNumberArg("workers") ?? 0;

const params = {
  path: initialPath,
  workers: initialWorkers,
  play: false,
  loop: true,
  frame: 0,
  seekPercent: 0,
  showStats: true,
  status: initialPath ? "loading" : "enter a happack path",
  source: "",
  time: "00:00.000 / 00:00.000",
};

const timing = {
  readMs: 0,
  decodeMs: 0,
  uploadMs: 0,
  totalMs: 0,
  fps: 0,
};

let video: HapVideoSource | null = null;
let lastDecodeStats: HapVideoSourceFrameStats | null = null;
let pendingLoadPath: string | null = initialPath || null;
let pendingFrame: number | null = null;
let currentFrame = 0;
let lastRenderMs = performance.now();
let fpsSmooth = 60;
let lastPaneRefreshMs = 0;
let paneRef: WindowTweakpane | null = null;

const device = await requestHapWebGpuDevice();
const p5 = new P5GPU(device, {
  width: OUTPUT_WIDTH,
  height: OUTPUT_HEIGHT,
  format: "rgba8unorm",
});
const renderWindow = await createWindowRenderManager({
  device,
  width: OUTPUT_WIDTH,
  height: OUTPUT_HEIGHT,
  title: "HAP FFI Player",
  pane: {
    title: "HAP FFI Player",
    panelWidth: 440,
    panelHeight: 520,
    setup: setupPane,
  },
});
const alphaBlitPipeline = createAlphaBlitPipeline(device, VIDEO_OUTPUT_FORMAT);

await renderWindow.run(renderFrame, {
  onEvent: handleWindowEvent,
  cleanup: () => {
    video?.close();
    p5.dispose();
  },
});

function setupPane(pane: WindowTweakpane): void {
  paneRef = pane;

  const source = pane.addFolder({ title: "Source" });
  source.addBinding(params, "path", { label: "Path" });
  source.addBinding(params, "workers", { min: 0, max: 16, step: 1, label: "Workers" });
  source.addButton({ title: "Load" }).on("click", () => {
    pendingLoadPath = params.path.trim();
  });
  source.addBinding(params, "source", { readonly: true, label: "Info" });

  const transport = pane.addFolder({ title: "Transport" });
  transport.addBinding(params, "play", { label: "Play" });
  transport.addBinding(params, "loop", { label: "Loop" });
  transport.addBinding(params, "frame", {
    min: 0,
    max: 1_000_000,
    step: 1,
    label: "Frame",
  }).on("change", (event) => {
    pendingFrame = Number(event.value ?? params.frame);
  });
  transport.addBinding(params, "seekPercent", {
    min: 0,
    max: 100,
    step: 0.1,
    label: "Seek %",
  }).on("change", (event) => {
    if (!video) {
      return;
    }
    const percent = Number(event.value ?? params.seekPercent) / 100;
    pendingFrame = Math.round(percent * Math.max(0, video.info.frameCount - 1));
  });
  transport.addButton({ title: "Previous Frame" }).on("click", () => queueRelativeFrame(-1));
  transport.addButton({ title: "Next Frame" }).on("click", () => queueRelativeFrame(1));
  transport.addButton({ title: "Random Frame" }).on("click", queueRandomFrame);

  const readout = pane.addFolder({ title: "Readout" });
  readout.addBinding(params, "time", { readonly: true, label: "Time" });
  readout.addBinding(params, "status", { readonly: true, label: "Status" });
  readout.addBinding(params, "showStats", { label: "Overlay Stats" });
  readout.addBinding(timing, "readMs", { readonly: true, label: "Read ms" });
  readout.addBinding(timing, "decodeMs", { readonly: true, label: "Decode ms" });
  readout.addBinding(timing, "uploadMs", { readonly: true, label: "Upload ms" });
  readout.addBinding(timing, "fps", { readonly: true, label: "FPS" });
}

function renderFrame(): GPUTexture {
  const now = performance.now();
  const frameFps = 1000 / Math.max(0.001, now - lastRenderMs);
  fpsSmooth += (frameFps - fpsSmooth) * 0.08;
  timing.fps = fpsSmooth;
  lastRenderMs = now;

  if (pendingLoadPath !== null) {
    const path = pendingLoadPath;
    pendingLoadPath = null;
    loadHappack(path);
  }

  const videoTexture = updateVideoSource(now);
  if (!videoTexture) {
    drawEmptyFrame();
    refreshPane(now);
    return p5.endFrame();
  }

  drawOverlay();
  const overlayTexture = p5.endFrame();

  const encoder = device.createCommandEncoder();
  alphaBlit(
    device,
    encoder,
    alphaBlitPipeline,
    overlayTexture.createView(),
    videoTexture.createView(),
  );
  device.queue.submit([encoder.finish()]);
  refreshPane(now);
  return videoTexture;
}

function updateVideoSource(now: number): GPUTexture | null {
  if (!video) {
    return null;
  }
  video.playing = params.play;
  video.loop = params.loop;

  try {
    if (pendingFrame !== null) {
      const frame = pendingFrame;
      pendingFrame = null;
      video.seekFrame(frame);
    }
    const texture = video.update(now);
    syncReadout();
    return texture;
  } catch (error) {
    params.play = false;
    params.status = error instanceof Error ? error.message : String(error);
    return video.texture;
  }
}

function loadHappack(path: string): void {
  if (!path) {
    params.status = "enter a happack path";
    return;
  }

  try {
    video?.close();
    video = HapVideoSource.open(device, path, {
      workerCount: params.workers,
      outputWidth: OUTPUT_WIDTH,
      outputHeight: OUTPUT_HEIGHT,
      outputFormat: VIDEO_OUTPUT_FORMAT,
      play: params.play,
      loop: params.loop,
    });
    currentFrame = 0;
    params.frame = 0;
    params.seekPercent = 0;
    params.source = `${video.info.width}x${video.info.height} ${video.info.frameRate.toFixed(3)}fps ${video.info.chunkCount} chunks ${video.info.compressor}`;
    params.status = "loaded";
    syncReadout();
    paneRef?.refresh();
  } catch (error) {
    video = null;
    params.play = false;
    params.source = "";
    params.status = error instanceof Error ? error.message : String(error);
    paneRef?.refresh();
  }
}

function syncReadout(): void {
  if (!video) {
    return;
  }
  const stats = video.lastStats;
  lastDecodeStats = stats;
  currentFrame = video.currentFrame;
  params.play = video.playing;
  params.frame = currentFrame;
  params.seekPercent = video.info.frameCount > 1
    ? (currentFrame / (video.info.frameCount - 1)) * 100
    : 0;
  params.time = `${formatTime(video.currentTimeSeconds)} / ${
    formatTime(video.info.durationSeconds)
  }`;
  if (stats) {
    timing.readMs = stats.readMs;
    timing.decodeMs = stats.decodeMs;
    timing.uploadMs = stats.uploadMs;
    timing.totalMs = stats.totalMs + stats.uploadMs;
  }
  if (params.status === "loaded") {
    params.status = "ok";
  }
}

function drawOverlay(): void {
  p5.beginFrame();
  p5.clear();
  p5.noStroke();
  p5.textFont("Inter Variable");
  p5.textAlign("left", "top");

  p5.fill(0, 0, 0, 150);
  p5.rect(16, 16, params.showStats ? 410 : 330, params.showStats ? 124 : 58, 6);

  p5.fill(245, 248, 255, 235);
  p5.textSize(15);
  p5.text(
    video
      ? `frame ${currentFrame + 1} / ${video.info.frameCount}   ${params.time}`
      : params.status,
    28,
    28,
  );

  if (!params.showStats || !video) {
    return;
  }

  p5.fill(185, 196, 210, 230);
  p5.textSize(13);
  p5.text(
    [
      `read ${timing.readMs.toFixed(3)} ms   decode ${timing.decodeMs.toFixed(3)} ms   upload ${timing.uploadMs.toFixed(3)} ms`,
      `total ${timing.totalMs.toFixed(3)} ms   render ${timing.fps.toFixed(1)} fps`,
      `chunks ${lastDecodeStats?.chunkCount ?? video.info.chunkCount}   workers ${
        (lastDecodeStats?.workerCount ?? params.workers) || "auto"
      }`,
      params.status,
    ].join("\n"),
    28,
    54,
  );
}

function drawEmptyFrame(): void {
  p5.beginFrame();
  p5.background(10, 12, 16);
  p5.noStroke();
  p5.textFont("Inter Variable");
  p5.textAlign("center", "center");
  p5.fill(185, 196, 210);
  p5.textSize(18);
  p5.text(params.status, OUTPUT_WIDTH / 2, OUTPUT_HEIGHT / 2);
}

function handleWindowEvent(event: WindowEvent): void {
  if (event.type !== "key" || !event.down) {
    return;
  }
  const key = event.key;
  if (key === " " || key === "Named(Space)") {
    params.play = !params.play;
    paneRef?.refresh();
    return;
  }
  if (key === "Named(ArrowLeft)" || key === "ArrowLeft") {
    queueRelativeFrame(-1);
    return;
  }
  if (key === "Named(ArrowRight)" || key === "ArrowRight") {
    queueRelativeFrame(1);
    return;
  }
  if (/^[0-9]$/.test(key)) {
    if (video) {
      const percent = Number(key) / 10;
      pendingFrame = Math.round(percent * Math.max(0, video.info.frameCount - 1));
    }
    return;
  }
  if (key.toLowerCase() === "r") {
    queueRandomFrame();
  }
}

function queueRelativeFrame(delta: number): void {
  pendingFrame = currentFrame + delta;
}

function queueRandomFrame(): void {
  if (!video) {
    return;
  }
  pendingFrame = Math.floor(Math.random() * video.info.frameCount);
}

function refreshPane(now: number): void {
  if (now - lastPaneRefreshMs < 100) {
    return;
  }
  lastPaneRefreshMs = now;
  paneRef?.refresh();
}

function formatTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const minutes = Math.floor(clamped / 60);
  const wholeSeconds = Math.floor(clamped % 60);
  const millis = Math.floor((clamped - Math.floor(clamped)) * 1000);
  return `${minutes.toString().padStart(2, "0")}:${
    wholeSeconds.toString().padStart(2, "0")
  }.${millis.toString().padStart(3, "0")}`;
}

function readStringArg(name: string): string | null {
  const prefix = `--${name}=`;
  const value = Deno.args.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
}

function readNumberArg(name: string): number | null {
  const value = readStringArg(name);
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
