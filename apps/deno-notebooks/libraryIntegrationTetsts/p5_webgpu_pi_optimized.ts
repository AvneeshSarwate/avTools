/// <reference lib="dom" />

/**
 * P5GPU RPi-optimized windowed benchmark (no Syphon, no MSAA).
 *
 * Run with (from apps/deno-notebooks):
 * deno run --unstable-webgpu --unstable-ffi --allow-ffi \
 *   --allow-read --allow-env --allow-net --allow-write \
 *   libraryIntegrationTetsts/p5_webgpu_pi_optimized.ts
 *
 * This version is tuned for Raspberry Pi and other constrained GPUs:
 * - sampleCount: 1 (MSAA disabled)
 * - optimizedMode: true (reduced tessellation for circles, caps, joins, rounded rects)
 * - Plain GPU window (no Syphon overhead)
 */

import { requestWebGpuDevice } from "./raw-webgpu-helpers.ts";
import { P5GPU } from "../tools/p5gpu.ts";
import { createBlitPipeline, createGpuWindow, blit } from "../window/mod.ts";

const WIDTH = 960;
const HEIGHT = 640;

const device = await requestWebGpuDevice();

const win = await createGpuWindow(device, {
  width: WIDTH,
  height: HEIGHT,
  title: "P5 WebGPU RPi Optimized",
});

const blitPipeline = createBlitPipeline(device, win.format);

const p5 = new P5GPU(device, {
  width: WIDTH,
  height: HEIGHT,
  format: "rgba8unorm",
  // sampleCount: 1,
  optimizedMode: true,
});

console.log("Window format:", win.format);
console.log("optimizedMode:", p5.optimizedMode);

function mod2(n: number, m: number) {
  return ((n % m) + m) % m;
}

// ─── Curve stress test config ────────────────────────────────────────────
const CURVE_COUNT = 100;
const CURVE_POINTS = 48; // points per curve (tune this to benchmark)

function drawAnimatedScene(api: P5GPU, tSec: number) {
  const w = api.width;
  const h = api.height;
  const cx = w * 0.5;
  const cy = h * 0.5;

  api.clear();

  // ── Curves first (behind circles) ──────────────────────────────────────
  api.noFill();
  api.curveTightness(0.0);

  for (let c = 0; c < CURVE_COUNT; c++) {
    const t = c / CURVE_COUNT;
    const baseY = t * h;
    const freq = 1.5 + c * 0.07;
    const phase = c * 0.4 + tSec * (0.5 + t * 1.5);
    const amp = 20 + Math.sin(c * 0.3) * 15;

    const r = mod2(60 + c * 7, 255);
    const g = mod2(140 + c * 3, 255);
    const b = mod2(220 - c * 5, 255);
    api.stroke(r, g, b, 180);
    api.strokeWeight(1.5 + Math.sin(c * 0.5) * 1);

    api.beginShape();
    for (let p = 0; p < CURVE_POINTS; p++) {
      const px = (p / (CURVE_POINTS - 1)) * w;
      const py = baseY + Math.sin(px * freq / w * Math.PI * 2 + phase) * amp;
      api.curveVertex(px, py);
      // duplicate first and last for Catmull-Rom end conditions
      if (p === 0 || p === CURVE_POINTS - 1) api.curveVertex(px, py);
    }
    api.endShape();
  }

  // ── Circles on top ─────────────────────────────────────────────────────
  api.strokeWeight(1);
  api.stroke(255);
  const circT = tSec * 0.2;
  for (let i = 0; i < 120; i++) {
    const a = (i / 12) * Math.PI * 2 + circT * 0.7;
    const r = (90 + Math.sin(circT * 1.2 + i * 0.8) * 36) * 3;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a * 1.3 + circT * 0.6) * r * 0.55;
    const d = 14 + Math.sin(circT * 2.0 + i) * 6 * 5;
    const red = mod2(80 + i * 12, 255);
    const green = mod2(180 - i * 8, 255);
    const blue = mod2(55 - i * 10, 255);
    api.fill(red, green, blue, 170);
    api.circle(x, y, d);
  }
}

const LOG_EVERY = 60;
const drawTimes: number[] = [];

function pushSample(arr: number[], v: number, maxSamples = LOG_EVERY): void {
  arr.push(v);
  if (arr.length > maxSamples) arr.shift();
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (const v of arr) sum += v;
  return sum / arr.length;
}

let running = true;
let frame = 0;
const startMs = performance.now();

while (running) {
  const events = win.pollEvents();

  for (const ev of events) {
    if (ev.type === "close") running = false;
  }

  if (!running || win.closed) break;

  const tSec = (performance.now() - startMs) / 1000;
  const drawStart = performance.now();
  p5.beginFrame();
  drawAnimatedScene(p5, tSec);
  const frameTexture = p5.endFrame();
  pushSample(drawTimes, performance.now() - drawStart);

  // Blit P5GPU output texture to window surface
  try {
    const swapTexture = win.ctx.getCurrentTexture();
    const encoder = device.createCommandEncoder();
    blit(device, encoder, blitPipeline, frameTexture.createView(), swapTexture.createView());
    device.queue.submit([encoder.finish()]);
    win.present();
  } catch (err) {
    console.error("Present error:", err);
    break;
  }

  if (frame % 60 === 0 && frame > 0) {
    const elapsedSec = (performance.now() - startMs) / 1000;
    const avgFps = elapsedSec > 0 ? frame / elapsedSec : 0;
    console.log(`[fps] frame=${frame} avg=${avgFps.toFixed(1)} avgDrawMs(${LOG_EVERY})=${avg(drawTimes).toFixed(2)}`);
  }

  frame += 1;
  await new Promise((resolve) => setTimeout(resolve, 0));
}

console.log(`Rendered ${frame} frames, closing...`);

try {
  p5.dispose();
} catch {
  // best-effort
}

try {
  win.close();
} catch {
  // best-effort
}

try {
  device.destroy();
} catch {
  // best-effort
}
