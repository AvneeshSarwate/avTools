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

import { P5GPU } from "../tools/p5gpu.ts";
import {
  createWindowRenderManager,
  requestWebGpuDevice,
  type WindowTweakpane,
} from "../window/mod.ts";
import { NativeTextEngine } from "../tools/p5gpu_text/ffi.ts";
import { launch } from "@avtools/core-timing";

// ── Tegaki data types (subset of packages/renderer/src/types.ts) ─────

interface TegakiStroke {
  p: number[][]; // [x, y, width] tuples in font units
  d: number;     // delay before stroke starts (seconds)
  a: number;     // stroke animation duration (seconds)
}
interface TegakiGlyph {
  w: number; // advance width (font units)
  t: number; // total animation duration (seconds)
  s: TegakiStroke[];
}
type TegakiGlyphData = Record<string, TegakiGlyph>;

// Charmonman bundle metadata (from its bundle.ts)
const FONT_META = { unitsPerEm: 1000, ascender: 1200, descender: -700 };
const FONT_FAMILY = "Charmonman";

// ── Config ───────────────────────────────────────────────────────────

const WIDTH = 1280;
const HEIGHT = 800;
const FONT_SIZE = 50;
const LINE_HEIGHT = 130;   // Charmonman has tall asc+desc (em ≈ 1.9x fontSize)
const MARGIN_X = 80;
const MARGIN_Y = 100;
const MAX_WIDTH = WIDTH - MARGIN_X * 2;

// Thai demo text — multiple phrases separated by spaces so the native
// layout engine has break opportunities (Thai has no inter-word spaces
// in normal prose, so we'd otherwise get one long unbreakable line).
const LOREM =
  "สวัสดีชาวโลก การเขียนอักษรไทย เป็นศิลปะที่งดงาม " +
  "ฝึกฝนให้เชี่ยวชาญ จะพบความภูมิใจ " +
  "ในมรดกทางวัฒนธรรมของชาติ ทุกเส้นขีดบนกระดาษ " +
  "คือบทกวีที่ไม่มีคำพูด อักษรนี้มีชีวิตและจิตใจ " +
  "Hello World";

const params = {
  triggerRate: 18,     // trigger attempts per second
  minDuration: 0.35,
  maxDuration: 1.40,
  widthScale: 1.0,
  bgColor: "#0d1017",
  inkColor: "#ffe9a8",
  idlePhase: 1.0,      // 0 = invisible when not animating, 1 = fully drawn
  paused: false,
  glyphScale: 1.0,
};

// ── Load tegaki bundle ───────────────────────────────────────────────

const TEGAKI_ROOT = new URL(
  "../../../clonedCompanionRepos/tegaki/packages/renderer/fonts/charmonman/",
  import.meta.url,
);
const glyphData: TegakiGlyphData = JSON.parse(
  await Deno.readTextFile(new URL("glyphData.json", TEGAKI_ROOT)),
);
const fontBytes = await Deno.readFile(new URL("charmonman.ttf", TEGAKI_ROOT));
console.log(`Loaded ${Object.keys(glyphData).length} tegaki glyphs (${FONT_FAMILY})`);

// ── Native layout: shape + wrap + per-line positions ─────────────────

