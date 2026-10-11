/// <reference types="@webgpu/types" preserve="true" />
import { readFile } from 'node:fs/promises';
import { requireNative, nativeDirectory } from './binding.ts';
import { P5GPU as PortableP5GPU, type P5GPUOptions } from '../../../apps/deno-notebooks/tools/p5gpu_renderer.ts';
import { NodeTextEngine } from './text.ts';
export { NodeTextEngine };
export { GPUWindow } from './window.ts';
export type { WindowOptions, SurfaceFrame, WindowEvent } from './window.ts';
export type { P5GPUOptions };
export type { P5GPUImage } from "../../../apps/deno-notebooks/tools/p5gpu_renderer.ts";
const { create, globals } = requireNative(`${nativeDirectory}dawn.node`) as {
  create(flags: string[]): GPU;
  globals: Record<string, unknown>;
};

export class P5GPU extends PortableP5GPU {
  constructor(device: GPUDevice, options: P5GPUOptions) {
    super(device, options, {
      createTextEngine: () => new NodeTextEngine(),
      readFile: async path => new Uint8Array(await readFile(path)),
      env: name => process.env[name],
    });
  }
}

/** Create an upstream Dawn WebGPU instance using the hardware Metal backend. */
export function createGPU() {
  Object.assign(globalThis, globals);
  return create(['backend=metal']);
}
export { SyphonChannel } from './syphon.ts';
export type { SyphonStats, SyphonRegion } from './syphon.ts';
