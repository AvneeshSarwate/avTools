// Pressure strokes as smooth variable-width ink, rendered with three.js.
//
// Every frame draws every stroke from its capsule data; nothing is baked into
// pixels, so the data can later be varied procedurally per frame.
//
// Shape: a variable-width stroke is the union of discs swept along its path
// (radius = half-width). It is drawn as a chain of tapered capsules (two
// discs of different radii plus their tangent lines), one per short piece of
// the curve, each shaded from its exact signed distance field. A union of
// discs is right by construction where an offset triangle strip goes wrong:
// turns tighter than the half-width, width changing faster than the stroke
// moves, ends (round caps come free) and self-overlaps.
//
// Overlap: all capsules are drawn in time order with normal alpha blending,
// and a GPU blends one draw call's primitives in submission order, so a later
// pass of a stroke (or a later stroke) lies on top of an earlier one, with
// antialiased edges, for free. The one thing to avoid is neighbouring
// capsules both blending their soft edges where they meet (darker beads at
// every joint), so each capsule also carries its neighbours (the previous
// capsule's start P and the next one's end N) and discards pixels where
// either neighbour is nearer. Along a stroke each pixel is then shaded by
// exactly one capsule: the nearest, whose coverage is the union's.
//
// Draws: one for all finished strokes (their capsules appended in order to
// one shared buffer when the pen lifts) plus one per stroke in progress. No
// depth or stencil buffer.
//
// Finished strokes keep their control points (with the time each was drawn,
// and a snapshot of them as drawn). Reshaping animations (scatter, restore,
// wander) are tweens over ranges of control points; each frame they move the
// points, re-tessellate the strokes they touched and rebuild the shared
// buffer, so the ink stays a smooth spline while it moves.
//
// CPU pipeline per stroke:
//   pointer samples → One Euro filter (2D on position, separately on
//   pressure) → control points (≥ MIN_SPACING px apart) → centripetal
//   Catmull-Rom through them, half-width on a monotone cubic over the same
//   parameter → adaptive samples (by offset-curve length and turning angle)
//   → one capsule between consecutive samples.
//
//   → capsules fitted greedily over those samples: each spans as many as stay
//   within FIT_TOL px of it (position plus radius), so straight and gently
//   curving stretches become a few long capsules and tight turns keep short
//   ones. Fragment cost scales with how many capsule quads cover a pixel,
//   about (length + width) / length, so long capsules are what keep a full
//   redraw cheap.
//
// Incrementality: spline segment i (P[i] → P[i+1]) depends on P[i-1..i+2], so
// only the newest segment is provisional (it extrapolates its far
// neighbour). Each frame re-samples from the first non-final segment (one or
// two segments); a capsule is kept if the sample that ended it is unchanged,
// so only the open tail is refitted, and CapsuleBuffer uploads only that
// range.
import * as THREE from "three";
import { CapsuleBuffer, ISTRIDE } from "./capsuleBuffer";
import { easeOutExpo, scatterTargets } from "./deform";
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
const STEP = 2; // px of (outer offset) curve per spline sample
const MAX_TURN = 0.1; // radians of tangent turn per spline sample
const MAX_SAMPLES = 96; // per spline segment
const FIT_TOL = 0.25; // px a capsule may deviate from the samples it spans
const FIT_COLOR_TOL = 0.02; // per channel, 0..1: colour is interpolated linearly along a capsule
const MAX_CAPSULE = 96; // px, longest capsule
const MIN_HALF_WIDTH = 0.6;
const MAX_HALF_WIDTH = 16;

// Control point layout: x, y, halfWidth, r, g, b
const CP = 6;

