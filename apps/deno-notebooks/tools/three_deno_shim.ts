/// <reference lib="dom" />

/**
 * Shim to run Three.js WebGPU renderer on Deno -- headless or windowed.
 *
 * Headless usage (render to texture, readback to PNG):
 *   import { createDenoThreeRenderer } from "@/tools/three_deno_shim.ts";
 *   const { renderer, THREE, outputTexture } = await createDenoThreeRenderer(device, width, height);
 *   renderer.render(scene, camera);
 *   // outputTexture is a GPUTexture you can read back with writeTextureToPng()
 *
 * Windowed usage:
 *   const { renderer, THREE } = await createDenoThreeRenderer(device, width, height, win.ctx);
 *
 * Also runs inside the TouchDesigner embedded V8 plugin (headless only), which
 * has no `navigator`, `self` or `TextDecoder`. Pass `host.device` and draw the
 * result with `p.image({ texture: outputTexture }, 0, 0, p.width, p.height)`.
 * The headless output texture has TEXTURE_BINDING for that purpose.
 */

// Static imports: the TD bundler rejects dynamic import(). Both resolve to the
// same three.core.js, so there is one copy of every class.
import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ThreeNamespace = typeof THREE;
type WebGPURendererType = WebGPURenderer;
type ThreeShimGlobal = Record<string, unknown>;

interface CanvasConfigureOptions {
  device: GPUDevice;
  format: GPUTextureFormat;
  usage?: number;
  alphaMode?: GPUCanvasAlphaMode | "opaque" | "premultiplied";
  toneMapping?: { mode: string };
}

export interface DenoThreeContext {
  renderer: WebGPURendererType;
  THREE: ThreeNamespace;
  canvas: DenoCanvasShim;
  /** The GPUTexture that Three.js renders into (headless mode). Read it back
   *  after calling renderer.render(). In windowed mode this is the swap-chain
   *  texture and rotates each frame, so prefer surface.present() instead. */
  outputTexture: GPUTexture;
}

// ---------------------------------------------------------------------------
// UTF-8 TextDecoder (installed only where the runtime lacks one)
// ---------------------------------------------------------------------------

/**
 * WHATWG UTF-8 decoder, used by GLTFLoader (.glb JSON chunk) and FileLoader.
 * Invalid sequences become U+FFFD exactly as the Encoding standard specifies
 * (or throw with `fatal`). Only UTF-8 is supported; `stream` is not.
 */
class Utf8TextDecoder {
  readonly encoding = "utf-8";
  readonly fatal: boolean;
  readonly ignoreBOM: boolean;

  constructor(label = "utf-8", options: { fatal?: boolean; ignoreBOM?: boolean } = {}) {
    const name = String(label).trim().toLowerCase();
    if (!["utf-8", "utf8", "unicode-1-1-utf-8", "unicode11utf8", "unicode20utf8", "x-unicode20utf8"].includes(name)) {
      throw new RangeError(`TextDecoder: only UTF-8 is supported, got "${label}"`);
    }
    this.fatal = !!options.fatal;
    this.ignoreBOM = !!options.ignoreBOM;
  }

