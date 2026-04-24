/// <reference lib="dom" />

// Tegaki × p5gpu — random-retrigger ECS demo.
//
// - Loads Caveat's tegaki glyph data + TTF from the vendored tegaki repo.
// - Lays out a long paragraph (multi-line word-wrap) via NativeTextEngine.
// - Stores per-laid-out-glyph phase in a flat ECS-style array (`glyphStates[]`).
// - Renderer is a dumb loop: for each char, draw its tegaki strokes up to `phase`.
// - Animation is core-timing branches writing to `state.phase`. A trigger loop
//   picks random characters and spawns short-lived ramp branches that drive
//   phase 0→1 over a random duration.
//
// Run from apps/deno-notebooks:
//   deno run --unstable-webgpu --unstable-ffi --allow-all \
//     examples/p5gpu_tegaki_handwriting.ts

import { P5GPU } from "../../tools/p5gpu.ts";
import {
  createWindowRenderManager,
  type PaneContainer,
  requestWebGpuDevice,
} from "../../window/mod.ts";
import { NativeTextEngine } from "../../tools/p5gpu_text/ffi.ts";
import { type DateTimeContext, launch } from "@avtools/core-timing";
import {
  type BodyContourProvider,
  createBodyContourProvider,
} from "./body_contour_provider.ts";
import {
  createHandBBoxProvider,
  type HandBBoxProvider,
} from "./hand_bbox_provider.ts";
import { installMacros, type MacroDef } from "../../tools/macros.ts";

// ── Tegaki data types (subset of packages/renderer/src/types.ts) ─────

interface TegakiStroke {
  p: number[][]; // [x, y, width] tuples in font units
  d: number; // delay before stroke starts (seconds)
  a: number; // stroke animation duration (seconds)
}
interface TegakiGlyph {
  w: number; // advance width (font units)
  t: number; // total animation duration (seconds)
  s: TegakiStroke[];
}
type TegakiGlyphData = Record<string, TegakiGlyph>;

interface PreparedTegakiStroke extends TegakiStroke {
  cumLen: Float32Array;
  totalLen: number;
  avgWidth: number;
}
interface PreparedTegakiGlyph extends Omit<TegakiGlyph, "s"> {
  s: PreparedTegakiStroke[];
}
type PreparedTegakiGlyphData = Record<string, PreparedTegakiGlyph>;

// ── Per-glyph state ─────────────────────────────────────────────────

/**
 * A single trigger mode's animation state for one glyph. Each mode has its
 * own buffer so switching modes doesn't disturb in-progress animations
 * driven by the other mode.
 */
interface PhaseTrack {
  phase: number;
  alpha: number;
  needsRecovery: boolean;
  epoch: number; // bumped on each trigger so stale ramps can self-cancel
  inProgress: boolean;
}

interface Bbox {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

/**
 * A hand-emitter particle. Lives as shared state between the core-timing
 * branch that drives its motion and the draw loop that renders it.
 * Coordinates are in screen pixels.
 */
interface HandParticle {
  x: number;
  y: number;
  radius: number;
  progress: number; // 0..1 as branch progTime / duration
  alive: boolean;
}

interface PathSpan {
  startU: number;
  endU: number;
  sourceAvgWidthPx: number;
}

interface MorphPathSample {
  t: number;
  x: number;
  y: number;
  cumLen: number;
}

interface MorphPathLut {
  samples: MorphPathSample[];
  totalLen: number;
}

interface GlyphState {
  ch: string; // source char this glyph corresponds to
  glyph: PreparedTegakiGlyph | null; // tegaki stroke data for that char (null = skipped)
  baselineX: number;
  baselineY: number;
  /** Glyph stroke bbox in normalized [0,1] coords (tegaki's layout canvas). Null for non-drawable. */
  bbox: Bbox | null;
  random: PhaseTrack;
  intersection: PhaseTrack;
  /** True if any body contour segment overlapped this glyph's bbox last frame. */
  intersecting: boolean;
  /** performance.now() timestamp before which intersection triggers are ignored. */
  cooldownUntil: number;
  /** Per-stroke normalized span assignment on the shared morph path target. */
  pathSpans: PathSpan[];
}

/**
 * Uniform grid over normalized [0,1]² storing drawable glyph indices per cell.
 * Glyph bboxes are static after layout, so the grid is built once in setup()
 * and queried per frame against dynamic contour segments.
 */
interface SpatialGrid {
  cols: number;
  rows: number;
  /** Flat array of length cols*rows. Each cell holds indices into state.glyphStates. */
  cells: number[][];
}

const GRID_COLS = 32;
const GRID_ROWS = 32;
const TAU = Math.PI * 2;
const CIRCLE_START_ANGLE = -Math.PI / 2;
const MORPH_PATH_SAMPLES = 1024;

// ── Constants ────────────────────────────────────────────────────────

// Charmonman bundle metadata (from its bundle.ts)
const FONT_META = { unitsPerEm: 1000, ascender: 1200, descender: -700 };
const FONT_FAMILY = "Charmonman";

const FONT_SIZE = 50;
const LINE_HEIGHT = 130; // Charmonman has tall asc+desc (em ≈ 1.9x fontSize)
const MARGIN_X = 80;
const MARGIN_Y = 100;

// Thai demo text — multiple phrases separated by spaces so the native
// layout engine has break opportunities (Thai has no inter-word spaces
// in normal prose, so we'd otherwise get one long unbreakable line).
const LOREM = `คำความรู้สึก
ภพ พราก จากไกล คิดถึง
แสงไฟลุก ใส่ใจ ม้วยมอด
กาลผันผ่าน สองโลก บรรจบ
ขม ขัด ปล่อย วางเวียน เวลา
`;

// ── Consolidated state ──────────────────────────────────────────────

export const state = {
  params: {
    /** Scene-level alpha multiplier. At 0, draw early-returns and trigger
     *  loops skip scheduling — matches burning_kinaree's `fade` semantics. */
    fade: 1.0,
    triggerMode: "random" as "random" | "intersection" | "hand",
    triggerRate: 18, // trigger attempts per second (random mode)
    minDuration: 0.35,
    maxDuration: 1.40,
    alphaFadeDuration: 0.75,
    widthScale: 2.0,
    bgColor: "#0d1017",
    inkColor: "#ffe9a8",
    idlePhase: 1.0, // 0 = invisible when not animating, 1 = fully drawn
    paused: false,
    glyphScale: 1.0, // 0–1, multiplies font scale; 0 = skip drawing
    pathMorph: 0.0, // 0 = laid-out text, 1 = shared target path
    pathMode: "lissajous" as "circle" | "lissajous",
    pathCenterX: 960,
    pathCenterY: 540,
    pathUniformWidth: false,
    circleRadius: 220,
    lissajousAmpX: 260,
    lissajousAmpY: 180,
    lissajousFreqX: 3,
    lissajousFreqY: 2,
    lissajousPhaseX: 0,
    lissajousPhaseY: Math.PI / 2,
    lissajousFreeRunPhaseX: true,
    lissajousFreeRunPhaseY: true,
    lissajousPhaseSpeedX: 0,
    lissajousPhaseSpeedY: 0,
    showContourDebug: false, // draw body contour outlines as sanity check
    contourDebugWeight: 4,
    /** Seconds after a glyph finishes animating before intersection can re-trigger it. */
    intersectionCooldownSec: 0.3,
    /** Mirror hand-bbox X across 0.5 before triggering. Swift sends camera-space
     *  coords; most camera feeds are rendered selfie-mirrored, so the user's
     *  left hand visually appears on screen-right. Default true. */
    mirrorHandX: true,

    // ── Hand particle emitter ──
    enableHandParticles: true,
    /** Straight-line travel distance from emitter origin, in pixels. */
    particleDistancePx: 150,
    /** Draw the (mirrored-if-toggled) hand bboxes as a debug overlay. */
    showHandBBoxDebug: false,
  },
  macros: {} as Record<string, number | boolean>,
  glyphStates: [] as GlyphState[],
  drawableIndices: [] as number[],
  runtime: {
    rootAnim: null as ReturnType<typeof launch> | null,
    engine: null as NativeTextEngine | null,
    /** Long-lived core-timing context used to spawn ramp branches from any call site. */
    triggerCtx: null as DateTimeContext | null,
    /** Uniform spatial grid over normalized [0,1] for fast bbox queries by contour segments. */
    spatialGrid: null as SpatialGrid | null,
    /** Scratch set for current-frame intersection tracking (avoids per-frame allocation). */
    intersectingScratch: new Set<number>(),
    /** Live particles emitted from hand bbox centers. Mutated by branches and draw. */
    handParticles: [] as HandParticle[],
    /** Shared target stroke width when pathUniformWidth is enabled. */
    pathUniformWidthPx: FONT_SIZE / FONT_META.unitsPerEm,
    morphPathKey: "",
    morphPathLut: null as MorphPathLut | null,
    lissajousPhaseAccumX: 0,
    lissajousPhaseAccumY: 0,
    lastMorphPhaseUpdateMs: null as number | null,
    prevPaused: false,
  },
  meta: {
    fontMeta: FONT_META,
    fontFamily: FONT_FAMILY,
    fontSize: FONT_SIZE,
    lineHeight: LINE_HEIGHT,
    marginX: MARGIN_X,
    marginY: MARGIN_Y,
    /** Canvas width in pixels. Populated by setup({width,height}). */
    width: 0,
    /** Canvas height in pixels. Populated by setup({width,height}). */
    height: 0,
    /** Text layout width = width - 2*marginX. Populated by setup. */
    maxWidth: 0,
    lorem: LOREM,
  },
  /**
   * Optional shared body contour source (set by combined.ts). Null in
   * standalone mode. Consumers can read `getContours()` each frame to get
   * the current smoothed outlines in normalized [0,1] coords.
   */
  contourProvider: null as BodyContourProvider | null,
  /**
   * Optional shared hand-bbox source. Used by the "hand" trigger mode to
   * fire glyph redraws when a hand bounding box overlaps a glyph bbox.
   */
  handBBoxProvider: null as HandBBoxProvider | null,
};

// ── Helper functions ────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function buildByteToCharIdx(text: string): Int32Array {
  const enc = new TextEncoder();
  const bytes = enc.encode(text);
  const arr = new Int32Array(bytes.length + 1);
  const chars = [...text];
  let b = 0;
  for (let i = 0; i < chars.length; i++) {
    const len = enc.encode(chars[i]!).length;
    for (let k = 0; k < len; k++) arr[b + k] = i;
    b += len;
  }
  arr[b] = chars.length;
  return arr;
}

