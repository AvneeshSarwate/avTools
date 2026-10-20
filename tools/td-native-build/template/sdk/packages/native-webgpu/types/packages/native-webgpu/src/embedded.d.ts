import { P5GPU as PortableP5GPU, type P5GPUOptions } from '../../../apps/deno-notebooks/tools/p5gpu_renderer.ts';
export declare class EmbeddedP5GPU extends PortableP5GPU {
    constructor(device: GPUDevice, options: P5GPUOptions, fonts: readonly string[]);
}
