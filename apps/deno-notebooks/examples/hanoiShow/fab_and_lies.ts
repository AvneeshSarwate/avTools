/// <reference lib="dom" />

// Fab and Lies — text blocks launched from the left or right, each drifting
// and rotating on its own snapshotted trajectory. Structurally this is a
// direct descendant of the rectangle-launch section of `burning_kinaree.ts`:
// the launch cadence, angle deviation, travel/rotation speed, and strobe
// (pure white) mechanics are the same. The only change is *what* gets drawn
// — instead of a rotated rect polyline, each entity is a text block whose
// translation comes from the computed point and whose orientation comes from
// a p5gpu rotate() call around that point.
//
// Text positioning uses `textAlign("center", "center")` so `text(word, 0, 0)`
// centers the glyphs on the transform origin — this is the p5gpu equivalent
// of a center-anchored text block.
//
// Run standalone from apps/deno-notebooks:
//   deno run --unstable-webgpu --unstable-ffi --allow-all \
//     examples/hanoiShow/fab_and_lies.ts

import { P5GPU } from "../../tools/p5gpu.ts";
import {
  createWindowRenderManager,
  type PaneContainer,
  requestWebGpuDevice,
} from "../../window/mod.ts";
import { type DateTimeContext, launch } from "@avtools/core-timing";
import { type MacroDef } from "../../tools/macros.ts";

// ── Color helpers (copied from burning_kinaree for self-containment) ─

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const v = max;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, v];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) {
    r = c;
    g = x;
    b = 0;
  } else if (h < 120) {
    r = x;
    g = c;
    b = 0;
  } else if (h < 180) {
    r = 0;
    g = c;
    b = x;
  } else if (h < 240) {
    r = 0;
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    g = 0;
    b = c;
  } else {
    r = c;
    g = 0;
    b = x;
  }
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function jitterHsv(
  hex: string,
  hJit: number,
  sJit: number,
  vJit: number,
): [number, number, number] {
  const [r, g, b] = hexToRgb(hex);
  const [h, s, v] = rgbToHsv(r, g, b);
  const nh = h + (Math.random() - 0.5) * 2 * hJit;
  const ns = Math.max(0, Math.min(1, s + (Math.random() - 0.5) * 2 * sJit));
  const nv = Math.max(0, Math.min(1, v + (Math.random() - 0.5) * 2 * vJit));
  return hsvToRgb(nh, ns, nv);
}

// ── Text-block entity ───────────────────────────────────────────────

// Word pool loaded from poem.txt (Thai). Read synchronously at module load
// so imports stay non-async. Whitespace-split + empty-filter — each
// whitespace-separated token becomes a candidate word.
const POEM_PATH = new URL("./poem.txt", import.meta.url);
const POEM_TEXT = Deno.readTextFileSync(POEM_PATH);
const WORD_POOL = POEM_TEXT.split(/\s+/).filter((w) => w.length > 0);

// Local Hanoi-show Thai fonts. p5gpu's text engine only auto-loads fonts
// bundled in `assets/fonts/`, so this scene explicitly loads one of the
// local .ttf files in this folder. The family name must match the font's
// embedded family for HarfBuzz lookup. These family names were pulled from
// the font files' embedded name tables so it's easy to switch fonts here.
interface LocalThaiFont {
  path: URL;
  family: string;
}

const TORSILP_YINGYAI_FONT: LocalThaiFont = {
  path: new URL("./TorsilpYingyai.ttf", import.meta.url),
  family: "Torsilp Yingyai",
};

const SOV_SANNOGA_FONT: LocalThaiFont = {
  path: new URL("./SOV_sannoga2467.ttf", import.meta.url),
  family: "SOV_sannoga2467",
};

const SOV_SORM_FONT: LocalThaiFont = {
  path: new URL("./SOV_sorm2496.ttf", import.meta.url),
  family: "SOV_sorm2496",
};

const ACTIVE_THAI_FONT = TORSILP_YINGYAI_FONT;

/**
 * Load the Thai font into the p5gpu text engine. Must be called once
 * before the first draw. Called automatically by the standalone entry;
 * callers composing this scene into a larger setup (e.g. combined.ts)
 * must await this during their own setup phase.
 */
