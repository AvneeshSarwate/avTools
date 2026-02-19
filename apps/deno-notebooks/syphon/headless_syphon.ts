import { encodeString, openLibrary, type SyphonLibrary } from "./ffi.ts";

export interface HeadlessSyphonOptions {
  serverName?: string;
  flipY?: boolean;
  frameworkPath?: string;
  libPath?: string;
}

export class HeadlessSyphonServer {
  #state: Deno.PointerValue;
  #lib: SyphonLibrary;
  #closed = false;

  constructor(options: HeadlessSyphonOptions = {}) {
    this.#lib = openLibrary(options.libPath);

    const name = encodeString(options.serverName ?? "Deno Syphon Headless");
    const frameworkPath = options.frameworkPath
      ? encodeString(options.frameworkPath)
      : null;

    this.#state = this.#lib.symbols.syphon_headless_init(
      name.ptr,
      name.len,
      frameworkPath?.ptr ?? null,
      frameworkPath?.len ?? 0,
    );

    if (!this.#state) {
      this.#lib.close();
      throw new Error("Failed to initialize headless syphon bridge.");
    }

    if (options.flipY !== undefined) {
      this.#lib.symbols.syphon_headless_set_flipped(
        this.#state,
        options.flipY ? 1 : 0,
      );
    }
  }

  publishFrame(
    pixelData: Uint8Array,
    width: number,
    height: number,
    bytesPerRow: number,
  ): bigint {
    if (!this.#state || pixelData.byteLength === 0) {
      return 0n;
    }
    const pixelDataPtr = Deno.UnsafePointer.of(
      pixelData as unknown as Uint8Array<ArrayBuffer>,
    );
    if (!pixelDataPtr) {
      return 0n;
    }
    return this.#lib.symbols.syphon_headless_publish_frame(
      this.#state,
      pixelDataPtr,
      width,
      height,
      bytesPerRow,
      0, // pixel_format: 0 = BGRA8
    );
  }

  get hasClients(): boolean {
    if (!this.#state) {
      return false;
    }
    return this.#lib.symbols.syphon_headless_has_clients(this.#state) !== 0;
  }

  get publishedCount(): bigint {
    if (!this.#state) {
      return 0n;
    }
    return this.#lib.symbols.syphon_headless_get_published_count(this.#state);
  }

  set name(value: string) {
    if (!this.#state) {
      return;
    }
    const name = encodeString(value);
    this.#lib.symbols.syphon_headless_set_name(
      this.#state,
      name.ptr,
      name.len,
    );
  }

  destroy() {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    if (this.#state) {
      this.#lib.symbols.syphon_headless_destroy(this.#state);
      this.#state = null;
    }
    this.#lib.close();
  }

  [Symbol.dispose]() {
    this.destroy();
  }
}
