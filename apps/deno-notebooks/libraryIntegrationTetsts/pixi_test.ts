/// <reference lib="dom" />

// Run from apps/deno-notebooks:
// deno run --unstable-webgpu --allow-all libraryIntegrationTetsts/pixi_test.ts

// ─── Global shims (must be before pixi import) ──────────────────────────

type PixiShimGlobal = Record<string, unknown>;
type ConstructorLike<T = object> = new (...args: never[]) => T;
type DomParserLike = ConstructorLike<{ parseFromString: (_xml: string, _type: string) => Document }>;
type ImageLike = ConstructorLike<HTMLImageElement>;

interface GPUUncapturedErrorEvent extends Event {
  error?: {
    constructor?: { name?: string };
    message?: string;
  };
}

interface GPUCanvasConfigureLike {
  device: GPUDevice;
  format?: GPUTextureFormat;
}

const g = globalThis as PixiShimGlobal;

if (typeof g.requestAnimationFrame === "undefined") {
  g.requestAnimationFrame = (cb: (time: number) => void): number =>
    setTimeout(() => cb(performance.now()), 16) as unknown as number;
}
if (typeof g.cancelAnimationFrame === "undefined") {
  g.cancelAnimationFrame = (id: number): void => clearTimeout(id);
}

// Minimal document shim for pixi's EventSystem and other DOM references
if (typeof g.document === "undefined") {
  function makeDomEl(): Record<string, unknown> {
    const el: Record<string, unknown> = {
      style: {} as Record<string, string>,
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() { return true; },
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
    };
    return el;
  }
  const bodyEl = makeDomEl();
  bodyEl.contains = () => true; // body.contains(canvas) must return true
  g.document = {
    createElement(_tag: string) { return makeDomEl(); },
    createElementNS(_ns: string, _tag: string) { return makeDomEl(); },
    addEventListener() {},
    removeEventListener() {},
    baseURI: "",
    fonts: null,
    body: bodyEl,
    documentElement: makeDomEl(),
    head: makeDomEl(),
  };
}

// window shim for pixi's event system
if (typeof g.window === "undefined") {
  g.window = g;
}

// PointerEvent shim so EventSystem doesn't crash
if (typeof g.PointerEvent === "undefined") {
  g.PointerEvent = class PointerEvent extends Event {
    pointerId = 0;
    width = 1;
    height = 1;
    pressure = 0;
    tangentialPressure = 0;
    tiltX = 0;
    tiltY = 0;
    twist = 0;
    pointerType = "mouse";
    isPrimary = true;
    constructor(type: string, opts?: EventInit) { super(type, opts); }
  };
}

// HTMLCanvasElement shim so pixi's CanvasSource.test() works
if (typeof g.HTMLCanvasElement === "undefined") {
  g.HTMLCanvasElement = class HTMLCanvasElement {};
}
const CanvasBase = ((g.HTMLCanvasElement as ConstructorLike | undefined) ?? class {}) as ConstructorLike;

// DOMParser shim for pixi's SVG/XML parsing (in BrowserAdapter)
if (typeof g.DOMParser === "undefined") {
  g.DOMParser = class DOMParser {
    parseFromString(_xml: string, _type: string) {
      return { documentElement: null };
    }
  };
}

// Image shim
if (typeof g.Image === "undefined") {
  g.Image = class Image {
    src = "";
    width = 0;
    height = 0;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
  };
}

// ─── Imports ─────────────────────────────────────────────────────────────

import { createGpuWindow } from "../window/mod.ts";

const WIDTH = 800;
const HEIGHT = 600;

// ─── GPU + Window setup ──────────────────────────────────────────────────

console.log("Requesting WebGPU adapter...");
const adapter = await navigator.gpu.requestAdapter();
if (!adapter) throw new Error("No WebGPU adapter");

console.log("Requesting GPU device...");
const device = await adapter.requestDevice();

device.addEventListener("uncapturederror", (event: Event) => {
  const gpuError = (event as GPUUncapturedErrorEvent).error;
  if (gpuError) {
    console.error("GPU ERROR:", gpuError.constructor?.name, gpuError.message);
  }
});

console.log("Creating window...");
const win = await createGpuWindow(device, {
  width: WIDTH,
  height: HEIGHT,
  title: "Pixi.js Deno Test",
});

console.log("Window created, format:", win.format);

// ─── Context wrapper ─────────────────────────────────────────────────────
// Pixi's GpuRenderTargetAdaptor configures the context with usage flags
// that Deno's surface doesn't support. We wrap it to only use RENDER_ATTACHMENT.

class DenoGPUCanvasContextWrapper {
  private _real: GPUCanvasContext;

  constructor(real: GPUCanvasContext) {
    this._real = real;
  }

