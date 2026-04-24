/// <reference lib="dom" />

// Burning Kinaree — rectangle section of the original composite scene.
// Red rectangles launch from left/right at a random y. Travel angle has
// ± angular deviation from horizontal; rotation speed is snapshotted at
// launch so the rect's orientation is its own thing.
//
// The falling-circle section was extracted into ashes.ts. This scene now
// owns only the rectangle layer, with the same per-scene fade convention
// used by the other hanoiShow sketches.
//
// Run standalone from apps/deno-notebooks:
//   deno run --unstable-webgpu --unstable-ffi --allow-all \
//     examples/hanoiShow/burning_kinaree.ts

import { P5GPU } from "../../tools/p5gpu.ts";
import {
  createWindowRenderManager,
  type PaneContainer,
  requestWebGpuDevice,
} from "../../window/mod.ts";
import { type DateTimeContext, launch } from "@avtools/core-timing";
import { type MacroDef } from "../../tools/macros.ts";

// ── Color helpers ───────────────────────────────────────────────────

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

// ── Section 1: red rectangles ───────────────────────────────────────

const RECT_LENGTH_RATIO = 6; // rectangle length = thickness × this
const RECT_HUE_JITTER = 15; // ± degrees
const RECT_SAT_JITTER = 0.1;
const RECT_VAL_JITTER = 0.1;

interface Rectangle {
  spawnTime: number; // performance.now() at launch (ms)
  startX: number;
  startY: number;
  travelAngle: number; // radians — direction of motion
  travelSpeed: number; // pixels/sec, snapshotted
  rotationSpeed: number; // radians/sec, snapshotted
  initialRotation: number; // radians — random 0..2π
  thickness: number; // snapshotted
  length: number; // snapshotted
  color: [number, number, number]; // rgb with HSV jitter
  alive: boolean;
}

function spawnRectangle(
  triggerCtx: DateTimeContext,
  screenWidth: number,
  screenHeight: number,
): Rectangle {
  const rects = state.params.rects;
  const fromLeft = triggerCtx.random() < 0.5;
  const baseAngle = fromLeft ? 0 : Math.PI;
  const devRad = (rects.angleDeviation * Math.PI) / 180;
  const travelAngle = baseAngle + (triggerCtx.random() - 0.5) * 2 * devRad;

  const length = rects.thickness * RECT_LENGTH_RATIO;
  // Spawn just off-screen so entry is clean regardless of rotation.
  const margin = length;
  const startX = fromLeft ? -margin : screenWidth + margin;
  const startY = triggerCtx.random() * screenHeight;

  return {
    spawnTime: performance.now(),
    startX,
    startY,
    travelAngle,
    travelSpeed: rects.travelSpeed,
    rotationSpeed: rects.rotationSpeed,
    initialRotation: triggerCtx.random() * Math.PI * 2,
    thickness: rects.thickness,
    length,
    color: jitterHsv(
      rects.color,
      RECT_HUE_JITTER,
      RECT_SAT_JITTER,
      RECT_VAL_JITTER,
    ),
    alive: true,
  };
}

// ── Consolidated state ──────────────────────────────────────────────

export const state = {
  params: {
    // Top-level
    fade: 0.0,
    bgColor: "#0d1017",

    // Section 1: red rectangles
    rects: {
      mix: 1.0,
      launchRate: 10.5, // rectangles per second
      travelSpeed: 1170, // pixels/sec, snapshotted at launch
      angleDeviation: 20, // degrees, ± range from straight horizontal
      thickness: 44, // pixels; length is RECT_LENGTH_RATIO × this
      rotationSpeed: 3.0, // radians/sec, snapshotted at launch
      color: "#e14a3a",
      // Strobe: during a pulse, every rectangle is drawn pure white instead
      // of its snapshotted color. `rate=0` disables the trigger. Pulse
      // interval may be jittered; pulse width is a percent of the (jittered)
      // interval, capped at 50 so the duty cycle can't exceed half.
      strobe: {
        rate: 0, // pulses per second (0 = off)
        widthPercent: 10, // 0..50 — percent of current interval
        jitter: 0, // 0..1 — 0 = perfectly rhythmic, 1 = interval ∈ [0, 2×base]
      },
    },
  },
  macros: {} as Record<string, number>,
  runtime: {
    rootAnim: null as ReturnType<typeof launch> | null,
    rectangles: [] as Rectangle[],
    // Screen dims, captured in setup() so the rect trigger loop can pick
    // spawn positions without needing a p5 handle. Defaults match the
    // standalone runner; combined.ts passes its own dims.
    screenWidth: 1280,
    screenHeight: 720,
    // When true, the rect draw loop paints pure white instead of each
    // rect's snapshotted color. Driven by the rect strobe trigger branch.
    rectStrobeActive: false,
  },
  frame: {
    lastFrameTime: performance.now(),
    fpsSmooth: 60,
  },
};