const capsuleVertex = /* glsl */ `
in vec3 capP; // previous capsule's start (x, y, r); r < 0: none
in vec3 capA; // this capsule: start
in vec3 capB; //               end
in vec3 capN; // next capsule's end; r < 0: none
in vec3 colA;
in vec3 colB;
uniform vec2 viewport; // CSS px
uniform float feather; // one device pixel, in CSS px
flat out vec3 vPrev;
flat out vec3 vA;
flat out vec3 vB;
flat out vec3 vNext;
flat out vec3 vColA;
flat out vec3 vColB;
void main() {
  // Quad corner from the vertex number: x picks the end (-1 = behind a,
  // +1 = past b), y the side.
  vec2 corner = vec2((gl_VertexID & 1) == 0 ? -1.0 : 1.0, (gl_VertexID & 2) == 0 ? -1.0 : 1.0);
  vec2 a = capA.xy, b = capB.xy;
  vec2 d = b - a;
  float len = length(d);
  vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float r = max(capA.z, capB.z) + 2.0 * feather;
  vec2 p = a + dir * (corner.x < 0.0 ? -r : len + r) + nrm * corner.y * r;
  vPrev = capP;
  vA = capA;
  vB = capB;
  vNext = capN;
  vColA = colA;
  vColB = colB;
  gl_Position = vec4(p.x / viewport.x * 2.0 - 1.0, 1.0 - p.y / viewport.y * 2.0, 0.0, 1.0);
}
`;

// sdUnevenCapsule is Inigo Quilez's exact 2D distance to a tapered capsule
// (iquilezles.org/articles/distfunctions2d), with guards for a zero-length
// capsule and for one disc swallowing the other.
const capsuleFragment = /* glsl */ `
precision highp float;
flat in vec3 vPrev;
flat in vec3 vA;
flat in vec3 vB;
flat in vec3 vNext;
flat in vec3 vColA;
flat in vec3 vColB;
uniform float feather; // one device pixel, in CSS px
uniform float canvasHeight; // device px
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
  // The pixel centre in CSS px, from gl_FragCoord rather than an interpolated
  // varying: neighbouring capsules compare distances at this pixel, so they
  // must see exactly the same point (each quad would interpolate it slightly
  // differently, and pixels both of them reject show as holes).
  vec2 p = vec2(gl_FragCoord.x, canvasHeight - gl_FragCoord.y) * feather;
  float d = sdUnevenCapsule(p, vA.xy, vB.xy, vA.z, vB.z);
  float alpha = clamp(0.5 - d / feather, 0.0, 1.0);
  if (alpha <= 0.0) discard;
  // A neighbour that is clearly nearer shades this pixel instead. Within the
  // tolerance both draw: a doubled pixel exactly on a joint is invisible,
  // a hole from rounding differences would not be.
  const float EPS = 1e-3;
  if (vPrev.z >= 0.0 && sdUnevenCapsule(p, vPrev.xy, vA.xy, vPrev.z, vA.z) < d - EPS) discard;
  if (vNext.z >= 0.0 && sdUnevenCapsule(p, vB.xy, vNext.xy, vB.z, vNext.z) < d - EPS) discard;
  vec2 ab = vB.xy - vA.xy;
  float t = clamp(dot(p - vA.xy, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  outColor = vec4(mix(vColA, vColB, t), alpha);
}
`;

function pressureToHalfWidth(p: number) {
  return MIN_HALF_WIDTH + (MAX_HALF_WIDTH - MIN_HALF_WIDTH) * p;
}

// Sample layout (spline samples and control points alike): x, y, halfWidth, r, g, b
const SP = 6;

class Stroke {
  private cps: number[] = [];
  private n = 0;
  // Fine spline samples. Sample 0 is the first control point; segment k's
  // samples are [segSample[k], segSample[k+1]).
  private samples: number[] = [];
  private segSample: number[] = [1];
  private finalSegs = 0; // segments 0..finalSegs-1 are final
  // Per capsule: the sample index it ends at, and the sample that ended its
  // fit (the first that did not fit; Infinity for the open last capsule).
  private capEnd: number[] = [];
  private capBreak: number[] = [];
  private pending = false;
  private readonly fxy = new OneEuroFilter2D(3, 0.03);
  private readonly fp = new OneEuroFilter(5, 2);

  constructor(readonly buffer: CapsuleBuffer) {}

