/// <reference lib="dom" />

import { ShaderEffect, type ShaderSource } from "@avtools/shader-fx/raw";
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

export interface P5GpuSketchRuntimeContext<TState = void> extends P5GpuSketchContext {
  state: TState;
}

export interface P5GpuSketchDrawContext<TState = void> extends P5GpuSketchRuntimeContext<TState> {
  frame: number;
  time: number;
}

export type P5GpuSketchFrameSource = ShaderSource;

export interface P5GpuSketchRenderContext<TState = void> extends P5GpuSketchDrawContext<TState> {
  sourceTexture: GPUTexture;
  sourceView: GPUTextureView;
}

export interface P5GpuSketchOptions<TState = void> {
  width: number;
  height: number;
  title?: string;
  syphon?: SyphonOptions;
  pane?: P5GpuSketchPaneOptions;
  setup?: (context: P5GpuSketchContext) => Promise<TState> | TState;
  draw: (context: P5GpuSketchDrawContext<TState>) => void;
  render?: (context: P5GpuSketchRenderContext<TState>) => P5GpuSketchFrameSource;
  cleanup?: (context: P5GpuSketchRuntimeContext<TState>) => void;
  onEvent?: (event: WindowEvent, context: P5GpuSketchRuntimeContext<TState>) => void;
  yieldMs?: number;
}

export async function runP5GpuSketch<TState = void>(
  options: P5GpuSketchOptions<TState>,
): Promise<void> {
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
  const state = options.setup
    ? await options.setup(context)
    : undefined as TState;
  const runtimeContext: P5GpuSketchRuntimeContext<TState> = { ...context, state };
  const yieldMs = options.yieldMs ?? 0;
  let running = true;
  let frame = 0;

  try {
    while (running && !window.closed) {
      const events = window.pollEvents();
      for (const event of events) {
        options.onEvent?.(event, runtimeContext);
        if (event.type === "close") {
          running = false;
        }
      }
      if (!running || window.closed) {
        break;
      }

      const time = performance.now() * 0.001;
      p5.beginFrame();
      options.draw({
        ...runtimeContext,
        frame,
        time,
      });
      const sourceTexture = p5.endFrame();
      const finalSource = options.render
        ? options.render({
          ...runtimeContext,
          frame,
          time,
          sourceTexture,
          sourceView: sourceTexture.createView(),
        })
        : sourceTexture;
      frame += 1;

      presentP5Frame(device, window, blitPipeline, resolveFrameSourceView(finalSource));

      await new Promise((resolve) => setTimeout(resolve, yieldMs));
    }
  } finally {
    if (options.cleanup) {
      options.cleanup(runtimeContext);
    } else if (hasDispose(state)) {
      state.dispose();
    }
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
  options: { width: number; height: number; title?: string; syphon?: SyphonOptions },
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

function resolveFrameSourceView(source: P5GpuSketchFrameSource): GPUTextureView {
  if (source instanceof ShaderEffect) {
    return source.output;
  }
  if ("createView" in source) {
    return source.createView();
  }
  return source;
}

function presentP5Frame(
  device: GPUDevice,
  window: P5GpuSketchWindow,
  blitPipeline: ReturnType<typeof createBlitPipeline>,
  sourceView: GPUTextureView,
): void {
  try {
    const swapTexture = window.ctx.getCurrentTexture();
    const encoder = device.createCommandEncoder();
    blit(device, encoder, blitPipeline, sourceView, swapTexture.createView());
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

function hasDispose(value: unknown): value is { dispose: () => void } {
  return typeof value === "object" && value !== null && "dispose" in value && typeof value.dispose === "function";
}
