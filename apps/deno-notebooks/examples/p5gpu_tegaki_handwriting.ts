/// <reference lib="dom" />

// Handwriting animation POC using tegaki-generated glyph data rendered with p5gpu.
//
// Loads the pre-generated Caveat bundle from the tegaki repo at
// clonedCompanionRepos/tegaki/packages/renderer/fonts/caveat/glyphData.json,
// walks each glyph's stroke polylines, and reveals them progressively over
// time as p5gpu lines. No native canvas, no SVG — just the raw stroke data.
//
// Run from apps/deno-notebooks:
//   deno run --unstable-webgpu --unstable-ffi --allow-all \
//     examples/p5gpu_tegaki_handwriting.ts

import { P5GPU } from "../tools/p5gpu.ts";
import {
  createWindowRenderManager,
  requestWebGpuDevice,
  type WindowTweakpane,
} from "../window/mod.ts";

// ── Types (a subset of tegaki/src/types.ts — keeps this POC standalone) ──

interface TegakiStroke {
  p: number[][]; // [x, y, width] tuples in font units
  d: number;     // delay before stroke starts (seconds)
  a: number;     // stroke animation duration (seconds)
}
interface TegakiGlyph {
  w: number;           // advance width (font units)
  t: number;           // total animation duration (seconds)
  s: TegakiStroke[];
}
type TegakiGlyphData = Record<string, TegakiGlyph>;

// Caveat bundle metadata (from bundle.ts — hard-coded here to avoid TS-import-attrs dance)
const FONT_META = {
  unitsPerEm: 1000,
  ascender: 960,
  descender: -300,
};

// ── Config ───────────────────────────────────────────────────────

const WIDTH = 1280;
const HEIGHT = 720;

const TEXT = "Hello World";
const FONT_SIZE = 180;
const ORIGIN_X = 80;
const ORIGIN_Y = 240; // top of em square in screen px
const LOOP_HOLD_SECONDS = 1.2;

// Timeline gaps (match tegaki defaults)
const GLYPH_GAP = 0.1;
const WORD_GAP = 0.15;

const params = {
  speed: 1.0,
  strokeColor: "#ffe9a8",
  bgColor: "#10131a",
  widthScale: 1.0,
  showGhost: true,
};

// ── Load glyph data from the tegaki repo ─────────────────────────

const GLYPH_DATA_PATH = new URL(
  "../../../clonedCompanionRepos/tegaki/packages/renderer/fonts/caveat/glyphData.json",
  import.meta.url,
);
const glyphData: TegakiGlyphData = JSON.parse(
  await Deno.readTextFile(GLYPH_DATA_PATH),
);
console.log(`Loaded ${Object.keys(glyphData).length} glyphs from Caveat bundle`);

// ── Timeline: schedule each character along a shared time axis ──

interface TimelineEntry {
  char: string;
  offset: number;   // seconds from start of animation
  duration: number;
  glyph: TegakiGlyph | null;
}

function buildTimeline(text: string): { entries: TimelineEntry[]; total: number } {
  const entries: TimelineEntry[] = [];
  let offset = 0;
  for (const ch of [...text]) {
    const glyph = glyphData[ch] ?? null;
    const isSpace = /\s/.test(ch);
    const dur = isSpace ? 0 : (glyph?.t ?? 0.2);
    entries.push({ char: ch, offset, duration: dur, glyph });
    offset += dur;
    offset += isSpace ? WORD_GAP : GLYPH_GAP;
  }
  return { entries, total: Math.max(0, offset - GLYPH_GAP) };
}

const timeline = buildTimeline(TEXT);
console.log(
  `Timeline: ${timeline.entries.length} entries, total ${timeline.total.toFixed(2)}s`,
);

// ── Advance-width layout: x offset per glyph in pixels ────────────

const glyphX: number[] = [];
{
  const scale = FONT_SIZE / FONT_META.unitsPerEm;
  let cursor = 0;
  for (const e of timeline.entries) {
    glyphX.push(cursor);
    const advance = e.glyph?.w ?? (e.char === " " ? 300 : 500); // fallback advance
    cursor += advance * scale;
  }
}

// ── Helpers ──────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** Ease-out quad (same as tegaki's default stroke easing). */
function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/**
 * Draw a stroke at the given progress (0..1) by emitting line segments
 * whose cumulative length covers `totalLen * progress`.
 */
function drawStroke(
  p5: P5GPU,
  stroke: TegakiStroke,
  ox: number,
  oy: number,
  scale: number,
  progress: number,
  widthScale: number,
) {
  const pts = stroke.p;
  if (pts.length === 0 || progress <= 0) return;

  // Screen-space mapping (matches tegaki/drawGlyph: y is negative above baseline,
  // shifted by ascender so the em-square top lands at oy).
  const px = (x: number) => ox + x * scale;
  const py = (y: number) => oy + (y + FONT_META.ascender) * scale;

  // Single-point dot
  if (pts.length === 1) {
    const p0 = pts[0]!;
    const w = Math.max(p0[2]!, 0.5) * scale * widthScale;
    p5.strokeWeight(w);
    p5.point(px(p0[0]!), py(p0[1]!));
    return;
  }

  // Compute total polyline length and average width for this stroke
  let totalLen = 0;
  let widthSum = 0;
  for (let i = 0; i < pts.length; i++) {
    widthSum += pts[i]![2]!;
    if (i > 0) {
      const dx = pts[i]![0]! - pts[i - 1]![0]!;
      const dy = pts[i]![1]! - pts[i - 1]![1]!;
      totalLen += Math.sqrt(dx * dx + dy * dy);
    }
  }
  const avgWidth = widthSum / pts.length;
  const lineWidth = Math.max(avgWidth, 0.5) * scale * widthScale;
  p5.strokeWeight(lineWidth);

  const drawLen = totalLen * progress;
  if (drawLen <= 0) return;

  // Emit fully-covered segments, then a partial tail.
  let accum = 0;
  let prevX = px(pts[0]![0]!);
  let prevY = py(pts[0]![1]!);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const dx = b[0]! - a[0]!;
    const dy = b[1]! - a[1]!;
    const segLen = Math.sqrt(dx * dx + dy * dy);

    if (accum + segLen <= drawLen) {
      const bx = px(b[0]!);
      const by = py(b[1]!);
      p5.line(prevX, prevY, bx, by);
      prevX = bx;
      prevY = by;
      accum += segLen;
    } else {
      const remain = drawLen - accum;
      if (remain > 0 && segLen > 0) {
        const t = remain / segLen;
        const tx = px(a[0]! + dx * t);
        const ty = py(a[1]! + dy * t);
        p5.line(prevX, prevY, tx, ty);
      }
      return;
    }
  }
}

