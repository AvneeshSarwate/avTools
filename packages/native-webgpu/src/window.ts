import { requireNative, nativeDirectory } from './binding.ts';

export interface WindowOptions { width: number; height: number; title?: string; }
export type WindowEvent = { type: string; [key: string]: unknown };
export interface SurfaceFrame { texture: GPUTexture; width: number; height: number; format: GPUTextureFormat; }
interface NativeWindow {
  poll(): string;
  acquire(): SurfaceFrame | null;
  present(): void;
  discard(): void;
  resize(width: number, height: number): void;
  setVisible(visible: boolean): void;
  setMinimized(minimized: boolean): void;
  dispose(): void;
}
const addon = requireNative(`${nativeDirectory}dawn.node`) as {
  NativeWindow: new (device: GPUDevice, options: Required<WindowOptions>) => NativeWindow;
};

/** Main-thread native preview. Rendering/publication never depends on a preview. */
export class GPUWindow {
  private native: NativeWindow | null;
  private pipelines = new Map<GPUTextureFormat, GPURenderPipeline>();
  private sampler: GPUSampler;
  private shader: GPUShaderModule;
  constructor(private readonly device: GPUDevice, options: WindowOptions) {
    this.native = new addon.NativeWindow(device, { title: 'avTools', ...options });
    this.sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
    this.shader = device.createShaderModule({ code: `
      struct Vertex { @builtin(position) position: vec4f, @location(0) uv: vec2f }
      @vertex fn vs(@builtin(vertex_index) i: u32) -> Vertex {
        let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
        return Vertex(vec4f(uv * vec2f(2., -2.) + vec2f(-1., 1.), 0., 1.), uv);
      }
      @group(0) @binding(0) var image: texture_2d<f32>;
      @group(0) @binding(1) var imageSampler: sampler;
      @fragment fn fs(v: Vertex) -> @location(0) vec4f { return textureSample(image, imageSampler, v.uv); }
    ` });
  }
  get closed(): boolean { return this.native === null; }
  poll(): WindowEvent[] {
    if (!this.native) return [];
    const events: WindowEvent[] = JSON.parse(this.native.poll());
    if (events.some(event => event.type === 'close')) this.dispose();
    return events;
  }
  acquire(): SurfaceFrame | null { return this.native?.acquire() ?? null; }
  present(): void { this.native?.present(); }
  discard(): void { this.native?.discard(); }
  resize(width: number, height: number): void { this.native?.resize(width, height); }
  setVisible(visible: boolean): void { this.native?.setVisible(visible); }
  setMinimized(minimized: boolean): void { this.native?.setMinimized(minimized); }

  /** Returns false if the preview has no available drawable. No CPU pixel transfer. */
  show(texture: GPUTexture): boolean {
    this.poll();
    const frame = this.acquire();
    if (!frame) return false;
    try {
      let pipeline = this.pipelines.get(frame.format);
      if (!pipeline) {
        pipeline = this.device.createRenderPipeline({ layout: 'auto',
          vertex: { module: this.shader, entryPoint: 'vs' },
          fragment: { module: this.shader, entryPoint: 'fs', targets: [{ format: frame.format }] } });
        this.pipelines.set(frame.format, pipeline);
      }
      const group = this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: texture.createView() }, { binding: 1, resource: this.sampler },
      ] });
      const encoder = this.device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: frame.texture.createView(),
        clearValue: [0, 0, 0, 1], loadOp: 'clear', storeOp: 'store' }] });
      pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.draw(3); pass.end();
      this.device.queue.submit([encoder.finish()]); this.present(); return true;
    } catch (error) { this.discard(); throw error; }
  }
  dispose(): void { this.native?.dispose(); this.native = null; this.pipelines.clear(); }
}
