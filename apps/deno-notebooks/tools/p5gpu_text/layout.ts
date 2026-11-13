import type { TextLayoutResult, TextLayoutGlyph } from "./types.ts";

export function parseBinaryLayout(buffer: Uint8Array, byteLength: number): TextLayoutResult {
  const emptyResult: TextLayoutResult = {
    glyphs: [],
    tightWidth: 0,
    fontWidth: 0,
    ascent: 0,
    descent: 0,
    fontAscent: 0,
    fontDescent: 0,
    fontCapHeight: 0,
    firstBaseline: 0,
    totalHeight: 0,
    lineCount: 0,
  };

  // Header is 44 bytes minimum
  if (byteLength < 44) return emptyResult;

  const dv = new DataView(buffer.buffer, buffer.byteOffset, byteLength);

  const tightWidth = dv.getFloat32(0, true);
  const fontWidth = dv.getFloat32(4, true);
  const ascent = dv.getFloat32(8, true);
  const descent = dv.getFloat32(12, true);
  const fontAscent = dv.getFloat32(16, true);
  const fontDescent = dv.getFloat32(20, true);
  const fontCapHeight = dv.getFloat32(24, true);
  const firstBaseline = dv.getFloat32(28, true);
  const totalHeight = dv.getFloat32(32, true);
  const lineCount = dv.getFloat32(36, true);
  const glyphCount = dv.getUint32(40, true);

  // Per-glyph record is 20 bytes: u64 key + i32 x + i32 y + u32 cluster
  const expectedSize = 44 + glyphCount * 20;
  if (byteLength < expectedSize) return emptyResult;

  const glyphs: TextLayoutGlyph[] = new Array(glyphCount);
  let offset = 44;
  for (let i = 0; i < glyphCount; i++) {
    const key = dv.getBigUint64(offset, true);
    const x = dv.getInt32(offset + 8, true);
    const y = dv.getInt32(offset + 12, true);
    const cluster = dv.getUint32(offset + 16, true);
    glyphs[i] = { key, x, y, cluster };
    offset += 20;
  }

  return {
    glyphs,
    tightWidth,
    fontWidth,
    ascent,
    descent,
    fontAscent,
    fontDescent,
    fontCapHeight,
    firstBaseline,
    totalHeight,
    lineCount,
  };
}
