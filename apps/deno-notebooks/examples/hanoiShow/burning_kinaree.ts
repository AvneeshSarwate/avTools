/// <reference lib="dom" />

// Burning Kinaree — two blended components:
//   1. Red rectangles launching from left/right at a random y. Travel
//      angle has ± angular deviation from horizontal; rotation speed is
//      snapshotted at launch so the rect's orientation is its own thing.
//   2. Snowfall of small circles. Each flake falls at `fallSpeed` with an
//      independent brownian x-wander; the noise source is behind a small
//      `NoiseSource` interface so the model is easy to swap later.
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

// ── Section 2: snowfall ─────────────────────────────────────────────

const SNOW_HUE_JITTER = 10;
const SNOW_SAT_JITTER = 0.08;
const SNOW_VAL_JITTER = 0.06;

/**
 * Minimal noise interface — anything with `step(dt)` and a `value` getter
 * can stand in. The snow sketch owns one instance per flake; swap
 * `createBrownianNoise` below for a different factory (perlin, sine+phase,
 * simplex) and nothing else has to change.
 */
interface NoiseSource {
  step(dt: number): void;
  readonly value: number;
  /**
   * Rate of change of `value`. For OU the internal velocity variable;
   * for other noise models this can be numerically differentiated
   * (`(value - prevValue) / dt`). Used by the snow section to couple
   * horizontal motion to vertical fall speed (momentum feel).
   */
  readonly velocity: number;
}

interface BrownianNoiseParams {
  stepSize: number; // random-impulse magnitude (applied to velocity per sec)
  damping: number; // velocity decay rate (1/sec)
  restoring: number; // spring constant pulling x back to 0 (1/sec²)
}

/**
 * Ornstein-Uhlenbeck-style brownian motion: a noisy driven, damped,
 * spring-restored scalar. Trajectories are smooth because velocity is
 * continuous, and restoring keeps wander bounded around 0 without needing
 * a hard clip. Reads params each step so runtime changes take effect live.
 */
function createBrownianNoise(
  getParams: () => BrownianNoiseParams,
): NoiseSource {
  let x = 0;
  let vel = 0;
  return {
    step(dt: number) {
      const p = getParams();
      const impulse = (Math.random() - 0.5) * 2 * p.stepSize;
      // a = impulse − damping·v − restoring·x
      vel += (impulse - p.damping * vel - p.restoring * x) * dt;
      x += vel * dt;
    },
    get value() {
      return x;
    },
    get velocity() {
      return vel;
    },
  };
}

interface Snowflake {
  startX: number; // launch x in pixels
  y: number; // current y; integrated per-frame (variable fall speed)
  size: number; // snapshotted radius
  color: [number, number, number]; // snapshotted with HSV jitter
  noise: NoiseSource; // per-flake x-wander
  alive: boolean;
}

function spawnSnowflake(
  triggerCtx: DateTimeContext,
  screenWidth: number,
): Snowflake {
  const snow = state.params.snow;
  return {
    startX: triggerCtx.random() * screenWidth,
    y: 0,
    size: snow.flakeSize,
    color: jitterHsv(
      snow.color,
      SNOW_HUE_JITTER,
      SNOW_SAT_JITTER,
      SNOW_VAL_JITTER,
    ),
    // Closure reads snow.noise live so tweakpane changes affect in-flight
    // flakes. Each flake has its own state (x, vel) via the factory's
    // internal `let` bindings.
    noise: createBrownianNoise(() => state.params.snow.noise),
    alive: true,
  };
}

// ── Consolidated state ──────────────────────────────────────────────

