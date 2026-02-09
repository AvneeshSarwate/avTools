import { FFI_SYMBOLS } from "../syphon/ffi.ts";

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    Deno.exit(1);
  }
}

function dylibPath(): URL {
  const base = new URL(
    "../native/syphon_bridge/target/release/",
    import.meta.url,
  );
  if (Deno.build.os === "darwin") {
    return new URL("libsyphon_bridge.dylib", base);
  }
  if (Deno.build.os === "windows") {
    return new URL("syphon_bridge.dll", base);
  }
  return new URL("libsyphon_bridge.so", base);
}

const lib = Deno.dlopen(dylibPath(), FFI_SYMBOLS);
console.log("OK: dylib loaded and symbols resolved");

const hasClients = lib.symbols.syphon_has_clients(null);
assert(hasClients === 0, "syphon_has_clients(null) should return 0");

const ready = lib.symbols.syphon_is_server_ready(null);
assert(ready === 0, "syphon_is_server_ready(null) should return 0");

const intercepts = lib.symbols.syphon_get_intercept_count(null);
assert(intercepts === 0n, "syphon_get_intercept_count(null) should return 0");

const size = new Uint32Array(2);
lib.symbols.syphon_get_last_texture_size(
  null,
  Deno.UnsafePointer.of(size.subarray(0, 1)),
  Deno.UnsafePointer.of(size.subarray(1, 2)),
);
assert(
  size[0] === 0 && size[1] === 0,
  "null size query should leave outputs at 0",
);

const nameSize = lib.symbols.syphon_get_server_name(null, null, 0);
assert(nameSize === 0, "syphon_get_server_name(null) should return 0");

lib.close();
console.log("ALL SMOKE TESTS PASSED");
