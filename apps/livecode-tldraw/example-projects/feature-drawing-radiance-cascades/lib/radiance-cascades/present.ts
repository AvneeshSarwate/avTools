/**
 * Draws any renderer texture into a target: tone-mapped HDR, plain color, or
 * a signed-distance ramp. `DisplayPass` renders into any view (the headless
 * check uses an offscreen texture); `CanvasPresenter` wraps it for a WebGPU
 * canvas. Browser-specific only through the canvas.
 */

import { createFullscreenPipeline } from "./effects.ts";
import { DISPLAY_WGSL } from "./wgsl.generated.ts";

export type DisplayMode = "hdr" | "color" | "distance";
export type ToneMap = "aces" | "soft";

export interface DisplayOptions {
  mode: DisplayMode;
  exposure?: number;
  toneMap?: ToneMap;
}

const DISPLAY_MODES: Record<DisplayMode, number> = {
  hdr: 0,
  color: 1,
  distance: 2,
};
const TONE_MAPS: Record<ToneMap, number> = { aces: 0, soft: 1 };

export class DisplayPass {
  private readonly pipeline: GPURenderPipeline;
  private readonly uniformBuffer: GPUBuffer;

  constructor(
    private readonly device: GPUDevice,
    readonly format: GPUTextureFormat,
  ) {
    this.pipeline = createFullscreenPipeline(
      device,
      "rc-display",
      DISPLAY_WGSL,
      [format],
    );
    this.uniformBuffer = device.createBuffer({
      label: "rc-display-uniforms",
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  draw(
    source: GPUTextureView,
    target: GPUTextureView,
    targetSize: readonly [number, number],
    options: DisplayOptions,
  ): void {
    this.device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      new Float32Array([
        targetSize[0],
        targetSize[1],
        options.exposure ?? 1,
        DISPLAY_MODES[options.mode],
        TONE_MAPS[options.toneMap ?? "aces"],
        0,
        0,
        0,
      ]),
    );
    const bindGroup = this.device.createBindGroup({
      label: "rc-display-bind",
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: source },
      ],
    });
    const encoder = this.device.createCommandEncoder({ label: "rc-display" });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: target,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      }],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  dispose(): void {
    this.uniformBuffer.destroy();
  }
}

export class CanvasPresenter {
  readonly format: GPUTextureFormat;
  private readonly context: GPUCanvasContext;
  private readonly pass: DisplayPass;

  constructor(device: GPUDevice, readonly canvas: HTMLCanvasElement) {
    // TypeScript's dom lib does not know the "webgpu" context id.
    const context = canvas.getContext("webgpu") as GPUCanvasContext | null;
    if (!context) throw new Error("canvas has no WebGPU context");
    this.context = context;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format: this.format, alphaMode: "opaque" });
    this.pass = new DisplayPass(device, this.format);
  }

  present(source: GPUTextureView, options: DisplayOptions): void {
    const target = this.context.getCurrentTexture();
    this.pass.draw(
      source,
      target.createView(),
      [target.width, target.height],
      options,
    );
  }

  dispose(): void {
    this.pass.dispose();
    this.context.unconfigure();
  }
}