  /** Control point positions as drawn (set when the stroke ends). */
  original: Float32Array | null = null;

  get needsTessellation() {
    return this.pending;
  }

  /** When each control point was drawn (seconds, pointer event time). */
  readonly times: number[] = [];

  get pointCount() {
    return this.n;
  }

  /** Control point positions [i0, i1) as x, y pairs (default: all). */
  positions(i0 = 0, i1 = this.n): Float32Array {
    const out = new Float32Array((i1 - i0) * 2);
    for (let i = i0; i < i1; i++) {
      out[2 * (i - i0)] = this.cps[i * CP];
      out[2 * (i - i0) + 1] = this.cps[i * CP + 1];
    }
    return out;
  }

  /** Overwrite control point positions from index i0 (x, y pairs); call rebuild() after. */
  setPositions(i0: number, xy: Float32Array) {
    const c = this.cps;
    for (let k = 0; k < xy.length / 2; k++) {
      c[(i0 + k) * CP] = xy[2 * k];
      c[(i0 + k) * CP + 1] = xy[2 * k + 1];
    }
  }

  snapshot() {
    this.original = this.positions();
  }

  /** Re-tessellate the whole stroke from its current control points. */
  rebuild() {
    const c = this.cps;
    this.samples = c.slice(0, SP); // sample 0 is the first control point
    this.segSample = [1];
    this.finalSegs = 0;
    this.capEnd = [];
    this.capBreak = [];
    this.buffer.count = 0;
    this.fit(0);
    this.tessellate(true);
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
    this.times.push(s.t);
    this.n++;
    if (this.n === 1) {
      this.samples.push(x, y, hw, s.r, s.g, s.b);
      this.fit(0); // the start dot (also all a tap leaves)
    }
    this.pending = true;
  }

  /** Re-sample from the first non-final segment and refit the tail. `final`: the stroke is over. */
  tessellate(final: boolean) {
    this.pending = false;
    const n = this.n;
    if (n < 2) return;
    const from = this.finalSegs;
    const firstChanged = this.segSample[from];
    this.samples.length = firstChanged * SP;
    this.segSample.length = from + 1;
    for (let s = from; s < n - 1; s++) {
      this.emitSegment(s);
      this.segSample.push(this.samples.length / SP);
    }
    // With n points, segment n-2 still extrapolates its far neighbour.
    this.finalSegs = final ? n - 1 : n - 2;
    this.fit(firstChanged);
  }

  // Keep the capsules whose fit only saw unchanged samples, then refit from
  // the end of the last one kept.
  private fit(firstChanged: number) {
    let keep = this.capBreak.length;
    while (keep > 0 && this.capBreak[keep - 1] >= firstChanged) keep--;
    this.truncate(keep);
    this.capEnd.length = this.capBreak.length = keep;
    const sm = this.samples;
    const count = sm.length / SP;
    let a = keep > 0 ? this.capEnd[keep - 1] : 0;
    if (count === 1) {
      this.emit(0, 0, Infinity); // a lone dot
      return;
    }
    while (a < count - 1) {
      // Extend the capsule a → e while the next sample still fits.
      let e = a + 1;
      while (e + 1 < count && this.fits(a, e + 1)) e++;
      this.emit(a, e, e + 1 < count ? e + 1 : Infinity);
      a = e;
    }
  }

