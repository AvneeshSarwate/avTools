export const HAP_DECODER_FFI_SYMBOLS = {
  hap_decoder_open: {
    parameters: ["buffer", "u32", "u32"],
    result: "pointer",
  },
  hap_decoder_close: {
    parameters: ["pointer"],
    result: "void",
  },
  hap_decoder_last_error: {
    parameters: ["buffer", "u32"],
    result: "u32",
  },
  hap_decoder_width: {
    parameters: ["pointer"],
    result: "u32",
  },
  hap_decoder_height: {
    parameters: ["pointer"],
    result: "u32",
  },
  hap_decoder_frame_count: {
    parameters: ["pointer"],
    result: "u32",
  },
  hap_decoder_frame_rate: {
    parameters: ["pointer"],
    result: "f64",
  },
  hap_decoder_duration_seconds: {
    parameters: ["pointer"],
    result: "f64",
  },
  hap_decoder_decoded_byte_length: {
    parameters: ["pointer"],
    result: "u32",
  },
  hap_decoder_chunk_count: {
    parameters: ["pointer"],
    result: "u32",
  },
  hap_decoder_compressor: {
    parameters: ["pointer"],
    result: "u32",
  },
  hap_decoder_decode_frame: {
    parameters: ["pointer", "u32", "buffer", "u32", "buffer", "u32"],
    result: "i32",
  },
} as const;

export type HapDecoderLibrary = Deno.DynamicLibrary<typeof HAP_DECODER_FFI_SYMBOLS>;

export interface NativeHapDecoderOptions {
  libPath?: string;
  workerCount?: number;
}

export interface NativeHapDecoderStats {
  readMs: number;
  decodeMs: number;
  totalMs: number;
  compressedBytes: number;
  decodedBytes: number;
  chunkCount: number;
  workerCount: number;
  frameIndex: number;
}

export interface NativeHapDecoderInfo {
  path: string;
  width: number;
  height: number;
  frameCount: number;
  frameRate: number;
  durationSeconds: number;
  decodedByteLength: number;
  chunkCount: number;
  compressor: "none" | "snappy";
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function openLibrary(libPath?: string): HapDecoderLibrary {
  const path = libPath ?? defaultLibUrl();
  return Deno.dlopen(path, HAP_DECODER_FFI_SYMBOLS);
}

export class NativeHapDecoder {
  readonly info: NativeHapDecoderInfo;

  #lib: HapDecoderLibrary;
  #handle: Deno.PointerValue;
  #statsBuffer = new Uint8Array(64);
  #closed = false;

  private constructor(
    path: string,
    lib: HapDecoderLibrary,
    handle: Deno.PointerValue,
  ) {
    this.#lib = lib;
    this.#handle = handle;
    this.info = {
      path,
      width: lib.symbols.hap_decoder_width(handle),
      height: lib.symbols.hap_decoder_height(handle),
      frameCount: lib.symbols.hap_decoder_frame_count(handle),
      frameRate: lib.symbols.hap_decoder_frame_rate(handle),
      durationSeconds: lib.symbols.hap_decoder_duration_seconds(handle),
      decodedByteLength: lib.symbols.hap_decoder_decoded_byte_length(handle),
      chunkCount: lib.symbols.hap_decoder_chunk_count(handle),
      compressor: lib.symbols.hap_decoder_compressor(handle) === 1 ? "snappy" : "none",
    };
  }

  static open(path: string, options: NativeHapDecoderOptions = {}): NativeHapDecoder {
    const lib = openLibrary(options.libPath);
    const pathBytes = textEncoder.encode(path);
    const workerCount = Math.max(0, Math.floor(options.workerCount ?? 0));
    const handle = lib.symbols.hap_decoder_open(pathBytes, pathBytes.byteLength, workerCount);
    if (!handle) {
      const error = readLastError(lib);
      lib.close();
      throw new Error(error || `Failed to open happack: ${path}`);
    }
    return new NativeHapDecoder(path, lib, handle);
  }

  get closed(): boolean {
    return this.#closed;
  }

  decodeFrame(frameIndex: number, output: Uint8Array<ArrayBuffer>): NativeHapDecoderStats {
    if (this.#closed) {
      throw new Error("NativeHapDecoder is closed");
    }
    if (output.byteLength < this.info.decodedByteLength) {
      throw new Error(
        `Output buffer too small: got ${output.byteLength}, need ${this.info.decodedByteLength}`,
      );
    }

    const frame = clampInt(frameIndex, 0, Math.max(0, this.info.frameCount - 1));
    const result = this.#lib.symbols.hap_decoder_decode_frame(
      this.#handle,
      frame,
      output,
      output.byteLength,
      this.#statsBuffer,
      this.#statsBuffer.byteLength,
    );
    if (result !== 0) {
      throw new Error(readLastError(this.#lib) || `hap_decoder_decode_frame failed: ${result}`);
    }
    return readStats(this.#statsBuffer);
  }

  close(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    try {
      this.#lib.symbols.hap_decoder_close(this.#handle);
    } finally {
      this.#lib.close();
      this.#handle = null;
    }
  }
}

function defaultLibUrl(): URL {
  const base = new URL("../native/hap_decoder/target/release/", import.meta.url);
  const os = Deno.build.os;
  const candidates = os === "windows"
    ? ["hap_decoder.dll", "libhap_decoder.dll"]
    : os === "darwin"
    ? ["libhap_decoder.dylib"]
    : ["libhap_decoder.so"];

  for (const name of candidates) {
    const url = new URL(name, base);
    try {
      const test = Deno.dlopen(url, HAP_DECODER_FFI_SYMBOLS);
      test.close();
      return url;
    } catch {
      // Try the next platform spelling.
    }
  }

  throw new Error(
    `Could not find native hap_decoder library in ${base.toString()} (tried ${
      candidates.join(", ")
    })`,
  );
}

function readLastError(lib: HapDecoderLibrary): string {
  const buffer = new Uint8Array(8192);
  const written = lib.symbols.hap_decoder_last_error(buffer, buffer.byteLength);
  if (written === 0) {
    return "";
  }
  return textDecoder.decode(buffer.subarray(0, Math.min(written, buffer.byteLength)));
}

function readStats(buffer: Uint8Array): NativeHapDecoderStats {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  return {
    readMs: view.getFloat64(0, true),
    decodeMs: view.getFloat64(8, true),
    totalMs: view.getFloat64(16, true),
    compressedBytes: view.getFloat64(24, true),
    decodedBytes: view.getFloat64(32, true),
    chunkCount: view.getUint32(40, true),
    workerCount: view.getUint32(44, true),
    frameIndex: view.getUint32(48, true),
  };
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}