export const state = {
  params: {
    // Top-level
    fade: 1.0,
    bgColor: "#0d1017",

    // Section 1: red rectangles
    rects: {
      mix: 1.0,
      launchRate: 2.5, // rectangles per second
      travelSpeed: 550, // pixels/sec, snapshotted at launch
      angleDeviation: 20, // degrees, ± range from straight horizontal
      thickness: 14, // pixels; length is RECT_LENGTH_RATIO × this
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

    // Section 2: snowfall
    snow: {
      mix: 1.0,
      launchRate: 18, // flakes per second
      fallSpeed: 170, // pixels/sec (baseline, pre-coupling)
      flakeSize: 5, // circle radius in pixels
      color: "#e8f4ff",
      xDisplacementRange: 1000, // pixel cap on horizontal drift from startX
      // Momentum coupling: fast horizontal motion steals fall speed.
      // effectiveFallSpeed = fallSpeed * max(0, 1 - coupling * |vx| / fallSpeed)
      // 0 = off, 1 = full stall when |vx| matches fallSpeed.
      momentumCoupling: 0.4,
      // Brownian shaping — tune these to taste. Swap createBrownianNoise
      // in spawnSnowflake to try a different model entirely.
      noise: {
        stepSize: 800,
        damping: 1.5,
        restoring: 2.0,
      },
    },
  },
  macros: {} as Record<string, number>,
  runtime: {
    rootAnim: null as ReturnType<typeof launch> | null,
    rectangles: [] as Rectangle[],
    snowflakes: [] as Snowflake[],
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
    key: "fade",
    defaultValue: 1.0,
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

  state.runtime.rectangles = [];
  state.runtime.snowflakes = [];

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

    // Section 2: snowflake launch trigger.
    ctx.branch(async (snowCtx) => {
      while (!snowCtx.isCanceled) {
        const rate = Math.max(0.01, state.params.snow.launchRate);
        await snowCtx.waitSec(1 / rate);

        const mix = state.params.snow.mix * state.params.fade;
        if (mix <= 0) continue;

        state.runtime.snowflakes.push(
          spawnSnowflake(snowCtx, state.runtime.screenWidth),
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
  // core-timing doesn't expose a direct cancel here; the branches self-exit
  // when the process tears down. Kept as a hook for future symmetry.
  state.runtime.rootAnim = null;
  state.runtime.rectangles = [];
  state.runtime.snowflakes = [];
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

function drawSnowSection(p5: P5GPU, dt: number): void {
  const snow = state.params.snow;
  const mix = snow.mix * state.params.fade;
  if (mix <= 0) return;

  const alpha = Math.round(255 * mix);
  const h = p5.height;
  const range = snow.xDisplacementRange;
  const fallSpeed = snow.fallSpeed;
  // Guard div-by-zero; coupling uses |vx| / fallSpeed as its scale.
  const fallRef = Math.max(1, fallSpeed);
  const coupling = Math.max(0, Math.min(1, snow.momentumCoupling));
  const live = state.runtime.snowflakes;

  p5.noStroke();

  for (let i = 0; i < live.length; i += 1) {
    const f = live[i];
    if (!f.alive) continue;

    f.noise.step(dt);
    const offset = Math.max(-range, Math.min(range, f.noise.value));
    const x = f.startX + offset;

    // Momentum coupling: fast horizontal noise velocity steals fall speed.
    // max(0, …) guarantees a non-negative fall even at coupling=1.
    const vx = f.noise.velocity;
    const effectiveFall = fallSpeed *
      Math.max(0, 1 - coupling * Math.abs(vx) / fallRef);
    f.y += effectiveFall * dt;

    if (f.y > h + f.size) {
      f.alive = false;
      continue;
    }

    p5.fill(f.color[0], f.color[1], f.color[2], alpha);
    p5.circle(x, f.y, f.size * 2);
  }

  if (live.length > 0 && live.length % 64 === 0) {
    state.runtime.snowflakes = live.filter((f) => f.alive);
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

  if (state.params.fade <= 0) return;

  drawRectsSection(p5);
  drawSnowSection(p5, dt);
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

  const snow = pane.addFolder({
    title: "Snow (falling circles)",
    expanded: true,
  });
  const sn = state.params.snow;
  snow.addBinding(sn, "mix", { min: 0, max: 1, step: 0.01, label: "Mix" });
  snow.addBinding(sn, "launchRate", {
    min: 0,
    max: 80,
    step: 0.5,
    label: "Launch Rate (Hz)",
  });
  snow.addBinding(sn, "fallSpeed", {
    min: 20,
    max: 800,
    step: 5,
    label: "Fall Speed",
  });
  snow.addBinding(sn, "flakeSize", {
    min: 1,
    max: 30,
    step: 0.5,
    label: "Flake Size",
  });
  snow.addBinding(sn, "color", { label: "Color" });
  snow.addBinding(sn, "xDisplacementRange", {
    min: 0,
    max: 2000,
    step: 5,
    label: "X Displacement",
  });
  snow.addBinding(sn, "momentumCoupling", {
    min: 0,
    max: 1,
    step: 0.01,
    label: "Momentum Coupling",
  });

  const nz = snow.addFolder({ title: "Brownian Noise", expanded: false });
  nz.addBinding(sn.noise, "stepSize", {
    min: 0,
    max: 4000,
    step: 5,
    label: "Step Size",
  });
  nz.addBinding(sn.noise, "damping", {
    min: 0,
    max: 10,
    step: 0.05,
    label: "Damping",
  });
  nz.addBinding(sn.noise, "restoring", {
    min: 0,
    max: 20,
    step: 0.05,
    label: "Restoring",
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
