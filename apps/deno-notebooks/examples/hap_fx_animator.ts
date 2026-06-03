/// <reference lib="dom" />

// Run from apps/deno-notebooks:
//   ./scripts/build_hap_decoder.sh
//   deno run --unstable-webgpu --unstable-ffi --allow-all examples/hap_fx_animator.ts /path/to/video.happack

import type { ShaderSource } from "@avtools/shader-fx/raw";
import { GrainEffect } from "@avtools/shader-fx/generated-raw/shaders/grain.frag.raw.generated.ts";
import { launch } from "@avtools/core-timing";
import { dirname } from "jsr:@std/path@1";
import {
  createWindowRenderManager,
  type PaneBinding,
  type WindowTweakpane,
} from "../window/mod.ts";
import { blit, createBlitPipeline } from "../window/blit.ts";
import type { WindowEvent } from "../window/events.ts";
import {
  HapVideoSource,
  type HapVideoSourceFrameStats,
  requestHapWebGpuDevice,
} from "../hap/mod.ts";
import { P5GPU } from "../tools/p5gpu.ts";
import {
  type AnimationPlaybackState,
  createAnimationEditorBridge,
} from "../tools/animationEditorAdapter.ts";
import {
  buildParamSystem,
  createAnimationCallbacks,
  snapshotToAnimation,
} from "../tools/paramSystem.ts";

const WIDTH = 1280;
const HEIGHT = 720;
const VIDEO_OUTPUT_FORMAT: GPUTextureFormat = "rgba8unorm";
const FX_FORMAT: GPUTextureFormat = "rgba8unorm";
const CLEAR_COLOR: GPUColor = { r: 0, g: 0, b: 0, a: 1 };
const DEFAULT_ANIMATION = "default";
const DEFAULT_HAPPACK_PATH = `${
  Deno.env.get("HOME") ?? ""
}/Downloads/Local_dialect_avneesh_promo_chunk4.happack`;

const initialPath = readStringArg("path") ??
  Deno.args.find((arg) => !arg.startsWith("--")) ??
  DEFAULT_HAPPACK_PATH;
const initialWorkers = readNumberArg("workers") ?? 0;

const paramDefs = {
  video: {
    _folder: "Video Params",
    frameNumber: {
      value: 0,
      min: 0,
      max: 1_000_000,
      step: 1,
      label: "Frame Number",
    },
  },
  effects: {
    _folder: "Effects",
    displacementPixels: {
      value: 1.6,
      min: 0,
      max: 100,
      step: 0.05,
      label: "Displacement Pixels",
    },
    grainCellSize: {
      value: 2,
      min: 1,
      max: 16,
      step: 1,
      label: "Grain Cell Size",
    },
  },
} as const;

type FxParams = {
  frameNumber: number;
  displacementPixels: number;
  grainCellSize: number;
};

const sourceParams = {
  path: initialPath,
  workers: initialWorkers,
  status: initialPath ? "loading" : "enter a happack path",
  source: "",
  playhead: "00:00.000 / 00:00.000",
  frame: "frame 0 / 0",
};

type ExportPreset = "hapq" | "prores" | "h264";

const exportParams = {
  preset: "hapq" as ExportPreset,
  fps: 60,
  outputPath: "",
  run: false,
  rate: "0.0x",
  status: "idle",
};

const timing = {
  readMs: 0,
  decodeMs: 0,
  uploadMs: 0,
  totalMs: 0,
  fps: 0,
};

const paramSystem = buildParamSystem(paramDefs);
const params = paramSystem.params as FxParams;
const paneBindings = new Map<string, PaneBinding>();
const syncRef = { enabled: true };
const animationPlayback: AnimationPlaybackState = {
  playing: false,
  currentTime: 0,
  duration: 1,
  loop: true,
  speed: 1,
};

let video: HapVideoSource | null = null;
let lastStats: HapVideoSourceFrameStats | null = null;
let pendingLoadPath: string | null = initialPath || null;
let pendingFrame: number | null = null;
let paneRef: WindowTweakpane | null = null;
let paramsDirty = false;
let paneRefreshRequested = false;
let lastPaneRefreshMs = 0;
let lastRenderMs = performance.now();
let fpsSmooth = 60;
let exporting = false;
let exportCancelRequested = false;
let exportChild: Deno.ChildProcess | null = null;

