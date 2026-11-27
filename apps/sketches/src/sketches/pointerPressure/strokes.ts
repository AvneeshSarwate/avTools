// Pressure strokes as smooth variable-width ink, rendered with three.js.
//
// Shape: a variable-width stroke is the union of discs swept along its path
// (radius = half-width). It is drawn as a chain of tapered capsules (two
// discs of different radii plus their tangent lines), one per short piece of
// the curve, each shaded from its exact signed distance field. A union of
// discs is right by construction where an offset triangle strip goes wrong:
// turns tighter than the half-width, width changing faster than the stroke
// moves, ends (round caps come free) and self-overlaps.
//
// Overlap has two cases. Neighbouring capsules overlap all the time, and
// blending each one would darken the antialiased edges where they meet; there
// the right answer is the union. But where a stroke crosses itself, the later
// pass should lie on top of the earlier one, which a union (nearest capsule
// wins) gets wrong: colour splits along the bisectors and the crossing looks
// pinched. So capsules are grouped into chunks of CHUNK consecutive ones:
// each chunk is drawn as an exact union, and chunks are composited in time
// order, newest on top. A crossing is between different chunks, so it layers;
// within a chunk the joints are seamless. Between chunks, each chunk also
// carries its neighbours' adjacent capsules as depth-only guards, so at a
// joint each pixel is claimed by whichever side is nearer (a straight cut
// across the stroke) instead of the newer chunk's round start cap sitting on
// the older chunk's end.
//
// A chunk's union is drawn in two passes with one material, depth and
// stencil cleared (scissored to the chunk) first: (1) depth only, writing the
// signed distance as depth with LESS, leaving every pixel's distance to the
// chunk's nearest capsule;
// (2) colour with depth LEQUAL against that minimum (with a small bias) and
// a stencil that lets one fragment per pixel through, so every pixel is
// blended exactly once, by its nearest capsule (or one within DEPTH_BIAS of
// it): the coverage of the union. The bias matters: an EQUAL test needs both
// passes to compute bit-identical depth, which doesn't hold everywhere (ANGLE
// on Metal can compile the depth-only and colour pipelines as different
// shader variants), and a 1-ulp mismatch leaves speckled holes. Finished strokes are baked into a
// persistent render target this way; strokes still being drawn are drawn on
// top of it each frame.
//
// CPU pipeline per stroke:
//   pointer samples → One Euro filter (2D on position, separately on
//   pressure) → control points (≥ MIN_SPACING px apart) → centripetal
//   Catmull-Rom through them, half-width on a monotone cubic over the same
//   parameter → adaptive samples (by offset-curve length and turning angle)
//   → one capsule between consecutive samples.
//
// Incrementality: spline segment i (P[i] → P[i+1]) depends on P[i-1..i+2], so
// only the newest segment is provisional (it extrapolates its far
// neighbour). Each frame re-tessellates from the first non-final segment (one
// or two segments) and CapsuleBuffer uploads only that range. When the pen
// lifts, the stroke is baked once into the ink target and its chunk buffers go
// back to a pool. Frames redraw only a scissor rect around what changed, and
// only the chunks that overlap it.
import * as THREE from "three";
import { CapsuleBuffer, ISTRIDE, UNBOUNDED } from "./capsuleBuffer";
import { OneEuroFilter, OneEuroFilter2D } from "./oneEuro";

export interface StrokeSample {
  x: number; // CSS px
  y: number;
  pressure: number; // 0..1
  t: number; // seconds
  r: number; // ink colour, 0..1
  g: number;
  b: number;
}

const MIN_SPACING = 2; // px between control points
const STEP = 3; // px of (outer offset) curve per capsule
const MAX_TURN = 0.1; // radians of tangent turn per capsule
const MAX_SAMPLES = 96; // per spline segment
const MIN_HALF_WIDTH = 0.6;
const MAX_HALF_WIDTH = 16;
const CHUNK = 16; // capsules per chunk (about 50 px of stroke)
const DEPTH_RANGE = 64; // px; signed distances in ±DEPTH_RANGE map onto depth 0..1
// Pass-2 depth bias: ~330 steps of a 24-bit depth buffer, 0.0026 px of distance.
const DEPTH_BIAS = 2e-5;

