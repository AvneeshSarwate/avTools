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
  type WindowTweakpane,
} from "../../window/mod.ts";
import { textOnPath, type Point } from "../../tools/text_on_path.ts";
import {
  createContourReceiver,
  type ContourFrame,
} from "../../tools/contour_receiver.ts";
import {
  createContourSmoother,
  defaultSmootherParams,
} from "../../tools/contour_smoother.ts";
import {
  createSpringTextRenderer,
  defaultSpringParams,
} from "../../tools/contour_spring.ts";

const WIDTH = 1280;
const HEIGHT = 720;

// ── Consolidated state ──────────────────────────────────────────

export const state = {
  smooth: { ...defaultSmootherParams },
  spring: { ...defaultSpringParams },
  render: {
    fade: 1.0,
    enableSmoothing: true,
    enableMinRadius: true,
    scrollSpeed: 80,
    outerText: "body outline ",
    innerText: "inner contour ",
    minPoints: 10,
    minRadius: 30,
    outerSize: 22,
    innerSize: 16,
    showDebugPath: true,
  },
  runtime: {
    receiver: null as ReturnType<typeof createContourReceiver> | null,
    smoother: null as ReturnType<typeof createContourSmoother> | null,
    springText: null as ReturnType<typeof createSpringTextRenderer> | null,
  },
  frame: {
    lastFrameTime: performance.now(),
    fpsSmooth: 60,
    lastProcessedFrame: -1,
    smoothedFrame: null as ReturnType<
      ReturnType<typeof createContourSmoother>["process"]
    > | null,
    lastRawFrame: null as ContourFrame | null,
  },
};

// ── Tweakpane setup ─────────────────────────────────────────────

export function setupPane(pane: WindowTweakpane) {
  const smooth = pane.addFolder({ title: "Smoothing" });
  smooth.addBinding(state.smooth, "mincutoff", {
    min: 0.1, max: 15, step: 0.1, label: "Min Cutoff",
  });
  smooth.addBinding(state.smooth, "beta", {
    min: 0.0, max: 0.2, step: 0.001, label: "Beta",
  });
  smooth.addBinding(state.smooth, "dcutoff", {
    min: 0.1, max: 5.0, step: 0.1, label: "D Cutoff",
  });
  smooth.addBinding(state.smooth, "resampleCount", {
    min: 50, max: 800, step: 10, label: "Resample N",
  });
  smooth.addBinding(state.smooth, "matchThreshold", {
    min: 0.01, max: 0.5, step: 0.01, label: "Match Thresh",
  });
  smooth.addBinding(state.smooth, "fadeInFrames", {
    min: 1, max: 20, step: 1, label: "Fade In",
  });
  smooth.addBinding(state.smooth, "fadeOutFrames", {
    min: 1, max: 30, step: 1, label: "Fade Out",
  });

  const stability = pane.addFolder({ title: "Stability" });
  stability.addBinding(state.smooth, "youngMaxAge", {
    min: 1, max: 10, step: 1, label: "Young Max Age",
  });
  stability.addBinding(state.smooth, "overlapDist", {
    min: 0.0, max: 0.3, step: 0.01, label: "Overlap Dist",
  });
  stability.addBinding(state.smooth, "shapeResetThreshold", {
    min: 0.01, max: 0.2, step: 0.005, label: "Shape Reset",
  });

  const spring = pane.addFolder({ title: "Spring Physics" });
  spring.addBinding(state.spring, "enabled", { label: "Enabled" });
  spring.addBinding(state.spring, "stiffness", {
    min: 10, max: 500, step: 5, label: "Stiffness",
  });
  spring.addBinding(state.spring, "damping", {
    min: 0.05, max: 2.0, step: 0.05, label: "Damping",
  });

  const render = pane.addFolder({ title: "Render" });
  render.addBinding(state.render, "fade", {
    min: 0, max: 1, step: 0.01, label: "Fade",
  });
  render.addBinding(state.render, "enableSmoothing", { label: "Smoothing" });
  render.addBinding(state.render, "enableMinRadius", {
    label: "Min Radius Filter",
  });
  render.addBinding(state.render, "scrollSpeed", {
    min: 0, max: 300, step: 1, label: "Scroll Speed",
  });
  render.addBinding(state.render, "outerSize", {
    min: 8, max: 48, step: 1, label: "Outer Size",
  });
  render.addBinding(state.render, "innerSize", {
    min: 6, max: 36, step: 1, label: "Inner Size",
  });
  render.addBinding(state.render, "minRadius", {
    min: 0, max: 200, step: 1, label: "Min Radius",
  });
  render.addBinding(state.render, "showDebugPath", { label: "Show Path" });
}

// ── Helper ───────────────────────────────────────────────────────

