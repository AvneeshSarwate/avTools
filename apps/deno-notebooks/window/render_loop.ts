/// <reference lib="dom" />

import type { BlitPipeline } from "./blit.ts";
import { blit } from "./blit.ts";
import type { WindowEvent } from "./events.ts";
import type { GpuWindow } from "./window.ts";

export interface RenderLoopOptions {
  window: GpuWindow;
  blitPipeline: BlitPipeline;
  onFrame: (frameNumber: number) => GPUTextureView;
  onEvent?: (event: WindowEvent) => void;
}

export function startRenderLoop(options: RenderLoopOptions): { stop(): void } {
  let running = true;
  let frame = 0;

  const loop = async () => {
    while (running) {
      const events = options.window.pollEvents();
      for (const event of events) {
        options.onEvent?.(event);
        if (event.type === "close") {
          running = false;
        }
      }
      if (!running || options.window.closed) {
        break;
      }

      const outputView = options.onFrame(frame);
      frame += 1;

      let swapTexture: GPUTexture;
      try {
        swapTexture = options.window.ctx.getCurrentTexture();
      } catch (err) {
        console.error("render_loop: getCurrentTexture failed", err);
        break;
      }
      const swapView = swapTexture.createView();

      const encoder = options.window.device.createCommandEncoder();
      blit(options.window.device, encoder, options.blitPipeline, outputView, swapView);
      options.window.device.queue.submit([encoder.finish()]);
      options.window.present();

      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    options.window.close();
  };

  void loop();

  return {
    stop() {
      running = false;
      options.window.close();
    },
  };
}
