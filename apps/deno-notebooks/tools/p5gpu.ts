// Deno entry point. The renderer itself uses only WebGPU and injected host services.
import { P5GPU as PortableP5GPU, type P5GPUHost, type P5GPUOptions } from "./p5gpu_renderer.ts";
import { NativeTextEngine } from "./p5gpu_text/ffi.ts";
export type { P5GPUOptions, P5GPUHost } from "./p5gpu_renderer.ts";

const denoHost: P5GPUHost = {
  createTextEngine() {
    // Preserve the Deno entry point's optional-text behavior.
    try { return new NativeTextEngine(); } catch { return null; }
  },
  readFile: (path) => Deno.readFile(path),
  env(name) {
    try { return Deno.env.get(name); } catch { return undefined; }
  },
};

export class P5GPU extends PortableP5GPU {
  constructor(device: GPUDevice, opts: P5GPUOptions) {
    super(device, opts, denoHost);
  }
}
