/// <reference lib="dom" />

import {
  encodeString,
  FFI_SYMBOLS,
  openLibrary,
  type SyphonLibrary,
} from "./ffi.ts";
import {
  type BeforeSurfaceCreateInfo,
  createGpuWindow,
  type GpuWindow,
  type WindowOptions,
} from "../window/window.ts";

export interface SyphonOptions {
  serverName?: string;
  flipY?: boolean;
  frameworkPath?: string;
  libPath?: string;
}

export class SyphonServer {
  #state: Deno.PointerValue;
  #lib: SyphonLibrary;
  #closed = false;

  constructor(nsViewPtr: bigint | number, options: SyphonOptions = {}) {
    const ptrValue = typeof nsViewPtr === "number"
      ? BigInt(nsViewPtr)
      : nsViewPtr;
    if (ptrValue === 0n) {
      throw new Error("SyphonServer requires a valid NSView pointer.");
    }

    this.#lib = openLibrary(options.libPath);

    const name = encodeString(options.serverName ?? "Deno Syphon");
    const frameworkPath = options.frameworkPath
      ? encodeString(options.frameworkPath)
      : null;

    this.#state = this.#lib.symbols.syphon_init(
      ptrValue,
      name.ptr,
      name.len,
      frameworkPath?.ptr ?? null,
      frameworkPath?.len ?? 0,
    );

    if (!this.#state) {
      this.#lib.close();
      throw new Error("Failed to initialize syphon bridge.");
    }

    if (options.flipY !== undefined) {
      this.#lib.symbols.syphon_set_flipped(
        this.#state,
        options.flipY ? 1 : 0,
      );
    }
  }

  destroy() {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    if (this.#state) {
      this.#lib.symbols.syphon_destroy(this.#state);
      this.#state = null;
    }
    this.#lib.close();
  }

  [Symbol.dispose]() {
    this.destroy();
  }

  publishFrame(): bigint {
    if (!this.#state) {
      return 0n;
    }
    return this.#lib.symbols.syphon_latch_and_publish(this.#state);
  }

  get hasClients(): boolean {
    if (!this.#state) {
      return false;
    }
    return this.#lib.symbols.syphon_has_clients(this.#state) !== 0;
  }

  get serverReady(): boolean {
    if (!this.#state) {
      return false;
    }
    return this.#lib.symbols.syphon_is_server_ready(this.#state) !== 0;
  }

  get interceptCount(): bigint {
    if (!this.#state) {
      return 0n;
    }
    return this.#lib.symbols.syphon_get_intercept_count(this.#state);
  }

  get lastTextureSize(): { width: number; height: number } {
    if (!this.#state) {
      return { width: 0, height: 0 };
    }
    const size = new Uint32Array(2);
    this.#lib.symbols.syphon_get_last_texture_size(
      this.#state,
      Deno.UnsafePointer.of(size.subarray(0, 1)),
      Deno.UnsafePointer.of(size.subarray(1, 2)),
    );
    return { width: size[0], height: size[1] };
  }

  get name(): string {
    if (!this.#state) {
      return "";
    }
    const required = this.#lib.symbols.syphon_get_server_name(
      this.#state,
      null,
      0,
    );
    if (required === 0) {
      return "";
    }
    const out = new Uint8Array(required);
    const written = this.#lib.symbols.syphon_get_server_name(
      this.#state,
      Deno.UnsafePointer.of(out),
      out.length,
    );
    return new TextDecoder().decode(out.subarray(0, written));
  }

  set name(value: string) {
    if (!this.#state) {
      return;
    }
    const name = encodeString(value);
    this.#lib.symbols.syphon_set_name(this.#state, name.ptr, name.len);
  }
}

export interface SyphonWindowOptions extends WindowOptions {
  syphon?: SyphonOptions;
}

export async function createSyphonGpuWindow(
  device: GPUDevice,
  options: SyphonWindowOptions,
): Promise<GpuWindow & { syphon: SyphonServer }> {
  let syphon: SyphonServer | null = null;
  const userHook = options.beforeSurfaceCreate;

  const windowOptions: WindowOptions = {
    ...options,
    beforeSurfaceCreate: async (info: BeforeSurfaceCreateInfo) => {
      await userHook?.(info);
      if (info.system !== "cocoa") {
        throw new Error("Syphon is only available on macOS cocoa windows.");
      }
      syphon = new SyphonServer(info.surfaceDisplayHandle, options.syphon);
    },
  };

  const window = await createGpuWindow(device, windowOptions);
  if (!syphon) {
    window.close();
    throw new Error("Failed to initialize Syphon server.");
  }

  const originalClose = window.close.bind(window);
  window.close = () => {
    syphon?.destroy();
    syphon = null;
    originalClose();
  };

  return Object.assign(window, { syphon });
}

export const SYPHON_FFI_SYMBOLS = FFI_SYMBOLS;
