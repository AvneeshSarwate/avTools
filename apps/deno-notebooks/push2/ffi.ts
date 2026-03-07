const FFI_SYMBOLS = {
  push2_display_open: { parameters: [], result: "pointer" },
  push2_display_close: { parameters: ["pointer"], result: "void" },
  push2_display_send_rgba_frame: {
    parameters: ["pointer", "buffer", "u32", "u32"],
    result: "i32",
  },
  push2_display_is_connected: { parameters: ["pointer"], result: "u32" },
} as const;

export type Push2DisplayLibrary = Deno.DynamicLibrary<typeof FFI_SYMBOLS>;

function defaultLibUrl(): URL {
  const base = new URL(
    "../native/push2_display/target/release/",
    import.meta.url,
  );
  const os = Deno.build.os;
  const candidates =
    os === "windows"
      ? ["push2_display.dll", "libpush2_display.dll"]
      : os === "darwin"
        ? ["libpush2_display.dylib"]
        : ["libpush2_display.so"];

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
    `Could not find libpush2_display in ${base.toString()} (tried ${candidates.join(", ")})`,
  );
}

export function openLibrary(libPath?: string): Push2DisplayLibrary {
  const path = libPath ? libPath : defaultLibUrl();
  return Deno.dlopen(path, FFI_SYMBOLS);
}
