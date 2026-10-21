export interface TextLayoutRequest {
    text: string;
    family: string;
    fontSize: number;
    lineHeight: number;
    width: number | null;
    height: number | null;
    alignH: 0 | 1 | 2;
    wrapMode: 0 | 1 | 2;
    weight: number;
    style: 0 | 1 | 2;
    axisQuantization: number;
    axes: Record<string, number>;
    /** When true, turns off standard / contextual / discretionary ligatures
     *  (`liga`, `clig`, `dlig`) and contextual alternates (`calt`) during
     *  HarfBuzz shaping. Use when downstream consumers index by codepoint
     *  (e.g. tegaki stroke-data lookup) and can't handle multi-codepoint
     *  glyphs. Default: false (ligatures on). Required ligatures like
     *  Arabic's `rlig` are never disabled. */
    disableLigatures?: boolean;
}
export interface TextLayoutGlyph {
    key: bigint;
    x: number;
    y: number;
    /** UTF-8 byte offset in the source text where this glyph's cluster begins.
     *  Multiple glyphs can share a cluster (e.g. decomposed mark + base); a
     *  single input codepoint can also be absent from the glyph list if the
     *  shaper collapsed it. Use this to map glyphs back to source text. */
    cluster: number;
}
export interface TextLayoutResult {
    glyphs: TextLayoutGlyph[];
    tightWidth: number;
    fontWidth: number;
    ascent: number;
    descent: number;
    fontAscent: number;
    fontDescent: number;
    fontCapHeight: number;
    firstBaseline: number;
    totalHeight: number;
    lineCount: number;
}
export interface RasterizedGlyph {
    width: number;
    height: number;
    left: number;
    top: number;
    contentType: number;
    pixels: Uint8Array;
}
/** Host-independent surface consumed by P5GPU and its atlas. */
export interface TextEngine {
    dispose(): void;
    loadFontBytes(bytes: Uint8Array): boolean;
    layoutText(req: TextLayoutRequest): TextLayoutResult;
    rasterizeGlyph(key: bigint): RasterizedGlyph | null;
}