// Control point layout: x, y, halfWidth, r, g, b
const CP = 6;

const capsuleVertex = /* glsl */ `
in vec2 position; // quad corner
in vec3 capA; // ax, ay, ra
in vec3 capB;
in vec3 colA;
in vec3 colB;
uniform vec2 viewport; // CSS px of the target
uniform float feather; // one device pixel, in CSS px
out vec2 vP;
flat out vec3 vA;
flat out vec3 vB;
flat out vec3 vColA;
flat out vec3 vColB;
flat out float vGuard;
void main() {
  vec2 a = capA.xy, b = capB.xy;
  vec2 d = b - a;
  float len = length(d);
  vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float r = max(capA.z, capB.z) + 2.0 * feather;
  vec2 p = a + dir * (position.x < 0.0 ? -r : len + r) + nrm * position.y * r;
  vP = p;
  vA = capA;
  vB = capB;
  vColA = colA;
  vColB = colB;
  vGuard = colA.r < 0.0 ? 1.0 : 0.0;
  gl_Position = vec4(p.x / viewport.x * 2.0 - 1.0, 1.0 - p.y / viewport.y * 2.0, 0.0, 1.0);
}
`;

// sdUnevenCapsule is Inigo Quilez's exact 2D distance to a tapered capsule
// (iquilezles.org/articles/distfunctions2d), with guards for a zero-length
// capsule and for one disc swallowing the other.
const capsuleFragment = /* glsl */ `
precision highp float;
in vec2 vP;
flat in vec3 vA;
flat in vec3 vB;
flat in vec3 vColA;
flat in vec3 vColB;
flat in float vGuard;
uniform float feather;
uniform float depthBias; // 0 in the depth pass, DEPTH_BIAS in the colour pass
out vec4 outColor;

float cro(vec2 a, vec2 b) { return a.x * b.y - a.y * b.x; }

float sdUnevenCapsule(vec2 p, vec2 pa, vec2 pb, float ra, float rb) {
  p -= pa;
  pb -= pa;
  float h = dot(pb, pb);
  float rd = ra - rb;
  if (h <= rd * rd + 1e-6) return min(length(p) - ra, length(p - pb) - rb);
  vec2 q = vec2(dot(p, vec2(pb.y, -pb.x)), dot(p, pb)) / h;
  q.x = abs(q.x);
  vec2 c = vec2(sqrt(h - rd * rd), rd);
  float k = cro(c, q);
  float m = dot(c, q);
  float n = dot(q, q);
  if (k < 0.0) return sqrt(h * n) - ra;
  if (k > c.x) return sqrt(h * (n + 1.0 - 2.0 * q.y)) - rb;
  return m - ra;
}

void main() {
  // Guards (a neighbouring chunk's capsule) only claim pixels in the depth pass.
  if (vGuard > 0.5 && depthBias > 0.0) discard;
  float d = sdUnevenCapsule(vP, vA.xy, vB.xy, vA.z, vB.z);
  float alpha = clamp(0.5 - d / feather, 0.0, 1.0);
  if (alpha <= 0.0) discard;
  gl_FragDepth = clamp(d / ${(2 * DEPTH_RANGE).toFixed(1)} + 0.5 - depthBias, 0.0, 1.0);
  vec2 ab = vB.xy - vA.xy;
  float t = clamp(dot(vP - vA.xy, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  outColor = vec4(mix(vColA, vColB, t), alpha);
}
`;

const blitVertex = /* glsl */ `
in vec2 position; // CSS px
in vec2 uv;
uniform vec2 viewport;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.x / viewport.x * 2.0 - 1.0, 1.0 - position.y / viewport.y * 2.0, 0.0, 1.0);
}
`;

const blitFragment = /* glsl */ `
precision highp float;
in vec2 vUv;
uniform sampler2D map;
out vec4 outColor;
void main() { outColor = texture(map, vUv); }
`;

// A rect padded for the antialiasing fringe, rounded out to whole CSS px and
// clamped to the given bounds; null if nothing is left.
function padRect(r: { x0: number; y0: number; x1: number; y1: number }, bx0: number, by0: number, bx1: number, by1: number) {
  const pad = 3;
  const x0 = Math.max(bx0, Math.floor(r.x0 - pad)), y0 = Math.max(by0, Math.floor(r.y0 - pad));
  const x1 = Math.min(bx1, Math.ceil(r.x1 + pad)), y1 = Math.min(by1, Math.ceil(r.y1 + pad));
  return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
}

