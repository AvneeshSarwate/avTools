/// <reference lib="dom" />

const textEncoder = new TextEncoder();

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
}

export interface TextLayoutGlyph {
  key: bigint;
  x: number;
  y: number;
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

export const FFI_SYMBOLS = {
  text_engine_create: { parameters: [], result: "pointer" },
  text_engine_destroy: { parameters: ["pointer"], result: "void" },
  text_engine_load_font_file: {
    parameters: ["pointer", "pointer", "u32"],
    result: "u32",
  },
  text_engine_load_font_bytes: {
    parameters: ["pointer", "pointer", "u32"],
    result: "u32",
  },
  text_engine_layout_json: {
    parameters: [
      "pointer", // engine
      "pointer", // text_ptr
      "u32", // text_len
      "pointer", // family_ptr
      "u32", // family_len
      "f32", // font_size
      "f32", // line_height
      "f32", // width
      "f32", // height
      "u32", // align_h
      "u32", // wrap_mode
      "u16", // weight
      "u32", // style
      "f32", // axis_quantization
      "pointer", // axes_json_ptr
      "u32", // axes_json_len
      "pointer", // out_ptr
      "u32", // out_cap
    ],
    result: "u32",
  },
  text_engine_rasterize_glyph: {
    parameters: [
      "pointer", // engine
      "u64", // key
      "pointer", // out_ptr
      "u32", // out_cap
      "pointer", // out_width
      "pointer", // out_height
      "pointer", // out_left
      "pointer", // out_top
      "pointer", // out_content_type
    ],
    result: "u32",
  },
} as const;

export type TextEngineSymbols = typeof FFI_SYMBOLS;
export type TextEngineLibrary = Deno.DynamicLibrary<TextEngineSymbols>;

let sharedLibrary: TextEngineLibrary | null = null;

function defaultLibUrl(): URL {
  const base = new URL("../../native/text_engine/target/release/", import.meta.url);
  const os = Deno.build.os;
  const candidates =
    os === "windows"
      ? ["text_engine.dll", "libtext_engine.dll"]
      : os === "darwin"
      ? ["libtext_engine.dylib"]
      : ["libtext_engine.so"];

  for (const name of candidates) {
    const url = new URL(name, base);
    try {
      const test = Deno.dlopen(url, FFI_SYMBOLS);
      test.close();
      return url;
    } catch {
      // Try next candidate.
    }
  }

  throw new Error(
    `Could not find native text_engine library in ${base.toString()} (tried ${candidates.join(", ")})`,
  );
}

function getLibrary(): TextEngineLibrary {
  if (sharedLibrary) return sharedLibrary;
  sharedLibrary = Deno.dlopen(defaultLibUrl(), FFI_SYMBOLS);
  return sharedLibrary;
}

function encodeString(input: string): { bytes: Uint8Array; ptr: Deno.PointerValue; len: number } {
  const bytes = textEncoder.encode(input);
  return {
    bytes,
    ptr: bytes.length > 0 ? Deno.UnsafePointer.of(bytes) : null,
    len: bytes.length,
  };
}

function parseBinaryLayout(buffer: Uint8Array, byteLength: number): TextLayoutResult {
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

  const expectedSize = 44 + glyphCount * 16;
  if (byteLength < expectedSize) return emptyResult;

  const glyphs: TextLayoutGlyph[] = new Array(glyphCount);
  let offset = 44;
  for (let i = 0; i < glyphCount; i++) {
    const key = dv.getBigUint64(offset, true);
    const x = dv.getInt32(offset + 8, true);
    const y = dv.getInt32(offset + 12, true);
    glyphs[i] = { key, x, y };
    offset += 16;
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

export class NativeTextEngine {
  private readonly _lib: TextEngineLibrary;
  private _enginePtr: Deno.PointerValue;
  private _layoutBuffer: Uint8Array = new Uint8Array(65536);
  private _layoutCache = new Map<string, TextLayoutResult>();
  private static readonly _LAYOUT_CACHE_MAX = 16384;

  constructor() {
    this._lib = getLibrary();
    this._enginePtr = this._lib.symbols.text_engine_create();
    if (!this._enginePtr) {
      throw new Error("Failed to create native text engine");
    }

    this.loadBundledFonts();
  }

  dispose(): void {
    if (!this._enginePtr) return;
    this._lib.symbols.text_engine_destroy(this._enginePtr);
    this._enginePtr = null;
  }

  loadFontFile(path: string): boolean {
    if (!this._enginePtr) return false;
    const encoded = encodeString(path);
    return this._lib.symbols.text_engine_load_font_file(this._enginePtr, encoded.ptr, encoded.len) !== 0;
  }

  loadFontBytes(bytes: Uint8Array): boolean {
    if (!this._enginePtr || bytes.length === 0) return false;
    const owned = new Uint8Array(bytes);
    const ptr = Deno.UnsafePointer.of(owned);
    return this._lib.symbols.text_engine_load_font_bytes(this._enginePtr, ptr, owned.length) !== 0;
  }

  layoutText(req: TextLayoutRequest): TextLayoutResult {
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
    if (!this._enginePtr) return emptyResult;

    // Build cache key from all params that affect layout output
    const weight = Math.max(1, Math.min(1000, Math.round(req.weight)));
    const width = req.width ?? -1;
    const height = req.height ?? -1;
    const axesKey = Object.keys(req.axes).length === 0 ? "" : JSON.stringify(req.axes);
    const cacheKey = `${req.text}\0${req.family}\0${req.fontSize}\0${req.lineHeight}\0${width}\0${height}\0${req.alignH}\0${req.wrapMode}\0${weight}\0${req.style}\0${req.axisQuantization}\0${axesKey}`;

    const cached = this._layoutCache.get(cacheKey);
    if (cached) return cached;

    const text = encodeString(req.text);
    const family = encodeString(req.family);
    const axesJson = encodeString(JSON.stringify(req.axes));

    // First call: pass the pre-allocated buffer directly.
    const outPtr = Deno.UnsafePointer.of(this._layoutBuffer);
    const needed = this._lib.symbols.text_engine_layout_json(
      this._enginePtr,
      text.ptr,
      text.len,
      family.ptr,
      family.len,
      req.fontSize,
      req.lineHeight,
      width,
      height,
      req.alignH,
      req.wrapMode,
      weight,
      req.style,
      req.axisQuantization,
      axesJson.ptr,
      axesJson.len,
      outPtr,
      this._layoutBuffer.length,
    );

    if (needed === 0) return emptyResult;

    let result: TextLayoutResult;

    // Common case: output fit in the pre-allocated buffer (single FFI call).
    if (needed <= this._layoutBuffer.length) {
      result = parseBinaryLayout(this._layoutBuffer, needed);
    } else {
      // Overflow: grow the buffer and make one more call.
      this._layoutBuffer = new Uint8Array(needed);
      const grownPtr = Deno.UnsafePointer.of(this._layoutBuffer);
      const written = this._lib.symbols.text_engine_layout_json(
        this._enginePtr,
        text.ptr,
        text.len,
        family.ptr,
        family.len,
        req.fontSize,
        req.lineHeight,
        width,
        height,
        req.alignH,
        req.wrapMode,
        weight,
        req.style,
        req.axisQuantization,
        axesJson.ptr,
        axesJson.len,
        grownPtr,
        this._layoutBuffer.length,
      );

      result = parseBinaryLayout(this._layoutBuffer, written);
    }

    // Cache the result (don't cache empty/error results)
    if (result.glyphs.length > 0 || result.lineCount > 0) {
      if (this._layoutCache.size >= NativeTextEngine._LAYOUT_CACHE_MAX) {
        this._layoutCache.clear();
      }
      this._layoutCache.set(cacheKey, result);
    }

    return result;
  }

  rasterizeGlyph(key: bigint): RasterizedGlyph | null {
    if (!this._enginePtr) return null;

    const outWidth = new Uint32Array(1);
    const outHeight = new Uint32Array(1);
    const outLeft = new Int32Array(1);
    const outTop = new Int32Array(1);
    const outContentType = new Uint32Array(1);

    const needed = this._lib.symbols.text_engine_rasterize_glyph(
      this._enginePtr,
      key,
      null,
      0,
      Deno.UnsafePointer.of(outWidth),
      Deno.UnsafePointer.of(outHeight),
      Deno.UnsafePointer.of(outLeft),
      Deno.UnsafePointer.of(outTop),
      Deno.UnsafePointer.of(outContentType),
    );

    if (needed === 0 || outWidth[0] === 0 || outHeight[0] === 0) {
      return null;
    }

    const out = new Uint8Array(needed);
    const outPtr = Deno.UnsafePointer.of(out);

    this._lib.symbols.text_engine_rasterize_glyph(
      this._enginePtr,
      key,
      outPtr,
      out.length,
      Deno.UnsafePointer.of(outWidth),
      Deno.UnsafePointer.of(outHeight),
      Deno.UnsafePointer.of(outLeft),
      Deno.UnsafePointer.of(outTop),
      Deno.UnsafePointer.of(outContentType),
    );

    return {
      width: outWidth[0],
      height: outHeight[0],
      left: outLeft[0],
      top: outTop[0],
      contentType: outContentType[0],
      pixels: out,
    };
  }

  private loadBundledFonts(): void {
    try {
      const fontsDir = new URL("../../assets/fonts/", import.meta.url);
      const entries = Array.from(Deno.readDirSync(fontsDir))
        .filter((entry) => entry.isFile && /\.(ttf|otf|woff2?)$/i.test(entry.name))
        .sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        const bytes = Deno.readFileSync(new URL(entry.name, fontsDir));
        this.loadFontBytes(bytes);
      }
    } catch {
      // Ignore missing bundled fonts.
    }
  }
}