  // Does a capsule from sample a to sample e stay within FIT_TOL of every
  // sample between them (distance to the chord plus radius difference), and
  // within FIT_COLOR_TOL of their colours?
  private fits(a: number, e: number) {
    const sm = this.samples;
    const ax = sm[a * SP], ay = sm[a * SP + 1], ar = sm[a * SP + 2];
    const ex = sm[e * SP], ey = sm[e * SP + 1], er = sm[e * SP + 2];
    const dx = ex - ax, dy = ey - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 > MAX_CAPSULE * MAX_CAPSULE) return false;
    for (let j = a + 1; j < e; j++) {
      const o = j * SP;
      const px = sm[o] - ax, py = sm[o + 1] - ay;
      const t = len2 > 1e-9 ? Math.min(1, Math.max(0, (px * dx + py * dy) / len2)) : 0;
      const off = Math.hypot(px - t * dx, py - t * dy);
      if (off + Math.abs(sm[o + 2] - (ar + (er - ar) * t)) > FIT_TOL) return false;
      for (let k = 3; k < 6; k++) {
        const ca = sm[a * SP + k];
        if (Math.abs(sm[o + k] - (ca + (sm[e * SP + k] - ca) * t)) > FIT_COLOR_TOL) return false;
      }
    }
    return true;
  }

  private emit(a: number, e: number, brk: number) {
    const sm = this.samples, oa = a * SP, oe = e * SP;
    this.push(
      sm[oa], sm[oa + 1], sm[oa + 2], sm[oe], sm[oe + 1], sm[oe + 2],
      sm[oa + 3], sm[oa + 4], sm[oa + 5], sm[oe + 3], sm[oe + 4], sm[oe + 5],
    );
    this.capEnd.push(e);
    this.capBreak.push(brk);
  }

  private truncate(count: number) {
    const b = this.buffer;
    b.count = count;
    b.mark(count);
    if (count > 0) {
      b.data[(count - 1) * ISTRIDE + 11] = -1; // the new last capsule has no next (yet)
      b.mark(count - 1);
    }
  }

  // Append a capsule A→B, linking it with the previous one.
  private push(
    ax: number, ay: number, ra: number, bx: number, by: number, rb: number,
    r1: number, g1: number, b1: number, r2: number, g2: number, b2: number,
  ) {
    const buf = this.buffer;
    buf.reserve(1);
    const f = buf.data;
    const i = buf.count;
    let w = i * ISTRIDE;
    if (i > 0) {
      const o = w - ISTRIDE;
      f[w++] = f[o + 3]; f[w++] = f[o + 4]; f[w++] = f[o + 5]; // P = previous capsule's A
      f[o + 9] = bx; f[o + 10] = by; f[o + 11] = rb; // previous capsule's N = this B
      buf.mark(i - 1);
    } else {
      f[w++] = 0; f[w++] = 0; f[w++] = -1;
    }
    f[w++] = ax; f[w++] = ay; f[w++] = ra;
    f[w++] = bx; f[w++] = by; f[w++] = rb;
    f[w++] = 0; f[w++] = 0; f[w++] = -1; // N: none yet
    f[w++] = r1; f[w++] = g1; f[w++] = b1;
    f[w++] = r2; f[w++] = g2; f[w] = b2;
    buf.mark(i);
    buf.count = i + 1;
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

    // Sample count: enough for the outer offset curve's length and the turn.
    const chord = Math.hypot(x2 - x1, y2 - y1);
    const turn = Math.abs(Math.atan2(t1x * t2y - t1y * t2x, t1x * t2x + t1y * t2y));
    const steps = Math.min(MAX_SAMPLES, Math.max(1, Math.ceil((chord + turn * wHi) / STEP), Math.ceil(turn / MAX_TURN)));

    const r1 = c[o1 + 3], g1 = c[o1 + 4], b1 = c[o1 + 5];
    const dr = c[o2 + 3] - r1, dg = c[o2 + 4] - g1, db = c[o2 + 5] - b1;

    // Samples for u in (0, 1]; u = 0 is the previous segment's last sample.
    const out = this.samples;
    for (let j = 1; j <= steps; j++) {
      const u = j / steps, u2 = u * u, u3 = u2 * u;
      let hw = aw * u3 + bw * u2 + m1 * u + w1;
      hw = hw < wLo ? wLo : hw > wHi ? wHi : hw;
      out.push(
        ax * u3 + bx * u2 + t1x * u + x1, ay * u3 + by * u2 + t1y * u + y1, hw,
        r1 + dr * u, g1 + dg * u, b1 + db * u,
      );
    }
  }
}