function writeCapsule(
  chunk: CapsuleBuffer, slot: number,
  ax: number, ay: number, ra: number, bx: number, by: number, rb: number,
  r1: number, g1: number, b1: number, r2: number, g2: number, b2: number,
) {
  const f = chunk.data;
  let w = slot * ISTRIDE;
  f[w++] = ax; f[w++] = ay; f[w++] = ra;
  f[w++] = bx; f[w++] = by; f[w++] = rb;
  f[w++] = r1; f[w++] = g1; f[w++] = b1;
  f[w++] = r2; f[w++] = g2; f[w] = b2;
  chunk.mark(slot);
}

function pressureToHalfWidth(p: number) {
  return MIN_HALF_WIDTH + (MAX_HALF_WIDTH - MIN_HALF_WIDTH) * p;
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// Chunk instance layout: slot 0 = guard copy of the previous chunk's last
// capsule (an empty capsule for the first chunk), slots 1..CHUNK = the
// chunk's own capsules, slot CHUNK+1 = guard copy of the next chunk's first
// capsule (present once the next chunk has one).
const SLOTS = CHUNK + 2;

class Stroke {
  readonly chunks: CapsuleBuffer[] = [];
  private count = 0; // capsules across all chunks
  private cps: number[] = [];
  private n = 0;
  // segStart[k]: capsule where spline segment k's capsules start; the entry
  // after the last written segment is the end. Capsule 0 is the start dot.
  private segStart: number[] = [1];
  private finalSegs = 0; // segments 0..finalSegs-1 are final
  private pending = false;
  private readonly fxy = new OneEuroFilter2D(3, 0.03);
  private readonly fp = new OneEuroFilter(5, 2);

  constructor(private alloc: () => CapsuleBuffer) {}

  get needsTessellation() {
    return this.pending;
  }

  add(s: StrokeSample) {
    this.fxy.filter(s.x, s.y, s.t);
    const x = this.fxy.x, y = this.fxy.y;
    const p = Math.min(1, Math.max(0, this.fp.filter(s.pressure, s.t)));
    if (this.n > 0) {
      const o = (this.n - 1) * CP;
      const dx = x - this.cps[o];
      const dy = y - this.cps[o + 1];
      if (dx * dx + dy * dy < MIN_SPACING * MIN_SPACING) return;
    }
    const hw = pressureToHalfWidth(p);
    this.cps.push(x, y, hw, s.r, s.g, s.b);
    this.n++;
    // The start dot: a zero-length capsule (also all a tap leaves).
    if (this.n === 1) this.push(x, y, hw, x, y, hw, s.r, s.g, s.b, s.r, s.g, s.b);
    this.pending = true;
  }

  /** Re-tessellate from the first non-final segment. `final`: the stroke is over. */
  tessellate(final: boolean) {
    this.pending = false;
    const n = this.n;
    if (n < 2) return;
    const from = this.finalSegs;
    this.truncate(this.segStart[from]);
    this.segStart.length = from + 1;
    for (let s = from; s < n - 1; s++) {
      this.emitSegment(s);
      this.segStart.push(this.count);
    }
    // With n points, segment n-2 still extrapolates its far neighbour.
    this.finalSegs = final ? n - 1 : n - 2;
  }

  /** Upload dirty chunks; grow `acc` by the screen area that changed. */
  flush(acc: Rect) {
    for (const chunk of this.chunks) {
      if (!chunk.dirty) continue;
      chunk.flush();
      const r = chunk.rect;
      if (r.x0 < acc.x0) acc.x0 = r.x0;
      if (r.y0 < acc.y0) acc.y0 = r.y0;
      if (r.x1 > acc.x1) acc.x1 = r.x1;
      if (r.y1 > acc.y1) acc.y1 = r.y1;
      chunk.resetRect();
    }
  }

  release(pool: CapsuleBuffer[]) {
    for (const chunk of this.chunks) {
      chunk.clear();
      pool.push(chunk);
    }
    this.chunks.length = 0;
  }

  private truncate(count: number) {
    this.count = count;
    for (let k = Math.max(0, Math.floor(count / CHUNK) - 1); k < this.chunks.length; k++) this.syncCount(k);
  }

  // A chunk's instance count from the stroke's capsule count.
  private syncCount(k: number) {
    const chunk = this.chunks[k];
    const own = Math.min(CHUNK, Math.max(0, this.count - k * CHUNK));
    const next = own === 0 ? 0 : 1 + own + (this.count > (k + 1) * CHUNK ? 1 : 0);
    if (next < chunk.count) chunk.truncate(next);
    else if (next > chunk.count) {
      chunk.mark(chunk.count);
      chunk.count = next;
    }
  }

  private push(
    ax: number, ay: number, ra: number, bx: number, by: number, rb: number,
    r1: number, g1: number, b1: number, r2: number, g2: number, b2: number,
  ) {
    const i = this.count;
    const ci = (i / CHUNK) | 0;
    const local = i - ci * CHUNK;
    let chunk = this.chunks[ci];
    if (!chunk) {
      chunk = this.chunks[ci] = this.alloc();
      if (ci === 0) {
        writeCapsule(chunk, 0, ax, ay, -1, ax, ay, -1, -1, 0, 0, 0, 0, 0); // no previous chunk: an empty guard
      } else {
        const prev = this.chunks[ci - 1].data, o = CHUNK * ISTRIDE; // its last own capsule
        writeCapsule(chunk, 0, prev[o], prev[o + 1], prev[o + 2], prev[o + 3], prev[o + 4], prev[o + 5], -1, 0, 0, 0, 0, 0);
      }
    }
    writeCapsule(chunk, 1 + local, ax, ay, ra, bx, by, rb, r1, g1, b1, r2, g2, b2);
    // Keep the neighbours' guard copies of this capsule current.
    const nextChunk = this.chunks[ci + 1];
    if (local === CHUNK - 1 && nextChunk) writeCapsule(nextChunk, 0, ax, ay, ra, bx, by, rb, -1, 0, 0, 0, 0, 0);
    if (local === 0 && ci > 0) writeCapsule(this.chunks[ci - 1], SLOTS - 1, ax, ay, ra, bx, by, rb, -1, 0, 0, 0, 0, 0);
    this.count++;
    this.syncCount(ci);
    if (local === 0 && ci > 0) this.syncCount(ci - 1);
  }

  private emitSegment(s: number) {
    const c = this.cps;
    const n = this.n;
    const o1 = s * CP, o2 = (s + 1) * CP;
    const x1 = c[o1], y1 = c[o1 + 1], w1 = c[o1 + 2];
    const x2 = c[o2], y2 = c[o2 + 1], w2 = c[o2 + 2];
    // Neighbours, reflected at the ends.
    let x0, y0, w0;
    if (s > 0) {
      const o0 = o1 - CP;
      x0 = c[o0]; y0 = c[o0 + 1]; w0 = c[o0 + 2];
    } else {
      x0 = 2 * x1 - x2; y0 = 2 * y1 - y2; w0 = w1;
    }
    let x3, y3, w3;
    if (s + 2 < n) {
      const o3 = o2 + CP;
      x3 = c[o3]; y3 = c[o3 + 1]; w3 = c[o3 + 2];
    } else {
      x3 = 2 * x2 - x1; y3 = 2 * y2 - y1; w3 = w2;
    }

    // Centripetal Catmull-Rom as a cubic Hermite on u ∈ [0, 1].
    let d1 = Math.sqrt(Math.hypot(x2 - x1, y2 - y1));
    let d0 = Math.sqrt(Math.hypot(x1 - x0, y1 - y0));
    let d2 = Math.sqrt(Math.hypot(x3 - x2, y3 - y2));
    if (d1 < 1e-4) d1 = 1;
    if (d0 < 1e-4) d0 = d1;
    if (d2 < 1e-4) d2 = d1;
    const t1x = ((x1 - x0) / d0 - (x2 - x0) / (d0 + d1) + (x2 - x1) / d1) * d1;
    const t1y = ((y1 - y0) / d0 - (y2 - y0) / (d0 + d1) + (y2 - y1) / d1) * d1;
    const t2x = ((x2 - x1) / d1 - (x3 - x1) / (d1 + d2) + (x3 - x2) / d2) * d1;
    const t2y = ((y2 - y1) / d1 - (y3 - y1) / (d1 + d2) + (y3 - y2) / d2) * d1;
    const ax = 2 * x1 - 2 * x2 + t1x + t2x, bx = -3 * x1 + 3 * x2 - 2 * t1x - t2x;
    const ay = 2 * y1 - 2 * y2 + t1y + t2y, by = -3 * y1 + 3 * y2 - 2 * t1y - t2y;

    // Half-width: cubic Hermite with Catmull-Rom slopes, zeroed at local
    // extrema (no overshoot), then clamped to the segment's range.
    let m1 = (w2 - w0) * 0.5;
    let m2 = (w3 - w1) * 0.5;
    if ((w1 - w0) * (w2 - w1) <= 0) m1 = 0;
    if ((w2 - w1) * (w3 - w2) <= 0) m2 = 0;
    const aw = 2 * w1 - 2 * w2 + m1 + m2, bw = -3 * w1 + 3 * w2 - 2 * m1 - m2;
    const wLo = Math.min(w1, w2), wHi = Math.max(w1, w2);

    // Capsule count: enough for the outer offset curve's length and the turn.
    const chord = Math.hypot(x2 - x1, y2 - y1);
    const turn = Math.abs(Math.atan2(t1x * t2y - t1y * t2x, t1x * t2x + t1y * t2y));
    const steps = Math.min(MAX_SAMPLES, Math.max(1, Math.ceil((chord + turn * wHi) / STEP), Math.ceil(turn / MAX_TURN)));

    const r1 = c[o1 + 3], g1 = c[o1 + 4], b1 = c[o1 + 5];
    const dr = c[o2 + 3] - r1, dg = c[o2 + 4] - g1, db = c[o2 + 5] - b1;

    // Each capsule starts where the previous one (or the start dot) ended.
    const last = this.count - 1;
    const lf = this.chunks[(last / CHUNK) | 0].data;
    const lo = (1 + (last % CHUNK)) * ISTRIDE;
    let px = lf[lo + 3], py = lf[lo + 4], pw = lf[lo + 5];
    let pr = lf[lo + 9], pg = lf[lo + 10], pb = lf[lo + 11];
    for (let j = 1; j <= steps; j++) {
      const u = j / steps, u2 = u * u, u3 = u2 * u;
      const x = ax * u3 + bx * u2 + t1x * u + x1;
      const y = ay * u3 + by * u2 + t1y * u + y1;
      let hw = aw * u3 + bw * u2 + m1 * u + w1;
      hw = hw < wLo ? wLo : hw > wHi ? wHi : hw;
      const r = r1 + dr * u, g = g1 + dg * u, b = b1 + db * u;
      this.push(px, py, pw, x, y, hw, pr, pg, pb, r, g, b);
      px = x; py = y; pw = hw; pr = r; pg = g; pb = b;
    }
  }
}

export class StrokeLayer {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private camera = new THREE.OrthographicCamera(); // unused: the shaders project screen px themselves
  private scene = new THREE.Scene(); // holds the one mesh being drawn
  private capsuleMaterial: THREE.RawShaderMaterial;
  private blitMaterial: THREE.RawShaderMaterial;
  private blitMesh: THREE.Mesh;
  private ink: THREE.WebGLRenderTarget | null = null; // finished strokes, in CSS px from the top-left
  private inkCss = { w: 0, h: 0 };
  private active = new Map<number, Stroke>();
  private pool: CapsuleBuffer[] = [];
  private needsRender = true;
  private size = { w: 1, h: 1, dpr: 1 };
  private background: THREE.Color;

  constructor(parent: HTMLElement, background = 0x0d0d0f) {
    // Raw values, not colour-managed: everything here writes straight sRGB bytes.
    this.background = new THREE.Color().setRGB(
      ((background >> 16) & 255) / 255, ((background >> 8) & 255) / 255, (background & 255) / 255,
      THREE.LinearSRGBColorSpace,
    );
    // preserveDrawingBuffer: frames redraw only a scissor rect around what changed.
    this.renderer = new THREE.WebGLRenderer({ antialias: false, depth: true, stencil: true, preserveDrawingBuffer: true });
    this.renderer.autoClear = false;
    this.canvas = this.renderer.domElement;
    parent.prepend(this.canvas);
    this.capsuleMaterial = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: capsuleVertex,
      fragmentShader: capsuleFragment,
      uniforms: { viewport: { value: new THREE.Vector2(1, 1) }, feather: { value: 1 }, depthBias: { value: 0 } },
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: true,
    });
    this.blitMaterial = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: blitVertex,
      fragmentShader: blitFragment,
      uniforms: { viewport: { value: new THREE.Vector2(1, 1) }, map: { value: null } },
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const quad = new THREE.BufferGeometry();
    quad.setAttribute("position", new THREE.BufferAttribute(new Float32Array(8), 2));
    quad.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]), 2));
    quad.setIndex([0, 1, 2, 2, 1, 3]);
    quad.boundingSphere = UNBOUNDED; // 2D positions: three can't compute one
    this.blitMesh = new THREE.Mesh(quad, this.blitMaterial);
    this.blitMesh.frustumCulled = false;
  }

  resize(width: number, height: number, pixelRatio: number) {
    this.size = { w: width, h: height, dpr: pixelRatio };
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height);
    this.capsuleMaterial.uniforms.feather.value = 1 / pixelRatio;
    this.ensureInk();
    this.needsRender = true;
  }

  private alloc = () => this.pool.pop() ?? new CapsuleBuffer(this.capsuleMaterial, SLOTS);

  begin(id: number, sample: StrokeSample) {
    this.end(id);
    const stroke = new Stroke(this.alloc);
    this.active.set(id, stroke);
    stroke.add(sample);
  }

  add(id: number, sample: StrokeSample) {
    this.active.get(id)?.add(sample);
  }

  end(id: number) {
    const stroke = this.active.get(id);
    if (!stroke) return;
    this.active.delete(id);
    stroke.tessellate(true);
    stroke.flush({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
    // Bake into the ink target, once.
    this.renderer.setRenderTarget(this.ink);
    this.drawStroke(stroke, this.inkCss.w, this.inkCss.h, null);
    this.setClip(null, 0);
    this.renderer.setRenderTarget(null);
    stroke.release(this.pool);
    this.needsRender = true;
  }

  clear() {
    for (const stroke of this.active.values()) stroke.release(this.pool);
    this.active.clear();
    this.renderer.setRenderTarget(this.ink);
    this.renderer.setClearColor(this.background, 1);
    this.renderer.clear(true, true, true);
    this.renderer.setRenderTarget(null);
    this.needsRender = true;
  }

  /**
   * Tessellate what changed, upload dirty ranges, and redraw only the screen
   * area they cover (ink blit + the active strokes' chunks that overlap it).
   * Idle frames draw nothing; resizes, bakes and clears redraw everything.
   */
  render() {
    if (!this.ink) return;
    const dirty: Rect = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const stroke of this.active.values()) {
      if (stroke.needsTessellation) stroke.tessellate(false);
      stroke.flush(dirty);
    }
    const full = this.needsRender;
    if (!full && dirty.x0 > dirty.x1) return;
    this.needsRender = false;
    const { w, h } = this.size;
    this.renderer.setRenderTarget(null);
    const clip = full ? { x0: 0, y0: 0, x1: w, y1: h } : padRect(dirty, 0, 0, w, h);
    if (!clip) return;
    this.setClip(clip, h);
    this.blit(this.ink, this.inkCss.w, this.inkCss.h, w, h);
    for (const stroke of this.active.values()) this.drawStroke(stroke, w, h, clip);
    this.setClip(null, h);
  }

  // Each chunk as an exact union (two passes, see the header), oldest first,
  // into the current target; chunks outside `clip` are skipped.
  private drawStroke(stroke: Stroke, viewW: number, viewH: number, clip: Rect | null) {
    const m = this.capsuleMaterial;
    (m.uniforms.viewport.value as THREE.Vector2).set(viewW, viewH);
    const bx0 = clip ? clip.x0 : 0, by0 = clip ? clip.y0 : 0;
    const bx1 = clip ? clip.x1 : viewW, by1 = clip ? clip.y1 : viewH;
    for (const chunk of stroke.chunks) {
      if (chunk.count === 0) continue;
      const r = padRect(chunk.bounds, bx0, by0, bx1, by1);
      if (!r) continue;
      this.setClip(r, viewH);
      this.renderer.clear(false, true, true);
      this.scene.add(chunk.mesh);
      // Pass 1: nearest signed distance per pixel into depth.
      m.colorWrite = false;
      m.depthWrite = true;
      m.depthFunc = THREE.LessDepth;
      m.stencilWrite = false;
      m.uniforms.depthBias.value = 0;
      this.renderer.render(this.scene, this.camera);
      // Pass 2: colour from that nearest capsule only, once per pixel.
      m.colorWrite = true;
      m.depthWrite = false;
      m.depthFunc = THREE.LessEqualDepth;
      m.uniforms.depthBias.value = DEPTH_BIAS;
      m.stencilWrite = true;
      m.stencilFunc = THREE.EqualStencilFunc;
      m.stencilRef = 0;
      m.stencilFail = THREE.KeepStencilOp;
      m.stencilZFail = THREE.KeepStencilOp;
      m.stencilZPass = THREE.IncrementStencilOp;
      this.renderer.render(this.scene, this.camera);
      this.scene.remove(chunk.mesh);
    }
  }

  // Scissor the current target to a CSS-px rect (top-left origin), or turn it off.
  private setClip(r: Rect | null, viewH: number) {
    const target = this.renderer.getRenderTarget();
    if (target) {
      if (r) {
        const s = target.width / this.inkCss.w; // device px per CSS px
        const x = Math.floor(r.x0 * s), y = Math.floor((viewH - r.y1) * s);
        target.scissor.set(x, y, Math.ceil(r.x1 * s) - x, Math.ceil((viewH - r.y0) * s) - y);
      }
      target.scissorTest = r !== null;
      this.renderer.setRenderTarget(target); // re-applies the target's scissor
    } else {
      if (r) this.renderer.setScissor(r.x0, viewH - r.y1, r.x1 - r.x0, r.y1 - r.y0); // GL origin is bottom-left
      this.renderer.setScissorTest(r !== null);
    }
  }

  // Draw a CSS-px texture (top-left origin) 1:1 into the current target.
  private blit(texture: THREE.WebGLRenderTarget, texW: number, texH: number, viewW: number, viewH: number) {
    const pos = this.blitMesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    pos.array.set([0, 0, texW, 0, 0, texH, texW, texH]);
    pos.needsUpdate = true;
    this.blitMaterial.uniforms.map.value = texture.texture;
    (this.blitMaterial.uniforms.viewport.value as THREE.Vector2).set(viewW, viewH);
    this.scene.add(this.blitMesh);
    this.renderer.render(this.scene, this.camera);
    this.scene.remove(this.blitMesh);
  }

  // The ink target only grows (a window resize or rotation never loses ink),
  // copying the old contents over; a pixel-ratio change rebuilds it at the new
  // density.
  private ensureInk() {
    const { w, h, dpr } = this.size;
    const old = this.ink;
    const oldDpr = old ? old.width / this.inkCss.w : dpr;
    if (old && w <= this.inkCss.w && h <= this.inkCss.h && Math.abs(oldDpr - dpr) < 1e-3) return;
    const cssW = Math.max(w, old ? this.inkCss.w : 0);
    const cssH = Math.max(h, old ? this.inkCss.h : 0);
    const target = new THREE.WebGLRenderTarget(Math.ceil(cssW * dpr), Math.ceil(cssH * dpr), {
      depthBuffer: true,
      stencilBuffer: true,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    this.renderer.setRenderTarget(target);
    this.renderer.setClearColor(this.background, 1);
    this.renderer.clear(true, true, true);
    if (old) {
      this.blit(old, this.inkCss.w, this.inkCss.h, target.width / dpr, target.height / dpr);
      old.dispose();
    }
    this.renderer.setRenderTarget(null);
    this.ink = target;
    this.inkCss = { w: target.width / dpr, h: target.height / dpr };
  }
}
