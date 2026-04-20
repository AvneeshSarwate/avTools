/// <reference lib="dom" />

// Renders text along body contours received from the Swift Vision app
// via the binary WebSocket contour protocol, with temporal smoothing.
//
// Run from apps/deno-notebooks:
//   deno run --unstable-webgpu --unstable-ffi --allow-all \
//     examples/hanoiShow/p5gpu_body_text.ts

import { P5GPU } from "../../tools/p5gpu.ts";
import {
  createWindowRenderManager,
  requestWebGpuDevice,
  type PaneContainer,
} from "../../window/mod.ts";
import { type Point, textOnPath } from "../../tools/text_on_path.ts";
import {
  createSpringTextRenderer,
  defaultSpringParams,
} from "../../tools/contour_spring.ts";
import {
  type BodyContourProvider,
  createBodyContourProvider,
} from "./body_contour_provider.ts";

const WIDTH = 1280;
const HEIGHT = 720;

// ── Consolidated state ──────────────────────────────────────────

export const state = {
  spring: { ...defaultSpringParams },
  render: {
    fade: 1.0,
    scrollSpeed: 80,
    outerText: "body outline ",
    innerText: "inner contour ",
    minPoints: 10,
    minRadius: 30,
    outerSize: 22,
    innerSize: 30,
    showDebugPath: true,
    enableMinRadius: true,
  },
  runtime: {
    springText: null as ReturnType<typeof createSpringTextRenderer> | null,
  },
  frame: {
    lastFrameTime: performance.now(),
    fpsSmooth: 60,
  },
  /**
   * Shared contour data source. Set by the host (combined.ts) or created
   * privately in standalone mode. Consumers should treat null as "no contour
   * data available" and draw nothing (or a placeholder).
   */
  contourProvider: null as BodyContourProvider | null,
};

// ── Tweakpane setup ─────────────────────────────────────────────

export function setupPane(pane: PaneContainer) {
  pane.addBinding(state.render, "fade", {
    min: 0,
    max: 1,
    step: 0.01,
    label: "Fade",
  });

  const spring = pane.addFolder({ title: "Spring Physics" });
  spring.addBinding(state.spring, "enabled", { label: "Enabled" });
  spring.addBinding(state.spring, "stiffness", {
    min: 10,
    max: 500,
    step: 5,
    label: "Stiffness",
  });
  spring.addBinding(state.spring, "damping", {
    min: 0.05,
    max: 2.0,
    step: 0.05,
    label: "Damping",
  });

  const render = pane.addFolder({ title: "Render" });
  render.addBinding(state.render, "enableMinRadius", {
    label: "Min Radius Filter",
  });
  render.addBinding(state.render, "scrollSpeed", {
    min: -300,
    max: 300,
    step: 1,
    label: "Scroll Speed",
  });
  render.addBinding(state.render, "outerSize", {
    min: 8,
    max: 48,
    step: 1,
    label: "Outer Size",
  });
  render.addBinding(state.render, "innerSize", {
    min: 6,
    max: 100,
    step: 1,
    label: "Inner Size",
  });
  render.addBinding(state.render, "minRadius", {
    min: 0,
    max: 200,
    step: 1,
    label: "Min Radius",
  });
  render.addBinding(state.render, "showDebugPath", { label: "Show Path" });
}

// ── Helper ───────────────────────────────────────────────────────

function drawPath(p5: P5GPU, pts: Point[]) {
  if (pts.length < 2) return;
  p5.noFill();
  p5.beginShape();
  for (const pt of pts) {
    p5.vertex(pt.x, pt.y);
  }
  p5.endShape();
}

// ── Setup / cleanup ─────────────────────────────────────────────

export function setup() {
  state.runtime.springText = createSpringTextRenderer(state.spring);
}

export function cleanup() {
  // Provider lifecycle is managed by the host that set it on state.
  // If we created it in standalone mode, the import.meta.main block cleans up.
}

// ── Draw function ───────────────────────────────────────────────

