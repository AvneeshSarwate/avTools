/// <reference lib="dom" />

/**
 * Shim to run Babylon.js (WebGPUEngine) on Deno -- headless or windowed.
 *
 * Babylon's WebGPUEngine creates its own GPU adapter/device via
 * navigator.gpu.requestAdapter(). To make it use a pre-created Deno
 * GPUDevice (so we can share the device with our Deno window/surface),
 * we install a navigator.gpu shim BEFORE constructing the engine.
 *
 * Usage (windowed):
 *   const device = await requestWebGpuDevice();
 *   const win = await createGpuWindow(device, { width, height, title });
 *   const { BABYLON, engine, canvas } = await createDenoBabylonEngine(
 *     device, win.width, win.height, win.ctx, win.format,
 *   );
 *   // build scene with BABYLON, then in render loop:
 *   //   engine.beginFrame(); scene.render(); engine.endFrame();
 *   //   win.present();
 *
 * Usage (headless): omit win.ctx -- engine renders into an offscreen
 * texture you can read back with snapshot helpers.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BabylonNamespace = typeof import("@babylonjs/core");
type WebGPUEngineType = import("@babylonjs/core").WebGPUEngine;
type ShimGlobal = Record<string, unknown>;

export interface DenoBabylonContext {
  BABYLON: BabylonNamespace;
  engine: WebGPUEngineType;
  canvas: BabylonCanvasShim;
  /** Headless mode only: the GPUTexture Babylon renders into. */
  outputTexture?: GPUTexture;
}

// ---------------------------------------------------------------------------
// Event target shim -- Babylon adds focus/blur/contextmenu listeners
// ---------------------------------------------------------------------------

class SimpleEventTarget {
  private _listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  addEventListener(event: string, handler: (...args: unknown[]) => void): void {
    let set = this._listeners.get(event);
    if (!set) {
      set = new Set();
      this._listeners.set(event, set);
    }
    set.add(handler);
  }

  removeEventListener(event: string, handler: (...args: unknown[]) => void): void {
    this._listeners.get(event)?.delete(handler);
  }

  dispatchEvent(event: { type: string }): boolean {
    const set = this._listeners.get(event.type);
    if (set) for (const h of set) h(event);
    return true;
  }
}

// ---------------------------------------------------------------------------
// Canvas shim
// ---------------------------------------------------------------------------

type ContextLike = HeadlessGPUContext | WindowedContextWrapper;

export class BabylonCanvasShim extends SimpleEventTarget {
  width: number;
  height: number;
  clientWidth: number;
  clientHeight: number;
  style: Record<string, string>;
  ownerDocument: null = null;
  // Used by Babylon's pointer-out logic; safe stub
  getBoundingClientRect = (): DOMRect => ({
    x: 0, y: 0, top: 0, left: 0, right: this.width, bottom: this.height,
    width: this.width, height: this.height, toJSON: () => ({}),
  } as unknown as DOMRect);

  private _context: ContextLike;

  constructor(width: number, height: number, context: ContextLike) {
    super();
    this.width = width;
    this.height = height;
    this.clientWidth = width;
    this.clientHeight = height;
    this._context = context;
    this.style = { width: `${width}px`, height: `${height}px`, touchAction: "none" };
  }

  setAttribute(_name: string, _value: string): void {}
  removeAttribute(_name: string): void {}
  focus(): void {}
  blur(): void {}

  getContext(type: string): ContextLike {
    if (type === "webgpu") return this._context;
    throw new Error(`BabylonCanvasShim: unsupported context type: ${type}`);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.clientWidth = width;
    this.clientHeight = height;
    this.style.width = `${width}px`;
    this.style.height = `${height}px`;
  }
}

