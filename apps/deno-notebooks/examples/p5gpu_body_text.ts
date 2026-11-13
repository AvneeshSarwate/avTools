/// <reference lib="dom" />

// Renders text along body contours received from the Swift Vision app
// via the binary WebSocket contour protocol, with temporal smoothing.
//
// Run from apps/deno-notebooks:
//   deno run --unstable-webgpu --unstable-ffi --allow-all \
//     examples/p5gpu_body_text.ts

import { P5GPU } from "../tools/p5gpu.ts";
import {
  createWindowRenderManager,
  requestWebGpuDevice,
  type WindowTweakpane,
} from "../window/mod.ts";
import { textOnPath, type Point } from "../tools/text_on_path.ts";
import { createContourReceiver, type ContourFrame } from "../tools/contour_receiver.ts";
import {
  createContourSmoother,
  defaultSmootherParams,
} from "../tools/contour_smoother.ts";
import {
  createSpringTextRenderer,
  defaultSpringParams,
} from "../tools/contour_spring.ts";

const WIDTH = 1280;
const HEIGHT = 720;

// ── Tweakpane params ─────────────────────────────────────────────

const smoothParams = { ...defaultSmootherParams };
const springParams = { ...defaultSpringParams };

const renderParams = {
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
};

function setupPane(pane: WindowTweakpane) {
  const smooth = pane.addFolder({ title: "Smoothing" });
  smooth.addBinding(smoothParams, "mincutoff", {
    min: 0.1, max: 15, step: 0.1, label: "Min Cutoff",
  });
  smooth.addBinding(smoothParams, "beta", {
    min: 0.0, max: 0.2, step: 0.001, label: "Beta",
  });
  smooth.addBinding(smoothParams, "dcutoff", {
    min: 0.1, max: 5.0, step: 0.1, label: "D Cutoff",
  });
  smooth.addBinding(smoothParams, "resampleCount", {
    min: 50, max: 800, step: 10, label: "Resample N",
  });
  smooth.addBinding(smoothParams, "matchThreshold", {
    min: 0.01, max: 0.5, step: 0.01, label: "Match Thresh",
  });
  smooth.addBinding(smoothParams, "fadeInFrames", {
    min: 1, max: 20, step: 1, label: "Fade In",
  });
  smooth.addBinding(smoothParams, "fadeOutFrames", {
    min: 1, max: 30, step: 1, label: "Fade Out",
  });

  const stability = pane.addFolder({ title: "Stability" });
  stability.addBinding(smoothParams, "youngMaxAge", {
    min: 1, max: 10, step: 1, label: "Young Max Age",
  });
  stability.addBinding(smoothParams, "overlapDist", {
    min: 0.0, max: 0.3, step: 0.01, label: "Overlap Dist",
  });
  stability.addBinding(smoothParams, "shapeResetThreshold", {
    min: 0.01, max: 0.2, step: 0.005, label: "Shape Reset",
  });

  const spring = pane.addFolder({ title: "Spring Physics" });
  spring.addBinding(springParams, "enabled", { label: "Enabled" });
  spring.addBinding(springParams, "stiffness", {
    min: 10, max: 500, step: 5, label: "Stiffness",
  });
  spring.addBinding(springParams, "damping", {
    min: 0.05, max: 2.0, step: 0.05, label: "Damping",
  });

  const render = pane.addFolder({ title: "Render" });
  render.addBinding(renderParams, "enableSmoothing", { label: "Smoothing" });
  render.addBinding(renderParams, "enableMinRadius", { label: "Min Radius Filter" });
  render.addBinding(renderParams, "scrollSpeed", {
    min: 0, max: 300, step: 1, label: "Scroll Speed",
  });
  render.addBinding(renderParams, "outerSize", {
    min: 8, max: 48, step: 1, label: "Outer Size",
  });
  render.addBinding(renderParams, "innerSize", {
    min: 6, max: 36, step: 1, label: "Inner Size",
  });
  render.addBinding(renderParams, "minRadius", {
    min: 0, max: 200, step: 1, label: "Min Radius",
  });
  render.addBinding(renderParams, "showDebugPath", { label: "Show Path" });
}

// ── Setup ────────────────────────────────────────────────────────

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
const receiver = createContourReceiver();
const smoother = createContourSmoother(smoothParams);
const springText = createSpringTextRenderer(springParams);