// Control points [i0, i1) of a stroke easing from `from` to `to` (x, y pairs).
interface Tween {
  stroke: Stroke;
  i0: number;
  i1: number;
  from: Float32Array;
  to: Float32Array;
  start: number;
  ms: number;
  done?: boolean;
}

// A range wander has bent: control points i0..i1 (inclusive, ends pinned) and
// their positions before the bend, which a restore returns to.
interface WanderRange {
  stroke: Stroke;
  i0: number;
  i1: number;
  base: Float32Array;
}

const WANDER_FRAMES = 20; // a range is the points drawn within this many 60 Hz frames
const WANDER_RESTORE_P = 0.3; // chance a step restores a range instead of bending one
const WANDER_TRIES = 12; // random picks before a step gives up and restores instead

export class StrokeLayer {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private camera = new THREE.OrthographicCamera(); // unused: the shader projects screen px itself
  private scene = new THREE.Scene();
  private material: THREE.RawShaderMaterial;
  private finished: CapsuleBuffer; // every finished stroke, in the order they ended
  private active = new Map<number, Stroke>();
  private strokes: Stroke[] = []; // finished, in the order they ended
  private order = 1;
  private frame = { width: 1, height: 1 }; // CSS px
  private tweens: Tween[] = [];
  private ranges: WanderRange[] = []; // ranges wander has bent and not yet restored

