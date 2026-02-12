/// <reference lib="dom" />

import earcut from "earcut";

export interface P5GPUOptions {
  width: number;
  height: number;
  format?: GPUTextureFormat;
}

type Vec2 = [number, number];
type ColorTuple = [number, number, number, number];

type DrawBatch = {
  startVertex: number;
  vertexCount: number;
  blendMode: number;
};

type ShapeBuilder = {
  kind: number | null;
  rings: Vec2[][];
  activeRing: number;
  curvePoints: Vec2[];
};

interface DrawState {
  matrix: Float32Array;
  fillEnabled: boolean;
  fillColor: ColorTuple;
  strokeEnabled: boolean;
  strokeColor: ColorTuple;
  strokeWeight: number;
  strokeCap: number;
  strokeJoin: number;
  rectMode: number;
  ellipseMode: number;
  colorMode: number;
  colorMaxes: [number, number, number, number];
  blendMode: number;
  curveTightness: number;
  eraseMode: boolean;
  eraseFillStrength: number;
  eraseStrokeStrength: number;
}

const EPS = 1e-6;
const FLOATS_PER_VERTEX = 6;
const BYTES_PER_VERTEX = FLOATS_PER_VERTEX * 4;

const P5_CONST = {
  CORNER: 0,
  CORNERS: 1,
  CENTER: 2,
  RADIUS: 3,

  ROUND: 10,
  SQUARE: 11,
  PROJECT: 12,
  MITER: 13,
  BEVEL: 14,

  CLOSE: 20,

  POINTS: 30,
  LINES: 31,
  TRIANGLES: 32,
  TRIANGLE_FAN: 33,
  TRIANGLE_STRIP: 34,
  QUADS: 35,
  QUAD_STRIP: 36,

  OPEN: 40,
  CHORD: 41,
  PIE: 42,

  RGB: 50,
  HSB: 51,
  HSL: 52,

  BLEND: 60,
  ADD: 61,
  DARKEST: 62,
  LIGHTEST: 63,
  DIFFERENCE: 64,
  EXCLUSION: 65,
  MULTIPLY: 66,
  SCREEN: 67,
  REPLACE: 68,
  REMOVE: 69,
  OVERLAY: 70,
  HARD_LIGHT: 71,
  SOFT_LIGHT: 72,
  DODGE: 73,
  BURN: 74,
} as const;

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function identityMatrix(): Float32Array {
  return new Float32Array([1, 0, 0, 1, 0, 0]);
}

function cloneState(state: DrawState): DrawState {
  return {
    matrix: new Float32Array(state.matrix),
    fillEnabled: state.fillEnabled,
    fillColor: [...state.fillColor] as ColorTuple,
    strokeEnabled: state.strokeEnabled,
    strokeColor: [...state.strokeColor] as ColorTuple,
    strokeWeight: state.strokeWeight,
    strokeCap: state.strokeCap,
    strokeJoin: state.strokeJoin,
    rectMode: state.rectMode,
    ellipseMode: state.ellipseMode,
    colorMode: state.colorMode,
    colorMaxes: [...state.colorMaxes] as [number, number, number, number],
    blendMode: state.blendMode,
    curveTightness: state.curveTightness,
    eraseMode: state.eraseMode,
    eraseFillStrength: state.eraseFillStrength,
    eraseStrokeStrength: state.eraseStrokeStrength,
  };
}

function multiplyAffineInPlace(m: Float32Array, n0: number, n1: number, n2: number, n3: number, n4: number, n5: number): void {
  const a = m[0];
  const b = m[1];
  const c = m[2];
  const d = m[3];
  const tx = m[4];
  const ty = m[5];

  m[0] = a * n0 + c * n1;
  m[1] = b * n0 + d * n1;
  m[2] = a * n2 + c * n3;
  m[3] = b * n2 + d * n3;
  m[4] = a * n4 + c * n5 + tx;
  m[5] = b * n4 + d * n5 + ty;
}

function transformPoint(m: Float32Array, x: number, y: number): Vec2 {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function normalize(vx: number, vy: number): Vec2 {
  const len = Math.hypot(vx, vy);
  if (len <= EPS) return [0, 0];
  return [vx / len, vy / len];
}

function lineIntersectionPoint(p1: Vec2, d1: Vec2, p2: Vec2, d2: Vec2): Vec2 | null {
  const denom = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(denom) < EPS) return null;
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const t = (dx * d2[1] - dy * d2[0]) / denom;
  return [p1[0] + d1[0] * t, p1[1] + d1[1] * t];
}

function hsbToRgb(h: number, s: number, v: number): [number, number, number] {
  const hh = ((h % 1) + 1) % 1;
  const i = Math.floor(hh * 6);
  const f = hh * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);

  switch (i % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hh = ((h % 1) + 1) % 1;
  if (s <= EPS) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hueToRgb = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return [hueToRgb(hh + 1 / 3), hueToRgb(hh), hueToRgb(hh - 1 / 3)];
}

