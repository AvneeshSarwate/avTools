export const FFI_SYMBOLS = {
  create_window: { parameters: ["u32", "u32", "pointer", "u32"], result: "pointer" },
  get_raw_window_handle: { parameters: ["pointer"], result: "usize" },
  get_raw_display_handle: { parameters: ["pointer"], result: "usize" },
  get_window_system: { parameters: ["pointer"], result: "u32" },
  poll_events: { parameters: ["pointer", "pointer", "u32"], result: "u32" },
  resize_window: { parameters: ["pointer", "u32", "u32"], result: "void" },
  get_window_size: { parameters: ["pointer", "pointer", "pointer"], result: "void" },
  destroy_window: { parameters: ["pointer"], result: "void" },
} as const;

export type WindowSymbols = typeof FFI_SYMBOLS;
export type WindowLibrary = Deno.DynamicLibrary<WindowSymbols>;

const textEncoder = new TextEncoder();

function defaultLibUrl(): URL {
  const base = new URL("../native/deno_window/target/release/", import.meta.url);
  const os = Deno.build.os;
  const candidates =
    os === "windows"
      ? ["deno_window.dll", "libdeno_window.dll"]
      : os === "darwin"
      ? ["libdeno_window.dylib"]
      : ["libdeno_window.so"];

  for (const name of candidates) {
    const u = new URL(name, base);
    try {
      const t = Deno.dlopen(u, FFI_SYMBOLS);
      t.close();
      return u;
    } catch {
      // try next
    }
  }

  throw new Error(
    `Could not find native deno_window library in ${base.toString()} (tried ${candidates.join(", ")})`,
  );
}

export function openLibrary(libPath?: string): WindowLibrary {
  const path = libPath ? libPath : defaultLibUrl();
  return Deno.dlopen(path, FFI_SYMBOLS);
}

export function encodeTitle(title: string): { ptr: Deno.PointerValue; len: number } {
  const bytes = textEncoder.encode(title);
  const ptr = Deno.UnsafePointer.of(bytes);
  return { ptr, len: bytes.length };
}
