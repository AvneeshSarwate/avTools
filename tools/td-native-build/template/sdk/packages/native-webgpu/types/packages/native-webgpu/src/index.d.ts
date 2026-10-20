/// <reference types="@webgpu/types" preserve="true" />
import { P5GPU as PortableP5GPU, type P5GPUOptions } from '../../../apps/deno-notebooks/tools/p5gpu_renderer.ts';
import { NodeTextEngine } from './text.ts';
export { NodeTextEngine };
export { GPUWindow } from './window.ts';
export type { WindowOptions, SurfaceFrame, WindowEvent } from './window.ts';
export type { P5GPUOptions };
export type { P5GPUImage } from "../../../apps/deno-notebooks/tools/p5gpu_renderer.ts";
export declare class P5GPU extends PortableP5GPU {
    constructor(device: GPUDevice, options: P5GPUOptions);
}
/** Create an upstream Dawn WebGPU instance using the hardware Metal backend. */
export declare function createGPU(): GPU;
export { SyphonChannel } from './syphon.ts';
export type { SyphonStats, SyphonRegion } from './syphon.ts';