class ExportCancelledError extends Error {
  constructor() {
    super("Export stopped");
  }
}

class RgbaReadback {
  readonly bytesPerRow: number;
  readonly tightBytesPerRow: number;
  readonly tightRgba: Uint8Array;
  #buffer: GPUBuffer;

  constructor(
    private readonly deviceRef: GPUDevice,
    readonly width: number,
    readonly height: number,
  ) {
    this.tightBytesPerRow = width * 4;
    this.bytesPerRow = alignTo(this.tightBytesPerRow, 256);
    this.tightRgba = new Uint8Array(this.tightBytesPerRow * height);
    this.#buffer = deviceRef.createBuffer({
      size: this.bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
  }

  async read(
    encoder: GPUCommandEncoder,
    texture: GPUTexture,
  ): Promise<Uint8Array> {
    encoder.copyTextureToBuffer(
      { texture },
      {
        buffer: this.#buffer,
        bytesPerRow: this.bytesPerRow,
        rowsPerImage: this.height,
      },
      { width: this.width, height: this.height, depthOrArrayLayers: 1 },
    );
    this.deviceRef.queue.submit([encoder.finish()]);
    await this.deviceRef.queue.onSubmittedWorkDone();
    await this.#buffer.mapAsync(GPUMapMode.READ);
    const mapped = new Uint8Array(this.#buffer.getMappedRange());
    for (let y = 0; y < this.height; y += 1) {
      const srcStart = y * this.bytesPerRow;
      const dstStart = y * this.tightBytesPerRow;
      this.tightRgba.set(
        mapped.subarray(srcStart, srcStart + this.tightBytesPerRow),
        dstStart,
      );
    }
    this.#buffer.unmap();
    return this.tightRgba;
  }

  destroy(): void {
    this.#buffer.destroy();
  }
}

function setupPane(pane: WindowTweakpane): void {
  paneRef = pane;

  const source = pane.addFolder({ title: "Source" });
  source.addBinding(sourceParams, "path", { label: "Path" });
  source.addBinding(sourceParams, "workers", {
    min: 0,
    max: 16,
    step: 1,
    label: "Workers",
  });
  source.addButton({ title: "Load" }).on("click", () => {
    pendingLoadPath = sourceParams.path.trim();
  });
  source.addBinding(sourceParams, "source", { readonly: true, label: "Info" });

  const nextBindings = paramSystem.setupPane(pane);
  paneBindings.clear();
  for (const [key, binding] of nextBindings) {
    paneBindings.set(key, binding);
  }

  const playback = pane.addFolder({ title: "Playback" });
  const playbackBindings = animationPlayback as unknown as Record<
    string,
    unknown
  >;
  playback.addBinding(playbackBindings, "playing", { label: "Play" });
  playback.addBinding(playbackBindings, "loop", { label: "Loop" });
  playback.addBinding(playbackBindings, "speed", {
    min: 0,
    max: 4,
    step: 0.05,
    label: "Speed",
  });
  playback.addButton({ title: "Previous Frame" }).on(
    "click",
    () => seekRelativeFrame(-1),
  );
  playback.addButton({ title: "Next Frame" }).on(
    "click",
    () => seekRelativeFrame(1),
  );
  playback.addButton({ title: "Random Frame" }).on("click", seekRandomFrame);

  const exportFolder = pane.addFolder({ title: "Export" });
  exportFolder.addBinding(exportParams, "preset", {
    label: "Preset",
    options: {
      "HAP Q": "hapq",
      "ProRes HQ": "prores",
      "H.264 Preview": "h264",
    },
  });
  exportFolder.addBinding(exportParams, "fps", {
    min: 1,
    max: 120,
    step: 0.001,
    label: "FPS",
  });
  exportFolder.addBinding(exportParams, "outputPath", { label: "Output Path" });
  exportFolder.addBinding(exportParams, "run", { label: "Start / Stop" }).on(
    "change",
    (event) => {
      if (event.value) {
        void exportVideo();
      } else {
        requestExportStop();
      }
    },
  );
  exportFolder.addBinding(exportParams, "rate", {
    readonly: true,
    label: "Rate",
  });
  exportFolder.addBinding(exportParams, "status", {
    readonly: true,
    label: "Status",
  });

  const readout = pane.addFolder({ title: "Readout" });
  readout.addBinding(sourceParams, "frame", { readonly: true, label: "Frame" });
  readout.addBinding(sourceParams, "playhead", {
    readonly: true,
    label: "Time",
  });
  readout.addBinding(sourceParams, "status", {
    readonly: true,
    label: "Status",
  });
  readout.addBinding(timing, "readMs", { readonly: true, label: "Read ms" });
  readout.addBinding(timing, "decodeMs", {
    readonly: true,
    label: "Decode ms",
  });
  readout.addBinding(timing, "uploadMs", {
    readonly: true,
    label: "Upload ms",
  });
  readout.addBinding(timing, "fps", { readonly: true, label: "FPS" });
}

function clampPlaybackTime(time: number): number {
  return Math.min(Math.max(time, 0), animationPlayback.duration);
}

let animationBridge = createAnimationEditorBridge({
  management: {
    trackInputs: paramSystem.trackInputs,
    syncRef,
    playbackRef: animationPlayback,
    snapshotCurrentState: (animationName, time) => {
      snapshotToAnimation(
        params,
        paramSystem.paramMeta,
        animationBridge.tracks,
        animationName,
        time,
      );
    },
  },
});

const animationCallbacks = createAnimationCallbacks(
  params,
  paneBindings,
  paramSystem.paramMeta,
  paramSystem.actionMap,
  syncRef,
);

animationBridge.tracks.setFromInputs(
  DEFAULT_ANIMATION,
  paramSystem.trackInputs,
);

const device = await requestHapWebGpuDevice();
const p5 = new P5GPU(device, {
  width: WIDTH,
  height: HEIGHT,
  format: VIDEO_OUTPUT_FORMAT,
});
const renderWindow = await createWindowRenderManager({
  device,
  width: WIDTH,
  height: HEIGHT,
  title: "HAP FX Animator",
  syphon: {
    serverName: "HAP_FX_Animator",
    flipY: true,
  },
  pane: {
    title: "HAP FX Animator",
    panelWidth: 460,
    panelHeight: 620,
    setup: setupPane,
  },
});

const placeholder = device.createTexture({
  size: { width: 1, height: 1 },
  format: VIDEO_OUTPUT_FORMAT,
  usage: GPUTextureUsage.TEXTURE_BINDING,
});
const grain = new GrainEffect(
  device,
  { src: placeholder },
  WIDTH,
  HEIGHT,
  FX_FORMAT,
  CLEAR_COLOR,
);
const exportBlitPipeline = createBlitPipeline(device, FX_FORMAT);
const exportTexture = device.createTexture({
  size: { width: WIDTH, height: HEIGHT, depthOrArrayLayers: 1 },
  format: FX_FORMAT,
  usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING |
    GPUTextureUsage.COPY_SRC,
});
const exportReadback = new RgbaReadback(device, WIDTH, HEIGHT);

const animationHandle = animationBridge.showBoundInWindow(
  renderWindow.window,
  DEFAULT_ANIMATION,
  {
    title: "HAP FX Animation Editor",
    panelWidth: 1100,
    panelHeight: 760,
  },
);
animationHandle.setCallbacks(animationCallbacks);

const rootAnim = launch(async (ctx) => {
  let lastTickTime = ctx.progTime;
  let lastAppliedTime: number | null = null;
  let lastPlaybackSignature = "";

  while (true) {
    if (exporting) {
      await ctx.waitSec(1 / 30);
      continue;
    }

    const now = ctx.progTime;
    const deltaTime = Math.max(0, now - lastTickTime);
    lastTickTime = now;

    const duration = Math.max(animationPlayback.duration, 0);
    const speed = Number.isFinite(animationPlayback.speed)
      ? Math.max(0, animationPlayback.speed)
      : 1;
    if (animationPlayback.playing) {
      const nextTime = animationPlayback.currentTime + deltaTime * speed;
      if (duration <= 0) {
        animationPlayback.currentTime = 0;
        animationPlayback.playing = false;
      } else if (nextTime >= duration) {
        if (animationPlayback.loop) {
          animationHandle.scrubAndEvaluate(duration);
          animationHandle.scrubToTime(0);
          lastAppliedTime = null;
          animationPlayback.currentTime = nextTime % duration;
        } else {
          animationPlayback.currentTime = duration;
          animationPlayback.playing = false;
        }
      } else {
        animationPlayback.currentTime = nextTime;
      }
    }

    const playbackTime = clampPlaybackTime(animationPlayback.currentTime);
    animationPlayback.currentTime = playbackTime;
    const playbackSignature = JSON.stringify({
      playing: animationPlayback.playing,
      currentTime: playbackTime,
      duration: animationPlayback.duration,
      loop: animationPlayback.loop,
      speed: animationPlayback.speed,
    });

    if (
      lastAppliedTime === null ||
      Math.abs(playbackTime - lastAppliedTime) > 1e-6
    ) {
      syncRef.enabled = false;
      animationHandle.scrubAndEvaluate(playbackTime);
      syncRef.enabled = true;
      paramsDirty = true;
      paneRefreshRequested = true;
      lastAppliedTime = playbackTime;
      lastPlaybackSignature = playbackSignature;
    } else if (playbackSignature !== lastPlaybackSignature) {
      animationHandle.scrubToTime(playbackTime);
      paneRefreshRequested = true;
      lastPlaybackSignature = playbackSignature;
    }

    animationHandle.setLivePlayhead(playbackTime);

    await ctx.waitSec(1 / 60);
  }
});
rootAnim.catch((err: unknown) => {
  if ((err as Error)?.message !== "aborted") {
    console.error("HAP FX root context error:", err);
  }
});

await renderWindow.run(renderFrame, {
  onEvent: handleWindowEvent,
  cleanup,
});

function renderFrame(): ShaderSource {
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

  if (exporting) {
    refreshPane(now);
    return grain;
  }

  const rendered = renderFxFrame(animationPlayback.currentTime);
  if (!rendered) {
    drawEmptyFrame();
    refreshPane(now);
    return p5.endFrame();
  }

  if (paramsDirty) {
    paramsDirty = false;
  }
  refreshPane(now);
  return rendered;
}

function renderFxFrame(animationTimeSeconds: number): ShaderSource | null {
  const videoTexture = updateVideoFrame();
  if (!videoTexture) {
    return null;
  }

  grain.setSrcs({ src: videoTexture });
  grain.setUniforms({
    deviationPixels: params.displacementPixels,
    time: animationTimeSeconds,
    frameNumber: params.frameNumber,
    cellSize: params.grainCellSize,
  });
  grain.render();
  return grain;
}

function updateVideoFrame(): GPUTexture | null {
  if (!video) {
    return null;
  }

  try {
    const targetFrame = pendingFrame ?? Math.round(params.frameNumber);
    pendingFrame = null;
    const clampedFrame = clampFrame(targetFrame);
    params.frameNumber = clampedFrame;

    if (video.currentFrame !== clampedFrame) {
      lastStats = video.seekFrame(clampedFrame);
    } else {
      lastStats = video.lastStats;
    }

    const texture = video.render();
    syncReadout();
    return texture;
  } catch (error) {
    animationPlayback.playing = false;
    sourceParams.status = error instanceof Error
      ? error.message
      : String(error);
    paneRefreshRequested = true;
    return video.texture;
  }
}

function loadHappack(rawPath: string): void {
  const path = expandHome(rawPath.trim());
  if (!path) {
    sourceParams.status = "enter a happack path";
    paneRefreshRequested = true;
    return;
  }

  try {
    video?.close();
    video = HapVideoSource.open(device, path, {
      workerCount: sourceParams.workers,
      outputWidth: WIDTH,
      outputHeight: HEIGHT,
      outputFormat: VIDEO_OUTPUT_FORMAT,
      play: false,
      loop: false,
    });
    video.playing = false;
    video.loop = false;

    sourceParams.path = path;
    sourceParams.source = `${video.info.width}x${video.info.height} ${
      video.info.frameRate.toFixed(3)
    }fps ${video.info.chunkCount} chunks ${video.info.compressor}`;
    sourceParams.status = "loaded";
    exportParams.fps = video.info.frameRate;

    animationPlayback.currentTime = 0;
    animationPlayback.duration = Math.max(
      video.info.durationSeconds,
      1 / Math.max(video.info.frameRate, 1),
    );
    params.frameNumber = 0;
    updateFrameTrackInputBounds(Math.max(0, video.info.frameCount - 1));
    seedDefaultVideoAnimation();
    animationHandle.scrubAndEvaluate(0);
    animationHandle.setLivePlayhead(0);

    syncReadout();
    paneRefreshRequested = true;
    paneRef?.refresh();
  } catch (error) {
    video = null;
    animationPlayback.playing = false;
    sourceParams.source = "";
    sourceParams.status = error instanceof Error
      ? error.message
      : String(error);
    paneRefreshRequested = true;
    paneRef?.refresh();
  }
}

function seedDefaultVideoAnimation(): void {
  if (!video) {
    return;
  }
  const animation = animationBridge.tracks.getFull(DEFAULT_ANIMATION);
  if (!animation) {
    return;
  }

  const maxFrame = Math.max(0, video.info.frameCount - 1);
  const frameRate = Math.max(video.info.frameRate, 1);
  const lastFrameTime = maxFrame / frameRate;
  const nowId = Date.now();

  const updatedTracks = animation.tracks.map((track) => {
    if (track.name === "frameNumber") {
      return {
        ...track,
        low: 0,
        high: maxFrame,
        elementData: [
          { id: `frame_start_${nowId}`, time: 0, value: 0 },
          { id: `frame_end_${nowId}`, time: lastFrameTime, value: maxFrame },
        ],
      };
    }

    if (track.name === "displacementPixels" && track.elementData.length === 0) {
      return {
        ...track,
        elementData: [
          {
            id: `displacement_start_${nowId}`,
            time: 0,
            value: params.displacementPixels,
          },
        ],
      };
    }

    if (track.name === "grainCellSize" && track.elementData.length === 0) {
      return {
        ...track,
        elementData: [
          {
            id: `grain_cell_start_${nowId}`,
            time: 0,
            value: params.grainCellSize,
          },
        ],
      };
    }

    return track;
  });

  animationBridge.tracks.set(
    DEFAULT_ANIMATION,
    updatedTracks,
    animation.trackOrder,
  );
}

function updateFrameTrackInputBounds(maxFrame: number): void {
  const frameInput = paramSystem.trackInputs.find((input) =>
    input.name === "frameNumber"
  );
  if (!frameInput) {
    return;
  }
  (frameInput as { low?: number; high?: number }).low = 0;
  (frameInput as { low?: number; high?: number }).high = maxFrame;
}

function syncReadout(): void {
  if (!video) {
    return;
  }
  const frame = video.currentFrame;
  sourceParams.frame = `frame ${frame + 1} / ${video.info.frameCount}`;
  sourceParams.playhead = `${formatTime(frame / video.info.frameRate)} / ${
    formatTime(video.info.durationSeconds)
  }`;
  if (sourceParams.status === "loaded") {
    sourceParams.status = "ok";
  }

  const stats = lastStats ?? video.lastStats;
  if (stats) {
    timing.readMs = stats.readMs;
    timing.decodeMs = stats.decodeMs;
    timing.uploadMs = stats.uploadMs;
    timing.totalMs = stats.totalMs + stats.uploadMs;
  }
}

async function exportVideo(): Promise<void> {
  if (!video) {
    exportParams.status = "load a happack first";
    exportParams.run = false;
    paneRefreshRequested = true;
    paneRef?.refresh();
    return;
  }
  if (exporting) {
    return;
  }

  exporting = true;
  exportCancelRequested = false;
  const previousPlayback = { ...animationPlayback };
  const previousFrame = params.frameNumber;
  const fps = Number.isFinite(exportParams.fps)
    ? Math.max(1, exportParams.fps)
    : 60;
  const duration = Math.max(animationPlayback.duration, 1 / fps);
  const frameCount = Math.max(1, Math.round(duration * fps));
  const outputPath = resolveExportPath(
    exportParams.outputPath,
    exportParams.preset,
  );
  const ffmpegArgs = buildFfmpegArgs(outputPath, exportParams.preset, fps);

  animationPlayback.playing = false;
  pendingFrame = null;
  exportParams.run = true;
  exportParams.rate = "0.0x";
  exportParams.status = `exporting 0 / ${frameCount}`;
  paneRefreshRequested = true;
  paneRef?.refresh();

  const startedAtMs = performance.now();
  let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  try {
    await Deno.mkdir(dirname(outputPath), { recursive: true });
    exportChild = new Deno.Command("ffmpeg", {
      args: ffmpegArgs,
      stdin: "piped",
      stdout: "null",
      stderr: "piped",
    }).spawn();
    const stderrPromise = new Response(exportChild.stderr).text();
    writer = exportChild.stdin.getWriter();

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      if (exportCancelRequested) {
        throw new ExportCancelledError();
      }

      const timeSeconds = frameIndex / fps;
      animationPlayback.currentTime = clampPlaybackTime(timeSeconds);
      syncRef.enabled = false;
      animationHandle.scrubAndEvaluate(animationPlayback.currentTime);
      syncRef.enabled = true;
      const rendered = renderFxFrame(animationPlayback.currentTime);
      if (!rendered) {
        throw new Error("No rendered frame available for export.");
      }
      const rgba = await readRenderedRgba();
      await writer.write(rgba);

      if (
        frameIndex === frameCount - 1 ||
        frameIndex % Math.max(1, Math.floor(fps / 2)) === 0
      ) {
        const elapsedSeconds = Math.max(
          0.001,
          (performance.now() - startedAtMs) / 1000,
        );
        const renderedSeconds = (frameIndex + 1) / fps;
        exportParams.rate = `${(renderedSeconds / elapsedSeconds).toFixed(2)}x`;
        exportParams.status = `exporting ${frameIndex + 1} / ${frameCount}`;
        paneRefreshRequested = true;
        paneRef?.refresh();
      }
    }

    await writer.close();
    writer = null;
    const [status, stderr] = await Promise.all([
      exportChild.status,
      stderrPromise,
    ]);
    if (!status.success) {
      if (exportCancelRequested) {
        throw new ExportCancelledError();
      }
      throw new Error(`ffmpeg exited ${status.code}: ${stderr.trim()}`);
    }

    exportParams.outputPath = outputPath;
    exportParams.status = `exported ${outputPath}`;
  } catch (error) {
    if (error instanceof ExportCancelledError || exportCancelRequested) {
      exportParams.status = "stopped";
    } else {
      exportParams.status = error instanceof Error
        ? error.message
        : String(error);
    }
    killExportChild();
    try {
      await writer?.close();
    } catch {
      // The pipe is expected to be broken after stopping ffmpeg.
    }
  } finally {
    animationPlayback.playing = false;
    animationPlayback.currentTime = clampPlaybackTime(
      previousPlayback.currentTime,
    );
    animationPlayback.duration = previousPlayback.duration;
    animationPlayback.loop = previousPlayback.loop;
    animationPlayback.speed = previousPlayback.speed;
    params.frameNumber = previousFrame;
    pendingFrame = Math.round(previousFrame);
    syncRef.enabled = false;
    animationHandle.scrubAndEvaluate(animationPlayback.currentTime);
    syncRef.enabled = true;
    animationHandle.setLivePlayhead(animationPlayback.currentTime);
    exporting = false;
    exportCancelRequested = false;
    exportChild = null;
    exportParams.run = false;
    paneRefreshRequested = true;
    paneRef?.refresh();
  }
}