  configure(config: GPUCanvasConfigureLike): void {
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

const wrappedCtx = new DenoGPUCanvasContextWrapper(win.ctx);

// ─── Canvas shim ─────────────────────────────────────────────────────────

class DenoPixiCanvas extends CanvasBase {
  width: number;
  height: number;
  style: Record<string, string>;
  private _ctx: DenoGPUCanvasContextWrapper;

  constructor(w: number, h: number, ctx: DenoGPUCanvasContextWrapper) {
    super();
    this.width = w;
    this.height = h;
    this._ctx = ctx;
    this.style = { width: `${w}px`, height: `${h}px` };
  }

  getContext(type: string): DenoGPUCanvasContextWrapper | null {
    if (type === "webgpu") return this._ctx;
    if (type === "2d") return null; // pixi might probe for 2d
    throw new Error(`Unsupported context: ${type}`);
  }

  setAttribute() {}
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() { return true; }
  getBoundingClientRect() {
    return { x: 0, y: 0, width: this.width, height: this.height, top: 0, left: 0, bottom: this.height, right: this.width };
  }
}

const canvas = new DenoPixiCanvas(win.width, win.height, wrappedCtx);

// ─── Import pixi.js and set adapter ──────────────────────────────────────

console.log("Importing pixi.js...");
const PIXI = await import("pixi.js");
const ImageCtor = g.Image as ImageLike;
const DOMParserCtor = g.DOMParser as DomParserLike;

// Set DOMAdapter before any pixi init
PIXI.DOMAdapter.set({
  createCanvas: (width?: number, height?: number) => {
    // Return a minimal canvas - pixi uses this for internal operations
    const c = {
      width: width ?? 0,
      height: height ?? 0,
      style: { width: `${width}px`, height: `${height}px` },
      getContext(type: string) {
        if (type === "2d") return null;
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
  createImage: () => new ImageCtor() as unknown as HTMLImageElement,
  getCanvasRenderingContext2D: () => (null as unknown as { prototype: CanvasRenderingContext2D }),
  getWebGLRenderingContext: () => (null as unknown as typeof WebGLRenderingContext),
  getNavigator: () => navigator,
  getBaseUrl: () => "",
  getFontFaceSet: () => null,
  fetch: (url: RequestInfo, options?: RequestInit) => fetch(url, options),
  parseXML: (xml: string) => new DOMParserCtor().parseFromString(xml, "text/xml") as Document,
});

// ─── Create WebGPU Renderer ──────────────────────────────────────────────

console.log("Creating pixi WebGPURenderer...");

const renderer = new PIXI.WebGPURenderer();

console.log("Initializing renderer...");
await renderer.init({
  canvas: canvas as unknown as HTMLCanvasElement,
  gpu: { adapter, device },
  width: win.width,
  height: win.height,
  resolution: 1,
  antialias: false,
  backgroundColor: 0x1a1a2e,
});

console.log("Renderer initialized!");

// ─── Build scene ─────────────────────────────────────────────────────────

const stage = new PIXI.Container();

// Draw some colored circles
const colors = [0xff6b6b, 0x4ecdc4, 0x45b7d1, 0xf9ca24, 0xa29bfe, 0xfd79a8];
const circleCount = 12;

for (let i = 0; i < circleCount; i++) {
  const g = new PIXI.Graphics();
  const color = colors[i % colors.length];
  const radius = 20 + Math.random() * 40;
  const x = 100 + Math.random() * (WIDTH - 200);
  const y = 100 + Math.random() * (HEIGHT - 200);

  g.circle(0, 0, radius);
  g.fill({ color, alpha: 0.85 });
  g.stroke({ color: 0xffffff, width: 2, alpha: 0.5 });
  g.position.set(x, y);

  stage.addChild(g);
}

// Add a central large circle
const center = new PIXI.Graphics();
center.circle(0, 0, 80);
center.fill({ color: 0xe17055, alpha: 0.9 });
center.stroke({ color: 0xffffff, width: 3 });
center.position.set(WIDTH / 2, HEIGHT / 2);
stage.addChild(center);

console.log("Scene built with", stage.children.length, "objects");

// ─── Render loop ─────────────────────────────────────────────────────────

let running = true;
let frame = 0;
const AUTOCLOSE = true;
const MAX_FRAMES = 300;

console.log("Starting render loop...");

while (running && (!AUTOCLOSE || frame < MAX_FRAMES)) {
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
  }
  if (!running || win.closed) break;

  // Animate: slowly rotate all circles around center
  const t = frame * 0.01;
  for (let i = 0; i < circleCount; i++) {
    const child = stage.children[i];
    const angle = (i / circleCount) * Math.PI * 2 + t;
    const dist = 120 + Math.sin(t * 2 + i) * 40;
    child.position.set(
      WIDTH / 2 + Math.cos(angle) * dist,
      HEIGHT / 2 + Math.sin(angle) * dist,
    );
  }

  // Rotate central circle
  center.rotation = t * 0.5;

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
try { renderer.destroy(); } catch (_) { /* ignore cleanup errors */ }
try { win.close(); } catch (_) { /* ignore */ }
try { device.destroy(); } catch (_) { /* ignore */ }
Deno.exit(0);