export const macroDefs: MacroDef<number>[] = [
  {
    key: "launchRate",
    defaultValue: 10.5,
    opts: { min: 0, max: 20, step: 0.1, label: "Launch Rate (Hz)" },
    apply: (v) => {
      state.params.rects.launchRate = v;
    },
  },
  {
    key: "fade",
    defaultValue: 0.0,
    opts: { min: 0, max: 1, step: 0.001, label: "Scene Fade" },
    apply: (v) => {
      state.params.fade = v;
    },
  },
  {
    key: "travelSpeed",
    defaultValue: 1170,
    opts: { min: 50, max: 2000, step: 10, label: "Travel Speed" },
    apply: (v) => {
      state.params.rects.travelSpeed = v;
    },
  },
  {
    key: "angleDeviation",
    defaultValue: 20,
    opts: { min: 0, max: 60, step: 1, label: "Angle Dev (°)" },
    apply: (v) => {
      state.params.rects.angleDeviation = v;
    },
  },
  {
    key: "thickness",
    defaultValue: 44,
    opts: { min: 4, max: 120, step: 1, label: "Thickness" },
    apply: (v) => {
      state.params.rects.thickness = v;
    },
  },
  {
    key: "rotationSpeed",
    defaultValue: 3.0,
    opts: { min: -10, max: 10, step: 0.05, label: "Rotation Speed" },
    apply: (v) => {
      state.params.rects.rotationSpeed = v;
    },
  },
];

// ── Setup / cleanup ─────────────────────────────────────────────────

