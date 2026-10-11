import type { TextEngine, TextLayoutRequest, TextLayoutResult, RasterizedGlyph } from '../../../apps/deno-notebooks/tools/p5gpu_text/types.ts';
import { parseBinaryLayout } from '../../../apps/deno-notebooks/tools/p5gpu_text/layout.ts';

export interface NativeEngine {
  dispose(): void;
  loadFontBytes(bytes: Uint8Array): boolean;
  layout(request: Record<string, unknown>): Uint8Array;
  rasterizeGlyph(key: bigint): RasterizedGlyph | null;
}
export class HostTextEngine implements TextEngine {
  private cache = new Map<string, TextLayoutResult>();
  constructor(private native: NativeEngine | null) {}

  dispose(): void {
    this.native?.dispose(); this.native = null; this.cache.clear();
  }

  loadFontBytes(bytes: Uint8Array): boolean {
    const loaded = this.engine().loadFontBytes(bytes);
    if (loaded) this.cache.clear();
    return loaded;
  }

  layoutText(req: TextLayoutRequest): TextLayoutResult {
    const engine = this.engine();
    const request = { ...req, width: req.width ?? -1, height: req.height ?? -1,
      weight: Math.max(1, Math.min(1000, Math.round(req.weight))),
      axesJson: JSON.stringify(req.axes), disableLigatures: req.disableLigatures ? 1 : 0 };
    const key = JSON.stringify(request);
    const cached = this.cache.get(key);
    if (cached) return cached;
    const bytes = engine.layout(request);
    const result = parseBinaryLayout(bytes, bytes.length);
    if (result.glyphs.length || result.lineCount) {
      if (this.cache.size >= 16384) this.cache.clear();
      this.cache.set(key, result);
    }
    return result;
  }

  rasterizeGlyph(key: bigint): RasterizedGlyph | null { return this.engine().rasterizeGlyph(key); }
  private engine(): NativeEngine {
    if (!this.native) throw new Error('Text engine is disposed');
    return this.native;
  }
}