// ── FPS tracking ─────────────────────────────────────────────────

let lastFrameTime = performance.now();
let fpsSmooth = 60;
let lastProcessedFrame = -1;
let smoothedFrame: ReturnType<typeof smoother.process> | null = null;
let lastRawFrame: ContourFrame | null = null;

// ── Helper ───────────────────────────────────────────────────────

function drawPath(pts: Point[]) {
  for (let i = 0; i < pts.length - 1; i++) {
    p5.line(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
  }
}

// ── Render loop ──────────────────────────────────────────────────

await renderWindow.run(renderFrame, {
  cleanup: () => {
    receiver.close();
    p5.dispose();
  },
});

function renderFrame() {
  const now = performance.now();
  const fps = 1000 / (now - lastFrameTime);
  fpsSmooth += (fps - fpsSmooth) * 0.1;
  lastFrameTime = now;

  const t = now * 0.001;
  const scrollOffset = t * renderParams.scrollSpeed;

  p5.beginFrame();
  p5.background(15, 18, 26);
  p5.noStroke();
  p5.textFont("Inter Variable");

  const rawFrame = receiver.latestFrame;
  if (rawFrame && rawFrame.frameNumber !== lastProcessedFrame) {
    if (renderParams.enableSmoothing) {
      smoothedFrame = smoother.process(rawFrame);
    }
    lastRawFrame = rawFrame;
    lastProcessedFrame = rawFrame.frameNumber;
  }

  // Build contour list (smoothed or raw)
  const contoursToRender: Array<{
    id: number;
    points: Point[];
    parentIndex: number;
    opacity: number;
  }> = [];

  if (renderParams.enableSmoothing && smoothedFrame) {
    for (const c of smoothedFrame.contours) {
      contoursToRender.push({
        id: c.id,
        points: c.points,
        parentIndex: c.parentIndex,
        opacity: c.opacity,
      });
    }
  } else if (lastRawFrame) {
    for (const c of lastRawFrame.contours) {
      contoursToRender.push({
        id: -1, // no stable ID for raw contours
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
      if (contour.points.length < renderParams.minPoints) continue;
      if (contour.id >= 0) activeIds.add(contour.id);

      const scaled: Point[] = contour.points.map((p) => ({
        x: p.x * WIDTH,
        y: p.y * HEIGHT,
      }));

      // Skip small contours by bounding-box half-diagonal
      if (renderParams.enableMinRadius) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of scaled) {
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        }
        const radius = Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2) / 2;
        if (radius < renderParams.minRadius) continue;
      }

      const isOuter = contour.parentIndex === -1;
      const alpha = Math.round(contour.opacity * 255);

      if (renderParams.showDebugPath) {
        p5.strokeWeight(10)
        p5.stroke(
          isOuter ? 0 : 130,
          isOuter ? 160 : 0,
          isOuter ? 190 : 160,
          Math.round(alpha * 0.5),
        );
        drawPath(scaled);
        p5.noStroke();
      }

      p5.textSize(isOuter ? renderParams.outerSize : renderParams.innerSize);
      if (isOuter) {
        p5.fill(100, 200, 255, alpha);
      } else {
        p5.fill(200, 140, 255, alpha);
      }

      const txt = isOuter ? renderParams.outerText : renderParams.innerText;

      if (contour.id >= 0 && springParams.enabled) {
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
    p5.fill(100, 100, 120);
    p5.textSize(20);
    p5.textAlign("center", "center");
    p5.text(
      "Waiting for contour data on ws://127.0.0.1:9100...",
      WIDTH / 2,
      HEIGHT / 2,
    );
  }

  // Status
  p5.textSize(14);
  p5.fill(100, 100, 120);
  p5.textAlign("left", "bottom");
  p5.text(`${Math.round(fpsSmooth)} fps`, 20, HEIGHT - 12);
  if (smoothedFrame) {
    p5.textAlign("right", "bottom");
    const nVisible = smoothedFrame.contours.filter(
      (c) => c.opacity > 0.01,
    ).length;
    p5.text(
      `frame ${smoothedFrame.frameNumber} · ${nVisible} contours`,
      WIDTH - 20,
      HEIGHT - 12,
    );
  }

  return p5.endFrame();
}