function requestExportStop(): void {
  if (!exporting) {
    exportParams.run = false;
    return;
  }

  exportCancelRequested = true;
  exportParams.status = "stopping";
  killExportChild();
  paneRefreshRequested = true;
  paneRef?.refresh();
}

function killExportChild(): void {
  try {
    exportChild?.kill("SIGTERM");
  } catch {
    // The process may already have exited.
  }
}

async function readRenderedRgba(): Promise<Uint8Array> {
  const encoder = device.createCommandEncoder();
  blit(
    device,
    encoder,
    exportBlitPipeline,
    grain.output,
    exportTexture.createView(),
  );
  return await exportReadback.read(encoder, exportTexture);
}

function drawEmptyFrame(): void {
  p5.beginFrame();
  p5.background(10, 12, 16);
  p5.noStroke();
  p5.textFont("Inter Variable");
  p5.textAlign("center", "center");
  p5.fill(185, 196, 210);
  p5.textSize(18);
  p5.text(sourceParams.status, WIDTH / 2, HEIGHT / 2);
}

function handleWindowEvent(event: WindowEvent): void {
  if (event.type !== "key" || !event.down) {
    return;
  }

  const key = event.key;
  if (key === " " || key === "Named(Space)") {
    animationPlayback.playing = !animationPlayback.playing;
    paneRefreshRequested = true;
    animationHandle.scrubToTime(animationPlayback.currentTime);
    return;
  }
  if (key === "Named(ArrowLeft)" || key === "ArrowLeft") {
    seekRelativeFrame(-1);
    return;
  }
  if (key === "Named(ArrowRight)" || key === "ArrowRight") {
    seekRelativeFrame(1);
    return;
  }
  if (/^[0-9]$/.test(key) && video) {
    const percent = Number(key) / 10;
    seekAbsoluteFrame(
      Math.round(percent * Math.max(0, video.info.frameCount - 1)),
    );
    return;
  }
  if (key.toLowerCase() === "r") {
    seekRandomFrame();
  }
}