export function draw(p5: P5GPU, time: number) {
  const fade = state.render.fade;
  if (fade <= 0) return;

  const provider = state.contourProvider;
  if (!provider) return;

  const now = performance.now();
  const fps = 1000 / (now - state.frame.lastFrameTime);
  state.frame.fpsSmooth += (fps - state.frame.fpsSmooth) * 0.1;
  state.frame.lastFrameTime = now;

  const scrollOffset = time * state.render.scrollSpeed;

  p5.noStroke();
  p5.textFont("Inter Variable");

  const springText = state.runtime.springText!;
  const contours = provider.getContours();
  const activeIds = new Set<number>();

  if (contours.length === 0) {
    p5.fill(100, 100, 120, Math.round(255 * fade));
    p5.textSize(20);
    p5.textAlign("center", "center");
    p5.text(
      "Waiting for contour data on ws://127.0.0.1:9100...",
      WIDTH / 2,
      HEIGHT / 2,
    );
    return;
  }

  for (const contour of contours) {
    if (contour.points.length < state.render.minPoints) continue;
    if (contour.id >= 0) activeIds.add(contour.id);

    // Scale normalized points to pixel coords
    const scaled: Point[] = contour.points.map((p) => ({
      x: p.x * WIDTH,
      y: p.y * HEIGHT,
    }));

    if (state.render.enableMinRadius) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const p of scaled) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      const radius = Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2) / 2;
      if (radius < state.render.minRadius) continue;
    }

    const isOuter = contour.parentIndex === -1;
    const alpha = Math.round(contour.opacity * 255 * fade);

    // Ink color #ffe9a8 — matches the tegaki sketch's default ink so the
    // two scenes read as one palette. Debug path uses the same color at
    // half alpha.
    if (state.render.showDebugPath) {
      p5.strokeWeight(10);
      p5.stroke(255, 233, 168, Math.round(alpha * 0.5));
      drawPath(p5, scaled);
      p5.noStroke();
    }

    p5.textSize(isOuter ? state.render.outerSize : state.render.innerSize);
    p5.fill(255, 233, 168, alpha);

    const txt = isOuter ? state.render.outerText : state.render.innerText;

    if (contour.id >= 0 && state.spring.enabled) {
      springText.renderTextOnPath(p5, contour.id, txt, scaled, {
        offset: scrollOffset,
        letterSpacing: 1,
      });
    } else {
      textOnPath(p5, txt, scaled, {
        fill: "wrap",
        offset: scrollOffset,
        letterSpacing: 1,
      });
    }
  }

  springText.tick();
  springText.cleanup(activeIds);
}

// ── Standalone entry point ──────────────────────────────────────

if (import.meta.main) {
  const device = await requestWebGpuDevice();

  // Standalone: create our own provider and wire it up.
  const provider = createBodyContourProvider();
  state.contourProvider = provider;
  provider.setup();

  const renderWindow = await createWindowRenderManager({
    device,
    width: WIDTH,
    height: HEIGHT,
    title: "Body Text",
    pane: {
      title: "Body Text",
      panelWidth: 520,
      panelHeight: 520,
      setup: (pane) => {
        setupPane(pane);
        provider.setupPane(pane.addFolder({ title: "Contour Processing" }));
      },
    },
  });
  const p5 = new P5GPU(device, { width: WIDTH, height: HEIGHT });

  setup();

  await renderWindow.run(
    () => {
      const t = performance.now() * 0.001;
      provider.tick();
      p5.beginFrame();
      p5.background(15, 18, 26);
      draw(p5, t);

      // HUD
      p5.textSize(14);
      p5.fill(100, 100, 120);
      p5.textAlign("left", "bottom");
      p5.text(`${Math.round(state.frame.fpsSmooth)} fps`, 20, HEIGHT - 12);
      const frameNum = provider.getFrameNumber();
      if (frameNum >= 0) {
        p5.textAlign("right", "bottom");
        p5.text(
          `frame ${frameNum} · ${provider.getContours().length} contours`,
          WIDTH - 20,
          HEIGHT - 12,
        );
      }

      return p5.endFrame();
    },
    {
      cleanup: () => {
        cleanup();
        provider.cleanup();
        p5.dispose();
      },
    },
  );
}
