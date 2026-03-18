/// <reference lib="dom" />

import {
  FeedbackNode,
  PassthruEffect,
  selectShaderFxFormat,
  type ShaderSource,
} from "@avtools/shader-fx/raw";
import { AlphaTimeTagEffect } from "@avtools/shader-fx/generated-raw/shaders/alphaTimeTag.frag.raw.generated.ts";
import { FloodFillDisplayEffect } from "@avtools/shader-fx/generated-raw/shaders/floodFillDisplay.frag.raw.generated.ts";
import { FloodFillStepEffect } from "@avtools/shader-fx/generated-raw/shaders/floodFillStep.frag.raw.generated.ts";

const DEFAULT_CLEAR_COLOR: GPUColor = { r: 0, g: 0, b: 0, a: 0 };
const DEFAULT_FORMATS: GPUTextureFormat[] = ["rgba16float", "rgba32float", "rgba8unorm"];

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
  readonly floodFillSeed: FloodFillStepEffect;
  readonly feedbackSeed: PassthruEffect;
  readonly feedback: FeedbackNode;
  readonly floodFill: FloodFillStepEffect;
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
  const floodFillSeed = new FloodFillStepEffect(
    device,
    { seed: timeStamper, feedback: timeStamper },
    options.width,
    options.height,
    format,
    clearColor,
  );
  const feedbackSeed = new PassthruEffect(
    device,
    { src: floodFillSeed },
    options.width,
    options.height,
    format,
    clearColor,
    "linear",
  );
  const feedback = new FeedbackNode(
    device,
    feedbackSeed,
    options.width,
    options.height,
    format,
    clearColor,
    "linear",
  );
  const floodFill = new FloodFillStepEffect(
    device,
    { seed: timeStamper, feedback },
    options.width,
    options.height,
    format,
    clearColor,
  );
  const display = new FloodFillDisplayEffect(
    device,
    { src: floodFill },
    options.width,
    options.height,
    format,
    clearColor,
  );
  feedback.setFeedbackSrc(floodFill);

  return {
    width: options.width,
    height: options.height,
    format,
    timeStamper,
    floodFillSeed,
    feedbackSeed,
    feedback,
    floodFill,
    display,
    setSource(source: ShaderSource): void {
      timeStamper.setSrcs({ src: source });
    },
    render(time: number): FloodFillDisplayEffect {
      timeStamper.setUniforms({ drawTime: time });
      display.renderAll();
      return display;
    },
    dispose(): void {
      display.disposeAll();
      if (ownsPlaceholderSource && "destroy" in placeholderSource) {
        placeholderSource.destroy();
      }
    },
  };
}