function prepareGlyphData(glyphData: TegakiGlyphData): PreparedTegakiGlyphData {
  const prepared: PreparedTegakiGlyphData = {};
  for (const [ch, glyph] of Object.entries(glyphData)) {
    prepared[ch] = {
      ...glyph,
      s: glyph.s.map(prepareStroke),
    };
  }
  return prepared;
}

function prepareStroke(stroke: TegakiStroke): PreparedTegakiStroke {
  const pts = stroke.p;
  const cumLen = new Float32Array(pts.length);
  let totalLen = 0;
  let widthSum = 0;

  for (let i = 0; i < pts.length; i++) {
    widthSum += pts[i]![2]!;
    if (i > 0) {
      const dx = pts[i]![0]! - pts[i - 1]![0]!;
      const dy = pts[i]![1]! - pts[i - 1]![1]!;
      totalLen += Math.sqrt(dx * dx + dy * dy);
    }
    cumLen[i] = totalLen;
  }

  return {
    ...stroke,
    cumLen,
    totalLen,
    avgWidth: pts.length > 0 ? widthSum / pts.length : 0,
  };
}

// ── Tegaki stroke rendering ──────────────────────────────────────────
//
// Baseline-relative: px = baselineX + x * scale, py = baselineY + y * scale.
// (Tegaki stores y with 0 at baseline and negative values above — so this
//  is equivalent to `oy + (y + ascender) * scale` using baseline = oy + asc*s.)

function drawStrokeUpTo(
  p5: P5GPU,
  stroke: PreparedTegakiStroke,
  baselineX: number,
  baselineY: number,
  scale: number,
  progress: number,
  widthScale: number,
) {
  const pts = stroke.p;
  if (pts.length === 0 || progress <= 0) return;

  if (pts.length === 1) {
    const p0 = pts[0]!;
    p5.strokeWeight(Math.max(p0[2]!, 0.5) * scale * widthScale);
    p5.point(baselineX + p0[0]! * scale, baselineY + p0[1]! * scale);
    return;
  }

  p5.strokeWeight(Math.max(stroke.avgWidth, 0.5) * scale * widthScale);
  const drawLen = stroke.totalLen * Math.min(progress, 1);
  if (drawLen <= 0) return;

  p5.beginShape();
  p5.vertex(baselineX + pts[0]![0]! * scale, baselineY + pts[0]![1]! * scale);

  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const segStart = stroke.cumLen[i - 1]!;
    const segEnd = stroke.cumLen[i]!;

    if (segEnd <= drawLen) {
      p5.vertex(baselineX + b[0]! * scale, baselineY + b[1]! * scale);
      continue;
    }

    const segLen = segEnd - segStart;
    if (segLen > 0) {
      const t = (drawLen - segStart) / segLen;
      const x = a[0]! + (b[0]! - a[0]!) * t;
      const y = a[1]! + (b[1]! - a[1]!) * t;
      p5.vertex(baselineX + x * scale, baselineY + y * scale);
    }
    break;
  }
  p5.endShape();
}

function assignPathSpans(): void {
  let totalStrokeLengthPx = 0;
  let weightedWidthSum = 0;
  let widthWeightSum = 0;

  for (const gs of state.glyphStates) {
    gs.pathSpans = [];
    const glyph = gs.glyph;
    if (!glyph) continue;
    for (const stroke of glyph.s) {
      const strokeLengthPx = stroke.totalLen * LAYOUT_SCALE;
      const strokeWidthPx = Math.max(stroke.avgWidth, 0.5) * LAYOUT_SCALE;
      totalStrokeLengthPx += strokeLengthPx;
      weightedWidthSum += strokeWidthPx * Math.max(strokeLengthPx, 1);
      widthWeightSum += Math.max(strokeLengthPx, 1);
    }
  }

  state.runtime.pathUniformWidthPx = widthWeightSum > 0
    ? weightedWidthSum / widthWeightSum
    : LAYOUT_SCALE;

  let u = 0;

  for (const gs of state.glyphStates) {
    const glyph = gs.glyph;
    if (!glyph) continue;
    for (const stroke of glyph.s) {
      const strokeLengthPx = stroke.totalLen * LAYOUT_SCALE;
      const span = totalStrokeLengthPx > 1e-6
        ? strokeLengthPx / totalStrokeLengthPx
        : 0;
      const startU = u;
      const endU = u + span;
      gs.pathSpans.push({
        startU,
        endU,
        sourceAvgWidthPx: Math.max(stroke.avgWidth, 0.5) * LAYOUT_SCALE,
      });
      u = endU;
    }
  }
}

function effectiveLissajousPhaseX(): number {
  return state.params.lissajousPhaseX + state.runtime.lissajousPhaseAccumX;
}

function effectiveLissajousPhaseY(): number {
  return state.params.lissajousPhaseY + state.runtime.lissajousPhaseAccumY;
}

function updateMorphPhaseAccumulators(nowMs = performance.now()): void {
  const lastMs = state.runtime.lastMorphPhaseUpdateMs;
  state.runtime.lastMorphPhaseUpdateMs = nowMs;
  if (lastMs === null) return;

  const dtSec = Math.max(0, (nowMs - lastMs) / 1000);
  if (dtSec <= 0) return;

  if (state.params.lissajousFreeRunPhaseX) {
    state.runtime.lissajousPhaseAccumX += state.params.lissajousPhaseSpeedX *
      dtSec;
  }
  if (state.params.lissajousFreeRunPhaseY) {
    state.runtime.lissajousPhaseAccumY += state.params.lissajousPhaseSpeedY *
      dtSec;
  }
}

