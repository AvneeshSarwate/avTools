import { FFI_SYMBOLS } from "../syphon/ffi.ts";

interface ServerInfo {
  name: string;
  appName: string;
  uuid: string;
}

const SERVER_NAME = "Deno Syphon Test";
const EXPECTED_WIDTH = 256;
const EXPECTED_HEIGHT = 256;

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

function encodeString(
  value: string,
): { bytes: Uint8Array; ptr: Deno.PointerValue; len: number } {
  const bytes = new TextEncoder().encode(value);
  return {
    bytes,
    ptr: bytes.length ? Deno.UnsafePointer.of(bytes) : null,
    len: bytes.length,
  };
}

function parseServerList(
  lib: Deno.DynamicLibrary<typeof FFI_SYMBOLS>,
): ServerInfo[] {
  const needed = lib.symbols.syphon_list_servers(null, 0);
  if (needed === 0) {
    return [];
  }
  const buf = new Uint8Array(needed);
  const written = lib.symbols.syphon_list_servers(
    Deno.UnsafePointer.of(buf),
    buf.length,
  );
  if (written > buf.length) {
    return [];
  }
  const json = new TextDecoder().decode(buf.subarray(0, written));
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed as ServerInfo[] : [];
  } catch {
    return [];
  }
}

const lib = Deno.dlopen(dylibPath(), FFI_SYMBOLS);

let clientState: Deno.PointerValue = null;

try {
  let selectedServer: ServerInfo | null = null;
  const discoverDeadline = Date.now() + 8000;
  while (Date.now() < discoverDeadline) {
    const servers = parseServerList(lib);
    selectedServer = servers.find((s) => s.name === SERVER_NAME) ?? null;
    if (selectedServer) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  assert(
    !!selectedServer,
    `Could not find Syphon server named '${SERVER_NAME}'.`,
  );
  assert(!!selectedServer.uuid, "Discovered server is missing UUID.");

  const uuid = encodeString(selectedServer.uuid);
  clientState = lib.symbols.syphon_client_create(uuid.ptr, uuid.len, null, 0);
  assert(!!clientState, "syphon_client_create failed.");

  const pollDeadline = Date.now() + 5000;
  let gotFrame = false;
  let frameSize: [number, number] = [0, 0];
  while (Date.now() < pollDeadline) {
    const hasNew = lib.symbols.syphon_client_has_new_frame(clientState);
    if (hasNew !== 0) {
      const dims = new Uint32Array(2);
      const ok = lib.symbols.syphon_client_get_frame_size(
        clientState,
        Deno.UnsafePointer.of(dims.subarray(0, 1)),
        Deno.UnsafePointer.of(dims.subarray(1, 2)),
      );
      if (ok !== 0) {
        gotFrame = true;
        frameSize = [dims[0], dims[1]];
        break;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  assert(gotFrame, "No Syphon frame received within timeout.");
  assert(
    frameSize[0] > 0 && frameSize[1] > 0,
    `Invalid frame size ${frameSize[0]}x${frameSize[1]}`,
  );
  if (frameSize[0] !== EXPECTED_WIDTH || frameSize[1] !== EXPECTED_HEIGHT) {
    console.warn(
      `WARN: expected ${EXPECTED_WIDTH}x${EXPECTED_HEIGHT}, got ${
        frameSize[0]
      }x${frameSize[1]} (Retina scaling may apply).`,
    );
  }

  console.log("Syphon client process validation passed");
} finally {
  if (clientState) {
    lib.symbols.syphon_client_destroy(clientState);
    clientState = null;
  }
  lib.close();
}
