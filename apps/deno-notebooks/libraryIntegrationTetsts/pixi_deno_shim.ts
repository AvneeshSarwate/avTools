/// <reference lib="dom" />

/**
 * Shared shim infrastructure for running pixi.js in Deno with a native window.
 *
 * Usage:
 *   import { setupPixiDeno } from "./pixi_deno_shim.ts";
 *   const { renderer, win, canvas, PIXI } = await setupPixiDeno({ width: 800, height: 600 });
 */

// deno-lint-ignore-file no-explicit-any

import { PixelFontMetrics } from "./pixi_text_metrics.ts";

// ─── EventTarget mixin for DOM shims ─────────────────────────────────────

type Listener = EventListenerOrEventListenerObject;
type ListenerEntry = { listener: Listener; options: AddEventListenerOptions };

class SimpleEventTarget {
  private _listeners = new Map<string, ListenerEntry[]>();

  addEventListener(type: string, listener: Listener, options?: boolean | AddEventListenerOptions): void {
    if (!listener) return;
    const opts: AddEventListenerOptions = typeof options === "boolean" ? { capture: options } : (options ?? {});
    let list = this._listeners.get(type);
    if (!list) { list = []; this._listeners.set(type, list); }
    // Avoid duplicates
    if (!list.some(e => e.listener === listener && e.options.capture === opts.capture)) {
      list.push({ listener, options: opts });
    }
  }

  removeEventListener(type: string, listener: Listener, options?: boolean | EventListenerOptions): void {
    const capture = typeof options === "boolean" ? options : (options?.capture ?? false);
    const list = this._listeners.get(type);
    if (!list) return;
    const idx = list.findIndex(e => e.listener === listener && e.options.capture === capture);
    if (idx >= 0) list.splice(idx, 1);
  }

  dispatchEvent(event: Event): boolean {
    const list = this._listeners.get(event.type);
    if (!list) return true;
    for (const entry of [...list]) {
      if (typeof entry.listener === "function") {
        entry.listener.call(this, event);
      } else {
        entry.listener.handleEvent(event);
      }
      if (entry.options.once) {
        this.removeEventListener(event.type, entry.listener, entry.options);
      }
    }
    return !event.defaultPrevented;
  }
}

// ─── Global shims (run immediately on import) ────────────────────────────

const g = globalThis as any;

if (typeof g.requestAnimationFrame === "undefined") {
  g.requestAnimationFrame = (cb: (time: number) => void): number =>
    setTimeout(() => cb(performance.now()), 16) as unknown as number;
}
if (typeof g.cancelAnimationFrame === "undefined") {
  g.cancelAnimationFrame = (id: number): void => clearTimeout(id);
}

// Document shim with real event dispatching
const documentEventTarget = new SimpleEventTarget();

function makeDomEl(): Record<string, unknown> {
  const et = new SimpleEventTarget();
  const el: Record<string, unknown> = {
    style: {} as Record<string, string>,
    addEventListener: et.addEventListener.bind(et),
    removeEventListener: et.removeEventListener.bind(et),
    dispatchEvent: et.dispatchEvent.bind(et),
    setAttribute() {},
    getAttribute() { return null; },
    remove() {},
    contains() { return false; },
    appendChild(child: unknown) { return child; },
    removeChild(child: unknown) { return child; },
    insertBefore(child: unknown) { return child; },
    parentNode: null,
    childNodes: [],
    children: [],
    classList: {
      add() {},
      remove() {},
      contains() { return false; },
      toggle() { return false; },
    },
    focus() {},
    blur() {},
    click() {},
    // Input element properties (for pixi UI Input component)
    value: "",
    type: "text",
    maxLength: -1,
    selectionStart: 0,
    selectionEnd: 0,
    setSelectionRange() {},
  };
  return el;
}

if (typeof g.document === "undefined") {
  const bodyEl = makeDomEl();
  bodyEl.contains = () => true;
  g.document = {
    createElement(_tag: string) { return makeDomEl(); },
    createElementNS(_ns: string, _tag: string) { return makeDomEl(); },
    addEventListener: documentEventTarget.addEventListener.bind(documentEventTarget),
    removeEventListener: documentEventTarget.removeEventListener.bind(documentEventTarget),
    dispatchEvent: documentEventTarget.dispatchEvent.bind(documentEventTarget),
    baseURI: "",
    fonts: null,
    body: bodyEl,
    documentElement: makeDomEl(),
    head: makeDomEl(),
  };
}