function evaluateMorphPath(t: number): { x: number; y: number } {
  const clampedT = Math.max(0, Math.min(1, t));
  const p = state.params;

  if (p.pathMode === "lissajous") {
    const theta = clampedT * TAU;
    return {
      x: p.pathCenterX +
        Math.sin(theta * p.lissajousFreqX + effectiveLissajousPhaseX()) *
          p.lissajousAmpX,
      y: p.pathCenterY +
        Math.sin(theta * p.lissajousFreqY + effectiveLissajousPhaseY()) *
          p.lissajousAmpY,
    };
  }

  const theta = CIRCLE_START_ANGLE + clampedT * TAU;
  return {
    x: p.pathCenterX + Math.cos(theta) * p.circleRadius,
    y: p.pathCenterY + Math.sin(theta) * p.circleRadius,
  };
}

function buildMorphPathLut(): MorphPathLut {
  const samples: MorphPathSample[] = [];
  let prev = evaluateMorphPath(0);
  samples.push({ t: 0, x: prev.x, y: prev.y, cumLen: 0 });

  let totalLen = 0;
  for (let i = 1; i <= MORPH_PATH_SAMPLES; i += 1) {
    const t = i / MORPH_PATH_SAMPLES;
    const cur = evaluateMorphPath(t);
    totalLen += Math.hypot(cur.x - prev.x, cur.y - prev.y);
    samples.push({ t, x: cur.x, y: cur.y, cumLen: totalLen });
    prev = cur;
  }

  return { samples, totalLen };
}

function morphPathKey(): string {
  const p = state.params;
  return [
    p.pathMode,
    p.pathCenterX,
    p.pathCenterY,
    p.circleRadius,
    p.lissajousAmpX,
    p.lissajousAmpY,
    p.lissajousFreqX,
    p.lissajousFreqY,
    effectiveLissajousPhaseX(),
    effectiveLissajousPhaseY(),
  ].join("|");
}

function ensureMorphPathLut(): MorphPathLut {
  const key = morphPathKey();
  if (state.runtime.morphPathLut && state.runtime.morphPathKey === key) {
    return state.runtime.morphPathLut;
  }
  const lut = buildMorphPathLut();
  state.runtime.morphPathLut = lut;
  state.runtime.morphPathKey = key;
  return lut;
}

function sampleMorphPathByArc(u: number): { x: number; y: number } {
  const lut = state.runtime.morphPathLut ?? ensureMorphPathLut();
  const samples = lut.samples;
  if (samples.length === 0 || lut.totalLen <= 1e-6) {
    return evaluateMorphPath(u);
  }

  const targetLen = Math.max(0, Math.min(1, u)) * lut.totalLen;
  let lo = 0;
  let hi = samples.length - 1;

  while (lo < hi) {
    const mid = Math.floor((lo + hi) * 0.5);
    if (samples[mid]!.cumLen < targetLen) lo = mid + 1;
    else hi = mid;
  }

  const upper = samples[lo]!;
  if (lo === 0) return { x: upper.x, y: upper.y };
  const lower = samples[lo - 1]!;
  const segLen = upper.cumLen - lower.cumLen;
  if (segLen <= 1e-6) return { x: upper.x, y: upper.y };
  const t = (targetLen - lower.cumLen) / segLen;
  return {
    x: lower.x + (upper.x - lower.x) * t,
    y: lower.y + (upper.y - lower.y) * t,
  };
}

function setPathMorphPoint(
  out: { x: number; y: number },
  stroke: PreparedTegakiStroke,
  pathSpan: PathSpan,
  baselineX: number,
  baselineY: number,
  sourceScale: number,
  morph: number,
  index: number,
): void {
  const pt = stroke.p[index]!;
  const srcX = baselineX + pt[0]! * sourceScale;
  const srcY = baselineY + pt[1]! * sourceScale;
  const frac = stroke.totalLen > 1e-6
    ? stroke.cumLen[index]! / stroke.totalLen
    : stroke.p.length > 1
    ? index / (stroke.p.length - 1)
    : 0.5;
  const u = pathSpan.startU + (pathSpan.endU - pathSpan.startU) * frac;
  const dst = sampleMorphPathByArc(u);
  out.x = srcX + (dst.x - srcX) * morph;
  out.y = srcY + (dst.y - srcY) * morph;
}

function drawStrokePathMorphUpTo(
  p5: P5GPU,
  stroke: PreparedTegakiStroke,
  pathSpan: PathSpan,
  baselineX: number,
  baselineY: number,
  sourceScale: number,
  progress: number,
  morph: number,
  widthScale: number,
): void {
  const pts = stroke.p;
  if (pts.length === 0 || progress <= 0) return;
  if (morph <= 0) {
    drawStrokeUpTo(
      p5,
      stroke,
      baselineX,
      baselineY,
      sourceScale,
      progress,
      widthScale,
    );
    return;
  }

  const sourceStrokeWeight = Math.max(stroke.avgWidth, 0.5) * sourceScale;
  const targetStrokeWeight = state.params.pathUniformWidth
    ? state.runtime.pathUniformWidthPx
    : pathSpan.sourceAvgWidthPx;
  p5.strokeWeight(
    (sourceStrokeWeight + (targetStrokeWeight - sourceStrokeWeight) * morph) *
      widthScale,
  );

  const p0 = { x: 0, y: 0 };
  const p1 = { x: 0, y: 0 };
  setPathMorphPoint(
    p0,
    stroke,
    pathSpan,
    baselineX,
    baselineY,
    sourceScale,
    morph,
    0,
  );

  if (pts.length === 1) {
    p5.point(p0.x, p0.y);
    return;
  }

  let totalLen = 0;
  let prevX = p0.x;
  let prevY = p0.y;
  for (let i = 1; i < pts.length; i += 1) {
    setPathMorphPoint(
      p1,
      stroke,
      pathSpan,
      baselineX,
      baselineY,
      sourceScale,
      morph,
      i,
    );
    totalLen += Math.hypot(p1.x - prevX, p1.y - prevY);
    prevX = p1.x;
    prevY = p1.y;
  }
  if (totalLen <= 1e-6) {
    p5.point(p0.x, p0.y);
    return;
  }

  const drawLen = totalLen * Math.min(progress, 1);
  if (drawLen <= 0) return;

  p5.beginShape();
  p5.vertex(p0.x, p0.y);
  prevX = p0.x;
  prevY = p0.y;
  let traveled = 0;

  for (let i = 1; i < pts.length; i += 1) {
    setPathMorphPoint(
      p1,
      stroke,
      pathSpan,
      baselineX,
      baselineY,
      sourceScale,
      morph,
      i,
    );
    const segLen = Math.hypot(p1.x - prevX, p1.y - prevY);

    if (traveled + segLen <= drawLen) {
      p5.vertex(p1.x, p1.y);
      traveled += segLen;
      prevX = p1.x;
      prevY = p1.y;
      continue;
    }

    if (segLen > 1e-6) {
      const t = (drawLen - traveled) / segLen;
      p5.vertex(
        prevX + (p1.x - prevX) * t,
        prevY + (p1.y - prevY) * t,
      );
    }
    break;
  }

  p5.endShape();
}

// ── Spatial index + intersection detection ──────────────────────────
//
// The glyph bbox is computed once after layout using the LAYOUT_SCALE (font
// em scale). It does NOT factor in `glyphScale` — we use the "canonical"
// full-size bbox so triggers fire based on where the letter *would* be at
// full scale, independent of the fade-out proxy.
//
// TODO: Add interior (point-in-polygon) semantics as an alternative mode.
// Current implementation tests bbox-vs-contour-polyline — rising edge fires
// when the outline itself crosses the bbox. Interior mode would test
// whether the bbox (or its center) is inside any contour's filled polygon;
// letters stay "intersecting" while enveloped by the silhouette. Could
// share this spatial grid by rasterizing filled polygons to a grid once
// per frame and doing a single cell lookup per glyph.