function seekRelativeFrame(delta: number): void {
  if (!video) {
    return;
  }
  seekAbsoluteFrame(video.currentFrame + delta);
}

function seekRandomFrame(): void {
  if (!video) {
    return;
  }
  seekAbsoluteFrame(Math.floor(Math.random() * video.info.frameCount));
}

function seekAbsoluteFrame(frame: number): void {
  if (!video) {
    return;
  }
  const nextFrame = clampFrame(frame);
  animationPlayback.playing = false;
  animationPlayback.currentTime = clampPlaybackTime(
    nextFrame / Math.max(video.info.frameRate, 1),
  );
  params.frameNumber = nextFrame;
  pendingFrame = nextFrame;
  paramsDirty = true;
  paneRefreshRequested = true;
  animationHandle.scrubToTime(animationPlayback.currentTime);
}

function clampFrame(frame: number): number {
  const frameCount = Math.max(1, video?.info.frameCount ?? 1);
  return Math.max(0, Math.min(frameCount - 1, Math.round(frame)));
}

function refreshPane(now: number): void {
  if (!paneRefreshRequested && now - lastPaneRefreshMs < 100) {
    return;
  }
  if (now - lastPaneRefreshMs < 50) {
    return;
  }
  lastPaneRefreshMs = now;
  paneRefreshRequested = false;
  paneRef?.refresh();
}

