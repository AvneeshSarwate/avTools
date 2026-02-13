/// <reference lib="dom" />

import type { NativeTextEngine, RasterizedGlyph } from "./ffi.ts";

export interface GlyphAtlasOptions {
  initialSize?: number;
  maxSize?: number;
  maxEntries?: number;
  dynamicScratchMode?: boolean;
  padding?: number;
}

export interface GlyphAtlasEntry {
  key: bigint;
  x: number;
  y: number;
  width: number;
  height: number;
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
}

export class GlyphAtlas {
  readonly device: GPUDevice;
  readonly queue: GPUQueue;
  readonly format: GPUTextureFormat = "r8unorm";
  readonly sampler: GPUSampler;

  texture: GPUTexture;
  version = 1;
  size: number;
  maxSize: number;
  maxEntries: number;
  dynamicScratchMode: boolean;

  private _padding: number;
  private _cursorX = 0;
  private _cursorY = 0;
  private _rowHeight = 0;
  private _frameId = 0;

  private _entries = new Map<bigint, GlyphAtlasEntry>();
  private _stats: AtlasFrameStats = {
    hits: 0,
    misses: 0,
    uploads: 0,
    bytesUploaded: 0,
    grows: 0,
    clears: 0,
  };

  constructor(device: GPUDevice, queue: GPUQueue, options: GlyphAtlasOptions = {}) {
    this.device = device;
    this.queue = queue;

    this.size = Math.max(64, options.initialSize ?? 512);
    this.maxSize = Math.max(this.size, options.maxSize ?? 4096);
    this.maxEntries = Math.max(64, options.maxEntries ?? 8192);
    this.dynamicScratchMode = options.dynamicScratchMode ?? false;
    this._padding = Math.max(0, options.padding ?? 1);

    this.texture = this._createTexture(this.size);
    this.sampler = this.device.createSampler({
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
    });
  }

  beginFrame(): void {
    this._frameId += 1;
    this._stats = {
      hits: 0,
      misses: 0,
      uploads: 0,
      bytesUploaded: 0,
      grows: 0,
      clears: 0,
    };
  }

  get entries(): ReadonlyMap<bigint, GlyphAtlasEntry> {
    return this._entries;
  }

  takeFrameStats(): AtlasFrameStats {
    return { ...this._stats };
  }

  textureView(): GPUTextureView {
    return this.texture.createView();
  }

  ensureGlyph(key: bigint, engine: NativeTextEngine): GlyphAtlasEntry | null {
    const existing = this._entries.get(key);
    if (existing) {
      existing.lastUsedFrame = this._frameId;
      this._stats.hits += 1;
      return existing;
    }

    this._stats.misses += 1;
    const raster = engine.rasterizeGlyph(key);
    if (!raster || raster.width === 0 || raster.height === 0) {
      return null;
    }

    if (!this._ensureGlyphFits(raster)) {
      return null;
    }

    let slot = this._allocate(raster.width, raster.height);
    let attempts = 0;
    while (!slot) {
      attempts += 1;
      if (attempts > 4) return null;

      const shouldScratch = this.dynamicScratchMode || this._entries.size >= this.maxEntries;
      if (shouldScratch || !this._growTexture()) {
        this._clearAtlas();
        this._stats.clears += 1;
      }

      slot = this._allocate(raster.width, raster.height);
    }

    this._upload(slot.x, slot.y, raster);

    const inv = 1 / this.size;
    const entry: GlyphAtlasEntry = {
      key,
      x: slot.x,
      y: slot.y,
      width: raster.width,
      height: raster.height,
      left: raster.left,
      top: raster.top,
      u0: slot.x * inv,
      v0: slot.y * inv,
      u1: (slot.x + raster.width) * inv,
      v1: (slot.y + raster.height) * inv,
      lastUsedFrame: this._frameId,
    };

    this._entries.set(key, entry);
    return entry;
  }

  clear(): void {
    this._clearAtlas();
  }

  dispose(): void {
    try {
      this.texture.destroy();
    } catch {
      // ignore
    }
    this._entries.clear();
  }

  private _createTexture(size: number): GPUTexture {
    return this.device.createTexture({
      size: { width: size, height: size, depthOrArrayLayers: 1 },
      format: this.format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
  }

  private _ensureGlyphFits(raster: RasterizedGlyph): boolean {
    while (raster.width + this._padding > this.size || raster.height + this._padding > this.size) {
      if (!this._growTexture()) {
        return false;
      }
    }
    return true;
  }

  private _growTexture(): boolean {
    if (this.size >= this.maxSize) {
      return false;
    }

    const nextSize = Math.min(this.maxSize, this.size * 2);
    try {
      this.texture.destroy();
    } catch {
      // ignore
    }

    this.size = nextSize;
    this.texture = this._createTexture(this.size);
    this.version += 1;
    this._stats.grows += 1;

    this._entries.clear();
    this._cursorX = 0;
    this._cursorY = 0;
    this._rowHeight = 0;
    return true;
  }

  private _clearAtlas(): void {
    this._entries.clear();
    this._cursorX = 0;
    this._cursorY = 0;
    this._rowHeight = 0;
  }

  private _allocate(width: number, height: number): { x: number; y: number } | null {
    const paddedW = width + this._padding;
    const paddedH = height + this._padding;

    if (paddedW > this.size || paddedH > this.size) {
      return null;
    }

    if (this._cursorX + paddedW > this.size) {
      this._cursorX = 0;
      this._cursorY += this._rowHeight;
      this._rowHeight = 0;
    }

    if (this._cursorY + paddedH > this.size) {
      return null;
    }

    const out = { x: this._cursorX, y: this._cursorY };
    this._cursorX += paddedW;
    this._rowHeight = Math.max(this._rowHeight, paddedH);
    return out;
  }

  private _upload(x: number, y: number, raster: RasterizedGlyph): void {
    const upload = new Uint8Array(raster.pixels);
    this.queue.writeTexture(
      {
        texture: this.texture,
        origin: { x, y, z: 0 },
      },
      upload,
      {
        offset: 0,
        bytesPerRow: raster.width,
        rowsPerImage: raster.height,
      },
      {
        width: raster.width,
        height: raster.height,
        depthOrArrayLayers: 1,
      },
    );

    this._stats.uploads += 1;
    this._stats.bytesUploaded += upload.length;
  }
}
