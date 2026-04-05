/// <reference lib="dom" />

// P5GPU sketch with a tweakpane control panel in a separate window.
//
// Run from apps/deno-notebooks:
//   deno run --unstable-webgpu --unstable-ffi --allow-all plorkSketch/sketch.ts

import {
  createWindowRenderManager,
  requestWebGpuDevice,
  type WindowTweakpane,
} from "../window/mod.ts";
import { FeedbackNode, PassthruEffect, selectShaderFxFormat } from "@avtools/shader-fx/raw";
import { AlphaTimeTagEffect } from "@avtools/shader-fx/generated-raw/shaders/alphaTimeTag.frag.raw.generated.ts";
import { FloodFillDisplayEffect } from "@avtools/shader-fx/generated-raw/shaders/floodFillDisplay.frag.raw.generated.ts";
import { FloodFillStepEffect } from "@avtools/shader-fx/generated-raw/shaders/floodFillStep.frag.raw.generated.ts";
import { P5GPU } from "../tools/p5gpu.ts";
import { launch, type DateTimeContext } from "@avtools/core-timing";

const WIDTH = 1280;
const HEIGHT = 720;
const CLEAR_COLOR: GPUColor = { r: 0, g: 0, b: 0, a: 0 };

const params = {
  duration: 2.0,
  hue: 180,
  radius: 20,
};

interface CircleState {
  x: number;
  hue: number;
  radius: number;
  handle: { cancel: () => void; handleCancel: (f: () => void) => () => void };
}

const activeCircles: Set<CircleState> = new Set();

let rootCtx: DateTimeContext | undefined = undefined;

/**
 * let rootCtx = undefined
 * launch(async (ctx) => {
 *   rootCtx = ctx
 *   while(true){await ctx.waitSec(1)}
 * })
 */
const rootAnim = launch(async (ctx) => {
  rootCtx = ctx;
  while (true) await ctx.waitSec(1 / 60);
});
rootAnim.catch((err: unknown) => {
  if ((err as Error)?.message !== "aborted") console.error("Root context error:", err);
});

function launchCircle() {
  if (!rootCtx) return;
  const hue = params.hue;
  const duration = params.duration;
  const radius = params.radius;
  const state: CircleState = { x: -radius, hue, radius, handle: null! };

  const handle = rootCtx.branch(async (ctx) => {
    while (!ctx.isCanceled && ctx.progTime < duration) {
      state.x = -radius + (ctx.progTime / duration) * (WIDTH + 2 * radius);
      await ctx.waitSec(1 / 60);
    }
    activeCircles.delete(state);
  });

  handle.handleCancel(() => activeCircles.delete(state));
  state.handle = handle;
  activeCircles.add(state);
}

const device = await requestWebGpuDevice();
const renderWindow = await createWindowRenderManager({
  device,
  width: WIDTH,
  height: HEIGHT,
  title: "P5GPU + Tweakpane",
  syphon: {
    serverName: "P5GPU_Panel_Demo",
    flipY: true,
  },
  pane: {
    title: "Circle Demo",
    panelWidth: 420,
    panelHeight: 300,
    setup: setupPane,
  },
});
const p5 = new P5GPU(device, { width: WIDTH, height: HEIGHT });
const floodFill = await createFloodFillChain(device, WIDTH, HEIGHT);

await renderWindow.run(renderFrame, { cleanup: cleanup });

function renderFrame() {
  const time = performance.now() * 0.001;

  p5.beginFrame();
  drawCircle();
  const sourceTexture = p5.endFrame();

  floodFill.timeStamper.setSrcs({ src: sourceTexture });
  floodFill.timeStamper.setUniforms({ drawTime: time });
  floodFill.display.renderAll();

  return floodFill.display;
}

function cleanup(): void {
  rootAnim.cancel();
  floodFill.display.disposeAll();
  floodFill.placeholder.destroy();
  p5.dispose();
}

function setupPane(pane: WindowTweakpane): void {
  pane.addBinding(params, "duration", { min: 0.1, max: 10, step: 0.1 });
  pane.addBinding(params, "radius", { min: 1, max: 200, step: 1 });
  pane.addBinding(params, "hue", { min: 0, max: 360, step: 1 });

  pane.addButton({ title: "Launch" }).on("click", launchCircle);
}

function drawCircle(): void {
  p5.clear();
  p5.noStroke();
  for (const state of activeCircles) {
    const c = hslToRgb(state.hue / 360, 0.8, 0.6);
    p5.fill(c[0], c[1], c[2]);
    p5.circle(state.x, HEIGHT / 2, state.radius * 2);
  }
}

async function createFloodFillChain(device: GPUDevice, width: number, height: number) {
  const format = await selectShaderFxFormat(device, ["rgba16float", "rgba8unorm"]);
  const placeholder = device.createTexture({
    size: { width: 1, height: 1 },
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING,
  });

  const timeStamper = new AlphaTimeTagEffect(
    device,
    { src: placeholder },
    width, height, format, CLEAR_COLOR,
  );
  const floodFillSeed = new FloodFillStepEffect(
    device,
    { seed: timeStamper, feedback: timeStamper },
    width, height, format, CLEAR_COLOR,
  );
  const feedbackSeed = new PassthruEffect(
    device,
    { src: floodFillSeed },
    width, height, format, CLEAR_COLOR, "linear",
  );
  const feedback = new FeedbackNode(
    device,
    feedbackSeed,
    width, height, format, CLEAR_COLOR, "linear",
  );
  const floodFill = new FloodFillStepEffect(
    device,
    { seed: timeStamper, feedback },
    width, height, format, CLEAR_COLOR,
  );
  const display = new FloodFillDisplayEffect(
    device,
    { src: floodFill },
    width, height, format, CLEAR_COLOR,
  );

  feedback.setFeedbackSrc(floodFill);

  return {
    placeholder,
    timeStamper,
    display,
  };
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [Math.round(l * 255), Math.round(l * 255), Math.round(l * 255)];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = hue2rgb(p, q, h + 1 / 3);
  const g = hue2rgb(p, q, h);
  const b = hue2rgb(p, q, h - 1 / 3);
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