export async function loadAssets(p5: P5GPU): Promise<void> {
  await p5.loadFont(ACTIVE_THAI_FONT.path, ACTIVE_THAI_FONT.family);
}

const WORD_HUE_JITTER = 15; // ± degrees
const WORD_SAT_JITTER = 0.1;
const WORD_VAL_JITTER = 0.1;

interface TextBlock {
  spawnTime: number; // performance.now() at launch (ms)
  startX: number;
  startY: number;
  travelAngle: number; // radians — direction of motion
  travelSpeed: number; // pixels/sec, snapshotted
  rotationSpeed: number; // radians/sec, snapshotted
  initialRotation: number; // radians — random 0..2π
  textSize: number; // snapshotted font size
  word: string; // snapshotted from WORD_POOL
  color: [number, number, number]; // rgb with HSV jitter
  // Which side the block was launched from; controls which column-edge
  // is treated as "off-screen" for the 2-screen simulation. Left-launched
  // blocks die once they're fully past x = w/3; right-launched blocks die
  // once they're fully past x = 2w/3.
  fromLeft: boolean;
  alive: boolean;
}

function spawnTextBlock(
  triggerCtx: DateTimeContext,
  screenWidth: number,
  screenHeight: number,
): TextBlock {
  const p = state.params;
  const fromLeft = triggerCtx.random() < 0.5;
  const baseAngle = fromLeft ? 0 : Math.PI;
  const devRad = (p.angleDeviation * Math.PI) / 180;
  const travelAngle = baseAngle + (triggerCtx.random() - 0.5) * 2 * devRad;

  // Spawn just off-screen so entry is clean regardless of rotation.
  // Margin is a generous multiple of textSize since text extent can't be
  // measured cheaply without laying it out.
  const margin = p.textSize * 4;
  const startX = fromLeft ? -margin : screenWidth + margin;
  const startY = triggerCtx.random() * screenHeight;

  const word = WORD_POOL[Math.floor(triggerCtx.random() * WORD_POOL.length)];

  return {
    spawnTime: performance.now(),
    startX,
    startY,
    travelAngle,
    travelSpeed: p.travelSpeed,
    rotationSpeed: p.rotationSpeed,
    initialRotation: triggerCtx.random() * Math.PI * 2,
    textSize: p.textSize,
    word,
    color: jitterHsv(
      p.color,
      WORD_HUE_JITTER,
      WORD_SAT_JITTER,
      WORD_VAL_JITTER,
    ),
    fromLeft,
    alive: true,
  };
}

// ── Consolidated state ──────────────────────────────────────────────

export const state = {
  params: {
    fade: 0.0,
    mix: 1.0,
    bgColor: "#0d1017",

    launchRate: 2.5, // text blocks per second
    travelSpeed: 550, // pixels/sec, snapshotted at launch
    angleDeviation: 20, // degrees, ± range from straight horizontal
    textSize: 96, // font size in pixels, snapshotted
    rotationSpeed: 3.0, // radians/sec, snapshotted at launch
    color: "#e14a3a",
    // Strobe: during a pulse, every text block is drawn pure white instead
    // of its snapshotted color. `rate=0` disables the trigger. Same
    // mechanics as burning_kinaree's rect strobe.
    strobe: {
      rate: 0, // pulses per second (0 = off)
      widthPercent: 10, // 0..50 — percent of current interval
      jitter: 0, // 0..1 — 0 = perfectly rhythmic, 1 = up to 2× base
    },
  },
  macros: {} as Record<string, number>,
  runtime: {
    rootAnim: null as ReturnType<typeof launch> | null,
    triggerCtx: null as DateTimeContext | null,
    blocks: [] as TextBlock[],
    screenWidth: 1280,
    screenHeight: 720,
    // When true, the draw loop paints pure white instead of each block's
    // snapshotted color. Driven by the strobe trigger branch.
    strobeActive: false,
  },
  frame: {
    lastFrameTime: performance.now(),
    fpsSmooth: 60,
  },
};

export const macroDefs: MacroDef<number>[] = [
  {
    key: "fade",
    defaultValue: 0.0,
    opts: { min: 0, max: 1, step: 0.001, label: "Scene Fade" },
    apply: (v) => {
      state.params.fade = v;
    },
  },
];

// ── Setup / cleanup ─────────────────────────────────────────────────