  decode(input?: ArrayBuffer | ArrayBufferView, options?: { stream?: boolean }): string {
    if (options?.stream) throw new TypeError("TextDecoder: streaming is not supported");
    if (input === undefined) return "";
    const bytes = input instanceof ArrayBuffer
      ? new Uint8Array(input)
      : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    const units: number[] = [];
    let out = "";
    const flush = () => {
      out += String.fromCharCode.apply(null, units);
      units.length = 0;
    };
    const bad = () => {
      if (this.fatal) throw new TypeError("TextDecoder: invalid UTF-8 data");
      units.push(0xfffd);
    };
    let i = 0;
    if (!this.ignoreBOM && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
    while (i < bytes.length) {
      const b = bytes[i++];
      if (b < 0x80) {
        units.push(b);
      } else {
        let need: number, cp: number, lower = 0x80, upper = 0xbf;
        if (b >= 0xc2 && b <= 0xdf) { need = 1; cp = b & 0x1f; }
        else if (b >= 0xe0 && b <= 0xef) {
          need = 2; cp = b & 0xf;
          if (b === 0xe0) lower = 0xa0;
          if (b === 0xed) upper = 0x9f;
        } else if (b >= 0xf0 && b <= 0xf4) {
          need = 3; cp = b & 0x7;
          if (b === 0xf0) lower = 0x90;
          if (b === 0xf4) upper = 0x8f;
        } else { bad(); continue; }
        let ok = true;
        for (let k = 0; k < need; k++) {
          const c = bytes[i];
          // Out-of-range continuation: emit U+FFFD and reprocess this byte.
          if (i >= bytes.length || c < lower || c > upper) { ok = false; break; }
          lower = 0x80; upper = 0xbf;
          cp = (cp << 6) | (c & 0x3f);
          i++;
        }
        if (!ok) { bad(); }
        else if (cp > 0xffff) {
          cp -= 0x10000;
          units.push(0xd800 | (cp >> 10), 0xdc00 | (cp & 0x3ff));
        } else units.push(cp);
      }
      if (units.length >= 0x4000) flush(); // stay under V8's argument limit
    }
    flush();
    return out;
  }
}

// ---------------------------------------------------------------------------
// Global polyfills -- installed on first import
// ---------------------------------------------------------------------------

const g = globalThis as ThreeShimGlobal;

if (typeof g.requestAnimationFrame === "undefined") {
  g.requestAnimationFrame = (cb: (time: number) => void): number =>
    setTimeout(() => cb(performance.now()), 1000 / 60) as unknown as number;
}

if (typeof g.cancelAnimationFrame === "undefined") {
  g.cancelAnimationFrame = (id: number): void => {
    clearTimeout(id);
  };
}

// three's animation loop calls self.requestAnimationFrame (renderer.init()).
if (typeof g.self === "undefined") {
  g.self = globalThis;
}

if (typeof g.TextDecoder === "undefined") {
  g.TextDecoder = Utf8TextDecoder;
}

if (typeof g.document === "undefined") {
  g.document = {
    createElementNS(_ns: string, tag: string) {
      throw new Error(
        `Unexpected DOM element creation: ${tag} -- pass canvas to WebGPURenderer`,
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Headless GPUCanvasContext mock
// ---------------------------------------------------------------------------

/**
 * A minimal mock that satisfies Three.js's GPUCanvasContext expectations
 * without an actual window surface. getCurrentTexture() returns a real
 * GPUTexture that the renderer can draw into and that you can read back.
 */
class HeadlessGPUContext {
  private _device: GPUDevice | null = null;
  private _format: GPUTextureFormat = "bgra8unorm";
  private _texture: GPUTexture | null = null;
  private _width: number;
  private _height: number;

  constructor(width: number, height: number) {
    this._width = width;
    this._height = height;
  }

  configure(config: {
    device: GPUDevice;
    format: GPUTextureFormat;
    usage?: number;
    alphaMode?: string;
    toneMapping?: { mode: string };
  }): void {
    this._device = config.device;
    this._format = config.format;
    // (re)create the backing texture
    this._texture?.destroy();
    this._texture = this._device.createTexture({
      size: { width: this._width, height: this._height },
      format: this._format,
      // TEXTURE_BINDING lets the result be sampled, e.g. by p.image() in TD.
      usage:
        (config.usage ?? GPUTextureUsage.RENDER_ATTACHMENT) |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.TEXTURE_BINDING,
    });
  }

  unconfigure(): void {
    this._texture?.destroy();
    this._texture = null;
  }

  getCurrentTexture(): GPUTexture {
    if (!this._texture) {
      throw new Error("HeadlessGPUContext: not configured");
    }
    return this._texture;
  }
}

// ---------------------------------------------------------------------------
// Windowed GPUCanvasContext wrapper
// ---------------------------------------------------------------------------

/**
 * Wraps a real Deno GPUCanvasContext so that Three.js's configure() call
 * doesn't break things. Strips options Deno doesn't support (toneMapping)
 * and keeps usage flags compatible with the surface.
 */
class WindowedContextWrapper {
  private _real: GPUCanvasContext;

  constructor(real: GPUCanvasContext) {
    this._real = real;
  }

  configure(config: CanvasConfigureOptions): void {
    // Strip options Deno's surface doesn't support
    const alphaMode = config.alphaMode === "premultiplied"
      ? "opaque"
      : (config.alphaMode ?? "opaque");
    const cleaned: GPUCanvasConfiguration = {
      device: config.device,
      format: config.format,
      // Deno surfaces only support RENDER_ATTACHMENT, not COPY_SRC
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
      alphaMode,
      // toneMapping is intentionally omitted -- Deno doesn't support it
    };
    this._real.configure(cleaned);
  }

  unconfigure(): void {
    this._real.unconfigure();
  }

  getCurrentTexture(): GPUTexture {
    return this._real.getCurrentTexture();
  }
}

// ---------------------------------------------------------------------------
// Canvas shim
// ---------------------------------------------------------------------------

type ContextLike = GPUCanvasContext | HeadlessGPUContext | WindowedContextWrapper;

export class DenoCanvasShim {
  width: number;
  height: number;
  style: { width: string; height: string };

  private _context: ContextLike;

  constructor(width: number, height: number, context: ContextLike) {
    this.width = width;
    this.height = height;
    this._context = context;
    this.style = { width: `${width}px`, height: `${height}px` };
  }

  getContext(type: string): ContextLike {
    if (type === "webgpu") {
      return this._context;
    }
    throw new Error(`Unsupported context type: ${type}`);
  }

  setAttribute(_name: string, _value: string): void {}
  addEventListener(_event: string, _handler: (...args: unknown[]) => void): void {}
  removeEventListener(_event: string, _handler: (...args: unknown[]) => void): void {}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a Three.js WebGPU renderer on Deno.
 *
 * @param device   - A pre-created GPUDevice
 * @param width    - Render width in pixels
 * @param height   - Render height in pixels
 * @param gpuCanvasContext - Pass a real GPUCanvasContext for windowed mode,
 *                          or omit / pass undefined for headless mode.
 */
export async function createDenoThreeRenderer(
  device: GPUDevice,
  width: number,
  height: number,
  gpuCanvasContext?: GPUCanvasContext,
): Promise<DenoThreeContext> {
  const ctx: ContextLike = gpuCanvasContext
    ? new WindowedContextWrapper(gpuCanvasContext)
    : new HeadlessGPUContext(width, height);
  const canvas = new DenoCanvasShim(width, height, ctx);

  // Without navigator.gpu (TD embedded V8), three cannot ask for the preferred
  // canvas format, so request 8-bit output explicitly (bgra8unorm).
  const hasNavigatorGpu = typeof navigator !== "undefined" &&
    typeof (navigator as { gpu?: GPU }).gpu?.getPreferredCanvasFormat === "function";

  const renderer = new WebGPURenderer({
    canvas: canvas as unknown as HTMLCanvasElement,
    device: device,
    antialias: false,
    alpha: false,
    ...(hasNavigatorGpu ? {} : { outputType: THREE.UnsignedByteType }),
  });

  await renderer.init();
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);

  // In windowed mode, init + setSize may have acquired a surface texture.
  // We need to present() it before the render loop can start clean.
  // In headless mode this is harmless (getCurrentTexture returns the same
  // backing texture every time).
  const outputTexture = ctx.getCurrentTexture();

  return { renderer, THREE, canvas, outputTexture };
}
