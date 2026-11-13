import { resolveNativeLib } from "../bundle_paths.ts";

export const FFI_SYMBOLS = {
  syphon_init: {
    parameters: ["usize", "pointer", "u32", "pointer", "u32"],
    result: "pointer",
  },
  syphon_destroy: {
    parameters: ["pointer"],
    result: "void",
  },
  syphon_latch_and_publish: {
    parameters: ["pointer"],
    result: "u64",
  },
  syphon_has_clients: {
    parameters: ["pointer"],
    result: "u32",
  },
  syphon_set_name: {
    parameters: ["pointer", "pointer", "u32"],
    result: "void",
  },
  syphon_set_flipped: {
    parameters: ["pointer", "u32"],
    result: "void",
  },
  syphon_set_publish_region: {
    parameters: ["pointer", "u32", "u32"],
    result: "void",
  },
  syphon_headless_init: {
    parameters: ["pointer", "u32", "pointer", "u32"],
    result: "pointer",
  },
  syphon_headless_destroy: {
    parameters: ["pointer"],
    result: "void",
  },
  syphon_headless_publish_frame: {
    parameters: ["pointer", "pointer", "u32", "u32", "u32", "u32"],
    result: "u64",
  },
  syphon_headless_has_clients: {
    parameters: ["pointer"],
    result: "u32",
  },
  syphon_headless_set_name: {
    parameters: ["pointer", "pointer", "u32"],
    result: "void",
  },
  syphon_headless_set_flipped: {
    parameters: ["pointer", "u32"],
    result: "void",
  },
  syphon_headless_get_published_count: {
    parameters: ["pointer"],
    result: "u64",
  },
  syphon_get_intercept_count: {
    parameters: ["pointer"],
    result: "u64",
  },
  syphon_is_server_ready: {
    parameters: ["pointer"],
    result: "u32",
  },
  syphon_get_last_texture_size: {
    parameters: ["pointer", "pointer", "pointer"],
    result: "void",
  },
  syphon_get_server_name: {
    parameters: ["pointer", "pointer", "u32"],
    result: "u32",
  },
  syphon_list_servers: {
    parameters: ["pointer", "u32"],
    result: "u32",
  },
  syphon_client_create: {
    parameters: ["pointer", "u32", "pointer", "u32"],
    result: "pointer",
  },
  syphon_client_has_new_frame: {
    parameters: ["pointer"],
    result: "u32",
  },
  syphon_client_get_frame_size: {
    parameters: ["pointer", "pointer", "pointer"],
    result: "u32",
  },
  syphon_client_destroy: {
    parameters: ["pointer"],
    result: "void",
  },
} as const;

export type SyphonSymbols = typeof FFI_SYMBOLS;
export type SyphonLibrary = Deno.DynamicLibrary<SyphonSymbols>;

const textEncoder = new TextEncoder();

function defaultLibUrl(): URL {
  const base = new URL(
    "../native/syphon_bridge/target/release/",
    import.meta.url,
  );
  const os = Deno.build.os;
  const candidates = os === "windows"
    ? ["syphon_bridge.dll", "libsyphon_bridge.dll"]
    : os === "darwin"
    ? ["libsyphon_bridge.dylib"]
    : ["libsyphon_bridge.so"];

  for (const name of candidates) {
    const url = resolveNativeLib(base, name);
    try {
      const test = Deno.dlopen(url, FFI_SYMBOLS);
      test.close();
      return url;
    } catch {
      // Try next candidate.
    }
  }

  throw new Error(
    `Could not find native syphon_bridge library in ${base.toString()} (tried ${
      candidates.join(", ")
    })`,
  );
}

export function openLibrary(libPath?: string): SyphonLibrary {
  const path = libPath ? libPath : defaultLibUrl();
  return Deno.dlopen(path, FFI_SYMBOLS);
}

export interface EncodedString {
  bytes: Uint8Array;
  ptr: Deno.PointerValue;
  len: number;
}

export function encodeString(value: string): EncodedString {
  const bytes = textEncoder.encode(value);
  return {
    bytes,
    ptr: bytes.length ? Deno.UnsafePointer.of(bytes) : null,
    len: bytes.length,
  };
}
