/// <reference lib="dom" />

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

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

function parseLayoutResponse(jsonText: string): TextLayoutResult {
  type RawGlyph = { key: string; x: number; y: number };
  type RawLayout = {
    glyphs?: RawGlyph[];
    tight_width?: number;
    font_width?: number;
    ascent?: number;
    descent?: number;
    font_ascent?: number;
    font_descent?: number;
    font_cap_height?: number;
    first_baseline?: number;
    total_height?: number;
    line_count?: number;
  };

  let parsed: RawLayout = {};
  try {
    parsed = JSON.parse(jsonText) as RawLayout;
  } catch {
    // fall through with empty layout
  }

  const glyphs = (parsed.glyphs ?? []).map((glyph) => ({
    key: BigInt(`0x${glyph.key}`),
    x: Number(glyph.x ?? 0),
    y: Number(glyph.y ?? 0),
  }));

  return {
    glyphs,
    tightWidth: Number(parsed.tight_width ?? 0),
    fontWidth: Number(parsed.font_width ?? 0),
    ascent: Number(parsed.ascent ?? 0),
    descent: Number(parsed.descent ?? 0),
    fontAscent: Number(parsed.font_ascent ?? 0),
    fontDescent: Number(parsed.font_descent ?? 0),
    fontCapHeight: Number(parsed.font_cap_height ?? 0),
    firstBaseline: Number(parsed.first_baseline ?? 0),
    totalHeight: Number(parsed.total_height ?? 0),
    lineCount: Number(parsed.line_count ?? 0),
  };
}

export class NativeTextEngine {
  private readonly _lib: TextEngineLibrary;
  private _enginePtr: Deno.PointerValue;

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
    if (!this._enginePtr) {
      return {
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
    }

    const text = encodeString(req.text);
    const family = encodeString(req.family);
    const axesJson = encodeString(JSON.stringify(req.axes));

    const needed = this._lib.symbols.text_engine_layout_json(
      this._enginePtr,
      text.ptr,
      text.len,
      family.ptr,
      family.len,
      req.fontSize,
      req.lineHeight,
      req.width ?? -1,
      req.height ?? -1,
      req.alignH,
      req.wrapMode,
      Math.max(1, Math.min(1000, Math.round(req.weight))),
      req.style,
      req.axisQuantization,
      axesJson.ptr,
      axesJson.len,
      null,
      0,
    );

    if (needed === 0) {
      return {
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
    }

    const out = new Uint8Array(needed);
    const outPtr = Deno.UnsafePointer.of(out);
    const written = this._lib.symbols.text_engine_layout_json(
      this._enginePtr,
      text.ptr,
      text.len,
      family.ptr,
      family.len,
      req.fontSize,
      req.lineHeight,
      req.width ?? -1,
      req.height ?? -1,
      req.alignH,
      req.wrapMode,
      Math.max(1, Math.min(1000, Math.round(req.weight))),
      req.style,
      req.axisQuantization,
      axesJson.ptr,
      axesJson.len,
      outPtr,
      out.length,
    );

    const jsonText = textDecoder.decode(out.subarray(0, written));
    return parseLayoutResponse(jsonText);
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
