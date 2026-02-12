/// <reference lib="dom" />

/**
 * DOM shims and rendering pipeline for running p5.js v1 on Deno.
 * Uses @gfx/canvas (Skia FFI) as the Canvas 2D backend.
 *
 * Windowed: Skia pixels → GPU texture → blit shader → native window surface.
 * Headless: Skia pixels → PNG file.
 *
 * Usage:
 *   import { setupP5Deno, runP5RenderLoop } from "../tools/p5_deno_shim.ts";
 *   const ctx = await setupP5Deno((p) => { p.setup = () => { p.createCanvas(400, 400); }; ... });
 *   await runP5RenderLoop(ctx);
 */

import { createGpuWindow, createBlitPipeline, blit } from "../window/mod.ts";
import type { GpuWindow, WindowEvent, BlitPipeline } from "../window/mod.ts";

// ─── Types ────────────────────────────────────────────────────────────────

type Listener = EventListenerOrEventListenerObject;
type ListenerEntry = { listener: Listener; options: AddEventListenerOptions };
type GlobalShim = Record<string, unknown>;

type PointerEventInitLike = EventInit & Partial<{
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
}>;

type WheelEventInitLike = EventInit & Partial<{
  deltaX: number;
  deltaY: number;
  deltaZ: number;
  deltaMode: number;
  clientX: number;
  clientY: number;
}>;

type CreateCanvasFn = (w: number, h: number) => {
  width?: number;
  height?: number;
  getContext: (type: "2d") => CanvasRenderingContext2D | null;
  dispose?: () => void;
};

// ─── SimpleEventTarget ───────────────────────────────────────────────────

class SimpleEventTarget {
  private _listeners = new Map<string, ListenerEntry[]>();