function drawPath(p5: P5GPU, pts: Point[]) {
  for (let i = 0; i < pts.length - 1; i++) {
    p5.line(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
  }
}

// ── Setup / cleanup ─────────────────────────────────────────────

export async function setup() {
  const receiver = createContourReceiver();
  const smoother = createContourSmoother(state.smooth);
  const springText = createSpringTextRenderer(state.spring);
  state.runtime.receiver = receiver;
  state.runtime.smoother = smoother;
  state.runtime.springText = springText;
}

export function cleanup() {
  state.runtime.receiver?.close();
}

// ── Draw function ───────────────────────────────────────────────

export function draw(p5: P5GPU, time: number) {
  const fade = state.render.fade;
  if (fade <= 0) return;

  const now = performance.now();
  const fps = 1000 / (now - state.frame.lastFrameTime);
  state.frame.fpsSmooth += (fps - state.frame.fpsSmooth) * 0.1;
  state.frame.lastFrameTime = now;

  const scrollOffset = time * state.render.scrollSpeed;

  p5.noStroke();
  p5.textFont("Inter Variable");

  const receiver = state.runtime.receiver!;
  const smoother = state.runtime.smoother!;
  const springText = state.runtime.springText!;

  const rawFrame = receiver.latestFrame;
  if (rawFrame && rawFrame.frameNumber !== state.frame.lastProcessedFrame) {
    if (state.render.enableSmoothing) {
      state.frame.smoothedFrame = smoother.process(rawFrame);
    }
    state.frame.lastRawFrame = rawFrame;
    state.frame.lastProcessedFrame = rawFrame.frameNumber;
  }

  // Build contour list (smoothed or raw)
  const contoursToRender: Array<{
    id: number;
    points: Point[];
    parentIndex: number;
    opacity: number;
  }> = [];

  if (state.render.enableSmoothing && state.frame.smoothedFrame) {
    for (const c of state.frame.smoothedFrame.contours) {
      contoursToRender.push({
        id: c.id,
        points: c.points,
        parentIndex: c.parentIndex,
        opacity: c.opacity,
      });
    }
  } else if (state.frame.lastRawFrame) {
    for (const c of state.frame.lastRawFrame.contours) {
      contoursToRender.push({
        id: -1,
        points: c.points,
        parentIndex: c.parentIndex,
        opacity: 1.0,
      });
    }
  }

  // Track active contour IDs for spring cleanup
  const activeIds = new Set<number>();

  if (contoursToRender.length > 0) {
    for (const contour of contoursToRender) {
      if (contour.points.length < state.render.minPoints) continue;
      if (contour.id >= 0) activeIds.add(contour.id);

      const scaled: Point[] = contour.points.map((p) => ({
        x: p.x * WIDTH,
        y: p.y * HEIGHT,
      }));

      // Skip small contours by bounding-box half-diagonal
      if (state.render.enableMinRadius) {
        let minX = Infinity,
          minY = Infinity,
          maxX = -Infinity,
          maxY = -Infinity;
        for (const p of scaled) {
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        }
        const radius =
          Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2) / 2;
        if (radius < state.render.minRadius) continue;
      }

      const isOuter = contour.parentIndex === -1;
      const alpha = Math.round(contour.opacity * 255 * fade);

      if (state.render.showDebugPath) {
        p5.strokeWeight(10);
        p5.stroke(
          isOuter ? 0 : 130,
          isOuter ? 160 : 0,
          isOuter ? 190 : 160,
          Math.round(alpha * 0.5),
        );
        drawPath(p5, scaled);
        p5.noStroke();
      }

      p5.textSize(
        isOuter ? state.render.outerSize : state.render.innerSize,
      );
      if (isOuter) {
        p5.fill(100, 200, 255, alpha);
      } else {
        p5.fill(200, 140, 255, alpha);
      }

      const txt = isOuter
        ? state.render.outerText
        : state.render.innerText;

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
  } else {
    p5.fill(100, 100, 120, Math.round(255 * fade));
    p5.textSize(20);
    p5.textAlign("center", "center");
    p5.text(
      "Waiting for contour data on ws://127.0.0.1:9100...",
      WIDTH / 2,
      HEIGHT / 2,
    );
  }
}

// ── Standalone entry point ──────────────────────────────────────

if (import.meta.main) {
  const device = await requestWebGpuDevice();
  const renderWindow = await createWindowRenderManager({
    device,
    width: WIDTH,
    height: HEIGHT,
    title: "Body Text",
    pane: {
      title: "Body Text",
      panelWidth: 520,
      panelHeight: 520,
      setup: setupPane,
    },
  });
  const p5 = new P5GPU(device, { width: WIDTH, height: HEIGHT });

  await setup();

  await renderWindow.run(
    () => {
      const t = performance.now() * 0.001;
      p5.beginFrame();
      p5.background(15, 18, 26);
      draw(p5, t);

      // HUD
      p5.textSize(14);
      p5.fill(100, 100, 120);
      p5.textAlign("left", "bottom");
      p5.text(`${Math.round(state.frame.fpsSmooth)} fps`, 20, HEIGHT - 12);
      if (state.frame.smoothedFrame) {
        p5.textAlign("right", "bottom");
        const nVisible = state.frame.smoothedFrame.contours.filter(
          (c) => c.opacity > 0.01,
        ).length;
        p5.text(
          `frame ${state.frame.smoothedFrame.frameNumber} · ${nVisible} contours`,
          WIDTH - 20,
          HEIGHT - 12,
        );
      }

      return p5.endFrame();
    },
    {
      cleanup: () => {
        cleanup();
        p5.dispose();
      },
    },
  );
}
