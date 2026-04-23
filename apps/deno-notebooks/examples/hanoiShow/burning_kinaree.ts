/// <reference lib="dom" />

// Burning Kinaree — three blended components:
//   1. Yellow circles orbiting an invisible center, each drawn as a closed
//      spline of ~20 points. Random circles pulse: a sparse subset of their
//      points jut outward and fall back together.
//   2. (TODO) Red rectangles launching horizontally across the screen.
//   3. (TODO) Snowfall of small circles with brownian x-wander.
//
// Each section has a local `mix` (0..1) that gates both draw and trigger
// work — mix=0 means the section fully no-ops. A top-level `fade` matches
// the per-scene fade convention used by the other hanoiShow sketches and
// multiplies every section's effective mix.
//
// Run standalone from apps/deno-notebooks:
//   deno run --unstable-webgpu --unstable-ffi --allow-all \
//     examples/hanoiShow/burning_kinaree.ts

import { P5GPU } from "../../tools/p5gpu.ts";
import {
  createWindowRenderManager,
  requestWebGpuDevice,
  type PaneContainer,
} from "../../window/mod.ts";
import { type DateTimeContext, launch } from "@avtools/core-timing";

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
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const v = max;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
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
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
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

// ── Section 1: orbiting circles ─────────────────────────────────────

const MAX_CIRCLES = 20;
const POINTS_PER_CIRCLE = 20;

interface RingCircle {
  // Angular position around the orbit is derived from the circle's *index*
  // and the live circleCount (`theta = (i/count) * 2π + orbitPhase`), so
  // circles stay evenly spaced even when the count changes at runtime.
  pointOffsets: Float32Array; // per-point 0..1 weight for the current pulse
  envelope: number;        // current pulse envelope 0..1
  epoch: number;           // bumped on each pulse so stale ramps self-cancel
  inProgress: boolean;
}

function createRingCircle(): RingCircle {
  return {
    pointOffsets: new Float32Array(POINTS_PER_CIRCLE),
    envelope: 0,
    epoch: 0,
    inProgress: false,
  };
}

function schedulePulse(
  circle: RingCircle,
  triggerCtx: DateTimeContext,
  duration: number,
): void {
  // Pick a sparse random subset of points and ramp them together: a single
  // envelope drives all of them, so multiple spikes rise and fall as one.
  circle.pointOffsets.fill(0);
  const numSpikes = 3 + Math.floor(triggerCtx.random() * 4); // 3..6
  for (let i = 0; i < numSpikes; i += 1) {
    const idx = Math.floor(triggerCtx.random() * POINTS_PER_CIRCLE);
    circle.pointOffsets[idx] = 0.5 + triggerCtx.random() * 0.5;
  }

  circle.epoch += 1;
  const myEpoch = circle.epoch;
  circle.inProgress = true;

  triggerCtx.branch(async (rampCtx) => {
    const start = rampCtx.progTime;
    while (!rampCtx.isCanceled) {
      if (circle.epoch !== myEpoch) return; // preempted by a newer pulse
      const t = (rampCtx.progTime - start) / duration;
      if (t >= 1) break;
      // sin(pi*t) gives a smooth 0→1→0 bump
      circle.envelope = Math.sin(t * Math.PI);
      await rampCtx.waitSec(1 / 60);
    }
    if (circle.epoch === myEpoch) {
      circle.envelope = 0;
      circle.pointOffsets.fill(0);
      circle.inProgress = false;
    }
  });
}

// ── Consolidated state ──────────────────────────────────────────────