  addEventListener(type: string, listener: Listener, options?: boolean | AddEventListenerOptions): void {
    if (!listener) return;
    const opts: AddEventListenerOptions = typeof options === "boolean" ? { capture: options } : (options ?? {});
    let list = this._listeners.get(type);
    if (!list) { list = []; this._listeners.set(type, list); }
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

// ─── requestAnimationFrame queue ─────────────────────────────────────────
// p5's draw loop uses rAF. We intercept it so our render loop controls
// when frames happen: each iteration drains the queue, triggering p5's _draw.

const _rafCallbacks: ((time: number) => void)[] = [];
let _rafId = 0;

// ─── Global shims (installed at import time, before p5 is loaded) ────────

const g = globalThis as GlobalShim;

// rAF: queue-based so our render loop drives p5's draw cycle
g.requestAnimationFrame = (cb: (time: number) => void): number => {
  _rafCallbacks.push(cb);
  return ++_rafId;
};
g.cancelAnimationFrame = (_id: number): void => {
  // p5 rarely cancels; if needed, could filter by id
};

// Window basics
g.window = globalThis;
g.self = globalThis;
g.devicePixelRatio = 1;
g.innerWidth = 100;
g.innerHeight = 100;
g.scrollX = 0;
g.scrollY = 0;
g.pageXOffset = 0;
g.pageYOffset = 0;
g.screen = { width: 1920, height: 1080 };

// Global event target (p5 adds listeners on window for keydown, resize, etc.)
const _globalET = new SimpleEventTarget();
const _origAddEventListener = (globalThis as unknown as EventTarget).addEventListener;
const _origRemoveEventListener = (globalThis as unknown as EventTarget).removeEventListener;
(globalThis as unknown as Record<string, unknown>).addEventListener = function (
  type: string, listener: Listener, options?: boolean | AddEventListenerOptions
) {
  _globalET.addEventListener(type, listener, options);
  // Also register on the real globalThis for built-in events
  if (_origAddEventListener) {
    try { _origAddEventListener.call(globalThis, type, listener, options); } catch (_) { /* ignore */ }
  }
};
(globalThis as unknown as Record<string, unknown>).removeEventListener = function (
  type: string, listener: Listener, options?: boolean | EventListenerOptions
) {
  _globalET.removeEventListener(type, listener, options);
  if (_origRemoveEventListener) {
    try { _origRemoveEventListener.call(globalThis, type, listener, options); } catch (_) { /* ignore */ }
  }
};
(globalThis as unknown as Record<string, unknown>).dispatchEvent = function (event: Event) {
  return _globalET.dispatchEvent(event);
};

// Stubs that p5 may access
if (!g.location) {
  g.location = { href: "http://localhost", pathname: "/", search: "", protocol: "http:", host: "localhost", hostname: "localhost", port: "", origin: "http://localhost" };
}
g.print = (...args: unknown[]) => console.log(...args);
g.confirm = () => false;
g.focus = () => {};
g.blur = () => {};
g.open = () => null;
g.close = () => {};
g.matchMedia = (_query: string) => ({
  matches: false, media: _query,
  addListener() {}, removeListener() {},
  addEventListener() {}, removeEventListener() {},
  dispatchEvent() { return true; },
  onchange: null,
});
g.getComputedStyle = (_el: unknown) => new Proxy({}, {
  get(_t, prop) {
    if (prop === "getPropertyValue") return () => "";
    return "";
  },
});
g.ResizeObserver = class ResizeObserver {
  constructor(_cb: unknown) {}
  observe() {}
  unobserve() {}
  disconnect() {}
};
g.MutationObserver = class MutationObserver {
  constructor(_cb: unknown) {}
  observe() {}
  disconnect() {}
  takeRecords() { return []; }
};

// ─── Event shim classes ──────────────────────────────────────────────────

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
    constructor(type: string, opts: PointerEventInitLike = {}) {
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
  g.MouseEvent = g.PointerEvent;
}

if (typeof g.WheelEvent === "undefined") {
  g.WheelEvent = class WheelEvent extends Event {
    deltaX: number;
    deltaY: number;
    deltaZ: number;
    deltaMode: number;
    clientX: number;
    clientY: number;
    constructor(type: string, opts: WheelEventInitLike = {}) {
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

if (typeof g.Image === "undefined") {
  g.Image = class Image {
    src = "";
    width = 0;
    height = 0;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
  };
}

const CanvasBase = (g.HTMLCanvasElement as (new (...args: never[]) => object) | undefined) ?? class {};

// ─── Element registry ────────────────────────────────────────────────────

const _elementsById = new Map<string, MockDomElement | P5CanvasShim>();
const _elementsByTag = new Map<string, (MockDomElement | P5CanvasShim)[]>();

function registerElement(el: MockDomElement | P5CanvasShim) {
  const id = el._id;
  if (id) _elementsById.set(id, el);
  const tag = el._tag.toLowerCase();
  if (!_elementsByTag.has(tag)) _elementsByTag.set(tag, []);
  _elementsByTag.get(tag)!.push(el);
}

// ─── MockDomElement ──────────────────────────────────────────────────────

class MockDomElement {
  _tag: string;
  _id = "";
  _children: (MockDomElement | P5CanvasShim)[] = [];
  _parent: MockDomElement | P5CanvasShim | null = null;
  _et = new SimpleEventTarget();
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  classList = {
    _classes: new Set<string>(),
    add(...c: string[]) { c.forEach(x => this._classes.add(x)); },
    remove(...c: string[]) { c.forEach(x => this._classes.delete(x)); },
    contains(c: string) { return this._classes.has(c); },
    toggle(c: string) {
      if (this._classes.has(c)) { this._classes.delete(c); return false; }
      this._classes.add(c); return true;
    },
  };
  innerHTML = "";
  innerText = "";
  textContent = "";

  constructor(tag: string) {
    this._tag = tag;
  }

  get id() { return this._id; }
  set id(v: string) { this._id = v; _elementsById.set(v, this); }

  get tagName() { return this._tag.toUpperCase(); }
  get nodeName() { return this._tag.toUpperCase(); }
  get nodeType() { return 1; } // ELEMENT_NODE
  get parentNode() { return this._parent; }
  get parentElement() { return this._parent; }
  get childNodes() { return this._children; }
  get children() { return this._children; }
  get firstChild() { return this._children[0] ?? null; }
  get lastChild() { return this._children[this._children.length - 1] ?? null; }
  get nextSibling() { return null; }
  get previousSibling() { return null; }
  get offsetWidth() { return 0; }
  get offsetHeight() { return 0; }
  get offsetLeft() { return 0; }
  get offsetTop() { return 0; }
  get scrollWidth() { return 0; }
  get scrollHeight() { return 0; }
  get clientWidth() { return 0; }
  get clientHeight() { return 0; }

  appendChild(child: MockDomElement | P5CanvasShim) {
    if (child._parent) (child._parent as MockDomElement).removeChild?.(child);
    child._parent = this;
    this._children.push(child);
    return child;
  }
  removeChild(child: MockDomElement | P5CanvasShim) {
    child._parent = null;
    this._children = this._children.filter(c => c !== child);
    return child;
  }
  insertBefore(child: MockDomElement | P5CanvasShim, _ref: unknown) {
    return this.appendChild(child);
  }
  replaceChild(newChild: MockDomElement | P5CanvasShim, oldChild: MockDomElement | P5CanvasShim) {
    this.removeChild(oldChild);
    this.appendChild(newChild);
    return oldChild;
  }
  contains(el: unknown): boolean {
    if (el === this) return true;
    for (const c of this._children) {
      if (c === el) return true;
      if ("contains" in c && (c as MockDomElement).contains(el)) return true;
    }
    return false;
  }

  setAttribute(_name: string, _value: string) {}
  getAttribute(_name: string) { return null; }
  hasAttribute(_name: string) { return false; }
  removeAttribute(_name: string) {}
  remove() { (this._parent as MockDomElement)?.removeChild?.(this); }

  getBoundingClientRect() {
    return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, bottom: 0, right: 0, toJSON() { return this; } };
  }

  focus() {}
  blur() {}
  click() {}
  cloneNode() { return new MockDomElement(this._tag); }

  addEventListener(type: string, listener: Listener, options?: boolean | AddEventListenerOptions) { this._et.addEventListener(type, listener, options); }
  removeEventListener(type: string, listener: Listener, options?: boolean | EventListenerOptions) { this._et.removeEventListener(type, listener, options); }
  dispatchEvent(ev: Event) { return this._et.dispatchEvent(ev); }

  getContext() { return null; }

  // p5 might set these on generic elements
  get value() { return ""; }
  set value(_v: string) {}
  get type() { return ""; }
  set type(_v: string) {}
}

// ─── P5CanvasShim ────────────────────────────────────────────────────────
// Canvas element backed by @gfx/canvas (Skia FFI). p5 creates these via
// document.createElement('canvas'), gets a 2D context, and draws through it.

let _createCanvasFn: CreateCanvasFn | null = null;

class P5CanvasShim extends (CanvasBase as new () => object) {
  // @gfx/canvas backing
  _ckCanvas: ReturnType<CreateCanvasFn>;
  _rawCtx: CanvasRenderingContext2D;
  _proxyCtx: CanvasRenderingContext2D;
  _width: number;
  _height: number;
  _dirty = false;

  // DOM compat
  _tag = "canvas";
  _id = "";
  _parent: MockDomElement | P5CanvasShim | null = null;
  _children: (MockDomElement | P5CanvasShim)[] = [];
  _et = new SimpleEventTarget();
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  classList = {
    _classes: new Set<string>(),
    add(...c: string[]) { c.forEach(x => this._classes.add(x)); },
    remove(...c: string[]) { c.forEach(x => this._classes.delete(x)); },
    contains(c: string) { return this._classes.has(c); },
    toggle(c: string) {
      if (this._classes.has(c)) { this._classes.delete(c); return false; }
      this._classes.add(c); return true;
    },
  };
  innerHTML = "";
  textContent = "";

  constructor(w: number, h: number) {
    super();
    this._width = Math.max(1, w);
    this._height = Math.max(1, h);
    if (!_createCanvasFn) throw new Error("@gfx/canvas not loaded yet. Call setupP5Deno() first.");
    this._ckCanvas = _createCanvasFn(this._width, this._height);
    this._rawCtx = this._ckCanvas.getContext("2d")!;
    if (!this._rawCtx) throw new Error("Failed to create 2d context from @gfx/canvas");
    this._proxyCtx = this._buildProxyCtx();
  }

  private _buildProxyCtx(): CanvasRenderingContext2D {
    // deno-lint-ignore no-this-alias
    const self = this;
    return new Proxy({} as Record<string | symbol, unknown>, {
      get(_target, prop) {
        self._ensureCanvas();
        // ctx.canvas should return the P5CanvasShim, not the internal @gfx/canvas
        if (prop === "canvas") return self;
        const val = (self._rawCtx as unknown as Record<string | symbol, unknown>)[prop];
        if (typeof val === "function") return (val as (...a: unknown[]) => unknown).bind(self._rawCtx);
        return val;
      },
      set(_target, prop, value) {
        self._ensureCanvas();
        // Normalize 8-char hex (#RRGGBBAA) → rgba() — Skia FFI doesn't support CSS Color Level 4 hex-alpha
        if ((prop === "fillStyle" || prop === "strokeStyle") &&
            typeof value === "string" && /^#[0-9a-fA-F]{8}$/.test(value)) {
          const r = parseInt(value.slice(1, 3), 16);
          const gv = parseInt(value.slice(3, 5), 16);
          const b = parseInt(value.slice(5, 7), 16);
          const a = parseInt(value.slice(7, 9), 16) / 255;
          value = `rgba(${r}, ${gv}, ${b}, ${a})`;
        }
        (self._rawCtx as unknown as Record<string | symbol, unknown>)[prop] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
  }

  get width() { return this._width; }
  set width(v: number) {
    const newW = Math.max(1, v || 1);
    if (newW !== this._width) {
      this._width = newW;
      this._dirty = true;
    }
  }

  get height() { return this._height; }
  set height(v: number) {
    const newH = Math.max(1, v || 1);
    if (newH !== this._height) {
      this._height = newH;
      this._dirty = true;
    }
  }

  get offsetWidth() { return this._width; }
  get offsetHeight() { return this._height; }
  get clientWidth() { return this._width; }
  get clientHeight() { return this._height; }

  _ensureCanvas() {
    if (this._dirty) {
      if (this._ckCanvas?.dispose) this._ckCanvas.dispose();
      this._ckCanvas = _createCanvasFn!(this._width, this._height);
      this._rawCtx = this._ckCanvas.getContext("2d")!;
      if (!this._rawCtx) throw new Error("Failed to recreate 2d context");
      this._dirty = false;
    }
  }

  getContext(type: string): CanvasRenderingContext2D | null {
    if (type === "2d") {
      this._ensureCanvas();
      return this._proxyCtx;
    }
    return null;
  }

  /** Read RGBA pixels from the Skia surface. */
  getPixelData(): { data: Uint8Array; width: number; height: number } {
    this._ensureCanvas();
    const imgData = this._rawCtx.getImageData(0, 0, this._width, this._height);
    return { data: new Uint8Array(imgData.data.buffer), width: this._width, height: this._height };
  }

  toDataURL(_type?: string) { return "data:image/png;base64,"; }
  toBlob(_cb: unknown, _type?: string) { /* stub */ }

  // DOM compat
  get id() { return this._id; }
  set id(v: string) { this._id = v; _elementsById.set(v, this); }

  get tagName() { return "CANVAS"; }
  get nodeName() { return "CANVAS"; }
  get nodeType() { return 1; }
  get parentNode() { return this._parent; }
  get parentElement() { return this._parent; }
  get childNodes() { return this._children; }
  get children() { return this._children; }
  get firstChild() { return this._children[0] ?? null; }
  get nextSibling() { return null; }

  appendChild(child: MockDomElement | P5CanvasShim) {
    child._parent = this;
    this._children.push(child);
    return child;
  }
  removeChild(child: MockDomElement | P5CanvasShim) {
    child._parent = null;
    this._children = this._children.filter(c => c !== child);
    return child;
  }
  insertBefore(child: MockDomElement | P5CanvasShim, _ref: unknown) {
    return this.appendChild(child);
  }
  contains(el: unknown) { return el === this; }

  setAttribute(_n: string, _v: string) {}
  getAttribute(name: string) {
    if (name === "width") return String(this._width);
    if (name === "height") return String(this._height);
    return null;
  }
  hasAttribute(_n: string) { return false; }
  removeAttribute(_n: string) {}
  remove() { (this._parent as MockDomElement)?.removeChild?.(this); }

  getBoundingClientRect() {
    return {
      x: 0, y: 0, width: this._width, height: this._height,
      top: 0, left: 0, bottom: this._height, right: this._width,
      toJSON() { return this; },
    };
  }

  addEventListener(type: string, listener: Listener, options?: boolean | AddEventListenerOptions) { this._et.addEventListener(type, listener, options); }
  removeEventListener(type: string, listener: Listener, options?: boolean | EventListenerOptions) { this._et.removeEventListener(type, listener, options); }
  dispatchEvent(ev: Event) { return this._et.dispatchEvent(ev); }
  focus() {}
  blur() {}
}

// ─── Document shim ───────────────────────────────────────────────────────

const _docET = new SimpleEventTarget();
const _body = new MockDomElement("body");
const _head = new MockDomElement("head");
const _html = new MockDomElement("html");
// p5 checks body.contains(canvas) — always return true
_body.contains = () => true;

if (typeof g.document === "undefined" || !(g.document as Record<string, unknown>).readyState) {
  g.document = {
    readyState: "complete", // p5 checks this to call _start() immediately

    createElement(tag: string) {
      if (tag.toLowerCase() === "canvas") {
        const c = new P5CanvasShim(100, 100);
        registerElement(c);
        return c;
      }
      const el = new MockDomElement(tag);
      registerElement(el);
      return el;
    },

    createElementNS(_ns: string, tag: string) {
      return (this as unknown as { createElement: (t: string) => unknown }).createElement(tag);
    },

    createTextNode(_text: string) {
      return new MockDomElement("#text");
    },

    createDocumentFragment() {
      return new MockDomElement("fragment");
    },

    createEvent(type: string) {
      return new Event(type);
    },

    getElementById(id: string) {
      return _elementsById.get(id) ?? null;
    },

    getElementsByTagName(tag: string) {
      return _elementsByTag.get(tag.toLowerCase()) ?? [];
    },

    getElementsByClassName(_cls: string) {
      return [];
    },

    querySelector(_sel: string) { return null; },
    querySelectorAll(_sel: string) { return []; },

    hasFocus() { return true; },

    body: _body,
    head: _head,
    documentElement: _html,

    addEventListener: _docET.addEventListener.bind(_docET),
    removeEventListener: _docET.removeEventListener.bind(_docET),
    dispatchEvent: _docET.dispatchEvent.bind(_docET),

    // Fullscreen stubs
    fullscreenElement: null,
    fullscreenEnabled: false,
    exitFullscreen() {},

    // Location
    location: { href: "http://localhost", pathname: "/", search: "" },
    baseURI: "",
    fonts: null,

    implementation: {
      createHTMLDocument() { return g.document; },
    },
  };
}

// ─── Native event → p5 event bridging ────────────────────────────────────

function bridgeNativeEvent(ev: WindowEvent, canvas: P5CanvasShim): void {
  type EventCtor = new (type: string, init?: PointerEventInitLike) => Event;
  const Ptr = g.PointerEvent as EventCtor;
  const Whl = g.WheelEvent as new (type: string, init?: WheelEventInitLike) => Event;

  switch (ev.type) {
    case "mouse_move": {
      // p5 may listen on canvas or document for mousemove/pointermove
      const init: PointerEventInitLike = { clientX: ev.x, clientY: ev.y, bubbles: true };
      canvas.dispatchEvent(new Ptr("mousemove", init));
      canvas.dispatchEvent(new Ptr("pointermove", init));
      _docET.dispatchEvent(new Ptr("mousemove", init));
      _docET.dispatchEvent(new Ptr("pointermove", init));
      break;
    }
    case "mouse_button": {
      const init: PointerEventInitLike = { clientX: ev.x, clientY: ev.y, button: ev.button, bubbles: true };
      if (ev.down) {
        canvas.dispatchEvent(new Ptr("mousedown", init));
        canvas.dispatchEvent(new Ptr("pointerdown", init));
      } else {
        canvas.dispatchEvent(new Ptr("mouseup", init));
        canvas.dispatchEvent(new Ptr("pointerup", init));
        _docET.dispatchEvent(new Ptr("mouseup", init));
        _docET.dispatchEvent(new Ptr("pointerup", init));
        _globalET.dispatchEvent(new Ptr("mouseup", init));
        _globalET.dispatchEvent(new Ptr("pointerup", init));
      }
      break;
    }
    case "scroll": {
      canvas.dispatchEvent(new Whl("wheel", { deltaX: ev.dx, deltaY: ev.dy, bubbles: true }));
      break;
    }
    case "key": {
      const type = ev.down ? "keydown" : "keyup";
      const ke = new KeyboardEvent(type, { key: ev.key, code: ev.key, bubbles: true });
      canvas.dispatchEvent(ke);
      _docET.dispatchEvent(ke);
      _globalET.dispatchEvent(ke);
      break;
    }
  }
}

// ─── Setup ───────────────────────────────────────────────────────────────

export interface P5DenoOptions {
  width?: number;
  height?: number;
  headless?: boolean;
  title?: string;
}

export interface P5DenoContext {
  p5Instance: unknown;
  win: GpuWindow | null;
  canvas: P5CanvasShim | null;
  device: GPUDevice;
  blitPipeline: BlitPipeline | null;
  gpuTexture: GPUTexture | null;
}

export async function setupP5Deno(
  sketch: (p: unknown) => void,
  opts: P5DenoOptions = {},
): Promise<P5DenoContext> {
  const W = opts.width ?? 400;
  const H = opts.height ?? 400;

  // 1. Load @gfx/canvas (Skia FFI)
  console.log("Loading @gfx/canvas (FFI/Skia)...");
  const canvasMod = await import("@gfx/canvas");
  _createCanvasFn = canvasMod.createCanvas as unknown as CreateCanvasFn;
  console.log("@gfx/canvas loaded!");

  // 2. Set window dimensions so p5 can read them
  (globalThis as GlobalShim).innerWidth = W;
  (globalThis as GlobalShim).innerHeight = H;

  // 3. Import p5 (global shims already installed at module scope)
  console.log("Importing p5.js...");
  const p5Module = await import("p5");
  const p5 = p5Module.default;
  (p5 as unknown as Record<string, boolean>).disableFriendlyErrors = true;
  console.log("p5.js loaded!");

  // 4. GPU setup
  let win: GpuWindow | null = null;
  let device: GPUDevice;
  let blitPipeline: BlitPipeline | null = null;
  let gpuTexture: GPUTexture | null = null;

  console.log("Requesting WebGPU adapter...");
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("No WebGPU adapter");
  device = await adapter.requestDevice();

  if (!opts.headless) {
    console.log("Creating window...");
    win = await createGpuWindow(device, { width: W, height: H, title: opts.title ?? "p5.js Deno" });
    console.log("Window created, format:", win.format);

    blitPipeline = createBlitPipeline(device, win.format);
    gpuTexture = device.createTexture({
      size: { width: W, height: H },
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
  }

  // 5. Create p5 instance (instance mode)
  // p5 synchronously calls sketch(p), then _start() (since readyState='complete')
  // which calls setup() → createCanvas() → first draw()
  console.log("Creating p5 instance...");
  // deno-lint-ignore no-explicit-any
  const p5Instance = new (p5 as any)(sketch);
  console.log("p5 instance created!");

  // 6. Find the canvas p5 created
  const canvases = _elementsByTag.get("canvas") ?? [];
  const mainCanvas = [...canvases].reverse().find(c => c instanceof P5CanvasShim) as P5CanvasShim | undefined;

  if (mainCanvas) {
    console.log(`Found p5 canvas: ${mainCanvas.width}x${mainCanvas.height}`);
    // Resize GPU texture to match canvas if p5 used a different size
    if (gpuTexture && (mainCanvas.width !== W || mainCanvas.height !== H)) {
      gpuTexture.destroy();
      gpuTexture = device.createTexture({
        size: { width: mainCanvas.width, height: mainCanvas.height },
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
    }
  } else {
    console.warn("No P5CanvasShim found — p5 may not have created a canvas");
  }

  return { p5Instance, win, canvas: mainCanvas ?? null, device, blitPipeline, gpuTexture };
}

// ─── Render loop (windowed) ──────────────────────────────────────────────

export async function runP5RenderLoop(
  ctx: P5DenoContext,
  opts: { maxFrames?: number; autoClose?: boolean } = {},
): Promise<void> {
  const { win, canvas, device, blitPipeline, gpuTexture } = ctx;
  if (!win || !canvas || !blitPipeline || !gpuTexture) {
    throw new Error("runP5RenderLoop requires windowed context (non-headless)");
  }

  const maxFrames = opts.maxFrames ?? 600;
  const autoClose = opts.autoClose ?? true;
  let running = true;
  let frame = 0;

  console.log("Starting p5 render loop...");

  while (running && (!autoClose || frame < maxFrames)) {
    // 1. Poll native window events
    const events = win.pollEvents();
    for (const ev of events) {
      if (ev.type === "close") running = false;
      bridgeNativeEvent(ev, canvas);
    }
    if (!running || win.closed) break;

    // 2. Drain queued rAF callbacks — this runs p5's _draw() which calls user's draw()
    const callbacks = _rafCallbacks.splice(0);
    const now = performance.now();
    for (const cb of callbacks) {
      cb(now);
    }

    // 3. Read pixels from @gfx/canvas (Skia surface)
    const pixels = canvas.getPixelData();

    // 4. Upload RGBA pixels to GPU texture
    const upload = Uint8Array.from(pixels.data);
    device.queue.writeTexture(
      { texture: gpuTexture },
      upload,
      { bytesPerRow: pixels.width * 4, rowsPerImage: pixels.height },
      { width: pixels.width, height: pixels.height },
    );

    // 5. Blit texture to window surface
    const swapTexture = win.ctx.getCurrentTexture();
    const encoder = device.createCommandEncoder();
    blit(device, encoder, blitPipeline, gpuTexture.createView(), swapTexture.createView());
    device.queue.submit([encoder.finish()]);

    // 6. Present
    try {
      win.present();
    } catch (e) {
      console.error("Present error at frame", frame, ":", e);
      break;
    }

    frame++;
    await new Promise(r => setTimeout(r, 0));
  }

  console.log(`Rendered ${frame} frames`);
}

// ─── Headless snapshot ───────────────────────────────────────────────────

export async function snapshotP5Frame(
  ctx: P5DenoContext,
  outPath: string,
): Promise<void> {
  const { p5Instance, canvas } = ctx;
  if (!canvas) throw new Error("No canvas found");

  // Trigger one frame render via p5's redraw
  (p5Instance as { redraw: () => void }).redraw();

  // Read RGBA pixels from Skia surface
  const pixels = canvas.getPixelData();

  // Encode to PNG and write
  const { encodePNG } = await import("@img/png");
  const dir = outPath.substring(0, outPath.lastIndexOf("/"));
  if (dir) await Deno.mkdir(dir, { recursive: true });
  const png = await encodePNG(new Uint8Array(pixels.data), {
    width: pixels.width,
    height: pixels.height,
    compression: 0,
    filter: 0,
    interlace: 0,
  });
  await Deno.writeFile(outPath, png);
  console.log(`Snapshot: ${outPath} (${pixels.width}x${pixels.height})`);
}

// ─── Cleanup ─────────────────────────────────────────────────────────────

export function cleanupP5Deno(ctx: P5DenoContext): void {
  try { ctx.gpuTexture?.destroy(); } catch (_) { /* ignore */ }
  try { ctx.win?.close(); } catch (_) { /* ignore */ }
  try { ctx.device.destroy(); } catch (_) { /* ignore */ }
}