/** Draw a single glyph at (ox, oy) animated to localTime seconds. */
function drawGlyph(
  p5: P5GPU,
  glyph: TegakiGlyph,
  ox: number,
  oy: number,
  localTime: number,
  widthScale: number,
) {
  const scale = FONT_SIZE / FONT_META.unitsPerEm;
  for (const stroke of glyph.s) {
    if (localTime < stroke.d) continue;
    const elapsed = localTime - stroke.d;
    const linear = Math.min(elapsed / Math.max(stroke.a, 1e-6), 1);
    drawStroke(p5, stroke, ox, oy, scale, easeOutQuad(linear), widthScale);
  }
}

/** Ghost outline: all strokes at progress=1, semi-transparent. */
function drawGhost(p5: P5GPU, glyph: TegakiGlyph, ox: number, oy: number, widthScale: number) {
  const scale = FONT_SIZE / FONT_META.unitsPerEm;
  for (const stroke of glyph.s) {
    drawStroke(p5, stroke, ox, oy, scale, 1.0, widthScale);
  }
}

// ── Tweakpane ─────────────────────────────────────────────────────

function setupPane(pane: WindowTweakpane) {
  pane.addBinding(params, "speed", { min: 0.1, max: 3.0, step: 0.05, label: "Speed" });
  pane.addBinding(params, "widthScale", { min: 0.2, max: 2.5, step: 0.05, label: "Width x" });
  pane.addBinding(params, "showGhost", { label: "Show ghost" });
  pane.addBinding(params, "strokeColor", { label: "Ink" });
  pane.addBinding(params, "bgColor", { label: "BG" });
}

// ── Setup ────────────────────────────────────────────────────────

const device = await requestWebGpuDevice();
const renderWindow = await createWindowRenderManager({
  device,
  width: WIDTH,
  height: HEIGHT,
  title: "Tegaki × p5gpu",
  pane: { title: "Tegaki", panelWidth: 360, panelHeight: 280, setup: setupPane },
});
const p5 = new P5GPU(device, { width: WIDTH, height: HEIGHT });

const startTime = performance.now();
let fpsSmooth = 60;
let lastFrameTime = startTime;

await renderWindow.run(renderFrame, { cleanup: () => p5.dispose() });

function renderFrame() {
  const now = performance.now();
  const fps = 1000 / Math.max(1, now - lastFrameTime);
  fpsSmooth += (fps - fpsSmooth) * 0.1;
  lastFrameTime = now;

  const elapsed = ((now - startTime) / 1000) * params.speed;
  const loopLen = timeline.total + LOOP_HOLD_SECONDS;
  const tLoop = elapsed % loopLen;

  const [br, bg, bb] = hexToRgb(params.bgColor);
  const [ir, ig, ib] = hexToRgb(params.strokeColor);

  p5.beginFrame();
  p5.background(br, bg, bb);
  p5.noFill();
  p5.strokeCap(p5.ROUND);

  // Ghost pass (entire word pre-drawn faintly)
  if (params.showGhost) {
    p5.stroke(ir, ig, ib, 28);
    for (let i = 0; i < timeline.entries.length; i++) {
      const e = timeline.entries[i]!;
      if (!e.glyph) continue;
      drawGhost(p5, e.glyph, ORIGIN_X + glyphX[i]!, ORIGIN_Y, params.widthScale);
    }
  }

  // Live pass
  p5.stroke(ir, ig, ib, 255);
  for (let i = 0; i < timeline.entries.length; i++) {
    const e = timeline.entries[i]!;
    if (!e.glyph) continue;
    const local = tLoop - e.offset;
    if (local <= 0) continue;
    drawGlyph(
      p5,
      e.glyph,
      ORIGIN_X + glyphX[i]!,
      ORIGIN_Y,
      Math.min(local, e.duration),
      params.widthScale,
    );
  }

  // HUD
  p5.noStroke();
  p5.fill(160, 160, 180);
  p5.textFont("Inter Variable");
  p5.textSize(14);
  p5.textAlign("left", "bottom");
  p5.text(
    `${Math.round(fpsSmooth)} fps  ·  t=${tLoop.toFixed(2)}s / ${timeline.total.toFixed(2)}s`,
    20,
    HEIGHT - 12,
  );
  p5.textAlign("right", "bottom");
  p5.text(`tegaki × p5gpu · "${TEXT}"`, WIDTH - 20, HEIGHT - 12);

  return p5.endFrame();
}