if (typeof g.window === "undefined") {
  g.window = g;
}

// PointerEvent shim with proper coordinate support
if (typeof g.PointerEvent === "undefined") {
  g.PointerEvent = class PointerEvent extends Event {
    pointerId: number;
    width: number;
    height: number;
    pressure: number;
    tangentialPressure: number;
    tiltX: number;
    tiltY: number;
    twist: number;
    pointerType: string;
    isPrimary: boolean;
    clientX: number;
    clientY: number;
    screenX: number;
    screenY: number;
    pageX: number;
    pageY: number;
    offsetX: number;
    offsetY: number;
    movementX: number;
    movementY: number;
    button: number;
    buttons: number;
    detail: number;
    constructor(type: string, opts: any = {}) {
      super(type, { bubbles: opts.bubbles ?? true, cancelable: opts.cancelable ?? true });
      this.pointerId = opts.pointerId ?? 1;
      this.width = opts.width ?? 1;
      this.height = opts.height ?? 1;
      this.pressure = opts.pressure ?? 0;
      this.tangentialPressure = opts.tangentialPressure ?? 0;
      this.tiltX = opts.tiltX ?? 0;
      this.tiltY = opts.tiltY ?? 0;
      this.twist = opts.twist ?? 0;
      this.pointerType = opts.pointerType ?? "mouse";
      this.isPrimary = opts.isPrimary ?? true;
      this.clientX = opts.clientX ?? 0;
      this.clientY = opts.clientY ?? 0;
      this.screenX = opts.screenX ?? opts.clientX ?? 0;
      this.screenY = opts.screenY ?? opts.clientY ?? 0;
      this.pageX = opts.pageX ?? opts.clientX ?? 0;
      this.pageY = opts.pageY ?? opts.clientY ?? 0;
      this.offsetX = opts.offsetX ?? opts.clientX ?? 0;
      this.offsetY = opts.offsetY ?? opts.clientY ?? 0;
      this.movementX = opts.movementX ?? 0;
      this.movementY = opts.movementY ?? 0;
      this.button = opts.button ?? 0;
      this.buttons = opts.buttons ?? 0;
      this.detail = opts.detail ?? 0;
    }
    getModifierState() { return false; }
  };
}

if (typeof g.MouseEvent === "undefined") {
  g.MouseEvent = g.PointerEvent; // Alias for compatibility
}

if (typeof g.HTMLCanvasElement === "undefined") {
  g.HTMLCanvasElement = class HTMLCanvasElement {};
}

if (typeof g.DOMParser === "undefined") {
  g.DOMParser = class DOMParser {
    parseFromString(_xml: string, _type: string) {
      return { documentElement: null };
    }
  };
}

if (typeof g.WheelEvent === "undefined") {
  g.WheelEvent = class WheelEvent extends Event {
    deltaX: number;
    deltaY: number;
    deltaZ: number;
    deltaMode: number;
    clientX: number;
    clientY: number;
    constructor(type: string, opts: any = {}) {
      super(type, { bubbles: opts.bubbles ?? true, cancelable: opts.cancelable ?? true });
      this.deltaX = opts.deltaX ?? 0;
      this.deltaY = opts.deltaY ?? 0;
      this.deltaZ = opts.deltaZ ?? 0;
      this.deltaMode = opts.deltaMode ?? 0;
      this.clientX = opts.clientX ?? 0;
      this.clientY = opts.clientY ?? 0;
    }
  };
}

if (typeof g.Image === "undefined") {
  g.Image = class Image {
    src = "";
    width = 0;
    height = 0;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
  };
}

// ─── Context wrapper ─────────────────────────────────────────────────────

class DenoGPUCanvasContextWrapper {
  private _real: GPUCanvasContext;

  constructor(real: GPUCanvasContext) {
    this._real = real;
  }

