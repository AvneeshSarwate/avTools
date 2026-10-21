import type { TextEngine } from "./types.ts";
export interface GlyphAtlasOptions {
    initialSize?: number;
    maxSize?: number;
    maxEntries?: number;
    /**
     * @deprecated No longer used. LRU eviction is always active.
     * Kept for API compatibility; setting this has no effect.
     */
    dynamicScratchMode?: boolean;
    padding?: number;
    /** Number of frames a glyph can go unused before eviction (default 3). */
    evictionThreshold?: number;
}
export interface GlyphAtlasEntry {
    key: bigint;
    x: number;
    y: number;
    width: number;
    height: number;
    inkX0: number;
    inkX1: number;
    left: number;
    top: number;
    u0: number;
    v0: number;
    u1: number;
    v1: number;
    lastUsedFrame: number;
}
export interface AtlasFrameStats {
    hits: number;
    misses: number;
    uploads: number;
    bytesUploaded: number;
    grows: number;
    clears: number;
    evictions: number;
}
export declare class GlyphAtlas {
    readonly device: GPUDevice;
    readonly queue: GPUQueue;
    readonly format: GPUTextureFormat;
    readonly sampler: GPUSampler;
    texture: GPUTexture;
    version: number;
    size: number;
    maxSize: number;
    maxEntries: number;
    /**
     * @deprecated No longer used. LRU eviction is always active.
     * Kept for API compatibility; reads/writes are ignored internally.
     */
    dynamicScratchMode: boolean;
    private _padding;
    private _inkAlphaThreshold;
    private _cursorX;
    private _cursorY;
    private _rowHeight;
    private _frameId;
    private _clearNextFrame;
    private _needsGrowNextFrame;
    private _evictionThreshold;
    private _entries;
    private _pendingTextureDestroys;
    private _stats;
    constructor(device: GPUDevice, queue: GPUQueue, options?: GlyphAtlasOptions);
    beginFrame(): void;
    get entries(): ReadonlyMap<bigint, GlyphAtlasEntry>;
    takeFrameStats(): AtlasFrameStats;
    textureView(): GPUTextureView;
    ensureGlyph(key: bigint, engine: TextEngine): GlyphAtlasEntry | null;
    clear(): void;
    dispose(): void;
    private _createTexture;
    /**
     * Check whether the raster fits within the current texture dimensions.
     * Does NOT attempt to grow -- caller must handle the failure.
     */
    private _glyphFitsInCurrentSize;
    private _growTexture;
    private _clearAtlas;
    private _zeroTexture;
    private _allocate;
    private _upload;
    private _computeInkXRange;
    private _deferTextureDestroy;
}
