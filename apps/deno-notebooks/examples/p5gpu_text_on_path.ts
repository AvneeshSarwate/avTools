/// <reference lib="dom" />

// Text-on-path demo with multiple test cases including fill modes.
//
// Run from apps/deno-notebooks:
//   deno run --unstable-webgpu --unstable-ffi --allow-all \
//     examples/p5gpu_text_on_path.ts

import { P5GPU } from "../tools/p5gpu.ts";
import {
  createWindowRenderManager,
  requestWebGpuDevice,
} from "../window/mod.ts";
import {
  textOnPath,
  circlePath,
  sinePath,
  catmullRomPath,
  linePath,
  type Point,
} from "../tools/text_on_path.ts";

const WIDTH = 1280;
const HEIGHT = 720;

const device = await requestWebGpuDevice();
const renderWindow = await createWindowRenderManager({
  device,
  width: WIDTH,
  height: HEIGHT,
  title: "Text on Path",
});
const p5 = new P5GPU(device, { width: WIDTH, height: HEIGHT });

// ── Helper: draw a path as a thin line for debugging ──────────────

function drawPath(pts: Point[]) {
  for (let i = 0; i < pts.length - 1; i++) {
    p5.line(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
  }
}

// ── Pre-build static paths ────────────────────────────────────────

const straightPath = linePath(50, 60, 600, 60);

const clipCircle = circlePath(170, 270, 120);
const wrapCircle = circlePath(170, 540, 120);

const wrapWave = sinePath(420, 180, 800, 60, 1.5);

const splineControlBase: Point[] = [
  { x: 420, y: 460 },
  { x: 580, y: 380 },
  { x: 760, y: 510 },
  { x: 940, y: 400 },
  { x: 1120, y: 490 },
];

// ── FPS tracking ──────────────────────────────────────────────────

let lastFrameTime = performance.now();
let fpsSmooth = 60;

// ── Render loop ───────────────────────────────────────────────────

await renderWindow.run(renderFrame, { cleanup: () => p5.dispose() });

function renderFrame() {
  const now = performance.now();
  const fps = 1000 / (now - lastFrameTime);
  fpsSmooth += (fps - fpsSmooth) * 0.1;
  lastFrameTime = now;

  const t = now * 0.001;

  p5.beginFrame();
  p5.background(15, 18, 26);
  p5.noStroke();
  p5.textFont("Inter Variable");

  // ── 1. Straight line (no fill) ────────────────────────────────
  p5.textSize(26);
  p5.stroke(50, 50, 50);
  drawPath(straightPath);
  p5.noStroke();

  p5.fill(255, 220, 100);
  textOnPath(p5, "Hello World on a straight path", straightPath);

  // ── 2. Circle — fill "clip" + scroll ──────────────────────────
  p5.textSize(20);
  p5.stroke(40, 60, 90);
  drawPath(clipCircle);
  p5.noStroke();

  // Label
  p5.fill(80, 80, 100);
  p5.textAlign("left", "top");
  p5.text('fill: "clip"', 300, 180);

  p5.fill(100, 200, 255);
  textOnPath(p5, "CLIP MODE", clipCircle, {
    fill: "clip",
    offset: t * 60,
  });

  // ── 3. Circle — fill "wrap" + scroll ──────────────────────────
  p5.stroke(50, 40, 70);
  drawPath(wrapCircle);
  p5.noStroke();

  // Label
  p5.fill(80, 80, 100);
  p5.textAlign("left", "top");
  p5.text('fill: "wrap"', 300, 450);

  p5.fill(200, 140, 255);
  textOnPath(p5, "WRAP MODE", wrapCircle, {
    fill: "wrap",
    offset: t * 60,
  });

  // ── 4. Sine wave — fill "wrap" + scroll ───────────────────────
  p5.textSize(22);
  p5.stroke(40, 70, 40);
  drawPath(wrapWave);
  p5.noStroke();

  p5.fill(150, 255, 150);
  textOnPath(p5, "wave", wrapWave, {
    fill: "wrap",
    offset: t * 100,
    letterSpacing: 2,
  });

  // ── 5. Wobbling Catmull-Rom spline (no fill) ──────────────────
  const wobbled = splineControlBase.map((cp, i) => ({
    x: cp.x + Math.sin(t * 1.3 + i * 1.7) * 25,
    y: cp.y + Math.cos(t * 1.1 + i * 2.3) * 20,
  }));
  const spline = catmullRomPath(wobbled);

  p5.textSize(20);
  p5.stroke(70, 35, 55);
  drawPath(spline);
  p5.noStroke();

  p5.fill(255, 100, 150, 120);
  for (const cp of wobbled) p5.circle(cp.x, cp.y, 6);

  p5.fill(255, 150, 200);
  textOnPath(p5, "Curving through space on a Catmull-Rom spline", spline);

  // ── 6. FPS + labels ───────────────────────────────────────────
  p5.textSize(14);
  p5.fill(100, 100, 120);
  p5.textAlign("left", "bottom");
  p5.text(`${Math.round(fpsSmooth)} fps`, 20, HEIGHT - 12);
  p5.textAlign("right", "bottom");
  p5.text("text_on_path.ts demo", WIDTH - 20, HEIGHT - 12);

  return p5.endFrame();
}