  configure(config: any): void {
    this._real.configure({
      device: config.device,
      format: config.format ?? "bgra8unorm",
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

// ─── Headless GPU context for offscreen rendering ────────────────────────

class HeadlessGPUCanvasContext {
  private _device!: GPUDevice;
  private _format!: GPUTextureFormat;
  private _texture!: GPUTexture;
  private _width: number;
  private _height: number;

  constructor(width: number, height: number) {
    this._width = width;
    this._height = height;
    this._format = "bgra8unorm";
  }

  configure(config: any): void {
    this._device = config.device;
    this._format = config.format ?? "bgra8unorm";
    this._texture?.destroy();
    this._texture = this._device.createTexture({
      size: { width: this._width, height: this._height },
      format: this._format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
  }

  unconfigure(): void {
    this._texture?.destroy();
  }

  getCurrentTexture(): GPUTexture {
    return this._texture;
  }
}

// ─── Canvas shim with real event support ─────────────────────────────────

class DenoPixiCanvas extends g.HTMLCanvasElement {
  width: number;
  height: number;
  style: Record<string, string>;
  private _ctx: any; // DenoGPUCanvasContextWrapper or HeadlessGPUCanvasContext
  private _et = new SimpleEventTarget();

  constructor(w: number, h: number, ctx: any) {
    super();
    this.width = w;
    this.height = h;
    this._ctx = ctx;
    this.style = { width: `${w}px`, height: `${h}px` };
  }

  getContext(type: string): any {
    if (type === "webgpu") return this._ctx;
    if (type === "2d") return null;
    throw new Error(`Unsupported context: ${type}`);
  }

  setAttribute() {}

  addEventListener(type: string, listener: Listener, options?: boolean | AddEventListenerOptions): void {
    this._et.addEventListener(type, listener, options);
  }
  removeEventListener(type: string, listener: Listener, options?: boolean | EventListenerOptions): void {
    this._et.removeEventListener(type, listener, options);
  }
  dispatchEvent(event: Event): boolean {
    return this._et.dispatchEvent(event);
  }

  getBoundingClientRect() {
    return { x: 0, y: 0, width: this.width, height: this.height, top: 0, left: 0, bottom: this.height, right: this.width };
  }
}

// ─── Text canvas backed by @gfx/canvas (FFI) or @gfx/canvas-wasm ─────────

let _ckCreateCanvas: ((w: number, h: number) => any) | null = null;
let _fontMetrics: PixelFontMetrics | null = null;

/**
 * Canvas wrapper that produces real pixels for text rendering. Works with both
 * @gfx/canvas (FFI/Skia, full text quality) and @gfx/canvas-wasm (pure WASM).
 * Extends HTMLCanvasElement for pixi's instanceof check. Uses a Proxy for the
 * 2D context so pixi's CanvasPool can cache the reference across resizes.
 * The measureText wrapper auto-detects whether the backend provides proper
 * vertical metrics (FFI does, WASM doesn't) and supplements when needed.
 */
class CanvaskitTextCanvas extends g.HTMLCanvasElement {
  _ckCanvas: any;
  _rawCtx: any;
  _proxyCtx: any;
  _width: number;
  _height: number;
  _dirty: boolean;
  style: Record<string, string>;

  constructor(w: number, h: number) {
    super();
    this._width = Math.max(1, w || 1);
    this._height = Math.max(1, h || 1);
    this._dirty = false;
    this.style = {};
    this._ckCanvas = _ckCreateCanvas!(this._width, this._height);
    this._rawCtx = this._ckCanvas.getContext("2d");

    // Proxy delegates to the current _rawCtx, surviving recreations on resize.
    // Wraps measureText() with pixel-scanned font metrics so pixi can
    // correctly size the text canvas (canvaskit-wasm only returns width).
    const self = this;
    this._proxyCtx = new Proxy({} as any, {
      get(_target: any, prop: string | symbol) {
        self._ensureCanvas();
        if (prop === "canvas") return self;
        if (prop === "measureText") {
          return function (text: string) {
            const result = self._rawCtx.measureText(text);
            // If native context already provides real vertical metrics
            // (FFI backend), pass through directly — no supplementing needed.
            if (result.fontBoundingBoxAscent > 0) {
              return result;
            }
            // WASM backend: supplement missing vertical metrics
            const width = result.width || 0;
            const font: string = self._rawCtx.font || "16px sans-serif";
            let ascent: number, descent: number;
            if (_fontMetrics) {
              const fm = _fontMetrics.measure(font);
              ascent = fm.ascent;
              descent = fm.descent;
            } else {
              const fontMatch = font.match(/(\d+(?:\.\d+)?)\s*px/i);
              const sz = fontMatch ? parseFloat(fontMatch[1]) : 16;
              ascent = Math.ceil(sz * 0.92);
              descent = Math.ceil(sz * 0.32);
            }
            return {
              width,
              actualBoundingBoxAscent: result.actualBoundingBoxAscent || ascent,
              actualBoundingBoxDescent: result.actualBoundingBoxDescent || descent,
              actualBoundingBoxLeft: result.actualBoundingBoxLeft || 0,
              actualBoundingBoxRight: result.actualBoundingBoxRight || width,
              fontBoundingBoxAscent: ascent,
              fontBoundingBoxDescent: descent,
            };
          };
        }
        const val = self._rawCtx[prop];
        if (typeof val === "function") return val.bind(self._rawCtx);
        return val;
      },
      set(_target: any, prop: string | symbol, value: any) {
        self._ensureCanvas();
        // Normalize 8-char hex colors (#RRGGBBAA) to rgba() — the native
        // canvas (FFI/Skia) doesn't support CSS Color Level 4 hex-with-alpha
        // and silently rejects it, falling back to black.
        if ((prop === "fillStyle" || prop === "strokeStyle") &&
            typeof value === "string" && /^#[0-9a-fA-F]{8}$/.test(value)) {
          const r = parseInt(value.slice(1, 3), 16);
          const g = parseInt(value.slice(3, 5), 16);
          const b = parseInt(value.slice(5, 7), 16);
          const a = parseInt(value.slice(7, 9), 16) / 255;
          value = `rgba(${r}, ${g}, ${b}, ${a})`;
        }
        self._rawCtx[prop] = value;
        return true;
      },
    });
  }

  get width() { return this._width; }
  set width(v: number) {
    this._width = Math.max(1, v || 1);
    this._dirty = true;
  }

  get height() { return this._height; }
  set height(v: number) {
    this._height = Math.max(1, v || 1);
    this._dirty = true;
  }

  _ensureCanvas() {
    if (this._dirty) {
      if (this._ckCanvas?.dispose) this._ckCanvas.dispose();
      this._ckCanvas = _ckCreateCanvas!(this._width, this._height);
      this._rawCtx = this._ckCanvas.getContext("2d");
      this._dirty = false;
    }
  }

  getContext(type: string): any {
    if (type === "2d") {
      this._ensureCanvas();
      return this._proxyCtx;
    }
    return null;
  }

  /**
   * Get RGBA pixels for GPU upload. Uses getImageData() (guaranteed RGBA by
   * Canvas 2D spec) rather than getRawBuffer() which may return BGRA depending
   * on the Skia backend. Premultiplies alpha since pixi expects it.
   */
  getRawPixels(): Uint8Array {
    this._ensureCanvas();
    const ctx = this._ckCanvas.getContext("2d");
    const imageData = ctx.getImageData(0, 0, this._width, this._height);
    const data = imageData.data;
    const out = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3] / 255;
      out[i] = (data[i] * a + 0.5) | 0;
      out[i + 1] = (data[i + 1] * a + 0.5) | 0;
      out[i + 2] = (data[i + 2] * a + 0.5) | 0;
      out[i + 3] = data[i + 3];
    }
    return out;
  }

  setAttribute() {}
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() { return true; }
  getBoundingClientRect() {
    return { x: 0, y: 0, width: this._width, height: this._height, top: 0, left: 0, bottom: this._height, right: this._width };
  }
}

// ─── Native event → pixi event bridging ──────────────────────────────────

let _lastMouseX = 0;
let _lastMouseY = 0;
let _mouseButtons = 0;

/**
 * Convert native window events from winit to DOM PointerEvents and dispatch
 * them to the appropriate targets (canvas, document, globalThis) so that
 * pixi's EventSystem picks them up.
 */
function bridgeNativeEvent(ev: any, canvas: DenoPixiCanvas): void {
  switch (ev.type) {
    case "mouse_move": {
      const dx = ev.x - _lastMouseX;
      const dy = ev.y - _lastMouseY;
      _lastMouseX = ev.x;
      _lastMouseY = ev.y;
      const pe = new g.PointerEvent("pointermove", {
        clientX: ev.x, clientY: ev.y,
        movementX: dx, movementY: dy,
        buttons: _mouseButtons,
        bubbles: true,
      });
      // Pixi listens on document for pointermove (capture phase)
      documentEventTarget.dispatchEvent(pe);
      break;
    }
    case "mouse_button": {
      _lastMouseX = ev.x;
      _lastMouseY = ev.y;
      const button = ev.button; // 0=left, 1=middle, 2=right
      if (ev.down) {
        _mouseButtons |= (1 << button);
        const pe = new g.PointerEvent("pointerdown", {
          clientX: ev.x, clientY: ev.y,
          button, buttons: _mouseButtons,
          bubbles: true,
        });
        // Pixi listens on canvas for pointerdown
        canvas.dispatchEvent(pe);
      } else {
        _mouseButtons &= ~(1 << button);
        const pe = new g.PointerEvent("pointerup", {
          clientX: ev.x, clientY: ev.y,
          button, buttons: _mouseButtons,
          bubbles: true,
        });
        // Pixi listens on globalThis for pointerup
        g.dispatchEvent(pe);
        // Also fire pointertap on canvas for click detection
        const tap = new g.PointerEvent("pointertap", {
          clientX: ev.x, clientY: ev.y,
          button, bubbles: true,
        });
        canvas.dispatchEvent(tap);
      }
      break;
    }
    case "scroll": {
      // Pixi listens on canvas for wheel
      const we = new WheelEvent("wheel", {
        deltaX: ev.dx,
        deltaY: ev.dy,
        clientX: _lastMouseX,
        clientY: _lastMouseY,
        bubbles: true,
      });
      canvas.dispatchEvent(we);
      break;
    }
    // Key events are forwarded to globalThis for any listeners
    case "key": {
      const type = ev.down ? "keydown" : "keyup";
      const ke = new KeyboardEvent(type, {
        key: ev.key,
        code: ev.key,
        bubbles: true,
      });
      g.dispatchEvent(ke);
      break;
    }
  }
}

// ─── Setup function ──────────────────────────────────────────────────────

import { createGpuWindow } from "../window/mod.ts";
import type { GpuWindow } from "../window/mod.ts";

export interface PixiDenoOptions {
  width?: number;
  height?: number;
  title?: string;
  backgroundColor?: number;
  /**
   * Enable real text rendering via a canvas backend.
   * - true or "native": use @gfx/canvas (FFI/Skia) — full text quality,
   *   needs native lib (prebuilt for macOS/Win/Linux x64, cross-compile for Pi)
   * - "wasm": use @gfx/canvas-wasm (pure WASM) — works everywhere,
   *   limited measureText/textAlign/textBaseline
   * - false/undefined: mock canvas, no text rendering (Graphics-only)
   */
  enableText?: boolean | "native" | "wasm";
  /** Render to offscreen texture (no window). Use with snapshotPixiFrame(). */
  headless?: boolean;
}

export interface PixiDenoContext {
  renderer: any;
  win: GpuWindow | null;
  canvas: DenoPixiCanvas;
  device: GPUDevice;
  adapter: GPUAdapter;
  PIXI: typeof import("npm:pixi.js@^8");
}

export async function setupPixiDeno(opts: PixiDenoOptions = {}): Promise<PixiDenoContext> {
  const WIDTH = opts.width ?? 800;
  const HEIGHT = opts.height ?? 600;
  const TITLE = opts.title ?? "Pixi.js Deno";
  const BG = opts.backgroundColor ?? 0x1a1a2e;

  console.log("Requesting WebGPU adapter...");
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("No WebGPU adapter");

  console.log("Requesting GPU device...");
  const device = await adapter.requestDevice();

  device.addEventListener("uncapturederror", (event: Event) => {
    const gpuError = (event as any).error;
    if (gpuError) {
      console.error("GPU ERROR:", gpuError.constructor?.name, gpuError.message);
    }
  });

  // Polyfill copyExternalImageToTexture (Deno doesn't have it).
  // Uses writeTexture with raw pixel data instead.
  if (typeof (device.queue as any).copyExternalImageToTexture !== "function") {
    (device.queue as any).copyExternalImageToTexture = function (
      source: { source: any; origin?: any; flipY?: boolean },
      destination: { texture: GPUTexture; origin?: any; premultipliedAlpha?: boolean },
      copySize: any,
    ) {
      const canvas = source.source;
      const w = copySize.width ?? copySize[0] ?? canvas.width ?? 1;
      const h = copySize.height ?? copySize[1] ?? canvas.height ?? 1;

      let pixels: Uint8Array;

      if (typeof canvas.getRawPixels === "function") {
        // CanvaskitTextCanvas: direct premultiplied RGBA
        pixels = canvas.getRawPixels();
      } else if (canvas.getContext) {
        // Generic canvas: getImageData + manual premultiply
        const ctx2d = canvas.getContext("2d");
        if (!ctx2d) {
          console.warn("copyExternalImageToTexture polyfill: no 2D context, skipping");
          return;
        }
        const imageData = ctx2d.getImageData(0, 0, w, h);
        const data = imageData.data;
        pixels = new Uint8Array(data.length);
        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3] / 255;
          pixels[i] = (data[i] * a + 0.5) | 0;
          pixels[i + 1] = (data[i + 1] * a + 0.5) | 0;
          pixels[i + 2] = (data[i + 2] * a + 0.5) | 0;
          pixels[i + 3] = data[i + 3];
        }
      } else {
        console.warn("copyExternalImageToTexture polyfill: unsupported source, skipping");
        return;
      }

      this.writeTexture(
        { texture: destination.texture, origin: destination.origin ?? { x: 0, y: 0 } },
        pixels,
        { bytesPerRow: w * 4, rowsPerImage: h },
        { width: w, height: h, depthOrArrayLayers: 1 },
      );
    };
  }

  // Load canvas backend for text rendering
  if (opts.enableText && !_ckCreateCanvas) {
    const useWasm = opts.enableText === "wasm";
    if (useWasm) {
      console.log("Loading canvas WASM for text rendering...");
      const canvasMod = await import("jsr:@gfx/canvas-wasm");
      _ckCreateCanvas = canvasMod.createCanvas;
      _fontMetrics = new PixelFontMetrics(_ckCreateCanvas);
      console.log("Canvas WASM loaded!");
    } else {
      // "native" or true — use @gfx/canvas (FFI/Skia) for full text quality
      console.log("Loading native canvas (FFI/Skia) for text rendering...");
      const canvasMod = await import("jsr:@gfx/canvas");
      _ckCreateCanvas = canvasMod.createCanvas;
      // No pixel-scanning needed — FFI version has full measureText metrics
      console.log("Native canvas loaded!");
    }
  }

  let win: GpuWindow | null = null;
  let canvas: DenoPixiCanvas;

  if (opts.headless) {
    console.log("Headless mode: rendering to offscreen texture");
    const headlessCtx = new HeadlessGPUCanvasContext(WIDTH, HEIGHT);
    canvas = new DenoPixiCanvas(WIDTH, HEIGHT, headlessCtx);
  } else {
    console.log("Creating window...");
    win = await createGpuWindow(device, { width: WIDTH, height: HEIGHT, title: TITLE });
    console.log("Window created, format:", win.format);

    const wrappedCtx = new DenoGPUCanvasContextWrapper(win.ctx);
    canvas = new DenoPixiCanvas(win.width, win.height, wrappedCtx);

    // Fire initial pointerover so pixi knows the pointer is inside
    const initOver = new g.PointerEvent("pointerover", {
      clientX: 0, clientY: 0, bubbles: true,
    });
    canvas.dispatchEvent(initOver);
  }

  console.log("Importing pixi.js...");
  const PIXI = await import("npm:pixi.js@^8");

  PIXI.DOMAdapter.set({
    createCanvas: (width?: number, height?: number) => {
      // If canvaskit is loaded, use real canvas for text rendering
      if (_ckCreateCanvas) {
        return new CanvaskitTextCanvas(width ?? 0, height ?? 0) as unknown as HTMLCanvasElement;
      }
      // Mock 2D context for text measurement (used by CanvasTextMetrics)
      const ctx2d = {
        font: "10px sans-serif",
        fillStyle: "",
        strokeStyle: "",
        globalAlpha: 1,
        textAlign: "start",
        textBaseline: "alphabetic",
        direction: "ltr",
        measureText(text: string) {
          // Approximate text metrics based on font size
          const fontSizeMatch = this.font.match(/(\d+(?:\.\d+)?)(px|pt|em)/);
          const fontSize = fontSizeMatch ? parseFloat(fontSizeMatch[1]) : 10;
          const avgCharWidth = fontSize * 0.6;
          const width = text.length * avgCharWidth;
          return {
            width,
            actualBoundingBoxAscent: fontSize * 0.8,
            actualBoundingBoxDescent: fontSize * 0.2,
            actualBoundingBoxLeft: 0,
            actualBoundingBoxRight: width,
            fontBoundingBoxAscent: fontSize * 0.8,
            fontBoundingBoxDescent: fontSize * 0.2,
          };
        },
        fillText() {},
        strokeText() {},
        clearRect() {},
        fillRect() {},
        save() {},
        restore() {},
        scale() {},
        rotate() {},
        translate() {},
        transform() {},
        setTransform() {},
        resetTransform() {},
        beginPath() {},
        closePath() {},
        moveTo() {},
        lineTo() {},
        arc() {},
        rect() {},
        fill() {},
        stroke() {},
        clip() {},
        createLinearGradient() { return { addColorStop() {} }; },
        createRadialGradient() { return { addColorStop() {} }; },
        createPattern() { return null; },
        drawImage() {},
        getImageData() { return { data: new Uint8ClampedArray(4), width: 1, height: 1 }; },
        putImageData() {},
        canvas: null as any,
      };
      const c = {
        width: width ?? 0,
        height: height ?? 0,
        style: { width: `${width}px`, height: `${height}px` },
        getContext(type: string) {
          if (type === "2d") {
            ctx2d.canvas = c;
            return ctx2d;
          }
          return null;
        },
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() { return true; },
        setAttribute() {},
        getBoundingClientRect() { return { x: 0, y: 0, width: width ?? 0, height: height ?? 0, top: 0, left: 0, bottom: height ?? 0, right: width ?? 0 }; },
        parentNode: null,
      };
      return c as unknown as HTMLCanvasElement;
    },
    createImage: () => new g.Image(),
    getCanvasRenderingContext2D: () => {
      // Pixi checks .prototype for letterSpacing support
      function MockCtx2D() {}
      MockCtx2D.prototype = {};
      return MockCtx2D as unknown as { prototype: CanvasRenderingContext2D };
    },
    getWebGLRenderingContext: () => (null as unknown as typeof WebGLRenderingContext),
    getNavigator: () => navigator,
    getBaseUrl: () => "",
    getFontFaceSet: () => null,
    fetch: (url: RequestInfo, options?: RequestInit) => fetch(url, options),
    parseXML: (xml: string) => new g.DOMParser().parseFromString(xml, "text/xml"),
  });

  console.log("Creating pixi WebGPURenderer...");
  const renderer = new PIXI.WebGPURenderer();

  console.log("Initializing renderer...");
  await renderer.init({
    canvas: canvas as unknown as HTMLCanvasElement,
    gpu: { adapter, device },
    width: WIDTH,
    height: HEIGHT,
    resolution: 1,
    antialias: false,
    backgroundColor: BG,
    preference: "webgpu",
  });

  console.log("Renderer initialized!");
  return { renderer, win, canvas, device, adapter, PIXI };
}

/**
 * Render loop with native-to-pixi event bridging.
 */
export async function runPixiRenderLoop(
  ctx: PixiDenoContext,
  stage: any,
  opts: {
    autoClose?: boolean;
    maxFrames?: number;
    onFrame?: (frame: number, dt: number) => void;
    onEvent?: (ev: any) => void;
  } = {},
): Promise<void> {
  const { renderer, win, canvas } = ctx;
  const autoClose = opts.autoClose ?? true;
  const maxFrames = opts.maxFrames ?? 300;

  let running = true;
  let frame = 0;

  console.log("Starting render loop...");

  while (running && (!autoClose || frame < maxFrames)) {
    const events = win.pollEvents();
    for (const ev of events) {
      if (ev.type === "close") running = false;
      if (ev.type === "resize") {
        canvas.width = ev.width;
        canvas.height = ev.height;
        canvas.style.width = `${ev.width}px`;
        canvas.style.height = `${ev.height}px`;
        renderer.resize(ev.width, ev.height, 1);
      }
      // Bridge to pixi's event system
      bridgeNativeEvent(ev, canvas);
      opts.onEvent?.(ev);
    }
    if (!running || win.closed) break;

    opts.onFrame?.(frame, 16);

    renderer.render({ container: stage });

    try {
      win.present();
    } catch (e) {
      console.error("Present error at frame", frame, ":", e);
      break;
    }

    frame++;
    await new Promise((r) => setTimeout(r, 16));
  }

  console.log(`Rendered ${frame} frames, closing`);
}

export function cleanupPixiDeno(ctx: PixiDenoContext): void {
  try { ctx.renderer.destroy(); } catch (_) { /* ignore */ }
  try { ctx.win?.close(); } catch (_) { /* ignore */ }
  try { ctx.device.destroy(); } catch (_) { /* ignore */ }
}

/**
 * Render one frame and save as PNG. Requires headless mode (the offscreen
 * texture must have COPY_SRC usage). Handles BGRA→RGBA conversion.
 */
export async function snapshotPixiFrame(
  ctx: PixiDenoContext,
  stage: any,
  outPath: string,
): Promise<void> {
  // Render one frame
  ctx.renderer.render({ container: stage });

  // Get the output texture from the canvas context
  const webgpuCtx = ctx.canvas.getContext("webgpu");
  const texture = webgpuCtx.getCurrentTexture() as GPUTexture;
  const width = texture.width;
  const height = texture.height;
  const format = texture.format;

  // Read back GPU texture to CPU
  const bytesPerRow = Math.ceil(width * 4 / 256) * 256;
  const bufferSize = bytesPerRow * height;
  const readBuffer = ctx.device.createBuffer({
    size: bufferSize,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  const encoder = ctx.device.createCommandEncoder();
  encoder.copyTextureToBuffer(
    { texture },
    { buffer: readBuffer, bytesPerRow, rowsPerImage: height },
    { width, height, depthOrArrayLayers: 1 },
  );
  ctx.device.queue.submit([encoder.finish()]);

  await readBuffer.mapAsync(GPUMapMode.READ);
  const mapped = new Uint8Array(readBuffer.getMappedRange());

  // Copy pixels with row stride handling and BGRA→RGBA conversion
  const rgba8 = new Uint8Array(width * height * 4);
  const isBGRA = format === "bgra8unorm";
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = y * bytesPerRow + x * 4;
      const dstIdx = (y * width + x) * 4;
      if (isBGRA) {
        rgba8[dstIdx]     = mapped[srcIdx + 2]; // R ← B
        rgba8[dstIdx + 1] = mapped[srcIdx + 1]; // G
        rgba8[dstIdx + 2] = mapped[srcIdx];     // B ← R
        rgba8[dstIdx + 3] = mapped[srcIdx + 3]; // A
      } else {
        rgba8[dstIdx]     = mapped[srcIdx];
        rgba8[dstIdx + 1] = mapped[srcIdx + 1];
        rgba8[dstIdx + 2] = mapped[srcIdx + 2];
        rgba8[dstIdx + 3] = mapped[srcIdx + 3];
      }
    }
  }

  readBuffer.unmap();
  readBuffer.destroy();

  // Encode and write PNG
  const { encodePNG } = await import("@img/png");
  const dir = outPath.substring(0, outPath.lastIndexOf("/"));
  if (dir) await Deno.mkdir(dir, { recursive: true });
  const png = await encodePNG(new Uint8Array(rgba8), {
    width, height, compression: 0, filter: 0, interlace: 0,
  });
  await Deno.writeFile(outPath, png);
  console.log(`Snapshot saved: ${outPath} (${width}x${height})`);
}
