/// <reference lib="dom" />

import {
  NativeHapDecoder,
  type NativeHapDecoderInfo,
  type NativeHapDecoderStats,
} from "./native_decoder.ts";
import { HapGpuRenderer } from "./gpu_renderer.ts";

export interface HapVideoSourceOptions {
  libPath?: string;
  workerCount?: number;
  outputWidth: number;
  outputHeight: number;
  outputFormat?: GPUTextureFormat;
  play?: boolean;
  loop?: boolean;
}

export interface HapVideoSourceFrameStats extends NativeHapDecoderStats {
  uploadMs: number;
}

export class HapVideoSource {
  readonly decoder: NativeHapDecoder;
  readonly renderer: HapGpuRenderer;
  readonly frameBytes: Uint8Array<ArrayBuffer>;
  readonly outputFormat: GPUTextureFormat;
  playing: boolean;
  loop: boolean;

  #currentFrame = 0;
  #lastStats: HapVideoSourceFrameStats | null = null;
  #playbackClockMs = performance.now();
  #closed = false;

  private constructor(
    decoder: NativeHapDecoder,
    renderer: HapGpuRenderer,
    options: Required<Pick<HapVideoSourceOptions, "play" | "loop">> & {
      outputFormat: GPUTextureFormat;
    },
  ) {
    this.decoder = decoder;
    this.renderer = renderer;
    this.outputFormat = options.outputFormat;
    this.playing = options.play;
    this.loop = options.loop;
    this.frameBytes = new Uint8Array(decoder.info.decodedByteLength);
    this.seekFrame(0);
  }

  static open(
    device: GPUDevice,
    path: string,
    options: HapVideoSourceOptions,
  ): HapVideoSource {
    const outputFormat = options.outputFormat ?? "rgba8unorm";
    const decoder = NativeHapDecoder.open(path, {
      libPath: options.libPath,
      workerCount: options.workerCount,
    });
    try {
      const renderer = new HapGpuRenderer({
        device,
        videoWidth: decoder.info.width,
        videoHeight: decoder.info.height,
        outputWidth: options.outputWidth,
        outputHeight: options.outputHeight,
        outputFormat,
      });
      return new HapVideoSource(decoder, renderer, {
        outputFormat,
        play: options.play ?? false,
        loop: options.loop ?? true,
      });
    } catch (error) {
      decoder.close();
      throw error;
    }
  }

  get info(): NativeHapDecoderInfo {
    return this.decoder.info;
  }

  get currentFrame(): number {
    return this.#currentFrame;
  }

  get currentTimeSeconds(): number {
    return this.#currentFrame / this.info.frameRate;
  }

  get lastStats(): HapVideoSourceFrameStats | null {
    return this.#lastStats;
  }

  get texture(): GPUTexture {
    return this.renderer.outputTexture;
  }

  seekFrame(frameIndex: number): HapVideoSourceFrameStats {
    this.#assertOpen();
    const frame = this.#normalizeFrame(frameIndex);
    const decodeStats = this.decoder.decodeFrame(frame, this.frameBytes);
    const uploadStart = performance.now();
    this.renderer.uploadFrame(this.frameBytes);
    const stats = {
      ...decodeStats,
      uploadMs: performance.now() - uploadStart,
    };
    this.#currentFrame = frame;
    this.#lastStats = stats;
    this.#playbackClockMs = performance.now();
    return stats;
  }

  seekPercent(percent: number): HapVideoSourceFrameStats {
    const clamped = Math.max(0, Math.min(1, percent));
    return this.seekFrame(Math.round(clamped * Math.max(0, this.info.frameCount - 1)));
  }

  stepFrame(delta: number): HapVideoSourceFrameStats {
    return this.seekFrame(this.#currentFrame + delta);
  }

  randomFrame(): HapVideoSourceFrameStats {
    return this.seekFrame(Math.floor(Math.random() * this.info.frameCount));
  }

  update(now = performance.now()): GPUTexture {
    this.#assertOpen();
    if (this.playing) {
      const frameDurationMs = 1000 / this.info.frameRate;
      const elapsed = now - this.#playbackClockMs;
      if (elapsed >= frameDurationMs) {
        const advance = Math.max(1, Math.floor(elapsed / frameDurationMs));
        const nextClockMs = this.#playbackClockMs + advance * frameDurationMs;
        this.#decodePlaybackFrame(this.#currentFrame + advance);
        this.#playbackClockMs = nextClockMs;
      }
    } else {
      this.#playbackClockMs = now;
    }
    return this.renderer.render();
  }

  render(): GPUTexture {
    this.#assertOpen();
    return this.renderer.render();
  }

  close(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    try {
      this.renderer.destroy();
    } finally {
      this.decoder.close();
    }
  }

  #decodePlaybackFrame(frameIndex: number): void {
    if (!this.loop && frameIndex >= this.info.frameCount) {
      this.playing = false;
      this.seekFrame(this.info.frameCount - 1);
      return;
    }
    this.seekFrame(frameIndex);
  }

  #normalizeFrame(frameIndex: number): number {
    const frameCount = Math.max(1, this.info.frameCount);
    let frame = Math.round(frameIndex);
    if (this.loop) {
      return ((frame % frameCount) + frameCount) % frameCount;
    }
    frame = Math.max(0, Math.min(frameCount - 1, frame));
    return frame;
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new Error("HapVideoSource is closed");
    }
  }
}