export function setup(opts?: { width?: number; height?: number }): void {
  if (opts?.width !== undefined) state.runtime.screenWidth = opts.width;
  if (opts?.height !== undefined) state.runtime.screenHeight = opts.height;

  state.runtime.rootAnim?.cancel();
  state.runtime.rectangles = [];

  const rootAnim = launch(async (ctx) => {
    // Section 1: rectangle strobe. One iteration = one full pulse cycle
    // (on-phase → off-phase). Pulse width and off-phase are both computed
    // from the *current* (jittered) interval, so the duty cycle the user
    // sets via `widthPercent` stays stable even with `jitter` > 0 — the
    // pulse train scales cleanly rather than drifting.
    ctx.branch(async (strobeCtx) => {
      while (!strobeCtx.isCanceled) {
        const s = state.params.rects.strobe;
        const rate = s.rate;
        if (rate <= 0) {
          state.runtime.rectStrobeActive = false;
          await strobeCtx.waitSec(0.25);
          continue;
        }
        const base = 1 / rate;
        const jitter = Math.max(0, Math.min(1, s.jitter));
        const jitterMul = 1 + (strobeCtx.random() - 0.5) * 2 * jitter;
        // Floor to avoid degenerate near-zero intervals when jitter=1.
        const interval = Math.max(0.01, base * jitterMul);
        // Cap widthPercent at 50 so the pulse can never exceed half the
        // interval (off-phase always stays ≥ on-phase).
        const widthPct = Math.max(0, Math.min(50, s.widthPercent));
        const onPhase = (widthPct / 100) * interval;
        const offPhase = Math.max(0, interval - onPhase);

        state.runtime.rectStrobeActive = true;
        await strobeCtx.waitSec(onPhase);
        state.runtime.rectStrobeActive = false;
        await strobeCtx.waitSec(offPhase);
      }
    });

    // Section 1: rectangle launch trigger.
    ctx.branch(async (rectCtx) => {
      while (!rectCtx.isCanceled) {
        const rate = Math.max(0.01, state.params.rects.launchRate);
        await rectCtx.waitSec(1 / rate);

        const mix = state.params.rects.mix * state.params.fade;
        if (mix <= 0) continue;

        state.runtime.rectangles.push(
          spawnRectangle(
            rectCtx,
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
      console.error("burning_kinaree root:", err);
    }
  });
}

export function cleanup(): void {
  state.runtime.rootAnim?.cancel();
  state.runtime.rootAnim = null;
  state.runtime.rectangles = [];
  state.runtime.rectStrobeActive = false;
}

// ── Section draws ───────────────────────────────────────────────────

function drawRectsSection(p5: P5GPU): void {
  const rects = state.params.rects;
  const mix = rects.mix * state.params.fade;
  if (mix <= 0) return;

  const alpha = Math.round(255 * mix);
  const now = performance.now();
  const w = p5.width;
  const h = p5.height;
  const live = state.runtime.rectangles;
  // Hoisted once per frame: during a strobe pulse, every rect is painted
  // pure white regardless of its snapshotted HSV-jittered color.
  const strobe = state.runtime.rectStrobeActive;

  p5.noStroke();

  for (let i = 0; i < live.length; i += 1) {
    const r = live[i];
    if (!r.alive) continue;

    const elapsed = (now - r.spawnTime) / 1000;
    const x = r.startX + Math.cos(r.travelAngle) * r.travelSpeed * elapsed;
    const y = r.startY + Math.sin(r.travelAngle) * r.travelSpeed * elapsed;
    const rot = r.initialRotation + r.rotationSpeed * elapsed;

    // Cull once fully off-screen. Length is an upper bound on projected
    // extent at any rotation since length > thickness.
    const margin = r.length;
    if (x < -margin || x > w + margin || y < -margin || y > h + margin) {
      r.alive = false;
      continue;
    }

    const hl = r.length / 2;
    const ht = r.thickness / 2;
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);

    if (strobe) {
      p5.fill(255, 255, 255, alpha);
    } else {
      p5.fill(r.color[0], r.color[1], r.color[2], alpha);
    }
    p5.beginShape();
    // Rotate each local corner into world space; no transform stack use.
    p5.vertex(x + -hl * cosR - -ht * sinR, y + -hl * sinR + -ht * cosR);
    p5.vertex(x + hl * cosR - -ht * sinR, y + hl * sinR + -ht * cosR);
    p5.vertex(x + hl * cosR - ht * sinR, y + hl * sinR + ht * cosR);
    p5.vertex(x + -hl * cosR - ht * sinR, y + -hl * sinR + ht * cosR);
    p5.endShape(p5.CLOSE);
  }

  // Compact occasionally — cheap for <200 rects; keeps memory bounded.
  if (live.length > 0 && live.length % 32 === 0) {
    state.runtime.rectangles = live.filter((r) => r.alive);
  }
}

// ── Draw ────────────────────────────────────────────────────────────

export function draw(p5: P5GPU, _time: number, autoClear = true): void {
  if (autoClear) p5.clear();

  const now = performance.now();
  const dtMs = now - state.frame.lastFrameTime;
  const fps = 1000 / Math.max(1, dtMs);
  state.frame.fpsSmooth += (fps - state.frame.fpsSmooth) * 0.1;
  state.frame.lastFrameTime = now;

  if (state.params.fade <= 0) return;

  drawRectsSection(p5);
}

// ── Tweakpane ───────────────────────────────────────────────────────

export function setupPane(pane: PaneContainer, _refresh?: () => void): void {
  pane.addBinding(state.params, "fade", {
    min: 0,
    max: 1,
    step: 0.01,
    label: "Scene Fade",
  });
  pane.addBinding(state.params, "bgColor", { label: "BG" });

  const rects = pane.addFolder({ title: "Rects (red)", expanded: true });
  const rc = state.params.rects;
  rects.addBinding(rc, "mix", { min: 0, max: 1, step: 0.01, label: "Mix" });
  rects.addBinding(rc, "launchRate", {
    min: 0,
    max: 20,
    step: 0.1,
    label: "Launch Rate (Hz)",
  });
  rects.addBinding(rc, "travelSpeed", {
    min: 50,
    max: 2000,
    step: 10,
    label: "Travel Speed",
  });
  rects.addBinding(rc, "angleDeviation", {
    min: 0,
    max: 60,
    step: 1,
    label: "Angle Dev (°)",
  });
  rects.addBinding(rc, "thickness", {
    min: 2,
    max: 80,
    step: 1,
    label: "Thickness",
  });
  rects.addBinding(rc, "rotationSpeed", {
    min: -10,
    max: 10,
    step: 0.05,
    label: "Rotation Speed",
  });
  rects.addBinding(rc, "color", { label: "Color" });

  const strobe = rects.addFolder({
    title: "Strobe (white flash)",
    expanded: false,
  });
  strobe.addBinding(rc.strobe, "rate", {
    min: 0,
    max: 30,
    step: 0.1,
    label: "Rate (Hz)",
  });
  strobe.addBinding(rc.strobe, "widthPercent", {
    min: 0,
    max: 50,
    step: 0.5,
    label: "Width (% of interval)",
  });
  strobe.addBinding(rc.strobe, "jitter", {
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
    title: "Burning Kinaree",
    pane: {
      title: "Burning Kinaree",
      panelWidth: 520,
      panelHeight: 820,
      setup: (pane) => setupPane(pane),
    },
  });
  const p5 = new P5GPU(device, { width: WIDTH, height: HEIGHT });

  setup({ width: WIDTH, height: HEIGHT });

  await renderWindow.run(
    () => {
      const t = performance.now() * 0.001;
      p5.beginFrame();
      const [br, bg, bb] = hexToRgb(state.params.bgColor);
      p5.background(br, bg, bb);
      draw(p5, t, false);

      // HUD
      p5.textSize(14);
      p5.fill(120, 120, 140);
      p5.textAlign("left", "bottom");
      p5.text(`${Math.round(state.frame.fpsSmooth)} fps`, 20, HEIGHT - 12);

      return p5.endFrame();
    },
    {
      // Yield between frames so WS callbacks (tweakpane slider drags) and
      // any future UDP/timer work aren't starved by the tight render loop.
      // Matches combined.ts — without this, slider input events arrive in
      // chunks every few hundred ms instead of smoothly.
      yieldMs: 4,
      cleanup: () => {
        cleanup();
        p5.dispose();
      },
    },
  );
}
