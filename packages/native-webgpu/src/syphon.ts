import { requireNative, nativeDirectory } from './binding.ts';
export interface SyphonStats { hasClients: boolean; inFlight: number; completed: number; failed: number; published: number; dropped: number; noClients: number; }
export interface SyphonRegion { x: number; y: number; width: number; height: number; }
interface NativeSyphon {
  publish(texture: GPUTexture, flipped: boolean, region: SyphonRegion): boolean;
  stats(): SyphonStats;
  description(): string | null;
  dispose(): void;
}
const addon = requireNative(`${nativeDirectory}dawn.node`) as {
  NativeSyphon: new (device: GPUDevice, name: string, privateServer: boolean) => NativeSyphon;
};
/** Offscreen Metal publication ordered on the source device's Dawn queue. */
export class SyphonChannel {
  private native: NativeSyphon;
  constructor(device: GPUDevice, name: string, options: { private?: boolean } = {}) {
    this.native = new addon.NativeSyphon(device, name, options.private ?? false);
  }
  /** False means no clients or a full queue. No readback. Set flipped:true for upright P5 output in TD. */
  publishTexture(texture: GPUTexture, options: { flipped?: boolean; region?: SyphonRegion } = {}): boolean {
    return this.native.publish(texture, options.flipped ?? false,
      options.region ?? { x: 0, y: 0, width: texture.width, height: texture.height });
  }
  get stats(): SyphonStats { return this.native.stats(); }
  /** Opaque Syphon connection descriptor, useful for private channels. */
  get serverDescription(): Record<string, unknown> | null {
    const value = this.native.description(); return value ? JSON.parse(value) : null;
  }
  dispose(): void { this.native.dispose(); }
}
