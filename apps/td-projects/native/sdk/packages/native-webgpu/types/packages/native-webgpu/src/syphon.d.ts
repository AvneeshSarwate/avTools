export interface SyphonStats {
    hasClients: boolean;
    inFlight: number;
    completed: number;
    failed: number;
    published: number;
    dropped: number;
    noClients: number;
}
export interface SyphonRegion {
    x: number;
    y: number;
    width: number;
    height: number;
}
/** Offscreen Metal publication ordered on the source device's Dawn queue. */
export declare class SyphonChannel {
    private native;
    constructor(device: GPUDevice, name: string, options?: {
        private?: boolean;
    });
    /** False means no clients or a full queue. No readback. Set flipped:true for upright P5 output in TD. */
    publishTexture(texture: GPUTexture, options?: {
        flipped?: boolean;
        region?: SyphonRegion;
    }): boolean;
    get stats(): SyphonStats;
    /** Opaque Syphon connection descriptor, useful for private channels. */
    get serverDescription(): Record<string, unknown> | null;
    dispose(): void;
}