const LAYOUT_SCALE = FONT_SIZE / FONT_META.unitsPerEm;

function computeGlyphBboxes(): void {
  for (const gs of state.glyphStates) {
    const glyph = gs.glyph;
    if (!glyph) continue;

    let xMin = Infinity;
    let yMin = Infinity;
    let xMax = -Infinity;
    let yMax = -Infinity;
    for (const stroke of glyph.s) {
      for (const pt of stroke.p) {
        const px = gs.baselineX + pt[0]! * LAYOUT_SCALE;
        const py = gs.baselineY + pt[1]! * LAYOUT_SCALE;
        if (px < xMin) xMin = px;
        if (py < yMin) yMin = py;
        if (px > xMax) xMax = px;
        if (py > yMax) yMax = py;
      }
    }
    if (xMin === Infinity) continue;

    // Normalize to [0,1] using the host canvas dimensions that were passed
    // into setup(). Contour points arrive in normalized coords relative to
    // the render canvas, so we use the same width/height for both the text
    // layout and the bbox normalization.
    gs.bbox = {
      xMin: xMin / state.meta.width,
      yMin: yMin / state.meta.height,
      xMax: xMax / state.meta.width,
      yMax: yMax / state.meta.height,
    };
  }
}

function buildSpatialGrid(): SpatialGrid {
  const cells: number[][] = Array.from(
    { length: GRID_COLS * GRID_ROWS },
    () => [],
  );
  for (let i = 0; i < state.glyphStates.length; i += 1) {
    const bbox = state.glyphStates[i]!.bbox;
    if (!bbox) continue;
    const cxMin = Math.max(
      0,
      Math.min(GRID_COLS - 1, Math.floor(bbox.xMin * GRID_COLS)),
    );
    const cyMin = Math.max(
      0,
      Math.min(GRID_ROWS - 1, Math.floor(bbox.yMin * GRID_ROWS)),
    );
    const cxMax = Math.max(
      0,
      Math.min(GRID_COLS - 1, Math.floor(bbox.xMax * GRID_COLS)),
    );
    const cyMax = Math.max(
      0,
      Math.min(GRID_ROWS - 1, Math.floor(bbox.yMax * GRID_ROWS)),
    );
    for (let cy = cyMin; cy <= cyMax; cy += 1) {
      for (let cx = cxMin; cx <= cxMax; cx += 1) {
        cells[cx + cy * GRID_COLS]!.push(i);
      }
    }
  }
  return { cols: GRID_COLS, rows: GRID_ROWS, cells };
}

function segmentIntersectsBbox(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  xMin: number,
  yMin: number,
  xMax: number,
  yMax: number,
): boolean {
  // Trivial reject: segment's own bbox doesn't overlap glyph bbox
  if (Math.max(ax, bx) < xMin) return false;
  if (Math.min(ax, bx) > xMax) return false;
  if (Math.max(ay, by) < yMin) return false;
  if (Math.min(ay, by) > yMax) return false;
  // Trivial accept: either endpoint inside bbox
  if (ax >= xMin && ax <= xMax && ay >= yMin && ay <= yMax) return true;
  if (bx >= xMin && bx <= xMax && by >= yMin && by <= yMax) return true;
  // Test segment against each of the 4 bbox edges (Cohen-Sutherland style).
  if (segSeg(ax, ay, bx, by, xMin, yMin, xMax, yMin)) return true;
  if (segSeg(ax, ay, bx, by, xMax, yMin, xMax, yMax)) return true;
  if (segSeg(ax, ay, bx, by, xMax, yMax, xMin, yMax)) return true;
  if (segSeg(ax, ay, bx, by, xMin, yMax, xMin, yMin)) return true;
  return false;
}

