export interface WindowOptions {
    width: number;
    height: number;
    title?: string;
}
export type WindowEvent = {
    type: string;
    [key: string]: unknown;
};
export interface SurfaceFrame {
    texture: GPUTexture;
    width: number;
    height: number;
    format: GPUTextureFormat;
}
/** Main-thread native preview. Rendering/publication never depends on a preview. */
export declare class GPUWindow {
    private readonly device;
    private native;
    private pipelines;
    private sampler;
    private shader;
    constructor(device: GPUDevice, options: WindowOptions);
    get closed(): boolean;
    poll(): WindowEvent[];
    acquire(): SurfaceFrame | null;
    present(): void;
    discard(): void;
    resize(width: number, height: number): void;
    setVisible(visible: boolean): void;
    setMinimized(minimized: boolean): void;
    /** Returns false if the preview has no available drawable. No CPU pixel transfer. */
    show(texture: GPUTexture): boolean;
    dispose(): void;
}
