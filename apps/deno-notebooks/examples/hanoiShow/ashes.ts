/// <reference lib="dom" />

// Ashes — extracted from the falling-circle section of burning_kinaree.ts.
// Independent scene with its own fade/macro wiring for combined_landscape.

import { P5GPU } from "../../tools/p5gpu.ts";
import {
  createWindowRenderManager,
  type PaneContainer,
  requestWebGpuDevice,
} from "../../window/mod.ts";
import { type DateTimeContext, launch } from "@avtools/core-timing";
import { type MacroDef } from "../../tools/macros.ts";

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

const ASH_HUE_JITTER = 10;
const ASH_SAT_JITTER = 0.08;
const ASH_VAL_JITTER = 0.06;

interface NoiseSource {
  step(dt: number): void;
  readonly value: number;
  readonly velocity: number;
}

interface BrownianNoiseParams {
  stepSize: number;
  damping: number;
  restoring: number;
}

function createBrownianNoise(
  getParams: () => BrownianNoiseParams,
): NoiseSource {
  let x = 0;
  let vel = 0;
  return {
    step(dt: number) {
      const p = getParams();
      const impulse = (Math.random() - 0.5) * 2 * p.stepSize;
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

interface AshParticle {
  startX: number;
  y: number;
  size: number;
  color: [number, number, number];
  noise: NoiseSource;
  alive: boolean;
}

function spawnAshParticle(
  triggerCtx: DateTimeContext,
  screenWidth: number,
): AshParticle {
  const ashes = state.params.ashes;
  return {
    startX: triggerCtx.random() * screenWidth,
    y: 0,
    size: ashes.flakeSize,
    color: jitterHsv(
      ashes.color,
      ASH_HUE_JITTER,
      ASH_SAT_JITTER,
      ASH_VAL_JITTER,
    ),
    noise: createBrownianNoise(() => state.params.ashes.noise),
    alive: true,
  };
}

export const state = {
  params: {
    fade: 0.0,
    bgColor: "#0d1017",
    ashes: {
      mix: 1.0,
      launchRate: 18,
      fallSpeed: 170,
      flakeSize: 5,
      color: "#e8f4ff",
      xDisplacementRange: 1000,
      momentumCoupling: 0.4,
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
    ashParticles: [] as AshParticle[],
    screenWidth: 1280,
    screenHeight: 720,
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

export function setup(opts?: { width?: number; height?: number }): void {
  if (opts?.width !== undefined) state.runtime.screenWidth = opts.width;
  if (opts?.height !== undefined) state.runtime.screenHeight = opts.height;

  state.runtime.rootAnim?.cancel();
  state.runtime.ashParticles = [];

  const rootAnim = launch(async (ctx) => {
    ctx.branch(async (ashCtx) => {
      while (!ashCtx.isCanceled) {
        const rate = Math.max(0.01, state.params.ashes.launchRate);
        await ashCtx.waitSec(1 / rate);

        const mix = state.params.ashes.mix * state.params.fade;
        if (mix <= 0) continue;

        state.runtime.ashParticles.push(
          spawnAshParticle(ashCtx, state.runtime.screenWidth),
        );
      }
    });

    while (!ctx.isCanceled) await ctx.waitSec(1 / 60);
  });
  state.runtime.rootAnim = rootAnim;
  rootAnim.catch((err: unknown) => {
    if ((err as Error)?.message !== "aborted") {
      console.error("ashes root:", err);
    }
  });
}

export function cleanup(): void {
  state.runtime.rootAnim?.cancel();
  state.runtime.rootAnim = null;
  state.runtime.ashParticles = [];
}

function drawAshesSection(p5: P5GPU, dt: number): void {
  const ashes = state.params.ashes;
  const mix = ashes.mix * state.params.fade;
  if (mix <= 0) return;

  const alpha = Math.round(255 * mix);
  const h = p5.height;
  const range = ashes.xDisplacementRange;
  const fallSpeed = ashes.fallSpeed;
  const fallRef = Math.max(1, fallSpeed);
  const coupling = Math.max(0, Math.min(1, ashes.momentumCoupling));
  const live = state.runtime.ashParticles;

  p5.noStroke();

  for (let i = 0; i < live.length; i += 1) {
    const particle = live[i];
    if (!particle.alive) continue;

    particle.noise.step(dt);
    const offset = Math.max(-range, Math.min(range, particle.noise.value));
    const x = particle.startX + offset;

    const vx = particle.noise.velocity;
    const effectiveFall = fallSpeed *
      Math.max(0, 1 - coupling * Math.abs(vx) / fallRef);
    particle.y += effectiveFall * dt;

    if (particle.y > h + particle.size) {
      particle.alive = false;
      continue;
    }

    p5.fill(particle.color[0], particle.color[1], particle.color[2], alpha);
    p5.circle(x, particle.y, particle.size * 2);
  }

  if (live.length > 0 && live.length % 64 === 0) {
    state.runtime.ashParticles = live.filter((particle) => particle.alive);
  }
}

export function draw(p5: P5GPU, _time: number, autoClear = true): void {
  if (autoClear) p5.clear();

  const now = performance.now();
  const dtMs = now - state.frame.lastFrameTime;
  const dt = Math.min(dtMs / 1000, 0.1);
  const fps = 1000 / Math.max(1, dtMs);
  state.frame.fpsSmooth += (fps - state.frame.fpsSmooth) * 0.1;
  state.frame.lastFrameTime = now;

  if (state.params.fade <= 0) return;

  drawAshesSection(p5, dt);
}

export function setupPane(pane: PaneContainer, _refresh?: () => void): void {
  pane.addBinding(state.params, "fade", {
    min: 0,
    max: 1,
    step: 0.01,
    label: "Scene Fade",
  });
  pane.addBinding(state.params, "bgColor", { label: "BG" });

  const ashes = pane.addFolder({
    title: "Ashes (falling circles)",
    expanded: true,
  });
  const ash = state.params.ashes;
  ashes.addBinding(ash, "mix", { min: 0, max: 1, step: 0.01, label: "Mix" });
  ashes.addBinding(ash, "launchRate", {
    min: 0,
    max: 80,
    step: 0.5,
    label: "Launch Rate (Hz)",
  });
  ashes.addBinding(ash, "fallSpeed", {
    min: 20,
    max: 800,
    step: 5,
    label: "Fall Speed",
  });
  ashes.addBinding(ash, "flakeSize", {
    min: 1,
    max: 30,
    step: 0.5,
    label: "Flake Size",
  });
  ashes.addBinding(ash, "color", { label: "Color" });
  ashes.addBinding(ash, "xDisplacementRange", {
    min: 0,
    max: 2000,
    step: 5,
    label: "X Displacement",
  });
  ashes.addBinding(ash, "momentumCoupling", {
    min: 0,
    max: 1,
    step: 0.01,
    label: "Momentum Coupling",
  });

  const noise = ashes.addFolder({ title: "Brownian Noise", expanded: false });
  noise.addBinding(ash.noise, "stepSize", {
    min: 0,
    max: 4000,
    step: 5,
    label: "Step Size",
  });
  noise.addBinding(ash.noise, "damping", {
    min: 0,
    max: 10,
    step: 0.05,
    label: "Damping",
  });
  noise.addBinding(ash.noise, "restoring", {
    min: 0,
    max: 20,
    step: 0.05,
    label: "Restoring",
  });
}

if (import.meta.main) {
  const WIDTH = 1280;
  const HEIGHT = 720;
  const device = await requestWebGpuDevice();

  const renderWindow = await createWindowRenderManager({
    device,
    width: WIDTH,
    height: HEIGHT,
    title: "Ashes",
    pane: {
      title: "Ashes",
      panelWidth: 520,
      panelHeight: 760,
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

      p5.textSize(14);
      p5.fill(120, 120, 140);
      p5.textAlign("left", "bottom");
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