function segSeg(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  const d1 = cross(dx - cx, dy - cy, ax - cx, ay - cy);
  const d2 = cross(dx - cx, dy - cy, bx - cx, by - cy);
  const d3 = cross(bx - ax, by - ay, cx - ax, cy - ay);
  const d4 = cross(bx - ax, by - ay, dx - ax, dy - ay);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function cross(ux: number, uy: number, vx: number, vy: number): number {
  return ux * vy - uy * vx;
}

function markPausedRecoverySubset(): void {
  for (const gs of state.glyphStates) {
    gs.random.needsRecovery = gs.random.alpha < 1;
    gs.intersection.needsRecovery = gs.intersection.alpha < 1;
  }
}

function clearPausedRecoverySubset(): void {
  for (const gs of state.glyphStates) {
    gs.random.needsRecovery = false;
    gs.intersection.needsRecovery = false;
  }
}

function updatePausedRecoveryState(): void {
  const wasPaused = state.runtime.prevPaused;
  const isPaused = state.params.paused;
  if (isPaused && !wasPaused) {
    markPausedRecoverySubset();
  } else if (!isPaused && wasPaused) {
    clearPausedRecoverySubset();
  }
  state.runtime.prevPaused = isPaused;
}

function activeTrackName(): "random" | "intersection" {
  return state.params.triggerMode === "random" ? "random" : "intersection";
}

function getTrack(
  gs: GlyphState,
  trackName: "random" | "intersection",
): PhaseTrack {
  return trackName === "random" ? gs.random : gs.intersection;
}

function scheduleRamp(
  gs: GlyphState,
  trackName: "random" | "intersection",
  duration: number,
  purpose: "normal" | "recovery" = "normal",
): void {
  const triggerCtx = state.runtime.triggerCtx;
  if (!triggerCtx) return;
  const track = getTrack(gs, trackName);

  track.epoch += 1;
  const myEpoch = track.epoch;
  track.inProgress = true;

  triggerCtx.branch(async (rampCtx) => {
    track.phase = 0;
    track.alpha = 1;
    while (!rampCtx.isCanceled && rampCtx.progTime < duration) {
      if (track.epoch !== myEpoch) return; // preempted by a newer ramp
      track.phase = Math.min(1, rampCtx.progTime / duration);
      track.alpha = 1;
      await rampCtx.waitSec(1 / 60);
    }
    if (track.epoch === myEpoch) {
      track.phase = 1;
      track.alpha = 1;

      const fadeDuration = Math.max(0, state.params.alphaFadeDuration);
      const shouldEndHidden = purpose === "normal" && !state.params.paused;
      if (shouldEndHidden && fadeDuration > 0) {
        const fadeStart = rampCtx.progTime;
        while (
          !rampCtx.isCanceled && (rampCtx.progTime - fadeStart) < fadeDuration
        ) {
          if (track.epoch !== myEpoch) return;
          const t = (rampCtx.progTime - fadeStart) / fadeDuration;
          track.phase = 1;
          track.alpha = Math.max(0, 1 - t);
          await rampCtx.waitSec(1 / 60);
        }
      }

      if (purpose === "recovery") {
        track.phase = 1;
        track.alpha = 1;
        track.needsRecovery = false;
      } else if (shouldEndHidden) {
        track.phase = state.params.idlePhase;
        track.alpha = 0;
        if (!state.params.paused) track.needsRecovery = false;
      } else {
        track.phase = 1;
        track.alpha = 1;
        track.needsRecovery = false;
      }
      track.inProgress = false;
      gs.cooldownUntil = performance.now() +
        state.params.intersectionCooldownSec * 1000;
    }
  });
}

/**
 * Detect rising edges: glyph bboxes that transitioned from not-intersecting
 * to intersecting any body contour segment this frame. Spawn ramps on the
 * intersection track for each rising edge, subject to inProgress / cooldown.
 */
function processIntersectionTriggers(): void {
  if (state.params.paused) return;
  const provider = state.contourProvider;
  const grid = state.runtime.spatialGrid;
  const triggerCtx = state.runtime.triggerCtx;
  if (!provider || !grid || !triggerCtx) return;

  const contours = provider.getContours();

  const current = state.runtime.intersectingScratch;
  current.clear();

  if (contours.length > 0) {
    for (const contour of contours) {
      const pts = contour.points;
      if (pts.length < 2) continue;
      // Walk segments (closed polyline — wrap last→first).
      for (let i = 0; i < pts.length; i += 1) {
        const a = pts[i]!;
        const b = pts[(i + 1) % pts.length]!;
        const ax = a.x, ay = a.y, bx = b.x, by = b.y;

        // Cells overlapped by segment's axis-aligned bbox.
        const lo_x = Math.min(ax, bx);
        const hi_x = Math.max(ax, bx);
        const lo_y = Math.min(ay, by);
        const hi_y = Math.max(ay, by);
        const cxMin = Math.max(
          0,
          Math.min(grid.cols - 1, Math.floor(lo_x * grid.cols)),
        );
        const cxMax = Math.max(
          0,
          Math.min(grid.cols - 1, Math.floor(hi_x * grid.cols)),
        );
        const cyMin = Math.max(
          0,
          Math.min(grid.rows - 1, Math.floor(lo_y * grid.rows)),
        );
        const cyMax = Math.max(
          0,
          Math.min(grid.rows - 1, Math.floor(hi_y * grid.rows)),
        );

        for (let cy = cyMin; cy <= cyMax; cy += 1) {
          for (let cx = cxMin; cx <= cxMax; cx += 1) {
            const cell = grid.cells[cx + cy * grid.cols]!;
            for (let k = 0; k < cell.length; k += 1) {
              const gi = cell[k]!;
              if (current.has(gi)) continue;
              const gbbox = state.glyphStates[gi]!.bbox!;
              if (
                segmentIntersectsBbox(
                  ax,
                  ay,
                  bx,
                  by,
                  gbbox.xMin,
                  gbbox.yMin,
                  gbbox.xMax,
                  gbbox.yMax,
                )
              ) {
                current.add(gi);
              }
            }
          }
        }
      }
    }
  }

  // Rising-edge detection + trigger dispatch.
  const now = performance.now();
  const minD = Math.max(0.05, state.params.minDuration);
  const maxD = Math.max(minD, state.params.maxDuration);

  for (let i = 0; i < state.glyphStates.length; i += 1) {
    const gs = state.glyphStates[i]!;
    const wasIntersecting = gs.intersecting;
    const nowIntersecting = current.has(i);

    if (nowIntersecting && !wasIntersecting) {
      if (!gs.intersection.inProgress && now >= gs.cooldownUntil) {
        const duration = minD +
          triggerCtx.random() * (maxD - minD);
        scheduleRamp(gs, "intersection", duration);
      }
    }
    gs.intersecting = nowIntersecting;
  }
}

/**
 * Hand-bbox variant of processIntersectionTriggers: rising edge fires when a
 * hand's AABB overlaps a glyph's AABB. Reuses the same `intersection` phase
 * track so a mode switch doesn't break in-flight ramps.
 */
function processHandBBoxTriggers(): void {
  if (state.params.paused) return;
  const provider = state.handBBoxProvider;
  const triggerCtx = state.runtime.triggerCtx;
  if (!provider || !triggerCtx) return;

  const hands = provider.getHands();

  const current = state.runtime.intersectingScratch;
  current.clear();

  const mirror = state.params.mirrorHandX;
  if (hands.length > 0) {
    for (let i = 0; i < state.glyphStates.length; i += 1) {
      const gbbox = state.glyphStates[i]!.bbox;
      if (!gbbox) continue;
      for (const h of hands) {
        // Optionally mirror bbox X to match selfie-mirrored screen coords.
        const hMinX = mirror ? 1 - h.maxX : h.minX;
        const hMaxX = mirror ? 1 - h.minX : h.maxX;
        // AABB overlap test (normalized [0,1], top-left origin — same space).
        if (
          hMaxX >= gbbox.xMin && hMinX <= gbbox.xMax &&
          h.maxY >= gbbox.yMin && h.minY <= gbbox.yMax
        ) {
          current.add(i);
          break;
        }
      }
    }
  }

  const now = performance.now();
  const minD = Math.max(0.05, state.params.minDuration);
  const maxD = Math.max(minD, state.params.maxDuration);

  for (let i = 0; i < state.glyphStates.length; i += 1) {
    const gs = state.glyphStates[i]!;
    const wasIntersecting = gs.intersecting;
    const nowIntersecting = current.has(i);

    if (nowIntersecting && !wasIntersecting) {
      if (!gs.intersection.inProgress && now >= gs.cooldownUntil) {
        const duration = minD + triggerCtx.random() * (maxD - minD);
        scheduleRamp(gs, "intersection", duration);
      }
    }
    gs.intersecting = nowIntersecting;
  }
}

// ── Hand-bbox particle emitter ──────────────────────────────────────
//
// One emitter per visible hand, at the center of the (mirrored-if-toggled)
// bbox. Particles are spawned every 30–150 ms at random and live
// for 0.5–1.5 s as their own core-timing branches. Each particle snapshots
// its origin on spawn, moves along a random 60–120° direction (measured
// from horizontal; 90° = straight up), with a perpendicular sinusoidal
// wobble. Straight-line travel distance is the slider-bound param.

function spawnHandParticle(
  ctx: DateTimeContext,
  originX: number,
  originY: number,
): void {
  const p: HandParticle = {
    x: originX,
    y: originY,
    radius: 6 + ctx.random() * 10,
    progress: 0,
    alive: true,
  };
  state.runtime.handParticles.push(p);

  ctx.branch(async (pCtx) => {
    const angleRad = (60 + pCtx.random() * 60) * Math.PI / 180; // 60–120°
    const dirX = Math.cos(angleRad);
    const dirY = -Math.sin(angleRad); // screen Y grows downward
    const perpX = -dirY;
    const perpY = dirX;
    const duration = 0.5 + pCtx.random() * 1.0;
    const ampPx = 6 + pCtx.random() * 28; // perpendicular wobble 6–34 px
    const periodSec = 0.15 + pCtx.random() * 0.45;
    while (!pCtx.isCanceled && pCtx.progTime < duration) {
      const t = pCtx.progTime / duration;
      const distance = state.params.particleDistancePx;
      const along = t * distance;
      const wave = Math.sin(2 * Math.PI * pCtx.progTime / periodSec) *
        ampPx * (1 - t * 0.3); // fade the wobble out a touch
      p.x = originX + dirX * along + perpX * wave;
      p.y = originY + dirY * along + perpY * wave;
      p.progress = t;
      await pCtx.waitSec(1 / 60);
    }
    p.alive = false;
  });
}

/**
 * Persistent emitter loop. Runs at ~60Hz; for each visible hand, spawns a
 * particle when that hand's slot cooldown has elapsed. Slots are indexed by
 * the current hand array position — if hand detection churns, particle
 * origins jitter accordingly. Acceptable given the hand bbox itself jitters.
 */
async function runHandEmitterLoop(ctx: DateTimeContext): Promise<void> {
  const nextSpawnMs: number[] = [0, 0, 0, 0];
  while (!ctx.isCanceled) {
    const provider = state.handBBoxProvider;
    if (
      state.params.enableHandParticles && provider &&
      !state.params.paused && state.params.fade > 0
    ) {
      const hands = provider.getHands();
      const nowMs = ctx.progTime * 1000;
      const mirror = state.params.mirrorHandX;
      for (let i = 0; i < hands.length && i < nextSpawnMs.length; i += 1) {
        if (nowMs < nextSpawnMs[i]!) continue;
        const h = hands[i]!;
        const minX = mirror ? 1 - h.maxX : h.minX;
        const maxX = mirror ? 1 - h.minX : h.maxX;
        const centerX = (minX + maxX) * 0.5;
        const centerY = (h.minY + h.maxY) * 0.5;
        spawnHandParticle(
          ctx,
          centerX * state.meta.width,
          centerY * state.meta.height,
        );
        nextSpawnMs[i] = nowMs + 30 + ctx.random() * 120; // 30–150 ms
      }
    }
    await ctx.waitSec(1 / 60);
  }
}

function drawHandBBoxDebug(p5: P5GPU): void {
  const provider = state.handBBoxProvider;
  if (!provider) return;
  const hands = provider.getHands();
  if (hands.length === 0) return;

  const w = p5.width;
  const h = p5.height;
  const mirror = state.params.mirrorHandX;

  p5.push();
  p5.noFill();
  p5.strokeWeight(2);
  for (const hand of hands) {
    const minX = mirror ? 1 - hand.maxX : hand.minX;
    const maxX = mirror ? 1 - hand.minX : hand.maxX;
    const color: [number, number, number] = hand.chirality === "left"
      ? [110, 220, 255] // cyan
      : hand.chirality === "right"
      ? [170, 255, 200] // mint
      : [255, 220, 120]; // amber for unknown
    p5.stroke(color[0], color[1], color[2], 220);
    p5.rect(
      minX * w,
      hand.minY * h,
      (maxX - minX) * w,
      (hand.maxY - hand.minY) * h,
    );
  }
  p5.pop();
}

function drawHandParticles(p5: P5GPU): void {
  const particles = state.runtime.handParticles;
  // Prune dead in place.
  for (let i = particles.length - 1; i >= 0; i -= 1) {
    if (!particles[i]!.alive) particles.splice(i, 1);
  }
  if (particles.length === 0) return;

  const fade = state.params.fade;
  p5.push();
  p5.noStroke();
  for (const p of particles) {
    // Fire → smoke: brighten/orange at spawn, fade to transparent at end.
    const t = p.progress;
    const alpha = Math.round((1 - t) * 200 * fade);
    const r = 255;
    const g = Math.round(120 + (1 - t) * 120); // 240 → 120
    const b = Math.round(40 + t * 80); // cools a touch as it fades
    const sizeScale = 0.6 + (1 - t) * 0.8; // shrinks slightly
    p5.fill(r, g, b, alpha);
    p5.circle(p.x, p.y, p.radius * 2 * sizeScale);
  }
  p5.pop();
}

// ────────────────────────────────────────────────────────────────────

function drawGlyphAtPhase(
  p5: P5GPU,
  gs: GlyphState,
  phase: number,
  scale: number,
  widthScale: number,
) {
  const glyph = gs.glyph;
  if (!glyph || phase <= 0) return;
  const localTime = phase * glyph.t;
  const pathMorph = state.params.pathMorph;
  for (let strokeIdx = 0; strokeIdx < glyph.s.length; strokeIdx += 1) {
    const stroke = glyph.s[strokeIdx]!;
    if (localTime < stroke.d) continue;
    const elapsed = localTime - stroke.d;
    const lin = Math.min(elapsed / Math.max(stroke.a, 1e-6), 1);
    if (pathMorph > 0) {
      const pathSpan = gs.pathSpans[strokeIdx];
      if (pathSpan) {
        drawStrokePathMorphUpTo(
          p5,
          stroke,
          pathSpan,
          gs.baselineX,
          gs.baselineY,
          scale,
          easeOutQuad(lin),
          pathMorph,
          widthScale,
        );
        continue;
      }
    }
    drawStrokeUpTo(
      p5,
      stroke,
      gs.baselineX,
      gs.baselineY,
      scale,
      easeOutQuad(lin),
      widthScale,
    );
  }
}

// ── Tweakpane setup ─────────────────────────────────────────────────

export const macroDefs: MacroDef<number | boolean>[] = [
  {
    key: "fade",
    defaultValue: 1.0,
    opts: { min: 0, max: 1, step: 0.001, label: "Scene Fade" },
    apply: (v) => {
      state.params.fade = v as number;
    },
  },
  {
    key: "morph",
    defaultValue: 0.0,
    opts: { min: 0, max: 1, step: 0.001, label: "Morph" },
    apply: (v) => {
      state.params.pathMorph = v as number;
    },
  },
  {
    key: "lissajousPhaseSpeedX",
    defaultValue: 0.0,
    opts: { min: -TAU * 2, max: TAU * 2, step: 0.01, label: "Speed X" },
    apply: (v) => {
      state.params.lissajousPhaseSpeedX = v as number;
    },
  },
  {
    key: "lissajousPhaseSpeedY",
    defaultValue: 0.0,
    opts: { min: -TAU * 2, max: TAU * 2, step: 0.01, label: "Speed Y" },
    apply: (v) => {
      state.params.lissajousPhaseSpeedY = v as number;
    },
  },
  {
    key: "lissajousAmpX",
    defaultValue: 260,
    opts: { min: 0, max: 1600, step: 1, label: "Amp X" },
    apply: (v) => {
      state.params.lissajousAmpX = v as number;
    },
  },
  {
    key: "lissajousAmpY",
    defaultValue: 180,
    opts: { min: 0, max: 800, step: 1, label: "Amp Y" },
    apply: (v) => {
      state.params.lissajousAmpY = v as number;
    },
  },
  {
    key: "paused",
    defaultValue: false,
    opts: { label: "Pause triggers" },
    apply: (v) => {
      state.params.paused = v as boolean;
    },
  },
];

export function setupPane(pane: PaneContainer, refresh?: () => void) {
  const macros = pane.addFolder({ title: "Macros", expanded: true });
  installMacros(
    macros,
    state.macros,
    macroDefs,
    refresh ?? (() => pane.refresh()),
  );

  pane.addBinding(state.params, "fade", {
    min: 0,
    max: 1,
    step: 0.01,
    label: "Scene Fade",
  });
  pane.addBinding(state.params, "glyphScale", {
    min: 0,
    max: 1,
    step: 0.01,
    label: "Glyph scale",
  });
  const pathMorph = pane.addFolder({ title: "Path Morph" });
  pathMorph.addBinding(state.params, "pathMorph", {
    min: 0,
    max: 1,
    step: 0.01,
    label: "Morph",
  });
  pathMorph.addBinding(state.params, "pathMode", {
    options: {
      Circle: "circle",
      Lissajous: "lissajous",
    },
    label: "Mode",
  });
  pathMorph.addBinding(state.params, "pathCenterX", {
    min: 0,
    max: 1280,
    step: 1,
    label: "Center X",
  });
  pathMorph.addBinding(state.params, "pathCenterY", {
    min: 0,
    max: 720,
    step: 1,
    label: "Center Y",
  });
  pathMorph.addBinding(state.params, "pathUniformWidth", {
    label: "Uniform width",
  });
  const circle = pathMorph.addFolder({ title: "Circle" });
  circle.addBinding(state.params, "circleRadius", {
    min: 0,
    max: 800,
    step: 1,
    label: "Radius",
  });
  const lissajous = pathMorph.addFolder({ title: "Lissajous" });
  lissajous.addBinding(state.params, "lissajousAmpX", {
    min: 0,
    max: 1600,
    step: 1,
    label: "Amp X",
  });
  lissajous.addBinding(state.params, "lissajousAmpY", {
    min: 0,
    max: 800,
    step: 1,
    label: "Amp Y",
  });
  lissajous.addBinding(state.params, "lissajousFreqX", {
    min: 1,
    max: 12,
    step: 0.01,
    label: "Freq X",
  });
  lissajous.addBinding(state.params, "lissajousFreqY", {
    min: 1,
    max: 12,
    step: 0.01,
    label: "Freq Y",
  });
  lissajous.addBinding(state.params, "lissajousPhaseX", {
    min: -TAU,
    max: TAU,
    step: 0.01,
    label: "Phase X",
  });
  lissajous.addBinding(state.params, "lissajousPhaseY", {
    min: -TAU,
    max: TAU,
    step: 0.01,
    label: "Phase Y",
  });
  lissajous.addBinding(state.params, "lissajousFreeRunPhaseX", {
    label: "Free-run X",
  });
  lissajous.addBinding(state.params, "lissajousPhaseSpeedX", {
    min: -TAU * 2,
    max: TAU * 2,
    step: 0.01,
    label: "Speed X",
  });
  lissajous.addBinding(state.params, "lissajousFreeRunPhaseY", {
    label: "Free-run Y",
  });
  lissajous.addBinding(state.params, "lissajousPhaseSpeedY", {
    min: -TAU * 2,
    max: TAU * 2,
    step: 0.01,
    label: "Speed Y",
  });
  pane.addBinding(state.params, "triggerMode", {
    options: {
      "Random": "random",
      "Body intersection": "intersection",
      "Hand bbox": "hand",
    },
    label: "Trigger mode",
  });
  pane.addBinding(state.params, "triggerRate", {
    min: 0.5,
    max: 80,
    step: 0.5,
    label: "Trigger Hz (random)",
  });
  pane.addBinding(state.params, "intersectionCooldownSec", {
    min: 0,
    max: 5,
    step: 0.05,
    label: "Cooldown (s)",
  });
  pane.addBinding(state.params, "mirrorHandX", { label: "Mirror hand X" });

  const particles = pane.addFolder({ title: "Hand Particles" });
  particles.addBinding(state.params, "enableHandParticles", {
    label: "Enable",
  });
  particles.addBinding(state.params, "particleDistancePx", {
    min: 50,
    max: 300,
    step: 1,
    label: "Distance (px)",
  });
  particles.addBinding(state.params, "showHandBBoxDebug", {
    label: "Show bbox",
  });
  pane.addBinding(state.params, "minDuration", {
    min: 0.05,
    max: 3,
    step: 0.05,
    label: "Min dur (s)",
  });
  pane.addBinding(state.params, "maxDuration", {
    min: 0.05,
    max: 5,
    step: 0.05,
    label: "Max dur (s)",
  });
  pane.addBinding(state.params, "alphaFadeDuration", {
    min: 0,
    max: 5,
    step: 0.05,
    label: "Fade out (s)",
  });
  pane.addBinding(state.params, "widthScale", {
    min: 0.2,
    max: 9.5,
    step: 0.05,
    label: "Width x",
  });
  pane.addBinding(state.params, "idlePhase", {
    min: 0,
    max: 1,
    step: 0.01,
    label: "Idle phase",
  });
  pane.addBinding(state.params, "paused", { label: "Pause triggers" });
  pane.addBinding(state.params, "inkColor", { label: "Ink" });
  pane.addBinding(state.params, "bgColor", { label: "BG" });

  const contour = pane.addFolder({ title: "Body Contour" });
  contour.addBinding(state.params, "showContourDebug", {
    label: "Show outline",
  });
  contour.addBinding(state.params, "contourDebugWeight", {
    min: 1,
    max: 12,
    step: 0.5,
    label: "Outline weight",
  });
  pane.addButton({ title: "Reset all → idle" }).on("click", () => {
    for (const s of state.glyphStates) {
      s.random.phase = state.params.idlePhase;
      s.random.alpha = 1;
      s.random.needsRecovery = false;
      s.random.epoch += 1;
      s.intersection.phase = state.params.idlePhase;
      s.intersection.alpha = 1;
      s.intersection.needsRecovery = false;
      s.intersection.epoch += 1;
      s.intersecting = false;
      s.cooldownUntil = 0;
    }
  });
  pane.addButton({ title: "Reset all → 0" }).on("click", () => {
    for (const s of state.glyphStates) {
      s.random.phase = 0;
      s.random.alpha = 0;
      s.random.needsRecovery = false;
      s.random.epoch += 1;
      s.intersection.phase = 0;
      s.intersection.alpha = 0;
      s.intersection.needsRecovery = false;
      s.intersection.epoch += 1;
      s.intersecting = false;
      s.cooldownUntil = 0;
    }
  });
}

// ── Setup (load data, build layout, start animation) ────────────────

export async function setup(dims: { width: number; height: number }) {
  state.meta.width = dims.width;
  state.meta.height = dims.height;
  state.meta.maxWidth = dims.width - MARGIN_X * 2;
  state.runtime.lissajousPhaseAccumX = 0;
  state.runtime.lissajousPhaseAccumY = 0;
  state.runtime.lastMorphPhaseUpdateMs = null;
  state.runtime.morphPathLut = null;
  state.runtime.morphPathKey = "";
  state.runtime.prevPaused = state.params.paused;

  // Load tegaki bundle
  const TEGAKI_ROOT = new URL(
    "../../../../clonedCompanionRepos/tegaki/packages/renderer/fonts/charmonman/",
    import.meta.url,
  );
  const glyphData: TegakiGlyphData = JSON.parse(
    await Deno.readTextFile(new URL("glyphData.json", TEGAKI_ROOT)),
  );
  const preparedGlyphData = prepareGlyphData(glyphData);
  const fontBytes = await Deno.readFile(new URL("charmonman.ttf", TEGAKI_ROOT));
  console.log(
    `Loaded ${Object.keys(glyphData).length} tegaki glyphs (${FONT_FAMILY})`,
  );

  // Native layout: shape + wrap + per-line positions
  const engine = new NativeTextEngine();
  if (!engine.loadFontBytes(fontBytes)) {
    throw new Error("Failed to load Caveat font into native text engine");
  }
  state.runtime.engine = engine;

  const layout = engine.layoutText({
    text: LOREM,
    family: FONT_FAMILY,
    fontSize: FONT_SIZE,
    lineHeight: LINE_HEIGHT,
    width: state.meta.maxWidth,
    height: null,
    alignH: 1, // center
    wrapMode: 0, // word wrap
    weight: 400,
    style: 0,
    axisQuantization: 0,
    axes: {},
    // Tegaki's bundle is keyed by codepoint — we can't render a ligature
    // glyph's stroke data from per-codepoint entries. Disable liga/clig/
    // dlig/calt so every source codepoint emits its own glyph.
    disableLigatures: true,
  });
  console.log(
    `Layout: ${layout.glyphs.length} glyphs, ${layout.lineCount} lines, ` +
      `firstBaseline=${layout.firstBaseline.toFixed(1)}px`,
  );

  // ECS-style per-glyph store (cluster-mapped)
  const chars = [...LOREM];
  const byteToChar = buildByteToCharIdx(LOREM);

  const glyphStates: GlyphState[] = [];
  {
    let i = 0;
    while (i < layout.glyphs.length) {
      const cluster = layout.glyphs[i]!.cluster;
      let j = i;
      while (
        j < layout.glyphs.length && layout.glyphs[j]!.cluster === cluster
      ) j++;
      const startCharIdx = byteToChar[cluster] ?? 0;
      for (let k = 0; k < j - i; k++) {
        const g = layout.glyphs[i + k]!;
        const ch = chars[startCharIdx + k] ?? "";
        glyphStates.push({
          ch,
          glyph: preparedGlyphData[ch] ?? null,
          baselineX: MARGIN_X + g.x,
          baselineY: MARGIN_Y + g.y,
          bbox: null,
          random: {
            phase: state.params.idlePhase,
            alpha: 1,
            needsRecovery: false,
            epoch: 0,
            inProgress: false,
          },
          intersection: {
            phase: state.params.idlePhase,
            alpha: 1,
            needsRecovery: false,
            epoch: 0,
            inProgress: false,
          },
          intersecting: false,
          cooldownUntil: 0,
          pathSpans: [],
        });
      }
      i = j;
    }
  }
  state.glyphStates = glyphStates;

  const drawableIndices = glyphStates
    .map((s, i) => (s.glyph ? i : -1))
    .filter((i) => i >= 0);
  state.drawableIndices = drawableIndices;

  console.log(
    `Glyphs: ${glyphStates.length} (chars: ${chars.length}, drawable: ${drawableIndices.length})`,
  );

  assignPathSpans();

  // Compute per-glyph normalized bboxes and build the spatial grid.
  computeGlyphBboxes();
  state.runtime.spatialGrid = buildSpatialGrid();

  // Core-timing animation system. The random-mode trigger loop gates on
  // triggerMode === "random"; intersection-mode ramps are spawned from draw()
  // via scheduleRamp using the stored triggerCtx. Ramps already in flight
  // continue even after a mode switch — they're keyed to their own track.
  const rootAnim = launch(async (ctx) => {
    // Hand particle emitter — runs alongside the trigger loop.
    ctx.branch((emitterCtx) => runHandEmitterLoop(emitterCtx));

    ctx.branch(async (triggerCtx) => {
      state.runtime.triggerCtx = triggerCtx;
      while (!triggerCtx.isCanceled) {
        const rate = Math.max(0.1, state.params.triggerRate);
        await triggerCtx.waitSec(1 / rate);
        if (state.params.fade <= 0) continue;
        if (state.drawableIndices.length === 0) continue;

        const minD = Math.max(0.05, state.params.minDuration);
        const maxD = Math.max(minD, state.params.maxDuration);

        if (state.params.paused) {
          const trackName = activeTrackName();
          const recoveryCandidates = state.drawableIndices.filter((idx) => {
            const track = getTrack(state.glyphStates[idx]!, trackName);
            return track.needsRecovery && !track.inProgress;
          });
          if (recoveryCandidates.length === 0) continue;

          const pick = recoveryCandidates[
            Math.floor(triggerCtx.random() * recoveryCandidates.length)
          ]!;
          const gs = state.glyphStates[pick]!;
          const duration = minD + triggerCtx.random() * (maxD - minD);
          scheduleRamp(gs, trackName, duration, "recovery");
          continue;
        }

        if (state.params.triggerMode !== "random") continue;

        const pick = state.drawableIndices[
          Math.floor(triggerCtx.random() * state.drawableIndices.length)
        ]!;
        const gs = state.glyphStates[pick]!;
        const duration = minD + triggerCtx.random() * (maxD - minD);

        scheduleRamp(gs, "random", duration);
      }
    });

    // Root tick — keep descendant-time fresh for the trigger loop.
    while (!ctx.isCanceled) await ctx.waitSec(1 / 60);
  });
  state.runtime.rootAnim = rootAnim;

  rootAnim.catch((err: unknown) => {
    if ((err as Error)?.message !== "aborted") console.error("root:", err);
  });
}

// ── Draw (no beginFrame/endFrame, no HUD) ───────────────────────────

export function draw(p5: P5GPU, autoClear = true) {
  if (autoClear) p5.clear();
  updateMorphPhaseAccumulators();
  updatePausedRecoveryState();

  const [ir, ig, ib] = hexToRgb(state.params.inkColor);
  const fade = state.params.fade;

  // Scene-level fade gate — at 0, nothing from this sketch draws (including
  // debug overlays). Kept above the contour-debug call so fade=0 really
  // means the whole layer is off.
  if (fade <= 0) return;

  if (state.params.showContourDebug) {
    drawContourDebug(p5, ir, ig, ib);
  }

  if (state.params.glyphScale <= 0 && state.params.pathMorph <= 0) return;

  // Intersection-mode triggers fire here so they're gated by scene visibility.
  // "intersection" = body contour, "hand" = hand bbox. Both write to the
  // shared `intersection` phase track so switching modes doesn't drop ramps.
  if (state.params.triggerMode === "intersection") {
    processIntersectionTriggers();
  } else if (state.params.triggerMode === "hand") {
    processHandBBoxTriggers();
  }

  const scale = (FONT_SIZE / FONT_META.unitsPerEm) * state.params.glyphScale;
  const useIntersectionPhase = state.params.triggerMode === "intersection" ||
    state.params.triggerMode === "hand";
  if (state.params.pathMorph > 0) ensureMorphPathLut();

  p5.noFill();
  p5.strokeCap(p5.ROUND);
  p5.strokeJoin(p5.ROUND);
  for (const gs of state.glyphStates) {
    const track = useIntersectionPhase ? gs.intersection : gs.random;
    const phase = track.phase;
    const glyphAlpha = track.alpha;
    if (glyphAlpha <= 0) continue;
    p5.stroke(ir, ig, ib, Math.round(255 * fade * glyphAlpha));
    drawGlyphAtPhase(p5, gs, phase, scale, state.params.widthScale);
  }

  drawHandParticles(p5);

  if (state.params.showHandBBoxDebug) {
    drawHandBBoxDebug(p5);
  }
}

function drawContourDebug(p5: P5GPU, r: number, g: number, b: number): void {
  const provider = state.contourProvider;
  if (!provider) return;
  const contours = provider.getContours();
  if (contours.length === 0) return;

  const w = p5.width;
  const h = p5.height;

  p5.noFill();
  p5.strokeCap(p5.ROUND);
  p5.strokeJoin(p5.ROUND);
  p5.strokeWeight(state.params.contourDebugWeight);

  for (const contour of contours) {
    const alpha = Math.round(contour.opacity * 255);
    p5.stroke(r, g, b, alpha);
    p5.beginShape();
    for (const pt of contour.points) {
      p5.vertex(pt.x * w, pt.y * h);
    }
    p5.endShape();
  }
}

// ── Cleanup ─────────────────────────────────────────────────────────

export function cleanup() {
  if (state.runtime.rootAnim) {
    state.runtime.rootAnim.cancel();
    state.runtime.rootAnim = null;
  }
  if (state.runtime.engine) {
    state.runtime.engine.dispose();
    state.runtime.engine = null;
  }
  state.runtime.morphPathLut = null;
  state.runtime.morphPathKey = "";
  state.runtime.lissajousPhaseAccumX = 0;
  state.runtime.lissajousPhaseAccumY = 0;
  state.runtime.lastMorphPhaseUpdateMs = null;
}

// ── Standalone entry point ──────────────────────────────────────────

if (import.meta.main) {
  const WIDTH = 1280;
  const HEIGHT = 720;
  const device = await requestWebGpuDevice();

  // Standalone: create our own providers and wire them up.
  const provider = createBodyContourProvider();
  const handProvider = createHandBBoxProvider();
  state.contourProvider = provider;
  state.handBBoxProvider = handProvider;
  provider.setup();
  handProvider.setup();

  const renderWindow = await createWindowRenderManager({
    device,
    width: WIDTH,
    height: HEIGHT,
    title: "Tegaki × p5gpu — random retrigger",
    pane: {
      title: "Tegaki",
      panelWidth: 380,
      panelHeight: 420,
      setup: (pane) => {
        setupPane(pane);
        provider.setupPane(pane.addFolder({ title: "Contour Processing" }));
        handProvider.setupPane(pane.addFolder({ title: "Hands" }));
      },
    },
  });
  const p5 = new P5GPU(device, { width: WIDTH, height: HEIGHT });

  await setup({ width: WIDTH, height: HEIGHT });

  let fpsSmooth = 60;
  let lastFrameTime = performance.now();

  await renderWindow.run(() => {
    const now = performance.now();
    fpsSmooth += (1000 / Math.max(1, now - lastFrameTime) - fpsSmooth) * 0.1;
    lastFrameTime = now;

    provider.tick();
    handProvider.tick();

    p5.beginFrame();
    const [br, bg, bb] = hexToRgb(state.params.bgColor);
    p5.background(br, bg, bb);
    draw(p5, false);

    // HUD
    p5.noStroke();
    p5.fill(150, 150, 170);
    p5.textFont("Inter Variable");
    p5.textSize(13);
    p5.textAlign("left", "bottom");
    p5.text(
      `${
        Math.round(fpsSmooth)
      } fps · ${state.drawableIndices.length} glyphs · ` +
        `trigger ${state.params.triggerRate.toFixed(1)} Hz`,
      20,
      HEIGHT - 12,
    );
    p5.textAlign("right", "bottom");
    p5.text("tegaki × p5gpu × core-timing", WIDTH - 20, HEIGHT - 12);

    return p5.endFrame();
  }, {
    cleanup: () => {
      cleanup();
      provider.cleanup();
      handProvider.cleanup();
      p5.dispose();
    },
  });
}