export const state = {
  params: {
    // Top-level
    fade: 1.0,
    bgColor: "#0d1017",

    // Section 1: orbiting yellow circles
    ring: {
      mix: 1.0,
      circleCount: 12,
      circleRadius: 36,         // radius of each individual spline circle
      baseOrbitRadius: 220,     // mean orbit radius
      orbitAmplitude: 40,       // sine amplitude added to base orbit radius
      orbitFrequency: 0.12,     // orbit-radius sine frequency (Hz)
      orbitAngularSpeed: 0.3,   // revolutions per second (whole ring)
      pulseIntensity: 70,       // max point deviation from circle radius
      pulseRate: 2.0,           // pulse trigger attempts per second
      pulseMinDuration: 0.25,
      pulseMaxDuration: 0.7,
      color: "#ffdb4a",
      strokeWeight: 2,
    },

    // Section 2: red rectangles (TODO)
    // Section 3: snowfall (TODO)
  },
  runtime: {
    rootAnim: null as ReturnType<typeof launch> | null,
    triggerCtx: null as DateTimeContext | null,
    circles: [] as RingCircle[],
    // Continuously integrated phases — rate params multiply the increment,
    // so changing rate shifts speed without introducing position jumps.
    orbitPhase: 0,
    orbitRadiusPhase: 0,
  },
  frame: {
    lastFrameTime: performance.now(),
    fpsSmooth: 60,
  },
};

// ── Setup / cleanup ─────────────────────────────────────────────────

