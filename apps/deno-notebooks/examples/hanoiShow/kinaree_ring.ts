/// <reference lib="dom" />

// Kinaree Ring — extracted from the orbiting-circle section of
// burning_kinaree.ts. Kept standalone for isolated tuning before the
// original scene is modified.

import { P5GPU } from "../../tools/p5gpu.ts";
import {
  createWindowRenderManager,
  type PaneContainer,
  requestWebGpuDevice,
} from "../../window/mod.ts";
import { type DateTimeContext, launch } from "@avtools/core-timing";

const MAX_CIRCLES = 20;
const POINTS_PER_CIRCLE = 20;

interface RingCircle {
  // Angular position around the orbit is derived from the circle's index and
  // live circleCount, so circles stay evenly spaced when count changes.
  pointOffsets: Float32Array;
  envelope: number;
  epoch: number;
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
  circle.pointOffsets.fill(0);
  const numSpikes = 3 + Math.floor(triggerCtx.random() * 4);
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
      if (circle.epoch !== myEpoch) return;
      const t = (rampCtx.progTime - start) / duration;
      if (t >= 1) break;
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

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

export const state = {
  params: {
    fade: 1.0,
    bgColor: "#0d1017",
    mix: 1.0,
    circleCount: 12,
    circleRadius: 36,
    baseOrbitRadius: 220,
    orbitAmplitude: 40,
    orbitFrequency: 0.12,
    orbitAngularSpeed: 0.3,
    pulseIntensity: 70,
    pulseRate: 2.0,
    pulseMinDuration: 0.25,
    pulseMaxDuration: 0.7,
    color: "#ffdb4a",
    strokeWeight: 2,
  },
  runtime: {
    rootAnim: null as ReturnType<typeof launch> | null,
    circles: [] as RingCircle[],
    orbitPhase: 0,
    orbitRadiusPhase: 0,
  },
  frame: {
    lastFrameTime: performance.now(),
  },
};

export function setup(): void {
  state.runtime.circles = Array.from(
    { length: MAX_CIRCLES },
    () => createRingCircle(),
  );
  state.runtime.orbitPhase = 0;
  state.runtime.orbitRadiusPhase = 0;

  const rootAnim = launch(async (ctx) => {
    ctx.branch(async (triggerCtx) => {
      while (!triggerCtx.isCanceled) {
        const rate = Math.max(0.01, state.params.pulseRate);
        await triggerCtx.waitSec(1 / rate);

        const mix = state.params.mix * state.params.fade;
        if (mix <= 0) continue;

        const count = Math.max(1, Math.floor(state.params.circleCount));
        const pick = Math.floor(triggerCtx.random() * count);
        const circle = state.runtime.circles[pick];
        if (!circle) continue;

        const minD = Math.max(0.05, state.params.pulseMinDuration);
        const maxD = Math.max(minD, state.params.pulseMaxDuration);
        const duration = minD + triggerCtx.random() * (maxD - minD);

        schedulePulse(circle, triggerCtx, duration);
      }
    });

    while (!ctx.isCanceled) await ctx.waitSec(1 / 60);
  });

  state.runtime.rootAnim = rootAnim;
  rootAnim.catch((err: unknown) => {
    if ((err as Error)?.message !== "aborted") {
      console.error("kinaree_ring root:", err);
    }
  });
}

export function cleanup(): void {
  state.runtime.rootAnim?.cancel();
  state.runtime.rootAnim = null;
  state.runtime.circles = [];
}

export function draw(p5: P5GPU, _time: number, autoClear = true): void {
  if (autoClear) p5.clear();

  const now = performance.now();
  const dtMs = now - state.frame.lastFrameTime;
  const dt = Math.min(dtMs / 1000, 0.1);
  state.frame.lastFrameTime = now;

  state.runtime.orbitPhase += Math.PI * 2 * state.params.orbitAngularSpeed * dt;
  state.runtime.orbitRadiusPhase += Math.PI * 2 * state.params.orbitFrequency *
    dt;

  const mix = state.params.mix * state.params.fade;
  if (mix <= 0) return;

  const cx = p5.width / 2;
  const cy = p5.height / 2;
  const orbitR = state.params.baseOrbitRadius +
    Math.sin(state.runtime.orbitRadiusPhase) * state.params.orbitAmplitude;
  const [cr, cg, cb] = hexToRgb(state.params.color);
  const alpha = Math.round(255 * mix);

  p5.noFill();
  p5.stroke(cr, cg, cb, alpha);
  p5.strokeWeight(state.params.strokeWeight);

  const count = Math.max(1, Math.floor(state.params.circleCount));
  const angleStep = (Math.PI * 2) / count;

  for (let i = 0; i < count; i += 1) {
    const circle = state.runtime.circles[i];
    if (!circle) continue;

    const theta = state.runtime.orbitPhase + i * angleStep;
    const ox = cx + Math.cos(theta) * orbitR;
    const oy = cy + Math.sin(theta) * orbitR;
    const pts: [number, number][] = new Array(POINTS_PER_CIRCLE);

    for (let j = 0; j < POINTS_PER_CIRCLE; j += 1) {
      const a = (j / POINTS_PER_CIRCLE) * Math.PI * 2;
      const disp = state.params.pulseIntensity * circle.envelope *
        circle.pointOffsets[j];
      const r = state.params.circleRadius + disp;
      pts[j] = [ox + Math.cos(a) * r, oy + Math.sin(a) * r];
    }

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

export function setupPane(pane: PaneContainer, _refresh?: () => void): void {
  pane.addBinding(state.params, "fade", {
    min: 0,
    max: 1,
    step: 0.01,
    label: "Scene Fade",
  });
  pane.addBinding(state.params, "bgColor", { label: "BG" });
  pane.addBinding(state.params, "mix", {
    min: 0,
    max: 1,
    step: 0.01,
    label: "Mix",
  });
  pane.addBinding(state.params, "circleCount", {
    min: 6,
    max: MAX_CIRCLES,
    step: 1,
    label: "Circle Count",
  });
  pane.addBinding(state.params, "circleRadius", {
    min: 4,
    max: 120,
    step: 1,
    label: "Circle Radius",
  });
  pane.addBinding(state.params, "baseOrbitRadius", {
    min: 20,
    max: 600,
    step: 1,
    label: "Orbit Radius",
  });
  pane.addBinding(state.params, "orbitAmplitude", {
    min: 0,
    max: 300,
    step: 1,
    label: "Orbit Sine Amp",
  });
  pane.addBinding(state.params, "orbitFrequency", {
    min: 0,
    max: 2,
    step: 0.005,
    label: "Orbit Sine Freq",
  });
  pane.addBinding(state.params, "orbitAngularSpeed", {
    min: -2,
    max: 2,
    step: 0.01,
    label: "Orbit Angular Speed",
  });
  pane.addBinding(state.params, "pulseIntensity", {
    min: 0,
    max: 300,
    step: 1,
    label: "Pulse Intensity",
  });
  pane.addBinding(state.params, "pulseRate", {
    min: 0,
    max: 20,
    step: 0.1,
    label: "Pulse Rate (Hz)",
  });
  pane.addBinding(state.params, "pulseMinDuration", {
    min: 0.05,
    max: 3,
    step: 0.01,
    label: "Pulse Min Dur",
  });
  pane.addBinding(state.params, "pulseMaxDuration", {
    min: 0.05,
    max: 3,
    step: 0.01,
    label: "Pulse Max Dur",
  });
  pane.addBinding(state.params, "color", { label: "Color" });
  pane.addBinding(state.params, "strokeWeight", {
    min: 0.5,
    max: 10,
    step: 0.1,
    label: "Stroke Weight",
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
    title: "Kinaree Ring",
    pane: {
      title: "Kinaree Ring",
      panelWidth: 520,
      panelHeight: 720,
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
