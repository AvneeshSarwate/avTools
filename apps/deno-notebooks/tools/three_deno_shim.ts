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
 */

// deno-lint-ignore-file no-explicit-any

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ThreeNamespace = typeof import("npm:three");
type WebGPURendererType = import("npm:three/webgpu").WebGPURenderer;

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
// Global polyfills -- installed on first import
// ---------------------------------------------------------------------------

const g = globalThis as any;

if (typeof g.requestAnimationFrame === "undefined") {
  g.requestAnimationFrame = (cb: (time: number) => void): number =>
    setTimeout(() => cb(performance.now()), 1000 / 60) as unknown as number;
}

if (typeof g.cancelAnimationFrame === "undefined") {
  g.cancelAnimationFrame = (id: number): void => {
    clearTimeout(id);
  };
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
      usage:
        (config.usage ?? GPUTextureUsage.RENDER_ATTACHMENT) |
        GPUTextureUsage.COPY_SRC,
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

  configure(config: Record<string, any>): void {
    // Strip options Deno's surface doesn't support
    const cleaned: Record<string, any> = {
      device: config.device,
      format: config.format,
      // Deno surfaces only support RENDER_ATTACHMENT, not COPY_SRC
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
      alphaMode: config.alphaMode === "premultiplied" ? "opaque" : (config.alphaMode ?? "opaque"),
      // toneMapping is intentionally omitted -- Deno doesn't support it
    };
    this._real.configure(cleaned as GPUCanvasConfiguration);
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
  addEventListener(_event: string, _handler: (...args: any[]) => void): void {}
  removeEventListener(_event: string, _handler: (...args: any[]) => void): void {}
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

  const THREE = await import("npm:three") as ThreeNamespace;
  const { WebGPURenderer } = await import("npm:three/webgpu");

  const renderer = new WebGPURenderer({
    canvas: canvas as any,
    device: device,
    antialias: false,
    alpha: false,
  });

  await renderer.init();
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);

  // In windowed mode, init + setSize may have acquired a surface texture.
  // We need to present() it before the render loop can start clean.
  // In headless mode this is harmless (getCurrentTexture returns the same
  // backing texture every time).
  const outputTexture = (ctx as any).getCurrentTexture() as GPUTexture;

  return { renderer, THREE, canvas, outputTexture };
}
