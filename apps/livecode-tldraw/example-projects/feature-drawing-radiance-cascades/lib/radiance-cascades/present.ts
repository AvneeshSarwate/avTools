/**
 * Draws any renderer texture into a WebGPU canvas: tone-mapped HDR, plain
 * color, or a signed-distance ramp. Browser-specific.
 */

import { createFullscreenPipeline } from "./effects.ts";
import { DISPLAY_WGSL } from "./wgsl.generated.ts";

export type DisplayMode = "hdr" | "color" | "distance";

const DISPLAY_MODES: Record<DisplayMode, number> = {
  hdr: 0,
  color: 1,
  distance: 2,
};

export class CanvasPresenter {
  readonly format: GPUTextureFormat;
  private readonly context: GPUCanvasContext;
  private readonly pipeline: GPURenderPipeline;
  private readonly uniformBuffer: GPUBuffer;

  constructor(
    private readonly device: GPUDevice,
    readonly canvas: HTMLCanvasElement,
  ) {
    // TypeScript's dom lib does not know the "webgpu" context id.
    const context = canvas.getContext("webgpu") as GPUCanvasContext | null;
    if (!context) throw new Error("canvas has no WebGPU context");
    this.context = context;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format: this.format, alphaMode: "opaque" });
    this.pipeline = createFullscreenPipeline(
      device,
      "rc-display",
      DISPLAY_WGSL,
      [this.format],
    );
    this.uniformBuffer = device.createBuffer({
      label: "rc-display-uniforms",
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  present(source: GPUTextureView, mode: DisplayMode, exposure = 1): void {
    const target = this.context.getCurrentTexture();
    this.device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      new Float32Array([
        target.width,
        target.height,
        exposure,
        DISPLAY_MODES[mode],
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
        view: target.createView(),
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
    this.context.unconfigure();
  }
}
