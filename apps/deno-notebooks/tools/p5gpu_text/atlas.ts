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
  private _inkAlphaThreshold = 128;
  private _cursorX = 0;
  private _cursorY = 0;
  private _rowHeight = 0;
  private _frameId = 0;
  private _clearNextFrame = false;

  private _entries = new Map<bigint, GlyphAtlasEntry>();
  private _pendingTextureDestroys: Promise<void>[] = [];
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
    if (this.dynamicScratchMode || this._clearNextFrame) {
      this._clearAtlas();
      this._clearNextFrame = false;
      this._stats.clears += 1;
    }
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
    if (this._entries.size >= this.maxEntries) {
      this._clearNextFrame = true;
      return null;
    }
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
      if (!this._growTexture()) {
        this._clearNextFrame = true;
        return null;
      }

      slot = this._allocate(raster.width, raster.height);
    }

    this._upload(slot.x, slot.y, raster);
    const ink = this._computeInkXRange(raster);

    const inv = 1 / this.size;
    const entry: GlyphAtlasEntry = {
      key,
      x: slot.x,
      y: slot.y,
      width: raster.width,
      height: raster.height,
      inkX0: ink.x0,
      inkX1: ink.x1,
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
    for (const pending of this._pendingTextureDestroys) {
      void pending.catch(() => {});
    }
    this._pendingTextureDestroys.length = 0;
    this._entries.clear();
  }

  private _createTexture(size: number): GPUTexture {
    return this.device.createTexture({
      size: { width: size, height: size, depthOrArrayLayers: 1 },
      format: this.format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
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

    const prevTexture = this.texture;
    const prevSize = this.size;
    const nextSize = Math.min(this.maxSize, this.size * 2);

    const nextTexture = this._createTexture(nextSize);
    const encoder = this.device.createCommandEncoder();
    encoder.copyTextureToTexture(
      { texture: prevTexture },
      { texture: nextTexture },
      { width: prevSize, height: prevSize, depthOrArrayLayers: 1 },
    );
    this.queue.submit([encoder.finish()]);
    this._deferTextureDestroy(prevTexture);

    this.size = nextSize;
    this.texture = nextTexture;
    const inv = 1 / this.size;
    for (const entry of this._entries.values()) {
      entry.u0 = entry.x * inv;
      entry.v0 = entry.y * inv;
      entry.u1 = (entry.x + entry.width) * inv;
      entry.v1 = (entry.y + entry.height) * inv;
    }
    this.version += 1;
    this._stats.grows += 1;
    // Keep atlas entries and packing cursor intact; prior UVs remain valid.
    return true;
  }

  private _clearAtlas(): void {
    this._entries.clear();
    this._cursorX = 0;
    this._cursorY = 0;
    this._rowHeight = 0;
    // Clearing invalidates all existing UV references.
    this.version += 1;
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

  private _computeInkXRange(raster: RasterizedGlyph): { x0: number; x1: number } {
    const { width, height, pixels } = raster;
    if (width <= 0 || height <= 0 || pixels.length === 0) {
      return { x0: 0, x1: width };
    }

    let minX = width;
    let maxX = -1;
    const threshold = this._inkAlphaThreshold;
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        if ((pixels[row + x] ?? 0) >= threshold) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
    }

    if (maxX < minX) {
      return { x0: 0, x1: width };
    }
    return { x0: minX, x1: maxX + 1 };
  }

  private _deferTextureDestroy(texture: GPUTexture): void {
    const queue = this.queue as GPUQueue & { onSubmittedWorkDone?: () => Promise<void> };
    if (typeof queue.onSubmittedWorkDone === "function") {
      const pending = queue.onSubmittedWorkDone()
        .catch(() => {})
        .then(() => {
          try {
            texture.destroy();
          } catch {
            // ignore
          }
        });
      this._pendingTextureDestroys.push(pending);
      if (this._pendingTextureDestroys.length > 24) {
        this._pendingTextureDestroys = this._pendingTextureDestroys.slice(-12);
      }
      return;
    }

    // Fallback for runtimes without queue fences: keep texture alive until dispose.
    this._pendingTextureDestroys.push(Promise.resolve());
  }
}
