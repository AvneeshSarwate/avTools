/// <reference lib="dom" />

import { createBlitPipeline, blit } from "./blit.ts";
import type { WindowEvent } from "./events.ts";
import { createWindowTweakpane, type WindowTweakpane } from "./tweakpane_panel.ts";
import { createGpuWindow, type GpuWindow } from "./window.ts";
import { P5GPU } from "../tools/p5gpu.ts";
import { createSyphonGpuWindow, type SyphonOptions, type SyphonServer } from "../syphon/syphon.ts";

export type P5GpuSketchWindow =
  | GpuWindow
  | (GpuWindow & { syphon: SyphonServer });

export interface P5GpuSketchPaneOptions {
  title?: string;
  panelWidth?: number;
  panelHeight?: number;
  toggleKey?: string;
  setup?: (pane: WindowTweakpane) => void;
}

export interface P5GpuSketchContext {
  device: GPUDevice;
  window: P5GpuSketchWindow;
  p5: P5GPU;
  pane: WindowTweakpane | null;
}

export interface P5GpuSketchDrawContext extends P5GpuSketchContext {
  frame: number;
  time: number;
}

export interface P5GpuSketchOptions {
  width: number;
  height: number;
  title?: string;
  syphon?: SyphonOptions;
  pane?: P5GpuSketchPaneOptions;
  draw: (context: P5GpuSketchDrawContext) => void;
  onEvent?: (event: WindowEvent, context: P5GpuSketchContext) => void;
  yieldMs?: number;
}

export async function runP5GpuSketch(options: P5GpuSketchOptions): Promise<void> {
  const device = await requestWebGpuDevice();
  const window = await createSketchWindow(device, options);
  const p5 = new P5GPU(device, { width: options.width, height: options.height });
  const blitPipeline = createBlitPipeline(device, window.format);
  const pane = options.pane
    ? createWindowTweakpane(window, {
      title: options.pane.title,
      panelWidth: options.pane.panelWidth,
      panelHeight: options.pane.panelHeight,
      toggleKey: options.pane.toggleKey,
    })
    : null;

  pane && options.pane?.setup?.(pane);

  const context: P5GpuSketchContext = { device, window, p5, pane };
  const yieldMs = options.yieldMs ?? 0;
  let running = true;
  let frame = 0;

  try {
    while (running && !window.closed) {
      const events = window.pollEvents();
      for (const event of events) {
        options.onEvent?.(event, context);
        if (event.type === "close") {
          running = false;
        }
      }
      if (!running || window.closed) {
        break;
      }

      p5.beginFrame();
      options.draw({
        ...context,
        frame,
        time: performance.now() * 0.001,
      });
      frame += 1;

      const texture = p5.endFrame();
      presentP5Frame(device, window, blitPipeline, texture);

      await new Promise((resolve) => setTimeout(resolve, yieldMs));
    }
  } finally {
    p5.dispose();
    window.close();
  }
}

async function requestWebGpuDevice(): Promise<GPUDevice> {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error("No WebGPU adapter");
  }
  return await adapter.requestDevice();
}

async function createSketchWindow(
  device: GPUDevice,
  options: P5GpuSketchOptions,
): Promise<P5GpuSketchWindow> {
  if (options.syphon) {
    return await createSyphonGpuWindow(device, {
      width: options.width,
      height: options.height,
      title: options.title,
      syphon: options.syphon,
    });
  }

  return await createGpuWindow(device, {
    width: options.width,
    height: options.height,
    title: options.title,
  });
}

function presentP5Frame(
  device: GPUDevice,
  window: P5GpuSketchWindow,
  blitPipeline: ReturnType<typeof createBlitPipeline>,
  texture: GPUTexture,
): void {
  try {
    const swapTexture = window.ctx.getCurrentTexture();
    const encoder = device.createCommandEncoder();
    blit(device, encoder, blitPipeline, texture.createView(), swapTexture.createView());
    device.queue.submit([encoder.finish()]);
    if (hasSyphon(window)) {
      window.syphon.publishFrame();
    }
    window.present();
  } catch (error) {
    console.error("p5gpu_sketch: present failed", error);
    throw error;
  }
}

function hasSyphon(window: P5GpuSketchWindow): window is GpuWindow & { syphon: SyphonServer } {
  return "syphon" in window;
}
