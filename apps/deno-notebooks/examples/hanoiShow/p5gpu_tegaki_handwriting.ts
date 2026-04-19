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
  requestWebGpuDevice,
  type PaneContainer,
} from "../../window/mod.ts";
import { NativeTextEngine } from "../../tools/p5gpu_text/ffi.ts";
import { launch } from "@avtools/core-timing";

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

interface GlyphState {
  ch: string; // source char this glyph corresponds to
  glyph: PreparedTegakiGlyph | null; // tegaki stroke data for that char (null = skipped)
  baselineX: number;
  baselineY: number;
  phase: number;
  epoch: number;
}

// ── Constants ────────────────────────────────────────────────────────

// Charmonman bundle metadata (from its bundle.ts)
const FONT_META = { unitsPerEm: 1000, ascender: 1200, descender: -700 };
const FONT_FAMILY = "Charmonman";

const WIDTH = 1280;
const HEIGHT = 800;
const FONT_SIZE = 50;
const LINE_HEIGHT = 130; // Charmonman has tall asc+desc (em ≈ 1.9x fontSize)
const MARGIN_X = 80;
const MARGIN_Y = 100;
const MAX_WIDTH = WIDTH - MARGIN_X * 2;

// Thai demo text — multiple phrases separated by spaces so the native
// layout engine has break opportunities (Thai has no inter-word spaces
// in normal prose, so we'd otherwise get one long unbreakable line).
const LOREM = "สวัสดีชาวโลก การเขียนอักษรไทย เป็นศิลปะที่งดงาม " +
  "ฝึกฝนให้เชี่ยวชาญ จะพบความภูมิใจ " +
  "ในมรดกทางวัฒนธรรมของชาติ ทุกเส้นขีดบนกระดาษ " +
  "คือบทกวีที่ไม่มีคำพูด อักษรนี้มีชีวิตและจิตใจ " +
  "Hello World";

// ── Consolidated state ──────────────────────────────────────────────

export const state = {
  params: {
    triggerRate: 18, // trigger attempts per second
    minDuration: 0.35,
    maxDuration: 1.40,
    widthScale: 1.0,
    bgColor: "#0d1017",
    inkColor: "#ffe9a8",
    idlePhase: 1.0, // 0 = invisible when not animating, 1 = fully drawn
    paused: false,
    glyphScale: 1.0, // 0–1, multiplies font scale; 0 = skip drawing
  },
  glyphStates: [] as GlyphState[],
  drawableIndices: [] as number[],
  runtime: {
    rootAnim: null as ReturnType<typeof launch> | null,
    engine: null as NativeTextEngine | null,
  },
  meta: {
    fontMeta: FONT_META,
    fontFamily: FONT_FAMILY,
    fontSize: FONT_SIZE,
    lineHeight: LINE_HEIGHT,
    marginX: MARGIN_X,
    marginY: MARGIN_Y,
    maxWidth: MAX_WIDTH,
    lorem: LOREM,
  },
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

function drawGlyphAtPhase(
  p5: P5GPU,
  gs: GlyphState,
  scale: number,
  widthScale: number,
) {
  const glyph = gs.glyph;
  if (!glyph || gs.phase <= 0) return;
  const localTime = gs.phase * glyph.t;
  for (const stroke of glyph.s) {
    if (localTime < stroke.d) continue;
    const elapsed = localTime - stroke.d;
    const lin = Math.min(elapsed / Math.max(stroke.a, 1e-6), 1);
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

export function setupPane(pane: PaneContainer) {
  pane.addBinding(state.params, "triggerRate", {
    min: 0.5,
    max: 80,
    step: 0.5,
    label: "Trigger Hz",
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
  pane.addBinding(state.params, "widthScale", {
    min: 0.2,
    max: 2.5,
    step: 0.05,
    label: "Width x",
  });
  pane.addBinding(state.params, "glyphScale", {
    min: 0,
    max: 1,
    step: 0.01,
    label: "Glyph scale",
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
  pane.addButton({ title: "Reset all → idle" }).on("click", () => {
    for (const s of state.glyphStates) {
      s.phase = state.params.idlePhase;
      s.epoch += 1;
    }
  });
  pane.addButton({ title: "Reset all → 0" }).on("click", () => {
    for (const s of state.glyphStates) {
      s.phase = 0;
      s.epoch += 1;
    }
  });
}

// ── Setup (load data, build layout, start animation) ────────────────

export async function setup() {
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
    width: MAX_WIDTH,
    height: null,
    alignH: 0, // left
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
          phase: state.params.idlePhase,
          epoch: 0,
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

  // Core-timing animation system
  const rootAnim = launch(async (ctx) => {
    ctx.branch(async (triggerCtx) => {
      while (!triggerCtx.isCanceled) {
        const rate = Math.max(0.1, state.params.triggerRate);
        await triggerCtx.waitSec(1 / rate);
        if (state.params.paused || state.drawableIndices.length === 0) continue;

        const pick = state.drawableIndices[
          Math.floor(triggerCtx.random() * state.drawableIndices.length)
        ]!;
        const gs = state.glyphStates[pick]!;
        const minD = Math.max(0.05, state.params.minDuration);
        const maxD = Math.max(minD, state.params.maxDuration);
        const duration = minD + triggerCtx.random() * (maxD - minD);

        gs.epoch += 1;
        const myEpoch = gs.epoch;

        triggerCtx.branch(async (rampCtx) => {
          gs.phase = 0;
          while (!rampCtx.isCanceled && rampCtx.progTime < duration) {
            if (gs.epoch !== myEpoch) return; // preempted by a newer ramp
            gs.phase = Math.min(1, rampCtx.progTime / duration);
            await rampCtx.waitSec(1 / 60);
          }
          if (gs.epoch === myEpoch) gs.phase = state.params.idlePhase;
        });
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

export function draw(p5: P5GPU) {
  if (state.params.glyphScale <= 0) return;

  const [ir, ig, ib] = hexToRgb(state.params.inkColor);
  const scale = (FONT_SIZE / FONT_META.unitsPerEm) * state.params.glyphScale;

  p5.noFill();
  p5.strokeCap(p5.ROUND);
  p5.strokeJoin(p5.ROUND);
  p5.stroke(ir, ig, ib, 255);

  for (const gs of state.glyphStates) {
    drawGlyphAtPhase(p5, gs, scale, state.params.widthScale);
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
}

// ── Standalone entry point ──────────────────────────────────────────

if (import.meta.main) {
  const device = await requestWebGpuDevice();
  const renderWindow = await createWindowRenderManager({
    device,
    width: WIDTH,
    height: HEIGHT,
    title: "Tegaki × p5gpu — random retrigger",
    pane: {
      title: "Tegaki",
      panelWidth: 380,
      panelHeight: 380,
      setup: setupPane,
    },
  });
  const p5 = new P5GPU(device, { width: WIDTH, height: HEIGHT });

  await setup();

  let fpsSmooth = 60;
  let lastFrameTime = performance.now();

  await renderWindow.run(() => {
    const now = performance.now();
    fpsSmooth += (1000 / Math.max(1, now - lastFrameTime) - fpsSmooth) * 0.1;
    lastFrameTime = now;

    p5.beginFrame();
    const [br, bg, bb] = hexToRgb(state.params.bgColor);
    p5.background(br, bg, bb);
    draw(p5);

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
      p5.dispose();
    },
  });
}
