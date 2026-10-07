/// <reference lib="dom" />

import type { BlitPipeline } from "./blit.ts";
import { blit } from "./blit.ts";
import type { WindowEvent } from "./events.ts";
import { createSwapSkipLog, type GpuWindow, tryGetSwapTexture } from "./window.ts";

export interface FramePublisher {
  publishFrame(): bigint | number;
}

export interface RenderLoopOptions {
  window: GpuWindow;
  blitPipeline: BlitPipeline;
  onFrame: (frameNumber: number) => GPUTextureView;
  onEvent?: (event: WindowEvent) => void;
  syphon?: FramePublisher;
}

export function startRenderLoop(options: RenderLoopOptions): { stop(): void } {
  let running = true;
  let frame = 0;
  const skips = createSwapSkipLog("render_loop");

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

      // Null while the window is occluded on Deno 2.8.3+ (wgpu 29): skip
      // the on-screen blit but keep running and publishing.
      const swapTexture = tryGetSwapTexture(options.window.ctx, skips);
      if (swapTexture) {
        const encoder = options.window.device.createCommandEncoder();
        blit(
          options.window.device,
          encoder,
          options.blitPipeline,
          outputView,
          swapTexture.createView(),
        );
        options.window.device.queue.submit([encoder.finish()]);
      }
      options.syphon?.publishFrame();
      if (swapTexture) {
        options.window.present();
      }

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
