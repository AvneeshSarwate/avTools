/// <reference lib="dom" />

// Text-on-path demo with multiple test cases.
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

const straightPath = linePath(50, 80, 580, 80);

const circle1 = circlePath(200, 380, 130);

const wave = sinePath(520, 200, 700, 70, 1.5);

const splineControlBase: Point[] = [
  { x: 520, y: 480 },
  { x: 680, y: 400 },
  { x: 860, y: 530 },
  { x: 1020, y: 430 },
  { x: 1180, y: 510 },
];

const animCircle = circlePath(200, 620, 70);

// ── FPS tracking ──────────────────────────────────────────────────

let lastFrameTime = performance.now();
let fps = 0;
let fpsSmooth = 60;

// ── Render loop ───────────────────────────────────────────────────

await renderWindow.run(renderFrame, { cleanup: () => p5.dispose() });

function renderFrame() {
  const now = performance.now();
  fps = 1000 / (now - lastFrameTime);
  fpsSmooth += (fps - fpsSmooth) * 0.1;
  lastFrameTime = now;

  const t = now * 0.001;

  p5.beginFrame();
  p5.background(15, 18, 26);
  p5.noStroke();

  // ── 1. Straight line ──────────────────────────────────────────
  p5.textFont("Inter Variable");
  p5.textSize(28);
  p5.fill(60, 60, 60);
  p5.stroke(60, 60, 60);
  drawPath(straightPath);
  p5.noStroke();

  p5.fill(255, 220, 100);
  textOnPath(p5, "Hello World on a straight path", straightPath);

  // ── 2. Circle (full winding — letters rotate with tangent) ────
  p5.textSize(22);
  p5.stroke(40, 70, 100);
  drawPath(circle1);
  p5.noStroke();

  p5.fill(100, 200, 255);
  textOnPath(
    p5,
    "The quick brown fox jumps over the lazy dog wrapping around",
    circle1,
    { align: "left" },
  );

  // ── 3. Sine wave ──────────────────────────────────────────────
  p5.textSize(24);
  p5.stroke(40, 80, 40);
  drawPath(wave);
  p5.noStroke();

  p5.fill(150, 255, 150);
  textOnPath(
    p5,
    "Flowing smoothly along a gentle sine wave path",
    wave,
    { align: "center" },
  );

  // ── 4. Catmull-Rom spline (wobbling) ─────────────────────────
  const wobbledControl = splineControlBase.map((cp, i) => ({
    x: cp.x + Math.sin(t * 1.3 + i * 1.7) * 25,
    y: cp.y + Math.cos(t * 1.1 + i * 2.3) * 20,
  }));
  const spline = catmullRomPath(wobbledControl);

  p5.textSize(22);
  p5.stroke(80, 40, 60);
  drawPath(spline);
  p5.noStroke();

  // Draw control points as small dots
  p5.fill(255, 100, 150, 120);
  for (const cp of wobbledControl) {
    p5.circle(cp.x, cp.y, 6);
  }

  p5.fill(255, 150, 200);
  textOnPath(p5, "Curving through space on a Catmull-Rom spline", spline);

  // ── 5. Animated scrolling text on a circle ────────────────────
  p5.textSize(18);
  p5.stroke(60, 50, 30);
  drawPath(animCircle);
  p5.noStroke();

  p5.fill(255, 180, 80);
  const scrollOffset = (t * 80) % (2 * Math.PI * 70);
  textOnPath(p5, "Spinning around and around!", animCircle, {
    offset: scrollOffset,
  });

  // ── 6. FPS + title ───────────────────────────────────────────
  p5.textSize(14);
  p5.fill(100, 100, 120);
  p5.textAlign("left", "bottom");
  p5.text(`${Math.round(fpsSmooth)} fps`, 20, HEIGHT - 12);
  p5.textAlign("right", "bottom");
  p5.text("text_on_path.ts demo", WIDTH - 20, HEIGHT - 12);

  return p5.endFrame();
}