export function setup(): void {
  // Pre-allocate the full MAX_CIRCLES pool so in-flight pulse state survives
  // runtime changes to `circleCount`. Per-circle angular positions are
  // derived from (i / circleCount) at draw time, so the active prefix is
  // always evenly spaced.
  state.runtime.circles = Array.from(
    { length: MAX_CIRCLES },
    () => createRingCircle(),
  );
  state.runtime.orbitPhase = 0;
  state.runtime.orbitRadiusPhase = 0;

  const rootAnim = launch(async (ctx) => {
    ctx.branch(async (triggerCtx) => {
      state.runtime.triggerCtx = triggerCtx;
      while (!triggerCtx.isCanceled) {
        const rate = Math.max(0.01, state.params.ring.pulseRate);
        await triggerCtx.waitSec(1 / rate);

        const mix = state.params.ring.mix * state.params.fade;
        if (mix <= 0) continue;

        const count = Math.max(1, Math.floor(state.params.ring.circleCount));
        const pick = Math.floor(triggerCtx.random() * count);
        const circle = state.runtime.circles[pick];
        if (!circle) continue;

        const minD = Math.max(0.05, state.params.ring.pulseMinDuration);
        const maxD = Math.max(minD, state.params.ring.pulseMaxDuration);
        const duration = minD + triggerCtx.random() * (maxD - minD);

        schedulePulse(circle, triggerCtx, duration);
      }
    });

    // Root tick — keep descendant-time fresh for the trigger loop.
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
  // core-timing doesn't expose a direct cancel here; the branches self-exit
  // when the process tears down. Kept as a hook for future symmetry.
  state.runtime.rootAnim = null;
  state.runtime.triggerCtx = null;
  state.runtime.circles = [];
}

// ── Section draws ───────────────────────────────────────────────────

function drawRingSection(p5: P5GPU): void {
  const ring = state.params.ring;
  const mix = ring.mix * state.params.fade;
  if (mix <= 0) return;

  const cx = p5.width / 2;
  const cy = p5.height / 2;

  const orbitR = ring.baseOrbitRadius +
    Math.sin(state.runtime.orbitRadiusPhase) * ring.orbitAmplitude;

  const [cr, cg, cb] = hexToRgb(ring.color);
  const alpha = Math.round(255 * mix);

  p5.noFill();
  p5.stroke(cr, cg, cb, alpha);
  p5.strokeWeight(ring.strokeWeight);

  const count = Math.max(1, Math.floor(ring.circleCount));
  const circles = state.runtime.circles;
  const ringPhase = state.runtime.orbitPhase;
  const angleStep = (Math.PI * 2) / count;

  for (let i = 0; i < count; i += 1) {
    const circle = circles[i];
    if (!circle) continue;

    const theta = ringPhase + i * angleStep;
    const ox = cx + Math.cos(theta) * orbitR;
    const oy = cy + Math.sin(theta) * orbitR;

    // Build the closed spline points with per-point pulse displacement.
    // Displacement direction is radial outward from the circle's own center.
    const pts: [number, number][] = new Array(POINTS_PER_CIRCLE);
    for (let j = 0; j < POINTS_PER_CIRCLE; j += 1) {
      const a = (j / POINTS_PER_CIRCLE) * Math.PI * 2;
      const disp = ring.pulseIntensity * circle.envelope * circle.pointOffsets[j];
      const r = ring.circleRadius + disp;
      pts[j] = [ox + Math.cos(a) * r, oy + Math.sin(a) * r];
    }

    // Catmull-Rom closed curve: repeat last→all→first→second so the spline
    // wraps smoothly around the seam.
    p5.beginShape();
    const prev = pts[POINTS_PER_CIRCLE - 1];
    p5.curveVertex(prev[0], prev[1]);
    for (let j = 0; j < POINTS_PER_CIRCLE; j += 1) {
      p5.curveVertex(pts[j][0], pts[j][1]);
    }
    p5.curveVertex(pts[0][0], pts[0][1]);
    p5.curveVertex(pts[1][0], pts[1][1]);
    p5.endShape();
  }
}

// ── Draw ────────────────────────────────────────────────────────────

export function draw(p5: P5GPU, _time: number, autoClear = true): void {
  if (autoClear) p5.clear();

  const now = performance.now();
  const dtMs = now - state.frame.lastFrameTime;
  // Cap dt so a long pause (tab blur, breakpoint) doesn't jerk positions.
  const dt = Math.min(dtMs / 1000, 0.1);
  const fps = 1000 / Math.max(1, dtMs);
  state.frame.fpsSmooth += (fps - state.frame.fpsSmooth) * 0.1;
  state.frame.lastFrameTime = now;

  // Integrate rate-driven phases regardless of fade — they're cheap and
  // keep ring geometry continuous across mix/fade transitions.
  const ring = state.params.ring;
  state.runtime.orbitPhase += Math.PI * 2 * ring.orbitAngularSpeed * dt;
  state.runtime.orbitRadiusPhase += Math.PI * 2 * ring.orbitFrequency * dt;

  if (state.params.fade <= 0) return;

  drawRingSection(p5);
  // drawRectsSection(p5, dt);  — TODO
  // drawSnowSection(p5, dt);   — TODO
}

// ── Tweakpane ───────────────────────────────────────────────────────

export function setupPane(pane: PaneContainer, _refresh?: () => void): void {
  pane.addBinding(state.params, "fade", {
    min: 0, max: 1, step: 0.01, label: "Scene Fade",
  });
  pane.addBinding(state.params, "bgColor", { label: "BG" });

  const ring = pane.addFolder({ title: "Ring (yellow circles)", expanded: true });
  const r = state.params.ring;
  ring.addBinding(r, "mix", { min: 0, max: 1, step: 0.01, label: "Mix" });
  ring.addBinding(r, "circleCount", {
    min: 6, max: MAX_CIRCLES, step: 1, label: "Circle Count",
  });
  ring.addBinding(r, "circleRadius", {
    min: 4, max: 120, step: 1, label: "Circle Radius",
  });
  ring.addBinding(r, "baseOrbitRadius", {
    min: 20, max: 600, step: 1, label: "Orbit Radius",
  });
  ring.addBinding(r, "orbitAmplitude", {
    min: 0, max: 300, step: 1, label: "Orbit Sine Amp",
  });
  ring.addBinding(r, "orbitFrequency", {
    min: 0, max: 2, step: 0.005, label: "Orbit Sine Freq",
  });
  ring.addBinding(r, "orbitAngularSpeed", {
    min: -2, max: 2, step: 0.01, label: "Orbit Angular Speed",
  });
  ring.addBinding(r, "pulseIntensity", {
    min: 0, max: 300, step: 1, label: "Pulse Intensity",
  });
  ring.addBinding(r, "pulseRate", {
    min: 0, max: 20, step: 0.1, label: "Pulse Rate (Hz)",
  });
  ring.addBinding(r, "pulseMinDuration", {
    min: 0.05, max: 3, step: 0.01, label: "Pulse Min Dur",
  });
  ring.addBinding(r, "pulseMaxDuration", {
    min: 0.05, max: 3, step: 0.01, label: "Pulse Max Dur",
  });
  ring.addBinding(r, "color", { label: "Color" });
  ring.addBinding(r, "strokeWeight", {
    min: 0.5, max: 10, step: 0.1, label: "Stroke Weight",
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
      panelHeight: 700,
      setup: (pane) => setupPane(pane),
    },
  });
  const p5 = new P5GPU(device, { width: WIDTH, height: HEIGHT });

  setup();

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
