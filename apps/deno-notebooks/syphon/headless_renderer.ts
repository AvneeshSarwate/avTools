/// <reference lib="dom" />

import { type DateTimeContext, launch } from "@avtools/core-timing";
import {
  type HeadlessSyphonOptions,
  HeadlessSyphonServer,
} from "./headless_syphon.ts";
import { createStagingBufferPair } from "./staging_buffers.ts";

export interface HeadlessSyphonRendererOptions {
  width: number;
  height: number;
  fps?: number;
  syphon?: HeadlessSyphonOptions;
}

export interface HeadlessSyphonRenderer {
  device: GPUDevice;
  width: number;
  height: number;
  renderTexture: GPUTexture;
  syphon: HeadlessSyphonServer;
  start(
    onFrame: (
      frameNumber: number,
      renderTexture: GPUTexture,
    ) => GPUCommandEncoder,
  ): { stop(): void };
  destroy(): void;
}

export function createHeadlessSyphonRenderer(
  device: GPUDevice,
  options: HeadlessSyphonRendererOptions,
): HeadlessSyphonRenderer {
  const width = Math.max(1, Math.floor(options.width));
  const height = Math.max(1, Math.floor(options.height));
  const fps = Math.max(1, options.fps ?? 60);

  const renderTexture = device.createTexture({
    size: { width, height },
    format: "bgra8unorm",
    usage: GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.COPY_SRC |
      GPUTextureUsage.TEXTURE_BINDING,
  });
  const syphon = new HeadlessSyphonServer(options.syphon);
  const staging = createStagingBufferPair();

  let destroyed = false;

  function start(
    onFrame: (
      frameNumber: number,
      renderTexture: GPUTexture,
    ) => GPUCommandEncoder,
  ): { stop(): void } {
    if (destroyed) {
      throw new Error("HeadlessSyphonRenderer has already been destroyed.");
    }

    let running = true;
    void launch(async (ctx: DateTimeContext) => {
      let frame = 0;
      while (running && !destroyed) {
        const readInfo = staging.getReadBuffer();
        if (readInfo) {
          const { buffer, bytesPerRow, width: rw, height: rh } = readInfo;
          let mapped = false;
          try {
            await device.queue.onSubmittedWorkDone();
            await buffer.mapAsync(GPUMapMode.READ);
            mapped = true;
            const bytes = new Uint8Array(buffer.getMappedRange());
            syphon.publishFrame(bytes, rw, rh, bytesPerRow);
          } catch (error) {
            console.error("Headless Syphon readback failed:", error);
          } finally {
            if (mapped) {
              buffer.unmap();
            }
          }
        }

        let encoder: GPUCommandEncoder;
        try {
          encoder = onFrame(frame, renderTexture);
        } catch (error) {
          console.error("Headless Syphon frame callback failed:", error);
          break;
        }

        const writeInfo = staging.getWriteBuffer(device, width, height);
        encoder.copyTextureToBuffer(
          { texture: renderTexture },
          {
            buffer: writeInfo.buffer,
            bytesPerRow: writeInfo.bytesPerRow,
            rowsPerImage: height,
          },
          { width, height, depthOrArrayLayers: 1 },
        );
        device.queue.submit([encoder.finish()]);
        staging.advance();

        frame += 1;
        await ctx.waitSec(1 / fps);
      }
    }, { bpm: 60 });

    return {
      stop() {
        running = false;
      },
    };
  }

  function destroy() {
    if (destroyed) {
      return;
    }
    destroyed = true;
    staging.destroy();
    renderTexture.destroy();
    syphon.destroy();
  }

  return {
    device,
    width,
    height,
    renderTexture,
    syphon,
    start,
    destroy,
  };
}