export function setup(opts?: { width?: number; height?: number }): void {
  if (opts?.width !== undefined) state.runtime.screenWidth = opts.width;
  if (opts?.height !== undefined) state.runtime.screenHeight = opts.height;

  state.runtime.blocks = [];

  const rootAnim = launch(async (ctx) => {
    // Strobe trigger — same duty-cycle-stable structure as kinaree.
    ctx.branch(async (strobeCtx) => {
      while (!strobeCtx.isCanceled) {
        const s = state.params.strobe;
        const rate = s.rate;
        if (rate <= 0) {
          state.runtime.strobeActive = false;
          await strobeCtx.waitSec(0.25);
          continue;
        }
        const base = 1 / rate;
        const jitter = Math.max(0, Math.min(1, s.jitter));
        const jitterMul = 1 + (strobeCtx.random() - 0.5) * 2 * jitter;
        const interval = Math.max(0.01, base * jitterMul);
        const widthPct = Math.max(0, Math.min(50, s.widthPercent));
        const onPhase = (widthPct / 100) * interval;
        const offPhase = Math.max(0, interval - onPhase);

        state.runtime.strobeActive = true;
        await strobeCtx.waitSec(onPhase);
        state.runtime.strobeActive = false;
        await strobeCtx.waitSec(offPhase);
      }
    });

    // Launch trigger.
    ctx.branch(async (launchCtx) => {
      state.runtime.triggerCtx = launchCtx;
      while (!launchCtx.isCanceled) {
        const rate = Math.max(0.01, state.params.launchRate);
        await launchCtx.waitSec(1 / rate);

        const mix = state.params.mix * state.params.fade;
        if (mix <= 0) continue;

        state.runtime.blocks.push(
          spawnTextBlock(
            launchCtx,
            state.runtime.screenWidth,
            state.runtime.screenHeight,
          ),
        );
      }
    });

    // Root tick — keep descendant-time fresh for the trigger loops.
    while (!ctx.isCanceled) await ctx.waitSec(1 / 60);
  });
  state.runtime.rootAnim = rootAnim;
  rootAnim.catch((err: unknown) => {
    if ((err as Error)?.message !== "aborted") {
      console.error("fab_and_lies root:", err);
    }
  });
}

export function cleanup(): void {
  state.runtime.rootAnim = null;
  state.runtime.triggerCtx = null;
  state.runtime.blocks = [];
  state.runtime.strobeActive = false;
}

// ── Draw ────────────────────────────────────────────────────────────

export function draw(p5: P5GPU, _time: number, autoClear = true): void {
  if (autoClear) p5.clear();

  const now = performance.now();
  const dtMs = now - state.frame.lastFrameTime;
  const fps = 1000 / Math.max(1, dtMs);
  state.frame.fpsSmooth += (fps - state.frame.fpsSmooth) * 0.1;
  state.frame.lastFrameTime = now;

  const mix = state.params.mix * state.params.fade;
  if (mix <= 0) return;

  const alpha = Math.round(255 * mix);
  const w = p5.width;
  const h = p5.height;
  const live = state.runtime.blocks;
  const strobe = state.runtime.strobeActive;

  // Center-based text anchoring so text(word, 0, 0) draws centered on the
  // transform origin — the p5gpu equivalent of the rect's center-origin.
  // Thai font must be set every frame because the standalone HUD below
  // (and potentially combined.ts) resets textFont to the default.
  p5.textFont(ACTIVE_THAI_FONT.family);
  p5.textAlign("center", "center");
  p5.noStroke();

  for (let i = 0; i < live.length; i += 1) {
    const b = live[i];
    if (!b.alive) continue;

    const elapsed = (now - b.spawnTime) / 1000;
    const x = b.startX + Math.cos(b.travelAngle) * b.travelSpeed * elapsed;
    const y = b.startY + Math.sin(b.travelAngle) * b.travelSpeed * elapsed;
    const rot = b.initialRotation + b.rotationSpeed * elapsed;

    // Kill once the center crosses the screen's horizontal midpoint —
    // simulates a 2-screen setup where a word launched from one side
    // "falls off" once it's past halfway. The middle-third blackout
    // hides the actual vanish, so this reads as the word going off-edge
    // on whichever column it belongs to.
    if (b.fromLeft ? x > w / 2 : x < w / 2) {
      b.alive = false;
      continue;
    }

    // Safety net for extreme travel angles that would carry a block off
    // the top/bottom before it ever reaches the midpoint.
    const margin = b.textSize * 4;
    if (y < -margin || y > h + margin) {
      b.alive = false;
      continue;
    }

    if (strobe) {
      p5.fill(255, 255, 255, alpha);
    } else {
      p5.fill(b.color[0], b.color[1], b.color[2], alpha);
    }

    p5.textSize(b.textSize);
    p5.push();
    p5.translate(x, y);
    p5.rotate(rot);
    p5.text(b.word, 0, 0);
    p5.pop();
  }

  // Compact occasionally to keep memory bounded.
  if (live.length > 0 && live.length % 32 === 0) {
    state.runtime.blocks = live.filter((b) => b.alive);
  }

  // Middle-third blackout — simulates the physical 3-column portrait
  // layout with the center column off. Drawn last and fully opaque so it
  // covers whatever text happens to be passing through that band.
  p5.noStroke();
  p5.fill(0, 0, 0, alpha);
  p5.rect(w / 3, 0, w / 3, h);
}