function cleanup(): void {
  rootAnim.cancel();
  animationHandle.disconnect();
  animationBridge.shutdown();
  grain.dispose();
  exportReadback.destroy();
  exportTexture.destroy();
  placeholder.destroy();
  video?.close();
  p5.dispose();
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

function expandHome(path: string): string {
  if (path === "~") {
    return Deno.env.get("HOME") ?? path;
  }
  if (path.startsWith("~/")) {
    const home = Deno.env.get("HOME");
    return home ? `${home}${path.slice(1)}` : path;
  }
  return path;
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

function resolveExportPath(rawPath: string, preset: ExportPreset): string {
  const trimmed = rawPath.trim();
  if (trimmed) {
    return expandHome(trimmed);
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const extension = preset === "h264" ? "mp4" : "mov";
  return `${Deno.cwd()}/exports/hap_fx_${timestamp}.${extension}`;
}

function buildFfmpegArgs(
  outputPath: string,
  preset: ExportPreset,
  fps: number,
): string[] {
  const baseArgs = [
    "-y",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgba",
    "-s:v",
    `${WIDTH}x${HEIGHT}`,
    "-r",
    String(fps),
    "-i",
    "pipe:0",
    "-an",
  ];

  if (preset === "hapq") {
    return [
      ...baseArgs,
      "-c:v",
      "hap",
      "-format",
      "hap_q",
      "-chunks",
      "4",
      "-compressor",
      "snappy",
      outputPath,
    ];
  }

  if (preset === "prores") {
    return [
      ...baseArgs,
      "-c:v",
      "prores_ks",
      "-profile:v",
      "3",
      "-pix_fmt",
      "yuv422p10le",
      outputPath,
    ];
  }

  return [
    ...baseArgs,
    "-c:v",
    "h264_videotoolbox",
    "-b:v",
    "40M",
    "-pix_fmt",
    "yuv420p",
    outputPath,
  ];
}

function alignTo(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}
