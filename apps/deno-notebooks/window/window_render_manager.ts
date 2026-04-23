/// <reference lib="dom" />

import { ShaderEffect, type ShaderSource } from "@avtools/shader-fx/raw";
import { createBlitPipeline, blit } from "./blit.ts";
import type { WindowEvent } from "./events.ts";
import { createWindowTweakpane, type WindowTweakpane } from "./tweakpane_panel.ts";
import { createGpuWindow, type GpuWindow } from "./window.ts";
import { createSyphonGpuWindow, type SyphonOptions, type SyphonServer } from "../syphon/syphon.ts";

export type WindowRenderSource = ShaderSource;

export type WindowRenderManagerWindow =
  | GpuWindow
  | (GpuWindow & { syphon: SyphonServer });

export interface WindowRenderManagerPaneOptions {
  title?: string;
  panelWidth?: number;
  panelHeight?: number;
  toggleKey?: string;
  setup?: (pane: WindowTweakpane) => void;
}

export interface WindowRenderManagerContext {
  device: GPUDevice;
  window: WindowRenderManagerWindow;
  pane: WindowTweakpane | null;
}

export interface WindowRenderManagerRunOptions {
  onEvent?: (event: WindowEvent, context: WindowRenderManagerContext) => void;
  /**
   * Milliseconds to `setTimeout`-yield between frames so WS/UDP callbacks
   * (notably tweakpane slider drags) aren't starved by the render loop.
   * Default 1 — the minimum that keeps event-loop callbacks flowing
   * smoothly. Raise (e.g. 4) for scenes that also pump UDP or heavy WS
   * traffic; `combined.ts` uses 4.
   */
  yieldMs?: number;
  cleanup?: () => void;
}

export interface WindowRenderManagerOptions {
  device: GPUDevice;
  width: number;
  height: number;
  title?: string;
  syphon?: SyphonOptions;
  pane?: WindowRenderManagerPaneOptions;
}

export interface WindowRenderManager extends WindowRenderManagerContext {
  run(frame: () => WindowRenderSource, options?: WindowRenderManagerRunOptions): Promise<void>;
  present(source: WindowRenderSource): void;
  stop(): void;
  dispose(): void;
}

export async function requestWebGpuDevice(): Promise<GPUDevice> {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error("No WebGPU adapter");
  }
  return await adapter.requestDevice();
}

export async function createWindowRenderManager(
  options: WindowRenderManagerOptions,
): Promise<WindowRenderManager> {
  const window = await createRenderWindow(options.device, options);
  const blitPipeline = createBlitPipeline(options.device, window.format);
  const pane = options.pane
    ? createWindowTweakpane(window, {
      title: options.pane.title,
      panelWidth: options.pane.panelWidth,
      panelHeight: options.pane.panelHeight,
      toggleKey: options.pane.toggleKey,
    })
    : null;

  pane && options.pane?.setup?.(pane);

  let disposed = false;
  let stopRequested = false;
  const context: WindowRenderManagerContext = {
    device: options.device,
    window,
    pane,
  };

  const present = (source: WindowRenderSource): void => {
    if (disposed || window.closed) {
      return;
    }
    try {
      const swapTexture = window.ctx.getCurrentTexture();
      const encoder = options.device.createCommandEncoder();
      blit(options.device, encoder, blitPipeline, resolveFrameSourceView(source), swapTexture.createView());
      options.device.queue.submit([encoder.finish()]);
      if (hasSyphon(window)) {
        window.syphon.publishFrame();
      }
      window.present();
    } catch (error) {
      console.error("window_render_manager: present failed", error);
      throw error;
    }
  };

  const stop = (): void => {
    stopRequested = true;
  };

  const dispose = (): void => {
    if (disposed) {
      return;
    }
    disposed = true;
    window.close();
  };

  const run = async (
    frame: () => WindowRenderSource,
    runOptions: WindowRenderManagerRunOptions = {},
  ): Promise<void> => {
    const yieldMs = runOptions.yieldMs ?? 1;
    stopRequested = false;

    try {
      while (!stopRequested && !window.closed) {
        const events = window.pollEvents();
        for (const event of events) {
          runOptions.onEvent?.(event, context);
          if (event.type === "close") {
            stopRequested = true;
          }
        }
        if (stopRequested || window.closed) {
          break;
        }

        const source = frame();
        present(source);

        await new Promise((resolve) => setTimeout(resolve, yieldMs));
      }
    } finally {
      try {
        runOptions.cleanup?.();
      } finally {
        dispose();
      }
    }
  };

  return {
    ...context,
    run,
    present,
    stop,
    dispose,
  };
}

async function createRenderWindow(
  device: GPUDevice,
  options: Pick<WindowRenderManagerOptions, "width" | "height" | "title" | "syphon">,
): Promise<WindowRenderManagerWindow> {
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

function resolveFrameSourceView(source: WindowRenderSource): GPUTextureView {
  if (source instanceof ShaderEffect) {
    return source.output;
  }
  if ("createView" in source) {
    return source.createView();
  }
  return source;
}

function hasSyphon(window: WindowRenderManagerWindow): window is GpuWindow & { syphon: SyphonServer } {
  return "syphon" in window;
}