// ── Tweakpane ───────────────────────────────────────────────────────

export function setupPane(pane: PaneContainer, _refresh?: () => void): void {
  pane.addBinding(state.params, "fade", {
    min: 0,
    max: 1,
    step: 0.01,
    label: "Scene Fade",
  });
  pane.addBinding(state.params, "mix", {
    min: 0,
    max: 1,
    step: 0.01,
    label: "Mix",
  });
  pane.addBinding(state.params, "bgColor", { label: "BG" });

  pane.addBinding(state.params, "launchRate", {
    min: 0,
    max: 20,
    step: 0.1,
    label: "Launch Rate (Hz)",
  });
  pane.addBinding(state.params, "travelSpeed", {
    min: 50,
    max: 2000,
    step: 10,
    label: "Travel Speed",
  });
  pane.addBinding(state.params, "angleDeviation", {
    min: 0,
    max: 60,
    step: 1,
    label: "Angle Dev (°)",
  });
  pane.addBinding(state.params, "textSize", {
    min: 12,
    max: 400,
    step: 1,
    label: "Text Size",
  });
  pane.addBinding(state.params, "rotationSpeed", {
    min: -10,
    max: 10,
    step: 0.05,
    label: "Rotation Speed",
  });
  pane.addBinding(state.params, "color", { label: "Color" });

  const strobe = pane.addFolder({
    title: "Strobe (white flash)",
    expanded: false,
  });
  strobe.addBinding(state.params.strobe, "rate", {
    min: 0,
    max: 30,
    step: 0.1,
    label: "Rate (Hz)",
  });
  strobe.addBinding(state.params.strobe, "widthPercent", {
    min: 0,
    max: 50,
    step: 0.5,
    label: "Width (% of interval)",
  });
  strobe.addBinding(state.params.strobe, "jitter", {
    min: 0,
    max: 1,
    step: 0.01,
    label: "Jitter",
  });
}

// ── Standalone entry point ──────────────────────────────────────────

if (import.meta.main) {
  const WIDTH = 1280;
  const HEIGHT = 720;
  const device = await requestWebGpuDevice();

  const renderWindow = await createWindowRenderManager({
    device,
    width: WIDTH,
    height: HEIGHT,
    title: "Fab and Lies",
    pane: {
      title: "Fab and Lies",
      panelWidth: 480,
      panelHeight: 620,
      setup: (pane) => setupPane(pane),
    },
  });
  const p5 = new P5GPU(device, { width: WIDTH, height: HEIGHT });
  await loadAssets(p5);

  setup({ width: WIDTH, height: HEIGHT });

  await renderWindow.run(
    () => {
      const t = performance.now() * 0.001;
      p5.beginFrame();
      const [br, bg, bb] = hexToRgb(state.params.bgColor);
      p5.background(br, bg, bb);
      draw(p5, t, false);

      p5.textAlign("left", "bottom");
      p5.textSize(14);
      p5.fill(120, 120, 140);
      p5.text(`${Math.round(state.frame.fpsSmooth)} fps`, 20, HEIGHT - 12);

      return p5.endFrame();
    },
    {
      yieldMs: 4,
      cleanup: () => {
        cleanup();
        p5.dispose();
      },
    },
  );
}