// ---------------------------------------------------------------------------
// Headless GPUCanvasContext mock
// ---------------------------------------------------------------------------

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

  configure(config: GPUCanvasConfiguration): void {
    this._device = config.device;
    this._format = config.format;
    this._texture?.destroy();
    this._texture = this._device.createTexture({
      size: { width: this._width, height: this._height },
      format: this._format,
      usage: (config.usage ?? GPUTextureUsage.RENDER_ATTACHMENT) | GPUTextureUsage.COPY_SRC,
    });
  }

  unconfigure(): void {
    this._texture?.destroy();
    this._texture = null;
  }

  getCurrentTexture(): GPUTexture {
    if (!this._texture) throw new Error("HeadlessGPUContext: not configured");
    return this._texture;
  }

  resize(width: number, height: number): void {
    this._width = width;
    this._height = height;
    if (this._device) {
      this._texture?.destroy();
      this._texture = this._device.createTexture({
        size: { width: this._width, height: this._height },
        format: this._format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Windowed GPUCanvasContext wrapper
// ---------------------------------------------------------------------------

/**
 * Wraps a real Deno GPUCanvasContext so Babylon's configure() call doesn't
 * blow up. Strips usage flags Deno surfaces don't support (only
 * RENDER_ATTACHMENT works), and forces opaque alpha.
 */
class WindowedContextWrapper {
  private _real: GPUCanvasContext;

  constructor(real: GPUCanvasContext) {
    this._real = real;
  }

  configure(config: GPUCanvasConfiguration): void {
    this._real.configure({
      device: config.device,
      format: config.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
      alphaMode: "opaque",
    });
  }

  unconfigure(): void {
    this._real.unconfigure();
  }

  getCurrentTexture(): GPUTexture {
    return this._real.getCurrentTexture();
  }
}

// ---------------------------------------------------------------------------
// navigator.gpu shim -- hands Babylon our pre-created device
// ---------------------------------------------------------------------------

let _shimInstalled = false;

function installBabylonShims(device: GPUDevice, format: GPUTextureFormat): void {
  if (_shimInstalled) return;
  _shimInstalled = true;
  const g = globalThis as ShimGlobal;

  if (typeof g.requestAnimationFrame === "undefined") {
    g.requestAnimationFrame = (cb: (time: number) => void): number =>
      setTimeout(() => cb(performance.now()), 1000 / 60) as unknown as number;
  }
  if (typeof g.cancelAnimationFrame === "undefined") {
    g.cancelAnimationFrame = (id: number): void => clearTimeout(id);
  }

  // Babylon checks `typeof document !== "undefined"`. We provide a minimal
  // document so its addEventListener calls (fullscreenchange, etc.) no-op.
  if (typeof g.document === "undefined") {
    const docTarget = new SimpleEventTarget();
    g.document = Object.assign(docTarget, {
      fullscreenElement: null,
      pointerLockElement: null,
      elementFromPoint: (_x: number, _y: number) => null,
    });
  }
  // Critically: do NOT define `window`. IsWindowObjectExist() returns false,
  // so Babylon skips host-window event listeners and getHostWindow() returns
  // null in the render loop.

  // Patch navigator.gpu so Babylon's requestAdapter/requestDevice flow returns
  // OUR pre-created device (sharing it with the Deno window surface).
  const realGpu = (globalThis as { navigator?: { gpu?: GPU } }).navigator?.gpu;
  if (!realGpu) {
    throw new Error("navigator.gpu not available -- run with --unstable-webgpu");
  }

  // Make getPreferredCanvasFormat return the surface format we already
  // configured the window with, so Babylon picks a compatible swap chain
  // format.
  const adapterShim = {
    features: new Set<string>(),
    limits: device.limits,
    info: { vendor: "deno", architecture: "deno", device: "shimmed", description: "shim" },
    requestDevice: (_descriptor?: GPUDeviceDescriptor): Promise<GPUDevice> => {
      return Promise.resolve(device);
    },
    // Real adapter has these but Babylon only uses features/limits/info/requestDevice
  };

  const gpuShim = {
    requestAdapter: (_options?: GPURequestAdapterOptions): Promise<typeof adapterShim> =>
      Promise.resolve(adapterShim),
    getPreferredCanvasFormat: (): GPUTextureFormat => format,
    wgslLanguageFeatures: realGpu.wgslLanguageFeatures ?? new Set<string>(),
  };

  // Replace navigator.gpu in-place. We can't reassign navigator itself in Deno,
  // but we can override the .gpu property.
  try {
    Object.defineProperty(globalThis.navigator, "gpu", {
      value: gpuShim,
      configurable: true,
      writable: true,
    });
  } catch {
    // Fallback: navigator may be locked. Stash on globalThis.
    (globalThis as ShimGlobal).gpu = gpuShim;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a Babylon.js WebGPU engine on Deno.
 *
 * @param device           - A pre-created GPUDevice (will be shared with Babylon)
 * @param width            - Render width in pixels
 * @param height           - Render height in pixels
 * @param gpuCanvasContext - Pass a real GPUCanvasContext for windowed mode,
 *                           or omit / pass undefined for headless mode.
 * @param surfaceFormat    - The format the surface was configured with (windowed mode).
 *                           Defaults to navigator.gpu.getPreferredCanvasFormat().
 */
export async function createDenoBabylonEngine(
  device: GPUDevice,
  width: number,
  height: number,
  gpuCanvasContext?: GPUCanvasContext,
  surfaceFormat?: GPUTextureFormat,
): Promise<DenoBabylonContext> {
  const format = surfaceFormat ?? navigator.gpu.getPreferredCanvasFormat();

  installBabylonShims(device, format);

  const ctx: ContextLike = gpuCanvasContext
    ? new WindowedContextWrapper(gpuCanvasContext)
    : new HeadlessGPUContext(width, height);
  const canvas = new BabylonCanvasShim(width, height, ctx);

  const BABYLON = await import("@babylonjs/core") as BabylonNamespace;
  const { WebGPUEngine } = BABYLON;

  const engine = new WebGPUEngine(canvas as unknown as HTMLCanvasElement, {
    swapChainFormat: format,
    antialias: false,
    audioEngine: false,
    // Skip glslang/twgsl loading: we only use WGSL shaders, not GLSL.
    // Babylon's _initGlslangAsync will throw without this if you use GLSL,
    // but for pure WGSL workflows this is fine.
  });

  await engine.initAsync();

  // Headless: hand back the offscreen texture for snapshots.
  const outputTexture = !gpuCanvasContext
    ? (ctx as HeadlessGPUContext).getCurrentTexture()
    : undefined;

  return { BABYLON, engine, canvas, outputTexture };
}