function parseRgbLikeComponent(raw: string): number {
  const trimmed = raw.trim();
  if (trimmed.endsWith("%")) {
    const value = Number(trimmed.slice(0, -1));
    if (!Number.isFinite(value)) return 0;
    return clamp(value / 100) * 255;
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return 0;
  return value;
}

function alignTo(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function createDefaultState(): DrawState {
  return {
    matrix: identityMatrix(),
    fillEnabled: true,
    fillColor: [1, 1, 1, 1],
    strokeEnabled: true,
    strokeColor: [0, 0, 0, 1],
    strokeWeight: 1,
    strokeCap: P5_CONST.ROUND,
    strokeJoin: P5_CONST.MITER,
    rectMode: P5_CONST.CORNER,
    ellipseMode: P5_CONST.CENTER,
    colorMode: P5_CONST.RGB,
    colorMaxes: [255, 255, 255, 255],
    blendMode: P5_CONST.BLEND,
    curveTightness: 0,
    eraseMode: false,
    eraseFillStrength: 255,
    eraseStrokeStrength: 255,
  };
}

function resolveBlendState(mode: number): GPUBlendState {
  switch (mode) {
    case P5_CONST.ADD:
      return {
        color: { operation: "add", srcFactor: "src-alpha", dstFactor: "one" },
        alpha: { operation: "add", srcFactor: "one", dstFactor: "one" },
      };
    case P5_CONST.MULTIPLY:
      return {
        color: { operation: "add", srcFactor: "dst", dstFactor: "one-minus-src-alpha" },
        alpha: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" },
      };
    case P5_CONST.SCREEN:
      return {
        color: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src" },
        alpha: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" },
      };
    case P5_CONST.REPLACE:
      return {
        color: { operation: "add", srcFactor: "one", dstFactor: "zero" },
        alpha: { operation: "add", srcFactor: "one", dstFactor: "zero" },
      };
    case P5_CONST.BLEND:
    default:
      return {
        color: { operation: "add", srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
        alpha: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" },
      };
  }
}

const SHADER_SOURCE = /* wgsl */`
struct CanvasUniform {
  size: vec2f,
}

@group(0) @binding(0) var<uniform> uCanvas: CanvasUniform;

struct VertexIn {
  @location(0) position: vec2f,
  @location(1) color: vec4f,
}

struct VertexOut {
  @builtin(position) clipPos: vec4f,
  @location(0) color: vec4f,
}

@vertex
fn vsMain(v: VertexIn) -> VertexOut {
  let ndc = vec2f(
    (v.position.x / uCanvas.size.x) * 2.0 - 1.0,
    -((v.position.y / uCanvas.size.y) * 2.0 - 1.0)
  );

  var out: VertexOut;
  out.clipPos = vec4f(ndc, 0.0, 1.0);
  out.color = v.color;
  return out;
}

@fragment
fn fsMain(v: VertexOut) -> @location(0) vec4f {
  return v.color;
}
`;

export class P5GPU {
  public readonly CORNER = P5_CONST.CORNER;
  public readonly CORNERS = P5_CONST.CORNERS;
  public readonly CENTER = P5_CONST.CENTER;
  public readonly RADIUS = P5_CONST.RADIUS;

  public readonly ROUND = P5_CONST.ROUND;
  public readonly SQUARE = P5_CONST.SQUARE;
  public readonly PROJECT = P5_CONST.PROJECT;
  public readonly MITER = P5_CONST.MITER;
  public readonly BEVEL = P5_CONST.BEVEL;

  public readonly CLOSE = P5_CONST.CLOSE;

  public readonly POINTS = P5_CONST.POINTS;
  public readonly LINES = P5_CONST.LINES;
  public readonly TRIANGLES = P5_CONST.TRIANGLES;
  public readonly TRIANGLE_FAN = P5_CONST.TRIANGLE_FAN;
  public readonly TRIANGLE_STRIP = P5_CONST.TRIANGLE_STRIP;
  public readonly QUADS = P5_CONST.QUADS;
  public readonly QUAD_STRIP = P5_CONST.QUAD_STRIP;

  public readonly OPEN = P5_CONST.OPEN;
  public readonly CHORD = P5_CONST.CHORD;
  public readonly PIE = P5_CONST.PIE;

  public readonly RGB = P5_CONST.RGB;
  public readonly HSB = P5_CONST.HSB;
  public readonly HSL = P5_CONST.HSL;

  public readonly BLEND = P5_CONST.BLEND;
  public readonly ADD = P5_CONST.ADD;
  public readonly DARKEST = P5_CONST.DARKEST;
  public readonly LIGHTEST = P5_CONST.LIGHTEST;
  public readonly DIFFERENCE = P5_CONST.DIFFERENCE;
  public readonly EXCLUSION = P5_CONST.EXCLUSION;
  public readonly MULTIPLY = P5_CONST.MULTIPLY;
  public readonly SCREEN = P5_CONST.SCREEN;
  public readonly REPLACE = P5_CONST.REPLACE;
  public readonly REMOVE = P5_CONST.REMOVE;
  public readonly OVERLAY = P5_CONST.OVERLAY;
  public readonly HARD_LIGHT = P5_CONST.HARD_LIGHT;
  public readonly SOFT_LIGHT = P5_CONST.SOFT_LIGHT;
  public readonly DODGE = P5_CONST.DODGE;
  public readonly BURN = P5_CONST.BURN;

  public readonly PI = Math.PI;
  public readonly TWO_PI = Math.PI * 2;
  public readonly HALF_PI = Math.PI * 0.5;
  public readonly QUARTER_PI = Math.PI * 0.25;
  public readonly TAU = Math.PI * 2;

  readonly device: GPUDevice;
  readonly width: number;
  readonly height: number;
  readonly format: GPUTextureFormat;
  readonly outputTexture: GPUTexture;

  pixels: Uint8ClampedArray;

  private _state: DrawState;
  private _stack: DrawState[] = [];
  private _shape: ShapeBuilder | null = null;

  private _shaderModule: GPUShaderModule;
  private _uniformBuffer: GPUBuffer;
  private _bindGroupLayout: GPUBindGroupLayout;
  private _bindGroup: GPUBindGroup;
  private _pipelineLayout: GPUPipelineLayout;
  private _pipelineCache = new Map<number, GPURenderPipeline>();

  private _vertices: number[] = [];
  private _vertexCount = 0;
  private _batches: DrawBatch[] = [];

  private _vertexBuffer: GPUBuffer | null = null;
  private _vertexBufferCapacityBytes = 0;

  private _clearRequested = false;
  private _clearColor: ColorTuple = [0, 0, 0, 0];
  private _hasRenderedFrame = false;

  constructor(device: GPUDevice, opts: P5GPUOptions) {
    this.device = device;
    this.width = Math.max(1, Math.floor(opts.width));
    this.height = Math.max(1, Math.floor(opts.height));
    this.format = opts.format ?? "rgba8unorm";
    this.outputTexture = this.device.createTexture({
      size: { width: this.width, height: this.height },
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
    });

    this._state = createDefaultState();
    this._state.strokeColor = [0, 0, 0, 1];
    this._state.fillColor = [1, 1, 1, 1];

    this._shaderModule = this.device.createShaderModule({ code: SHADER_SOURCE });
    this._bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "uniform" },
        },
      ],
    });

    this._pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [this._bindGroupLayout] });
    this._uniformBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this._uniformBuffer, 0, new Float32Array([this.width, this.height]));

    this._bindGroup = this.device.createBindGroup({
      layout: this._bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this._uniformBuffer } }],
    });

    this.pixels = new Uint8ClampedArray(this.width * this.height * 4);
  }

  beginFrame(): void {
    this._vertices.length = 0;
    this._vertexCount = 0;
    this._batches.length = 0;
    this._shape = null;
    this._clearRequested = false;
    this._clearColor = [0, 0, 0, 0];
  }

  endFrame(): GPUTexture {
    const encoder = this.device.createCommandEncoder();
    const loadOp: GPULoadOp = (this._clearRequested || !this._hasRenderedFrame) ? "clear" : "load";
    const clearColor: GPUColor = {
      r: this._clearColor[0],
      g: this._clearColor[1],
      b: this._clearColor[2],
      a: this._clearColor[3],
    };

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.outputTexture.createView(),
          loadOp,
          storeOp: "store",
          clearValue: clearColor,
        },
      ],
    });

    pass.setBindGroup(0, this._bindGroup);

    if (this._vertexCount > 0) {
      const vertexData = new Float32Array(this._vertices);
      this._ensureVertexBuffer(vertexData.byteLength);
      this.device.queue.writeBuffer(this._vertexBuffer!, 0, vertexData.buffer, vertexData.byteOffset, vertexData.byteLength);
      pass.setVertexBuffer(0, this._vertexBuffer!);

      for (const batch of this._batches) {
        if (batch.vertexCount <= 0) continue;
        pass.setPipeline(this._getPipeline(batch.blendMode));
        pass.draw(batch.vertexCount, 1, batch.startVertex, 0);
      }
    }

    pass.end();
    this.device.queue.submit([encoder.finish()]);
    this._hasRenderedFrame = true;
    return this.outputTexture;
  }

  dispose(): void {
    try { this._vertexBuffer?.destroy(); } catch (_) { /* ignore */ }
    try { this._uniformBuffer.destroy(); } catch (_) { /* ignore */ }
    try { this.outputTexture.destroy(); } catch (_) { /* ignore */ }
  }

  push(): void {
    this._stack.push(cloneState(this._state));
  }

  pop(): void {
    const prev = this._stack.pop();
    if (prev) this._state = prev;
  }

  resetMatrix(): void {
    this._state.matrix.set(identityMatrix());
  }

  translate(x: number, y: number): void {
    multiplyAffineInPlace(this._state.matrix, 1, 0, 0, 1, toNumber(x), toNumber(y));
  }

  rotate(angle: number): void {
    const theta = toNumber(angle);
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    multiplyAffineInPlace(this._state.matrix, c, s, -s, c, 0, 0);
  }

  scale(s: number, sy?: number): void {
    const sx = toNumber(s, 1);
    const y = sy === undefined ? sx : toNumber(sy, sx);
    multiplyAffineInPlace(this._state.matrix, sx, 0, 0, y, 0, 0);
  }

  shearX(angle: number): void {
    multiplyAffineInPlace(this._state.matrix, 1, 0, Math.tan(toNumber(angle)), 1, 0, 0);
  }

  shearY(angle: number): void {
    multiplyAffineInPlace(this._state.matrix, 1, Math.tan(toNumber(angle)), 0, 1, 0, 0);
  }

  applyMatrix(a: number, b: number, c: number, d: number, e: number, f: number): void {
    multiplyAffineInPlace(this._state.matrix, toNumber(a), toNumber(b), toNumber(c), toNumber(d), toNumber(e), toNumber(f));
  }

  rectMode(mode: number): void {
    this._state.rectMode = toNumber(mode, this.CORNER);
  }

  ellipseMode(mode: number): void {
    this._state.ellipseMode = toNumber(mode, this.CENTER);
  }

  colorMode(mode: number, max1 = 255, max2 = max1, max3 = max1, maxA = 255): void {
    this._state.colorMode = toNumber(mode, this.RGB);
    this._state.colorMaxes = [
      Math.max(EPS, toNumber(max1, 255)),
      Math.max(EPS, toNumber(max2, 255)),
      Math.max(EPS, toNumber(max3, 255)),
      Math.max(EPS, toNumber(maxA, 255)),
    ];
  }

  blendMode(mode: number): void {
    this._state.blendMode = toNumber(mode, this.BLEND);
  }

  erase(strengthFill = 255, strengthStroke = 255): void {
    this._state.eraseMode = true;
    this._state.eraseFillStrength = clamp(toNumber(strengthFill, 255), 0, 255);
    this._state.eraseStrokeStrength = clamp(toNumber(strengthStroke, 255), 0, 255);
  }

  noErase(): void {
    this._state.eraseMode = false;
  }

  fill(v1: unknown, v2?: unknown, v3?: unknown, a?: unknown): void {
    this._state.fillEnabled = true;
    this._state.fillColor = this._parseColor(v1, v2, v3, a);
  }

  noFill(): void {
    this._state.fillEnabled = false;
  }

  stroke(v1: unknown, v2?: unknown, v3?: unknown, a?: unknown): void {
    this._state.strokeEnabled = true;
    this._state.strokeColor = this._parseColor(v1, v2, v3, a);
  }

  noStroke(): void {
    this._state.strokeEnabled = false;
  }

  strokeWeight(weight: number): void {
    this._state.strokeWeight = Math.max(0, toNumber(weight, 1));
  }

  strokeCap(cap: number): void {
    this._state.strokeCap = toNumber(cap, this.ROUND);
  }

  strokeJoin(join: number): void {
    this._state.strokeJoin = toNumber(join, this.MITER);
  }

  curveTightness(amount: number): void {
    this._state.curveTightness = toNumber(amount);
  }

  background(v1: unknown, v2?: unknown, v3?: unknown, a?: unknown): void {
    this._clearRequested = true;
    this._clearColor = this._parseColor(v1, v2, v3, a);
  }

  clear(): void {
    this._clearRequested = true;
    this._clearColor = [0, 0, 0, 0];
  }

  rect(x: number, y: number, w: number, h?: number, tl?: number, tr?: number, br?: number, bl?: number): void {
    const rect = this._resolveRect(x, y, w, h);
    const hasRounding = tl !== undefined || tr !== undefined || br !== undefined || bl !== undefined;

    if (!hasRounding) {
      const p0: Vec2 = [rect.x, rect.y];
      const p1: Vec2 = [rect.x + rect.w, rect.y];
      const p2: Vec2 = [rect.x + rect.w, rect.y + rect.h];
      const p3: Vec2 = [rect.x, rect.y + rect.h];

      if (this._state.fillEnabled) {
        const fillColor = this._effectiveFillColor();
        this._emitLocalTriangle(p0, p1, p2, fillColor);
        this._emitLocalTriangle(p0, p2, p3, fillColor);
      }
      if (this._state.strokeEnabled && this._state.strokeWeight > 0) {
        const strokeColor = this._effectiveStrokeColor();
        this._emitStrokePathLocal([p0, p1, p2, p3], true, strokeColor);
      }
      return;
    }

    const points = this._buildRoundedRectPoints(
      rect.x,
      rect.y,
      rect.w,
      rect.h,
      [toNumber(tl, 0), toNumber(tr, tl ?? 0), toNumber(br, tl ?? 0), toNumber(bl, tr ?? tl ?? 0)],
    );

    if (this._state.fillEnabled && points.length >= 3) {
      this._emitPolygonFillLocal([points], this._effectiveFillColor());
    }
    if (this._state.strokeEnabled && this._state.strokeWeight > 0 && points.length >= 2) {
      this._emitStrokePathLocal(points, true, this._effectiveStrokeColor());
    }
  }

  square(x: number, y: number, size: number, tl?: number, tr?: number, br?: number, bl?: number): void {
    this.rect(x, y, size, size, tl, tr, br, bl);
  }

  triangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): void {
    const a: Vec2 = [toNumber(x1), toNumber(y1)];
    const b: Vec2 = [toNumber(x2), toNumber(y2)];
    const c: Vec2 = [toNumber(x3), toNumber(y3)];

    if (this._state.fillEnabled) {
      this._emitLocalTriangle(a, b, c, this._effectiveFillColor());
    }
    if (this._state.strokeEnabled && this._state.strokeWeight > 0) {
      this._emitStrokePathLocal([a, b, c], true, this._effectiveStrokeColor());
    }
  }

  quad(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number): void {
    const a: Vec2 = [toNumber(x1), toNumber(y1)];
    const b: Vec2 = [toNumber(x2), toNumber(y2)];
    const c: Vec2 = [toNumber(x3), toNumber(y3)];
    const d: Vec2 = [toNumber(x4), toNumber(y4)];

    if (this._state.fillEnabled) {
      const fillColor = this._effectiveFillColor();
      this._emitLocalTriangle(a, b, c, fillColor);
      this._emitLocalTriangle(a, c, d, fillColor);
    }
    if (this._state.strokeEnabled && this._state.strokeWeight > 0) {
      this._emitStrokePathLocal([a, b, c, d], true, this._effectiveStrokeColor());
    }
  }

  ellipse(x: number, y: number, w: number, h?: number): void {
    const e = this._resolveEllipse(x, y, w, h);
    if (e.rx <= EPS || e.ry <= EPS) return;

    const points = this._buildEllipsePoints(e.cx, e.cy, e.rx, e.ry, 0, Math.PI * 2);

    if (this._state.fillEnabled) {
      const center = transformPoint(this._state.matrix, e.cx, e.cy);
      const fillColor = this._effectiveFillColor();
      for (let i = 0; i < points.length; i++) {
        const p0 = transformPoint(this._state.matrix, points[i][0], points[i][1]);
        const p1 = transformPoint(this._state.matrix, points[(i + 1) % points.length][0], points[(i + 1) % points.length][1]);
        this._emitTriangle(center, p0, p1, fillColor);
      }
    }

    if (this._state.strokeEnabled && this._state.strokeWeight > 0) {
      this._emitStrokePathLocal(points, true, this._effectiveStrokeColor());
    }
  }

  circle(x: number, y: number, d: number): void {
    this.ellipse(x, y, d, d);
  }

  arc(x: number, y: number, w: number, h: number, start: number, stop: number, mode: number = this.OPEN): void {
    const e = this._resolveEllipse(x, y, w, h);
    if (e.rx <= EPS || e.ry <= EPS) return;

    let s = toNumber(start);
    let t = toNumber(stop);
    if (!Number.isFinite(s) || !Number.isFinite(t)) return;

    while (t < s) t += Math.PI * 2;
    const span = Math.max(EPS, t - s);
    const points = this._buildEllipsePoints(e.cx, e.cy, e.rx, e.ry, s, s + span);

    if (this._state.fillEnabled && mode !== this.OPEN) {
      const fillColor = this._effectiveFillColor();
      if (mode === this.CHORD) {
        this._emitPolygonFillLocal([points], fillColor);
      } else {
        const center = transformPoint(this._state.matrix, e.cx, e.cy);
        for (let i = 0; i < points.length - 1; i++) {
          const p0 = transformPoint(this._state.matrix, points[i][0], points[i][1]);
          const p1 = transformPoint(this._state.matrix, points[i + 1][0], points[i + 1][1]);
          this._emitTriangle(center, p0, p1, fillColor);
        }
      }
    }

    if (this._state.strokeEnabled && this._state.strokeWeight > 0) {
      const strokeColor = this._effectiveStrokeColor();
      if (mode === this.PIE) {
        this._emitStrokePathLocal([[e.cx, e.cy], ...points], true, strokeColor);
      } else if (mode === this.CHORD) {
        this._emitStrokePathLocal(points, true, strokeColor);
      } else {
        this._emitStrokePathLocal(points, false, strokeColor);
      }
    }
  }

  line(x1: number, y1: number, x2: number, y2: number): void {
    if (!this._state.strokeEnabled || this._state.strokeWeight <= 0) return;
    this._emitStrokePathLocal(
      [
        [toNumber(x1), toNumber(y1)],
        [toNumber(x2), toNumber(y2)],
      ],
      false,
      this._effectiveStrokeColor(),
    );
  }

  point(x: number, y: number): void {
    if (!this._state.strokeEnabled || this._state.strokeWeight <= 0) return;
    const scale = this._estimatedStrokeScale();
    const diameter = Math.max(1, this._state.strokeWeight * scale);
    const radius = diameter * 0.5;
    const center = transformPoint(this._state.matrix, toNumber(x), toNumber(y));
    const segments = Math.max(8, Math.ceil((Math.PI * 2 * radius) / 3));
    const color = this._effectiveStrokeColor();

    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      const p0: Vec2 = [center[0] + Math.cos(a0) * radius, center[1] + Math.sin(a0) * radius];
      const p1: Vec2 = [center[0] + Math.cos(a1) * radius, center[1] + Math.sin(a1) * radius];
      this._emitTriangle(center, p0, p1, color);
    }
  }

  beginShape(kind?: number): void {
    this._shape = {
      kind: kind === undefined ? null : toNumber(kind),
      rings: [[]],
      activeRing: 0,
      curvePoints: [],
    };
  }

  endShape(mode?: number): void {
    const shape = this._shape;
    if (!shape) return;
    this._shape = null;

    const closeRequested = mode === this.CLOSE;
    const outer = shape.rings[0] ?? [];
    if (outer.length === 0) return;

    if (shape.kind === null) {
      if (this._state.fillEnabled) {
        this._emitPolygonFillLocal(shape.rings.filter((ring) => ring.length >= 3), this._effectiveFillColor());
      }
      if (this._state.strokeEnabled && this._state.strokeWeight > 0) {
        const strokeColor = this._effectiveStrokeColor();
        for (let i = 0; i < shape.rings.length; i++) {
          const ring = shape.rings[i];
          if (ring.length < 2) continue;
          this._emitStrokePathLocal(ring, i > 0 || closeRequested, strokeColor);
        }
      }
      return;
    }

    switch (shape.kind) {
      case P5_CONST.POINTS:
        for (const [x, y] of outer) this.point(x, y);
        return;
      case P5_CONST.LINES:
        for (let i = 0; i + 1 < outer.length; i += 2) {
          const a = outer[i];
          const b = outer[i + 1];
          this.line(a[0], a[1], b[0], b[1]);
        }
        return;
      case P5_CONST.TRIANGLES:
        for (let i = 0; i + 2 < outer.length; i += 3) {
          const a = outer[i];
          const b = outer[i + 1];
          const c = outer[i + 2];
          this.triangle(a[0], a[1], b[0], b[1], c[0], c[1]);
        }
        return;
      case P5_CONST.TRIANGLE_FAN:
        for (let i = 1; i + 1 < outer.length; i++) {
          const a = outer[0];
          const b = outer[i];
          const c = outer[i + 1];
          this.triangle(a[0], a[1], b[0], b[1], c[0], c[1]);
        }
        return;
      case P5_CONST.TRIANGLE_STRIP:
        for (let i = 0; i + 2 < outer.length; i++) {
          const a = outer[i];
          const b = outer[i + 1];
          const c = outer[i + 2];
          this.triangle(a[0], a[1], b[0], b[1], c[0], c[1]);
        }
        return;
      case P5_CONST.QUADS:
        for (let i = 0; i + 3 < outer.length; i += 4) {
          const a = outer[i];
          const b = outer[i + 1];
          const c = outer[i + 2];
          const d = outer[i + 3];
          this.quad(a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]);
        }
        return;
      case P5_CONST.QUAD_STRIP:
        for (let i = 0; i + 3 < outer.length; i += 2) {
          const a = outer[i];
          const b = outer[i + 1];
          const c = outer[i + 3];
          const d = outer[i + 2];
          this.quad(a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]);
        }
        return;
      default:
        return;
    }
  }

  vertex(x: number, y: number): void {
    if (!this._shape) return;
    const ring = this._shape.rings[this._shape.activeRing];
    ring.push([toNumber(x), toNumber(y)]);
  }

  beginContour(): void {
    if (!this._shape || this._shape.kind !== null) return;
    this._shape.rings.push([]);
    this._shape.activeRing = this._shape.rings.length - 1;
  }

  endContour(): void {
    if (!this._shape || this._shape.kind !== null) return;
    this._shape.activeRing = 0;
  }

  curveVertex(x: number, y: number): void {
    if (!this._shape) return;
    this._shape.curvePoints.push([toNumber(x), toNumber(y)]);
    if (this._shape.curvePoints.length < 4) return;
    const points = this._shape.curvePoints;
    const p0 = points[points.length - 4];
    const p1 = points[points.length - 3];
    const p2 = points[points.length - 2];
    const p3 = points[points.length - 1];
    const sampled = this._sampleCatmullRom(p0, p1, p2, p3, 48, this._state.curveTightness);
    const ring = this._shape.rings[this._shape.activeRing];
    if (ring.length === 0) ring.push(sampled[0]);
    for (let i = 1; i < sampled.length; i++) ring.push(sampled[i]);
  }

  bezierVertex(x2: number, y2: number, x3: number, y3: number, x4: number, y4: number): void {
    if (!this._shape) return;
    const ring = this._shape.rings[this._shape.activeRing];
    const last = ring[ring.length - 1];
    if (!last) return;

    const sampled = this._sampleCubicBezier(
      last,
      [toNumber(x2), toNumber(y2)],
      [toNumber(x3), toNumber(y3)],
      [toNumber(x4), toNumber(y4)],
      48,
    );

    for (let i = 1; i < sampled.length; i++) ring.push(sampled[i]);
  }

  quadraticVertex(cx: number, cy: number, x3: number, y3: number): void {
    if (!this._shape) return;
    const ring = this._shape.rings[this._shape.activeRing];
    const last = ring[ring.length - 1];
    if (!last) return;

    const sampled = this._sampleQuadraticBezier(
      last,
      [toNumber(cx), toNumber(cy)],
      [toNumber(x3), toNumber(y3)],
      48,
    );

    for (let i = 1; i < sampled.length; i++) ring.push(sampled[i]);
  }

  bezier(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number): void {
    if (!this._state.strokeEnabled || this._state.strokeWeight <= 0) return;
    const sampled = this._sampleCubicBezier(
      [toNumber(x1), toNumber(y1)],
      [toNumber(x2), toNumber(y2)],
      [toNumber(x3), toNumber(y3)],
      [toNumber(x4), toNumber(y4)],
      72,
    );
    this._emitStrokePathLocal(sampled, false, this._effectiveStrokeColor());
  }

  curve(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number): void {
    if (!this._state.strokeEnabled || this._state.strokeWeight <= 0) return;
    const sampled = this._sampleCatmullRom(
      [toNumber(x1), toNumber(y1)],
      [toNumber(x2), toNumber(y2)],
      [toNumber(x3), toNumber(y3)],
      [toNumber(x4), toNumber(y4)],
      72,
      this._state.curveTightness,
    );
    this._emitStrokePathLocal(sampled, false, this._effectiveStrokeColor());
  }

  lerpColor(c1: unknown, c2: unknown, amt: number): ColorTuple {
    const a = this._parseColor(c1);
    const b = this._parseColor(c2);
    const t = clamp(toNumber(amt), 0, 1);
    return [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
      a[3] + (b[3] - a[3]) * t,
    ];
  }

  async loadPixels(): Promise<void> {
    const bytesPerRow = alignTo(this.width * 4, 256);
    const readBuffer = this.device.createBuffer({
      size: bytesPerRow * this.height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const encoder = this.device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture: this.outputTexture },
      { buffer: readBuffer, bytesPerRow, rowsPerImage: this.height },
      { width: this.width, height: this.height, depthOrArrayLayers: 1 },
    );
    this.device.queue.submit([encoder.finish()]);

    await readBuffer.mapAsync(GPUMapMode.READ);
    const mapped = new Uint8Array(readBuffer.getMappedRange());

    const out = new Uint8ClampedArray(this.width * this.height * 4);
    for (let y = 0; y < this.height; y++) {
      const srcStart = y * bytesPerRow;
      const dstStart = y * this.width * 4;
      out.set(mapped.subarray(srcStart, srcStart + this.width * 4), dstStart);
    }

    this.pixels = out;
    readBuffer.unmap();
    readBuffer.destroy();
  }

  updatePixels(): void {
    if (this.pixels.length !== this.width * this.height * 4) {
      throw new Error("pixels length mismatch; call loadPixels() first or provide full canvas data");
    }

    const upload = Uint8Array.from(this.pixels);
    this.device.queue.writeTexture(
      { texture: this.outputTexture },
      upload,
      { bytesPerRow: this.width * 4, rowsPerImage: this.height },
      { width: this.width, height: this.height, depthOrArrayLayers: 1 },
    );
  }

  get(x: number, y: number): [number, number, number, number];
  get(x: number, y: number, w: number, h: number): Uint8ClampedArray;
  get(x: number, y: number, w?: number, h?: number): [number, number, number, number] | Uint8ClampedArray {
    const xi = Math.floor(toNumber(x));
    const yi = Math.floor(toNumber(y));

    if (w === undefined || h === undefined) {
      if (this.pixels.length !== this.width * this.height * 4) {
        throw new Error("pixels not loaded; call await loadPixels() first");
      }
      if (xi < 0 || yi < 0 || xi >= this.width || yi >= this.height) return [0, 0, 0, 0];
      const idx = (yi * this.width + xi) * 4;
      return [this.pixels[idx], this.pixels[idx + 1], this.pixels[idx + 2], this.pixels[idx + 3]];
    }

    const ww = Math.max(0, Math.floor(toNumber(w)));
    const hh = Math.max(0, Math.floor(toNumber(h)));
    const out = new Uint8ClampedArray(ww * hh * 4);
    if (this.pixels.length !== this.width * this.height * 4) {
      throw new Error("pixels not loaded; call await loadPixels() first");
    }

    for (let yy = 0; yy < hh; yy++) {
      for (let xx = 0; xx < ww; xx++) {
        const srcX = xi + xx;
        const srcY = yi + yy;
        const dstIdx = (yy * ww + xx) * 4;
        if (srcX < 0 || srcY < 0 || srcX >= this.width || srcY >= this.height) continue;
        const srcIdx = (srcY * this.width + srcX) * 4;
        out[dstIdx] = this.pixels[srcIdx];
        out[dstIdx + 1] = this.pixels[srcIdx + 1];
        out[dstIdx + 2] = this.pixels[srcIdx + 2];
        out[dstIdx + 3] = this.pixels[srcIdx + 3];
      }
    }

    return out;
  }

  set(x: number, y: number, c: unknown): void {
    const xi = Math.floor(toNumber(x));
    const yi = Math.floor(toNumber(y));
    if (xi < 0 || yi < 0 || xi >= this.width || yi >= this.height) return;

    if (this.pixels.length !== this.width * this.height * 4) {
      this.pixels = new Uint8ClampedArray(this.width * this.height * 4);
    }

    const color = this._parseColor(c);
    const idx = (yi * this.width + xi) * 4;
    this.pixels[idx] = Math.round(clamp(color[0]) * 255);
    this.pixels[idx + 1] = Math.round(clamp(color[1]) * 255);
    this.pixels[idx + 2] = Math.round(clamp(color[2]) * 255);
    this.pixels[idx + 3] = Math.round(clamp(color[3]) * 255);
  }

  // Image drawing is deferred for now; this keeps parity with plan phases.
  image(_img: unknown, _x: number, _y: number, _w?: number, _h?: number): void {
    throw new Error("P5GPU.image() is not implemented yet");
  }

  private _parseColor(v1?: unknown, v2?: unknown, v3?: unknown, v4?: unknown): ColorTuple {
    if (typeof v1 === "string") {
      const parsed = this._parseColorString(v1);
      if (parsed) return parsed;
    }

    if (Array.isArray(v1) || ArrayBuffer.isView(v1)) {
      const arr = Array.from(v1 as ArrayLike<unknown>).slice(0, 4).map((v) => toNumber(v));
      if (arr.length === 0) return [0, 0, 0, 1];
      if (arr.length === 1) arr.push(arr[0], arr[0], this._state.colorMaxes[3]);
      if (arr.length === 2) {
        const gray = arr[0];
        const alpha = arr[1];
        arr[1] = gray;
        arr.push(gray, alpha);
      }
      if (arr.length === 3) arr.push(this._state.colorMaxes[3]);

      const maxes = this._state.colorMaxes;
      const looksNormalized = arr.every((value) => value >= 0 && value <= 1);
      if (looksNormalized) {
        return [clamp(arr[0]), clamp(arr[1]), clamp(arr[2]), clamp(arr[3])];
      }
      return this._numericColorToRgba(arr[0], arr[1], arr[2], arr[3], maxes);
    }

    if (typeof v1 === "object" && v1) {
      const maybeLevels = v1 as { levels?: ArrayLike<number> };
      if (maybeLevels.levels && maybeLevels.levels.length >= 3) {
        const lv = maybeLevels.levels;
        return [clamp((lv[0] ?? 0) / 255), clamp((lv[1] ?? 0) / 255), clamp((lv[2] ?? 0) / 255), clamp((lv[3] ?? 255) / 255)];
      }
    }

    const n1 = toNumber(v1, 0);
    const hasV2 = v2 !== undefined;
    const hasV3 = v3 !== undefined;
    const hasV4 = v4 !== undefined;

    const maxes = this._state.colorMaxes;

    if (!hasV2 && !hasV3 && !hasV4) {
      return this._numericColorToRgba(n1, n1, n1, maxes[3], maxes);
    }

    if (hasV2 && !hasV3 && !hasV4) {
      const n2 = toNumber(v2, maxes[3]);
      return this._numericColorToRgba(n1, n1, n1, n2, maxes);
    }

    const n2 = toNumber(v2, 0);
    const n3 = toNumber(v3, 0);
    const n4 = hasV4 ? toNumber(v4, maxes[3]) : maxes[3];
    return this._numericColorToRgba(n1, n2, n3, n4, maxes);
  }

  private _numericColorToRgba(c1: number, c2: number, c3: number, a: number, maxes: [number, number, number, number]): ColorTuple {
    const alpha = clamp(a / maxes[3]);

    if (this._state.colorMode === this.HSB) {
      const h = clamp(c1 / maxes[0]);
      const s = clamp(c2 / maxes[1]);
      const b = clamp(c3 / maxes[2]);
      const [r, g, bb] = hsbToRgb(h, s, b);
      return [r, g, bb, alpha];
    }

    if (this._state.colorMode === this.HSL) {
      const h = clamp(c1 / maxes[0]);
      const s = clamp(c2 / maxes[1]);
      const l = clamp(c3 / maxes[2]);
      const [r, g, bb] = hslToRgb(h, s, l);
      return [r, g, bb, alpha];
    }

    return [
      clamp(c1 / maxes[0]),
      clamp(c2 / maxes[1]),
      clamp(c3 / maxes[2]),
      alpha,
    ];
  }

  private _parseColorString(value: string): ColorTuple | null {
    const input = value.trim().toLowerCase();

    const named = new Map<string, ColorTuple>([
      ["black", [0, 0, 0, 1]],
      ["white", [1, 1, 1, 1]],
      ["red", [1, 0, 0, 1]],
      ["green", [0, 0.5, 0, 1]],
      ["blue", [0, 0, 1, 1]],
      ["transparent", [0, 0, 0, 0]],
    ]);
    if (named.has(input)) return named.get(input)!;

    if (/^#[0-9a-f]{3}$/.test(input)) {
      const r = parseInt(input[1] + input[1], 16);
      const g = parseInt(input[2] + input[2], 16);
      const b = parseInt(input[3] + input[3], 16);
      return [r / 255, g / 255, b / 255, 1];
    }

    if (/^#[0-9a-f]{4}$/.test(input)) {
      const r = parseInt(input[1] + input[1], 16);
      const g = parseInt(input[2] + input[2], 16);
      const b = parseInt(input[3] + input[3], 16);
      const a = parseInt(input[4] + input[4], 16);
      return [r / 255, g / 255, b / 255, a / 255];
    }

    if (/^#[0-9a-f]{6}$/.test(input)) {
      const r = parseInt(input.slice(1, 3), 16);
      const g = parseInt(input.slice(3, 5), 16);
      const b = parseInt(input.slice(5, 7), 16);
      return [r / 255, g / 255, b / 255, 1];
    }

    if (/^#[0-9a-f]{8}$/.test(input)) {
      const r = parseInt(input.slice(1, 3), 16);
      const g = parseInt(input.slice(3, 5), 16);
      const b = parseInt(input.slice(5, 7), 16);
      const a = parseInt(input.slice(7, 9), 16);
      return [r / 255, g / 255, b / 255, a / 255];
    }

    const rgbMatch = input.match(/^rgba?\((.+)\)$/);
    if (rgbMatch) {
      const parts = rgbMatch[1].split(",").map((p) => p.trim());
      if (parts.length === 3 || parts.length === 4) {
        const r = parseRgbLikeComponent(parts[0]);
        const g = parseRgbLikeComponent(parts[1]);
        const b = parseRgbLikeComponent(parts[2]);
        let a = 255;
        if (parts.length === 4) {
          const alphaRaw = parts[3];
          if (alphaRaw.endsWith("%")) {
            a = clamp(Number(alphaRaw.slice(0, -1)) / 100) * 255;
          } else {
            const alpha = Number(alphaRaw);
            a = alpha <= 1 ? clamp(alpha) * 255 : clamp(alpha, 0, 255);
          }
        }
        return [clamp(r / 255), clamp(g / 255), clamp(b / 255), clamp(a / 255)];
      }
    }

    return null;
  }

  private _resolveRect(x: number, y: number, w: number, h?: number): { x: number; y: number; w: number; h: number } {
    let rx = toNumber(x);
    let ry = toNumber(y);
    let rw = toNumber(w);
    let rh = h === undefined ? rw : toNumber(h);

    switch (this._state.rectMode) {
      case P5_CONST.CORNERS: {
        const x0 = rx;
        const y0 = ry;
        const x2 = rw;
        const y2 = rh;
        const left = Math.min(x0, x2);
        const top = Math.min(y0, y2);
        rx = left;
        ry = top;
        rw = Math.abs(x2 - x0);
        rh = Math.abs(y2 - y0);
        break;
      }
      case P5_CONST.CENTER:
        rx -= rw * 0.5;
        ry -= rh * 0.5;
        break;
      case P5_CONST.RADIUS:
        rx -= rw;
        ry -= rh;
        rw *= 2;
        rh *= 2;
        break;
      case P5_CONST.CORNER:
      default:
        break;
    }

    if (rw < 0) {
      rx += rw;
      rw = -rw;
    }
    if (rh < 0) {
      ry += rh;
      rh = -rh;
    }

    return { x: rx, y: ry, w: rw, h: rh };
  }

  private _resolveEllipse(x: number, y: number, w: number, h?: number): { cx: number; cy: number; rx: number; ry: number } {
    let xx = toNumber(x);
    let yy = toNumber(y);
    let ww = toNumber(w);
    let hh = h === undefined ? ww : toNumber(h);

    switch (this._state.ellipseMode) {
      case P5_CONST.CORNER:
        return {
          cx: xx + ww * 0.5,
          cy: yy + hh * 0.5,
          rx: Math.abs(ww) * 0.5,
          ry: Math.abs(hh) * 0.5,
        };
      case P5_CONST.CORNERS: {
        const x2 = ww;
        const y2 = hh;
        return {
          cx: (xx + x2) * 0.5,
          cy: (yy + y2) * 0.5,
          rx: Math.abs(x2 - xx) * 0.5,
          ry: Math.abs(y2 - yy) * 0.5,
        };
      }
      case P5_CONST.RADIUS:
        return {
          cx: xx,
          cy: yy,
          rx: Math.abs(ww),
          ry: Math.abs(hh),
        };
      case P5_CONST.CENTER:
      default:
        return {
          cx: xx,
          cy: yy,
          rx: Math.abs(ww) * 0.5,
          ry: Math.abs(hh) * 0.5,
        };
    }
  }

  private _buildEllipsePoints(cx: number, cy: number, rx: number, ry: number, start: number, stop: number): Vec2[] {
    const arcLength = Math.max(EPS, Math.abs(stop - start));
    const circumference = Math.PI * 2 * Math.sqrt((rx * rx + ry * ry) * 0.5);
    const scaledLength = circumference * (arcLength / (Math.PI * 2));
    const segments = Math.max(12, Math.ceil(scaledLength / 4));

    const points: Vec2[] = [];
    const step = (stop - start) / segments;
    for (let i = 0; i <= segments; i++) {
      const t = start + step * i;
      points.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry]);
    }

    if (points.length > 1) {
      const first = points[0];
      const last = points[points.length - 1];
      if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-3) {
        points.pop();
      }
    }

    return points;
  }

  private _buildRoundedRectPoints(x: number, y: number, w: number, h: number, radii: [number, number, number, number]): Vec2[] {
    const maxR = Math.min(w, h) * 0.5;
    let tl = clamp(radii[0], 0, maxR);
    let tr = clamp(radii[1], 0, maxR);
    let br = clamp(radii[2], 0, maxR);
    let bl = clamp(radii[3], 0, maxR);

    if (tl + tr > w && w > EPS) {
      const scale = w / (tl + tr);
      tl *= scale;
      tr *= scale;
    }
    if (bl + br > w && w > EPS) {
      const scale = w / (bl + br);
      bl *= scale;
      br *= scale;
    }

    const segFor = (r: number) => Math.max(3, Math.ceil((Math.PI * 0.5 * r) / 4));
    const points: Vec2[] = [];

    const addArc = (cx: number, cy: number, r: number, start: number, end: number) => {
      if (r <= EPS) {
        points.push([cx, cy]);
        return;
      }
      const segs = segFor(r);
      for (let i = 0; i <= segs; i++) {
        const t = start + (end - start) * (i / segs);
        points.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]);
      }
    };

    addArc(x + w - tr, y + tr, tr, -Math.PI * 0.5, 0);
    addArc(x + w - br, y + h - br, br, 0, Math.PI * 0.5);
    addArc(x + bl, y + h - bl, bl, Math.PI * 0.5, Math.PI);
    addArc(x + tl, y + tl, tl, Math.PI, Math.PI * 1.5);

    const deduped: Vec2[] = [];
    for (const p of points) {
      const prev = deduped[deduped.length - 1];
      if (!prev || Math.hypot(prev[0] - p[0], prev[1] - p[1]) > 1e-3) {
        deduped.push(p);
      }
    }
    if (deduped.length > 1) {
      const first = deduped[0];
      const last = deduped[deduped.length - 1];
      if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-3) {
        deduped.pop();
      }
    }

    return deduped;
  }

  private _emitLocalTriangle(a: Vec2, b: Vec2, c: Vec2, color: ColorTuple): void {
    const ta = transformPoint(this._state.matrix, a[0], a[1]);
    const tb = transformPoint(this._state.matrix, b[0], b[1]);
    const tc = transformPoint(this._state.matrix, c[0], c[1]);
    this._emitTriangle(ta, tb, tc, color);
  }

  private _emitTriangle(a: Vec2, b: Vec2, c: Vec2, color: ColorTuple): void {
    const blend = this._currentBlendMode();
    this._ensureBatch(blend);
    this._pushVertex(a[0], a[1], color);
    this._pushVertex(b[0], b[1], color);
    this._pushVertex(c[0], c[1], color);
  }

  private _emitPolygonFillLocal(rings: Vec2[][], color: ColorTuple): void {
    const validRings = rings.filter((ring) => ring.length >= 3);
    if (validRings.length === 0) return;

    const flat: number[] = [];
    const holes: number[] = [];
    let cursor = 0;

    for (let i = 0; i < validRings.length; i++) {
      const ring = validRings[i];
      if (i > 0) holes.push(cursor);
      for (const p of ring) {
        flat.push(p[0], p[1]);
        cursor += 1;
      }
    }

    const indices = earcut(flat, holes.length > 0 ? holes : undefined, 2);
    for (let i = 0; i + 2 < indices.length; i += 3) {
      const ia = indices[i] * 2;
      const ib = indices[i + 1] * 2;
      const ic = indices[i + 2] * 2;

      const a: Vec2 = [flat[ia], flat[ia + 1]];
      const b: Vec2 = [flat[ib], flat[ib + 1]];
      const c: Vec2 = [flat[ic], flat[ic + 1]];
      this._emitLocalTriangle(a, b, c, color);
    }
  }

  private _emitStrokePathLocal(points: Vec2[], closed: boolean, color: ColorTuple): void {
    if (points.length < 2) return;

    const transformed = points.map((p) => transformPoint(this._state.matrix, p[0], p[1]));
    this._emitStrokePathScreen(transformed, closed, color);
  }

  private _emitStrokePathScreen(points: Vec2[], closed: boolean, color: ColorTuple): void {
    if (points.length < 2) return;

    const scale = this._estimatedStrokeScale();
    const weight = Math.max(0.0001, this._state.strokeWeight * scale);
    const half = weight * 0.5;

    const path = points.map((p) => [p[0], p[1]] as Vec2);

    if (!closed && (this._state.strokeCap === this.SQUARE || this._state.strokeCap === this.PROJECT) && path.length >= 2) {
      const first = path[0];
      const second = path[1];
      const last = path[path.length - 1];
      const prev = path[path.length - 2];

      const d0 = normalize(second[0] - first[0], second[1] - first[1]);
      const d1 = normalize(last[0] - prev[0], last[1] - prev[1]);
      first[0] -= d0[0] * half;
      first[1] -= d0[1] * half;
      last[0] += d1[0] * half;
      last[1] += d1[1] * half;
    }

    const segmentCount = closed ? path.length : path.length - 1;
    for (let i = 0; i < segmentCount; i++) {
      const a = path[i];
      const b = path[(i + 1) % path.length];
      this._emitStrokeSegmentQuad(a, b, half, color);
    }

    const joinCount = closed ? path.length : path.length - 2;
    for (let i = 0; i < joinCount; i++) {
      const currIndex = closed ? i : i + 1;
      const prevIndex = (currIndex - 1 + path.length) % path.length;
      const nextIndex = (currIndex + 1) % path.length;
      this._emitStrokeJoin(path[prevIndex], path[currIndex], path[nextIndex], half, color);
    }

    if (!closed && this._state.strokeCap === this.ROUND && path.length >= 2) {
      const first = path[0];
      const second = path[1];
      const last = path[path.length - 1];
      const prev = path[path.length - 2];
      const d0 = normalize(second[0] - first[0], second[1] - first[1]);
      const d1 = normalize(last[0] - prev[0], last[1] - prev[1]);
      this._emitRoundCap(first, [-d0[0], -d0[1]], half, color);
      this._emitRoundCap(last, [d1[0], d1[1]], half, color);
    }
  }

  private _emitStrokeSegmentQuad(a: Vec2, b: Vec2, half: number, color: ColorTuple): void {
    const dir = normalize(b[0] - a[0], b[1] - a[1]);
    if (Math.hypot(dir[0], dir[1]) <= EPS) return;

    const nx = -dir[1] * half;
    const ny = dir[0] * half;

    const v0: Vec2 = [a[0] + nx, a[1] + ny];
    const v1: Vec2 = [a[0] - nx, a[1] - ny];
    const v2: Vec2 = [b[0] - nx, b[1] - ny];
    const v3: Vec2 = [b[0] + nx, b[1] + ny];

    this._emitTriangle(v0, v1, v2, color);
    this._emitTriangle(v0, v2, v3, color);
  }

  private _emitStrokeJoin(prev: Vec2, curr: Vec2, next: Vec2, half: number, color: ColorTuple): void {
    const dirA = normalize(curr[0] - prev[0], curr[1] - prev[1]);
    const dirB = normalize(next[0] - curr[0], next[1] - curr[1]);

    if (Math.hypot(dirA[0], dirA[1]) <= EPS || Math.hypot(dirB[0], dirB[1]) <= EPS) return;

    const cross = dirA[0] * dirB[1] - dirA[1] * dirB[0];
    if (Math.abs(cross) < 1e-5) return;

    const sign = cross > 0 ? 1 : -1;

    const nA: Vec2 = [-dirA[1] * half * sign, dirA[0] * half * sign];
    const nB: Vec2 = [-dirB[1] * half * sign, dirB[0] * half * sign];

    const outerA: Vec2 = [curr[0] + nA[0], curr[1] + nA[1]];
    const outerB: Vec2 = [curr[0] + nB[0], curr[1] + nB[1]];

    if (this._state.strokeJoin === this.ROUND) {
      this._emitRoundJoin(curr, nA, nB, half, sign, color);
      return;
    }

    if (this._state.strokeJoin === this.MITER) {
      const miterPoint = lineIntersectionPoint(outerA, dirA, outerB, dirB);
      const miterLimit = this._state.strokeWeight * this._estimatedStrokeScale() * 2;
      if (miterPoint) {
        const d = Math.hypot(miterPoint[0] - curr[0], miterPoint[1] - curr[1]);
        if (d <= miterLimit) {
          this._emitTriangle(outerA, miterPoint, outerB, color);
          return;
        }
      }
    }

    this._emitTriangle(curr, outerA, outerB, color);
  }

  private _emitRoundJoin(center: Vec2, fromOffset: Vec2, toOffset: Vec2, radius: number, sign: number, color: ColorTuple): void {
    let a0 = Math.atan2(fromOffset[1], fromOffset[0]);
    let a1 = Math.atan2(toOffset[1], toOffset[0]);

    if (sign > 0) {
      while (a1 < a0) a1 += Math.PI * 2;
    } else {
      while (a1 > a0) a1 -= Math.PI * 2;
    }

    const delta = a1 - a0;
    const steps = Math.max(6, Math.ceil(Math.abs(delta) / (Math.PI / 24)));

    let prev: Vec2 = [center[0] + Math.cos(a0) * radius, center[1] + Math.sin(a0) * radius];
    for (let i = 1; i <= steps; i++) {
      const angle = a0 + (delta * i) / steps;
      const next: Vec2 = [center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius];
      this._emitTriangle(center, prev, next, color);
      prev = next;
    }
  }

  private _emitRoundCap(center: Vec2, dir: Vec2, radius: number, color: ColorTuple): void {
    const base = Math.atan2(dir[1], dir[0]);
    const start = base - Math.PI * 0.5;
    const end = base + Math.PI * 0.5;
    const steps = Math.max(8, Math.ceil((Math.PI * radius) / 3));

    let prev: Vec2 = [center[0] + Math.cos(start) * radius, center[1] + Math.sin(start) * radius];
    for (let i = 1; i <= steps; i++) {
      const angle = start + ((end - start) * i) / steps;
      const next: Vec2 = [center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius];
      this._emitTriangle(center, prev, next, color);
      prev = next;
    }
  }

  private _sampleCubicBezier(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, segments: number): Vec2[] {
    const steps = Math.max(2, Math.floor(segments));
    const out: Vec2[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const mt = 1 - t;
      const x = mt * mt * mt * p0[0]
        + 3 * mt * mt * t * p1[0]
        + 3 * mt * t * t * p2[0]
        + t * t * t * p3[0];
      const y = mt * mt * mt * p0[1]
        + 3 * mt * mt * t * p1[1]
        + 3 * mt * t * t * p2[1]
        + t * t * t * p3[1];
      out.push([x, y]);
    }
    return out;
  }

  private _sampleQuadraticBezier(p0: Vec2, p1: Vec2, p2: Vec2, segments: number): Vec2[] {
    const steps = Math.max(2, Math.floor(segments));
    const out: Vec2[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const mt = 1 - t;
      const x = mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0];
      const y = mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1];
      out.push([x, y]);
    }
    return out;
  }

  private _sampleCatmullRom(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, segments: number, tightness: number): Vec2[] {
    const steps = Math.max(2, Math.floor(segments));
    const t = (1 - tightness) * 0.5;
    const out: Vec2[] = [];

    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const u2 = u * u;
      const u3 = u2 * u;

      const a0 = -t * u3 + 2 * t * u2 - t * u;
      const a1 = (2 - t) * u3 + (t - 3) * u2 + 1;
      const a2 = (t - 2) * u3 + (3 - 2 * t) * u2 + t * u;
      const a3 = t * u3 - t * u2;

      const x = a0 * p0[0] + a1 * p1[0] + a2 * p2[0] + a3 * p3[0];
      const y = a0 * p0[1] + a1 * p1[1] + a2 * p2[1] + a3 * p3[1];
      out.push([x, y]);
    }

    return out;
  }

  private _effectiveFillColor(): ColorTuple {
    if (!this._state.eraseMode) return this._state.fillColor;
    const alpha = 1 - this._state.eraseFillStrength / 255;
    return [0, 0, 0, clamp(alpha)];
  }

  private _effectiveStrokeColor(): ColorTuple {
    if (!this._state.eraseMode) return this._state.strokeColor;
    const alpha = 1 - this._state.eraseStrokeStrength / 255;
    return [0, 0, 0, clamp(alpha)];
  }

  private _currentBlendMode(): number {
    if (this._state.eraseMode) return this.REPLACE;
    return this._state.blendMode;
  }

  private _estimatedStrokeScale(): number {
    const m = this._state.matrix;
    const sx = Math.hypot(m[0], m[1]);
    const sy = Math.hypot(m[2], m[3]);
    return Math.max(0.0001, (sx + sy) * 0.5);
  }

  private _ensureBatch(blendMode: number): void {
    const batch = this._batches[this._batches.length - 1];
    if (!batch || batch.blendMode !== blendMode) {
      this._batches.push({ startVertex: this._vertexCount, vertexCount: 0, blendMode });
    }
  }

  private _pushVertex(x: number, y: number, color: ColorTuple): void {
    this._vertices.push(x, y, color[0], color[1], color[2], color[3]);
    this._vertexCount += 1;
    const batch = this._batches[this._batches.length - 1];
    if (batch) batch.vertexCount += 1;
  }

  private _ensureVertexBuffer(requiredBytes: number): void {
    if (this._vertexBuffer && requiredBytes <= this._vertexBufferCapacityBytes) return;

    const newSize = Math.max(requiredBytes, Math.ceil(this._vertexBufferCapacityBytes * 1.5), 64 * 1024);
    try { this._vertexBuffer?.destroy(); } catch (_) { /* ignore */ }

    this._vertexBuffer = this.device.createBuffer({
      size: newSize,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this._vertexBufferCapacityBytes = newSize;
  }

  private _getPipeline(mode: number): GPURenderPipeline {
    const existing = this._pipelineCache.get(mode);
    if (existing) return existing;

    const pipeline = this.device.createRenderPipeline({
      layout: this._pipelineLayout,
      vertex: {
        module: this._shaderModule,
        entryPoint: "vsMain",
        buffers: [
          {
            arrayStride: BYTES_PER_VERTEX,
            stepMode: "vertex",
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x2" },
              { shaderLocation: 1, offset: 8, format: "float32x4" },
            ],
          },
        ],
      },
      fragment: {
        module: this._shaderModule,
        entryPoint: "fsMain",
        targets: [
          {
            format: this.format,
            blend: resolveBlendState(mode),
            writeMask: GPUColorWrite.ALL,
          },
        ],
      },
      primitive: {
        topology: "triangle-list",
      },
      multisample: {
        count: 1,
      },
    });

    this._pipelineCache.set(mode, pipeline);
    return pipeline;
  }
}
