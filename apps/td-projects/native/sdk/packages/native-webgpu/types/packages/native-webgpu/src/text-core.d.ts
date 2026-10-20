import type { TextEngine, TextLayoutRequest, TextLayoutResult, RasterizedGlyph } from '../../../apps/deno-notebooks/tools/p5gpu_text/types.ts';
export interface NativeEngine {
    dispose(): void;
    loadFontBytes(bytes: Uint8Array): boolean;
    layout(request: Record<string, unknown>): Uint8Array;
    rasterizeGlyph(key: bigint): RasterizedGlyph | null;
}
export declare class HostTextEngine implements TextEngine {
    private native;
    private cache;
    constructor(native: NativeEngine | null);
    dispose(): void;
    loadFontBytes(bytes: Uint8Array): boolean;
    layoutText(req: TextLayoutRequest): TextLayoutResult;
    rasterizeGlyph(key: bigint): RasterizedGlyph | null;
    private engine;
}