  constructor(parent: HTMLElement, background = 0x0d0d0f) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, depth: false, stencil: false });
    // No colour management: the shader writes straight sRGB values, and the
    // clear colour should too.
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setClearColor(new THREE.Color().setHex(background, THREE.LinearSRGBColorSpace), 1);
    this.canvas = this.renderer.domElement;
    parent.prepend(this.canvas);
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: capsuleVertex,
      fragmentShader: capsuleFragment,
      uniforms: { viewport: { value: new THREE.Vector2(1, 1) }, feather: { value: 1 }, canvasHeight: { value: 1 } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.finished = new CapsuleBuffer(this.material, 1 << 15);
    this.finished.mesh.renderOrder = 0;
    this.scene.add(this.finished.mesh);
  }

  resize(width: number, height: number, pixelRatio: number) {
    this.frame = { width, height };
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height);
    // Feather = one device pixel in CSS px; the canvas may be a fraction off
    // width × pixelRatio after rounding, so use its real size.
    const canvas = this.renderer.domElement;
    this.material.uniforms.feather.value = width / canvas.width;
    this.material.uniforms.canvasHeight.value = canvas.height;
    (this.material.uniforms.viewport.value as THREE.Vector2).set(width, height);
  }

  begin(id: number, sample: StrokeSample) {
    this.end(id);
    const buffer = new CapsuleBuffer(this.material);
    buffer.mesh.renderOrder = this.order++; // strokes in progress draw after the finished ones, in start order
    this.scene.add(buffer.mesh);
    const stroke = new Stroke(buffer);
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
    stroke.snapshot();
    // It joins the shared buffer; its own buffer stays as its CPU-side copy.
    this.scene.remove(stroke.buffer.mesh);
    this.strokes.push(stroke);
    this.finished.append(stroke.buffer);
  }

  clear() {
    for (const stroke of this.active.values()) this.scene.remove(stroke.buffer.mesh);
    this.active.clear();
    this.strokes = [];
    this.tweens = [];
    this.ranges = [];
    this.finished.clear();
  }

  /**
   * Bend every finished stroke: `points` points along each move about
   * `distance` px (staying in frame), eased over `ms`. Cancels wander's ranges.
   */
  scatter(points: number, distance: number, ms: number) {
    this.tweens = [];
    this.ranges = [];
    for (const s of this.strokes) {
      this.tween(s, 0, scatterTargets(s.positions(), this.frame, distance, points), ms);
    }
  }

  /** Ease every finished stroke back to its shape as drawn, over `ms`. Cancels wander's ranges. */
  restore(ms: number) {
    this.tweens = [];
    this.ranges = [];
    for (const s of this.strokes) this.tween(s, 0, s.original ?? s.positions(), ms);
  }

  /**
   * One step of the wander process (main.ts calls it once a second while it
   * is on). With probability WANDER_RESTORE_P, or when no free range turns up
   * in WANDER_TRIES random picks, ease one bent range back; otherwise bend a
   * new range: the control points drawn within WANDER_FRAMES frames from a
   * random start on a random stroke, not overlapping any bent range. `points`
   * picks inside it move about `distance` px with its two ends pinned, so the
   * bend tapers into the rest of the stroke.
   */
  wanderStep(points: number, distance: number, ms: number) {
    if (this.ranges.length > 0 && Math.random() < WANDER_RESTORE_P) {
      this.restoreRange(ms);
      return;
    }
    const range = this.pickRange();
    if (!range) {
      if (this.ranges.length > 0) this.restoreRange(ms);
      return;
    }
    const { stroke, i0, i1 } = range;
    const base = stroke.positions(i0, i1 + 1);
    this.ranges.push({ stroke, i0, i1, base });
    this.tween(stroke, i0, scatterTargets(base, this.frame, distance, points, true), ms);
  }

  // A random free range, or null after WANDER_TRIES misses.
  private pickRange(): { stroke: Stroke; i0: number; i1: number } | null {
    const candidates = this.strokes.filter((s) => s.pointCount >= 3);
    if (candidates.length === 0) return null;
    for (let tryNo = 0; tryNo < WANDER_TRIES; tryNo++) {
      const stroke = candidates[Math.floor(Math.random() * candidates.length)];
      const n = stroke.pointCount, times = stroke.times;
      const i0 = Math.floor(Math.random() * (n - 2));
      let i1 = i0 + 1;
      while (i1 < n - 1 && times[i1 + 1] - times[i0] <= WANDER_FRAMES / 60) i1++;
      if (i1 - i0 < 2) i1 = Math.min(n - 1, i0 + 2); // at least one point between the pinned ends
      // Ranges may share an end point (it stays pinned in both).
      const clash = this.ranges.some((r) => r.stroke === stroke && i0 < r.i1 && r.i0 < i1);
      if (!clash) return { stroke, i0, i1 };
    }
    return null;
  }

  private restoreRange(ms: number) {
    const k = Math.floor(Math.random() * this.ranges.length);
    const [r] = this.ranges.splice(k, 1);
    this.tween(r.stroke, r.i0, r.base, ms);
  }

  // Ease control points from index i0 to `to` (x, y pairs), starting from
  // where they are now; replaces any tween already moving those points.
  private tween(stroke: Stroke, i0: number, to: Float32Array, ms: number) {
    const i1 = i0 + to.length / 2;
    this.tweens = this.tweens.filter((t) => t.stroke !== stroke || t.i1 <= i0 || i1 <= t.i0);
    this.tweens.push({ stroke, i0, i1, from: stroke.positions(i0, i1), to, start: performance.now(), ms });
  }

  private stepTweens() {
    if (this.tweens.length === 0) return;
    const now = performance.now();
    const moved = new Set<Stroke>();
    for (const t of this.tweens) {
      const p = Math.min(1, (now - t.start) / t.ms);
      const e = easeOutExpo(p);
      const xy = new Float32Array(t.from.length);
      for (let k = 0; k < xy.length; k++) xy[k] = t.from[k] + (t.to[k] - t.from[k]) * e;
      t.stroke.setPositions(t.i0, xy);
      moved.add(t.stroke);
      t.done = p >= 1;
    }
    this.tweens = this.tweens.filter((t) => !t.done);
    for (const s of moved) s.rebuild();
    this.finished.clear();
    for (const stroke of this.strokes) this.finished.append(stroke.buffer);
  }

  /** Bring the data up to date and draw every stroke. Call once per frame. */
  render() {
    this.stepTweens();
    for (const stroke of this.active.values()) {
      if (stroke.needsTessellation) stroke.tessellate(false);
      stroke.buffer.flush();
    }
    this.finished.flush();
    this.renderer.render(this.scene, this.camera);
  }
}
