/// <reference lib="dom" />

import {
  PassthruEffect,
  selectShaderFxFormat,
  type ShaderEffect,
  type ShaderSource,
} from "@avtools/shader-fx/raw";
import { AlphaTimeTagEffect } from "@avtools/shader-fx/generated-raw/shaders/alphaTimeTag.frag.raw.generated.ts";
import { FloodFillDisplayEffect } from "@avtools/shader-fx/generated-raw/shaders/floodFillDisplay.frag.raw.generated.ts";
import { FloodFillStepEffect } from "@avtools/shader-fx/generated-raw/shaders/floodFillStep.frag.raw.generated.ts";

const DEFAULT_CLEAR_COLOR: GPUColor = { r: 0, g: 0, b: 0, a: 0 };
const DEFAULT_FORMATS: GPUTextureFormat[] = ["rgba16float", "rgba32float", "rgba8unorm"];
const DEFAULT_RECENCY_PERIOD_SEC = 16;

export interface FloodFillGraphOptions {
  width: number;
  height: number;
  source?: ShaderSource;
  format?: GPUTextureFormat;
  clearColor?: GPUColor;
  preferredFormats?: GPUTextureFormat[];
}

export interface FloodFillGraph {
  readonly width: number;
  readonly height: number;
  readonly format: GPUTextureFormat;
  readonly timeStamper: AlphaTimeTagEffect;
  readonly feedbackStore: PassthruEffect;
  readonly floodFillPing: FloodFillStepEffect;
  readonly floodFillPong: FloodFillStepEffect;
  readonly display: FloodFillDisplayEffect;
  setSource(source: ShaderSource): void;
  render(time: number): FloodFillDisplayEffect;
  dispose(): void;
}

export async function createFloodFillGraph(
  device: GPUDevice,
  options: FloodFillGraphOptions,
): Promise<FloodFillGraph> {
  const clearColor = options.clearColor ?? DEFAULT_CLEAR_COLOR;
  const format = options.format
    ?? await selectShaderFxFormat(device, options.preferredFormats ?? DEFAULT_FORMATS);

  const ownsPlaceholderSource = !options.source;
  const placeholderSource = options.source
    ?? device.createTexture({
      size: { width: 1, height: 1 },
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING,
    });

  const timeStamper = new AlphaTimeTagEffect(
    device,
    { src: placeholderSource },
    options.width,
    options.height,
    format,
    clearColor,
  );
  const feedbackStore = new PassthruEffect(
    device,
    { src: placeholderSource },
    options.width,
    options.height,
    format,
    clearColor,
    "nearest",
  );
  const floodFillPing = new FloodFillStepEffect(
    device,
    { seed: timeStamper, feedback: feedbackStore },
    options.width,
    options.height,
    format,
    clearColor,
    "nearest",
  );
  const floodFillPong = new FloodFillStepEffect(
    device,
    { seed: timeStamper, feedback: floodFillPing },
    options.width,
    options.height,
    format,
    clearColor,
    "nearest",
  );
  const display = new FloodFillDisplayEffect(
    device,
    { src: floodFillPing },
    options.width,
    options.height,
    format,
    clearColor,
  );
  let feedbackPrimed = false;

  return {
    width: options.width,
    height: options.height,
    format,
    timeStamper,
    feedbackStore,
    floodFillPing,
    floodFillPong,
    display,
    setSource(source: ShaderSource): void {
      timeStamper.setSrcs({ src: source });
    },
    render(time: number): FloodFillDisplayEffect {
      const currentPhase = (time / DEFAULT_RECENCY_PERIOD_SEC) % 1;
      timeStamper.setUniforms({
        drawTime: time,
        recencyPeriod: DEFAULT_RECENCY_PERIOD_SEC,
      });
      const stepUniforms = {
        diskRadius: 1,
        useDisk: 0,
        skipDistance: 0,
        currentPhase,
      };
      timeStamper.render();
      floodFillPing.setUniforms(stepUniforms);
      floodFillPong.setUniforms(stepUniforms);

      const initialFeedback: ShaderSource = feedbackPrimed
        ? feedbackStore
        : timeStamper;

      let terminal: ShaderEffect = floodFillPing;
      for (let i = 0; i < 1; i += 1) {
        const step = i % 2 === 0 ? floodFillPing : floodFillPong;
        const feedbackSrc = i === 0
          ? initialFeedback
          : (i % 2 === 0 ? floodFillPong : floodFillPing);
        step.setSrcs({
          seed: timeStamper,
          feedback: feedbackSrc,
        });
        step.render();
        terminal = step;
      }

      feedbackStore.setSrcs({ src: terminal });
      feedbackStore.render();
      feedbackPrimed = true;
      display.setSrcs({ src: terminal });
      display.render();
      return display;
    },
    dispose(): void {
      display.dispose();
      floodFillPong.dispose();
      floodFillPing.dispose();
      feedbackStore.dispose();
      timeStamper.dispose();
      if (ownsPlaceholderSource && "destroy" in placeholderSource) {
        placeholderSource.destroy();
      }
    },
  };
}