const engine = new NativeTextEngine();
if (!engine.loadFontBytes(fontBytes)) {
  throw new Error("Failed to load Caveat font into native text engine");
}
const layout = engine.layoutText({
  text: LOREM,
  family: FONT_FAMILY,
  fontSize: FONT_SIZE,
  lineHeight: LINE_HEIGHT,
  width: MAX_WIDTH,
  height: null,
  alignH: 0,         // left
  wrapMode: 0,       // word wrap
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

// ── ECS-style per-glyph store (cluster-mapped) ───────────────────────
//
// One entry per laid-out glyph, NOT per source character. For Thai (and
// any script with combining marks / ligatures) the shaper's glyph list
// doesn't 1:1 match the input codepoints: a base consonant + its above
// vowel + its tone mark can all share one cluster (same `cluster` byte
// offset) but emit 2–3 glyphs at different (x, y) positions.
//
// We rebuilt the native engine to emit HarfBuzz's `cluster` per glyph
// (absolute UTF-8 byte offset into the source text). To map glyph→char
// we:
//   1. Build a byte→char-index lookup for the source text.
//   2. Walk glyphs in order, grouping consecutive glyphs with the same
//      cluster. Within a cluster-run, the k-th glyph maps to the k-th
//      source char in that cluster's char range (logical order holds
//      for Thai LTR since base precedes its marks in source).
//
// Each resulting GlyphState gets its own phase — so retriggering can
// flash an individual mark independently of its base, which is the
// exact effect we want for Thai.

interface GlyphState {
  ch: string;                   // source char this glyph corresponds to
  glyph: TegakiGlyph | null;    // tegaki stroke data for that char (null = skipped)
  baselineX: number;
  baselineY: number;
  phase: number;
  epoch: number;
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

const chars = [...LOREM];
const byteToChar = buildByteToCharIdx(LOREM);

const glyphStates: GlyphState[] = [];
{
  let i = 0;
  while (i < layout.glyphs.length) {
    const cluster = layout.glyphs[i]!.cluster;
    let j = i;
    while (j < layout.glyphs.length && layout.glyphs[j]!.cluster === cluster) j++;
    const startCharIdx = byteToChar[cluster] ?? 0;
    for (let k = 0; k < j - i; k++) {
      const g = layout.glyphs[i + k]!;
      const ch = chars[startCharIdx + k] ?? "";
      glyphStates.push({
        ch,
        glyph: glyphData[ch] ?? null,
        baselineX: MARGIN_X + g.x,
        baselineY: MARGIN_Y + g.y,
        phase: params.idlePhase,
        epoch: 0,
      });
    }
    i = j;
  }
}
const drawableIndices = glyphStates
  .map((s, i) => (s.glyph ? i : -1))
  .filter((i) => i >= 0);
console.log(
  `Glyphs: ${glyphStates.length} (chars: ${chars.length}, drawable: ${drawableIndices.length})`,
);

// ── Tegaki stroke rendering ──────────────────────────────────────────
//
// Baseline-relative: px = baselineX + x * scale, py = baselineY + y * scale.
// (Tegaki stores y with 0 at baseline and negative values above — so this
//  is equivalent to `oy + (y + ascender) * scale` using baseline = oy + asc*s.)

function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function drawStrokeUpTo(
  p5: P5GPU,
  stroke: TegakiStroke,
  baselineX: number,
  baselineY: number,
  scale: number,
  progress: number,
  widthScale: number,
) {
  const pts = stroke.p;
  if (pts.length === 0 || progress <= 0) return;

  const px = (x: number) => baselineX + x * scale;
  const py = (y: number) => baselineY + y * scale;

  if (pts.length === 1) {
    const p0 = pts[0]!;
    p5.strokeWeight(Math.max(p0[2]!, 0.5) * scale * widthScale);
    p5.point(px(p0[0]!), py(p0[1]!));
    return;
  }

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
  p5.strokeWeight(Math.max(widthSum / pts.length, 0.5) * scale * widthScale);

  const drawLen = totalLen * progress;
  if (drawLen <= 0) return;

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
      prevX = bx; prevY = by;
      accum += segLen;
    } else {
      const remain = drawLen - accum;
      if (remain > 0 && segLen > 0) {
        const t = remain / segLen;
        p5.line(prevX, prevY, px(a[0]! + dx * t), py(a[1]! + dy * t));
      }
      return;
    }
  }
}

function drawGlyphAtPhase(
  p5: P5GPU,
  state: GlyphState,
  scale: number,
  widthScale: number,
) {
  const glyph = state.glyph;
  if (!glyph || state.phase <= 0) return;
  const localTime = state.phase * glyph.t;
  for (const stroke of glyph.s) {
    if (localTime < stroke.d) continue;
    const elapsed = localTime - stroke.d;
    const lin = Math.min(elapsed / Math.max(stroke.a, 1e-6), 1);
    drawStrokeUpTo(
      p5, stroke, state.baselineX, state.baselineY, scale,
      easeOutQuad(lin), widthScale,
    );
  }
}

// ── Core-timing animation system ─────────────────────────────────────
//
// Root ticks at 60 Hz (required so branches spawned via the trigger loop
// start with fresh ctx.time). Trigger loop runs at `triggerRate` Hz,
// picking a random drawable char on each tick and spawning a one-shot
// ramp branch that writes `state.phase` over a random duration.
//
// `epoch` guards against stale branches: if a char gets retriggered
// before its current ramp finishes, the new ramp bumps epoch and the
// old branch bails out on its next iteration.

const rootAnim = launch(async (ctx) => {
  ctx.branch(async (triggerCtx) => {
    while (!triggerCtx.isCanceled) {
      const rate = Math.max(0.1, params.triggerRate);
      await triggerCtx.waitSec(1 / rate);
      if (params.paused || drawableIndices.length === 0) continue;

      const pick = drawableIndices[
        Math.floor(triggerCtx.random() * drawableIndices.length)
      ]!;
      const state = glyphStates[pick]!;
      const minD = Math.max(0.05, params.minDuration);
      const maxD = Math.max(minD, params.maxDuration);
      const duration = minD + triggerCtx.random() * (maxD - minD);

      state.epoch += 1;
      const myEpoch = state.epoch;

      triggerCtx.branch(async (rampCtx) => {
        state.phase = 0;
        while (!rampCtx.isCanceled && rampCtx.progTime < duration) {
          if (state.epoch !== myEpoch) return; // preempted by a newer ramp
          state.phase = Math.min(1, rampCtx.progTime / duration);
          await rampCtx.waitSec(1 / 60);
        }
        if (state.epoch === myEpoch) state.phase = params.idlePhase;
      });
    }
  });

  // Root tick — keep descendant-time fresh for the trigger loop.
  while (!ctx.isCanceled) await ctx.waitSec(1 / 60);
});
rootAnim.catch((err: unknown) => {
  if ((err as Error)?.message !== "aborted") console.error("root:", err);
});

// ── Tweakpane ────────────────────────────────────────────────────────

function setupPane(pane: WindowTweakpane) {
  pane.addBinding(params, "triggerRate", {
    min: 0.5, max: 80, step: 0.5, label: "Trigger Hz",
  });
  pane.addBinding(params, "minDuration", {
    min: 0.05, max: 3, step: 0.05, label: "Min dur (s)",
  });
  pane.addBinding(params, "maxDuration", {
    min: 0.05, max: 5, step: 0.05, label: "Max dur (s)",
  });
  pane.addBinding(params, "widthScale", {
    min: 0.2, max: 2.5, step: 0.05, label: "Width x",
  });
  pane.addBinding(params, "glyphScale", {
    min: 0, max: 1, step: 0.01, label: "Glyph scale",
  });
  pane.addBinding(params, "idlePhase", {
    min: 0, max: 1, step: 0.01, label: "Idle phase",
  });
  pane.addBinding(params, "paused", { label: "Pause triggers" });
  pane.addBinding(params, "inkColor", { label: "Ink" });
  pane.addBinding(params, "bgColor", { label: "BG" });
  pane.addButton({ title: "Reset all → idle" }).on("click", () => {
    for (const s of glyphStates) { s.phase = params.idlePhase; s.epoch += 1; }
  });
  pane.addButton({ title: "Reset all → 0" }).on("click", () => {
    for (const s of glyphStates) { s.phase = 0; s.epoch += 1; }
  });
}

// ── Setup + render loop ──────────────────────────────────────────────

const device = await requestWebGpuDevice();
const renderWindow = await createWindowRenderManager({
  device,
  width: WIDTH,
  height: HEIGHT,
  title: "Tegaki × p5gpu — random retrigger",
  pane: { title: "Tegaki", panelWidth: 380, panelHeight: 360, setup: setupPane },
});
const p5 = new P5GPU(device, { width: WIDTH, height: HEIGHT });

let fpsSmooth = 60;
let lastFrameTime = performance.now();

await renderWindow.run(renderFrame, {
  cleanup: () => {
    rootAnim.cancel();
    engine.dispose();
    p5.dispose();
  },
});

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function renderFrame() {
  const now = performance.now();
  fpsSmooth += (1000 / Math.max(1, now - lastFrameTime) - fpsSmooth) * 0.1;
  lastFrameTime = now;

  const [br, bg, bb] = hexToRgb(params.bgColor);
  const [ir, ig, ib] = hexToRgb(params.inkColor);
  const scale = (FONT_SIZE / FONT_META.unitsPerEm) * params.glyphScale;

  p5.beginFrame();
  p5.background(br, bg, bb);

  if (params.glyphScale > 0) {
    p5.noFill();
    p5.strokeCap(p5.ROUND);
    p5.stroke(ir, ig, ib, 255);

    // The entire animation is just: read phase, draw.
    for (const state of glyphStates) {
      drawGlyphAtPhase(p5, state, scale, params.widthScale);
    }
  }

  // HUD
  p5.noStroke();
  p5.fill(150, 150, 170);
  p5.textFont("Inter Variable");
  p5.textSize(13);
  p5.textAlign("left", "bottom");
  p5.text(
    `${Math.round(fpsSmooth)} fps · ${drawableIndices.length} glyphs · ` +
    `${layout.lineCount} lines · trigger ${params.triggerRate.toFixed(1)} Hz`,
    20, HEIGHT - 12,
  );
  p5.textAlign("right", "bottom");
  p5.text("tegaki × p5gpu × core-timing", WIDTH - 20, HEIGHT - 12);

  return p5.endFrame();
}
