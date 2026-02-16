/// <reference lib="dom" />

/**
 * P5GPU WebGPU window with Syphon output (single native window).
 *
 * Run with (from apps/deno-notebooks):
 * deno run --unstable-webgpu --allow-all libraryIntegrationTetsts/p5_webgpu_syphon.ts --sync=none
 *
 * Sync modes:
 * --sync=none (default): publish immediately after render/blit
 * --sync=wait: await device.queue.onSubmittedWorkDone() before publish
 *
 * Orientation:
 * --flip-y / --no-flip-y
 * SYPHON_FLIP_Y=1 (default is flipped)
 *
 * Background:
 * The rendered frame starts fully transparent (`api.clear()`), so Syphon can
 * publish alpha from source content. The window surface itself is configured
 * in `opaque` mode for backend compatibility.
 */

import { requestWebGpuDevice } from "./raw-webgpu-helpers.ts";
import { P5GPU } from "../tools/p5gpu.ts";
import { createBlitPipeline, blit } from "../window/mod.ts";
import { createSyphonGpuWindow } from "../syphon/mod.ts";

const WIDTH = 960;
const HEIGHT = 640;
const SERVER_NAME = "P5WebGpuSyphon";

type SyncMode = "none" | "wait";

function getSyncMode(): SyncMode {
  const arg = Deno.args.find((a) => a.startsWith("--sync="));
  const fromArg = arg ? arg.slice("--sync=".length) : "";
  const raw = (fromArg || Deno.env.get("SYPHON_SYNC_MODE") || "none").toLowerCase();
  if (raw === "wait") return "wait";
  return "none";
}

function getFlipY(): boolean {
  let fromArgs: boolean | undefined;
  for (const arg of Deno.args) {
    if (arg === "--flip-y") fromArgs = true;
    if (arg === "--no-flip-y") fromArgs = false;
  }
  if (fromArgs !== undefined) {
    return fromArgs;
  }
  const raw = (Deno.env.get("SYPHON_FLIP_Y") || "").trim().toLowerCase();
  if (!raw) return true;
  return raw !== "0" && raw !== "false" && raw !== "no" && raw !== "off";
}

function configureSurface(
  device: GPUDevice,
  ctx: GPUCanvasContext,
  fallbackFormat: GPUTextureFormat,
): { format: GPUTextureFormat; alphaMode: string } {
  const alphaCandidates = [
    { raw: "opaque", typed: "opaque" as GPUCanvasAlphaMode },
  ];
  const formatCandidates: GPUTextureFormat[] = [fallbackFormat];

  let lastErr: unknown = null;
  for (const format of formatCandidates) {
    for (const alpha of alphaCandidates) {
      try {
        ctx.configure({
          device,
          format,
          usage: GPUTextureUsage.RENDER_ATTACHMENT,
          alphaMode: alpha.typed,
        });
        return { format, alphaMode: alpha.raw };
      } catch (err) {
        lastErr = err;
      }
    }
  }

  throw lastErr ?? new Error("Failed to configure surface");
}

const SYNC_MODE = getSyncMode();
const FLIP_Y = getFlipY();

const device = await requestWebGpuDevice();

const syphonWin = await createSyphonGpuWindow(device, {
  width: WIDTH,
  height: HEIGHT,
  title: "P5 WebGPU + Syphon",
  syphon: {
    serverName: SERVER_NAME,
    flipY: FLIP_Y,
  },
});

const syphonConfigured = configureSurface(device, syphonWin.ctx, syphonWin.format);

const syphonBlit = createBlitPipeline(device, syphonConfigured.format);

const p5 = new P5GPU(device, {
  width: WIDTH,
  height: HEIGHT,
  format: "rgba8unorm",
  sampleCount: 4,
});

console.log("Syphon window format:", syphonWin.format, "configured:", syphonConfigured.format, "alpha:", syphonConfigured.alphaMode);
console.log("Syphon server:", syphonWin.syphon.name);
console.log("Syphon sync mode:", SYNC_MODE);
console.log("Syphon flipY:", FLIP_Y);

let syncWaitTotalMs = 0;
let syncWaitSamples = 0;
async function maybeSyncWait() {
  if (SYNC_MODE !== "wait") return;
  const t0 = performance.now();
  await device.queue.onSubmittedWorkDone();
  syncWaitTotalMs += performance.now() - t0;
  syncWaitSamples += 1;
}

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

  // api.fill(255, 255, 255, 180);
  // api.circle(
  //   cx + Math.cos(tSec * 1.8) * 140,
  //   cy + Math.sin(tSec * 1.3) * 90,
  //   22,
  // );
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
  const syphonEvents = syphonWin.pollEvents();

  for (const ev of syphonEvents) {
    if (ev.type === "close") running = false;
  }

  if (!running || syphonWin.closed) break;

  const tSec = (performance.now() - startMs) / 1000;
  const drawStart = performance.now();
  p5.beginFrame();
  drawAnimatedScene(p5, tSec);
  const frameTexture = p5.endFrame();
  pushSample(drawTimes, performance.now() - drawStart);
  const srcView = frameTexture.createView();

  const encoder = device.createCommandEncoder();
  blit(device, encoder, syphonBlit, srcView, syphonWin.ctx.getCurrentTexture().createView());
  device.queue.submit([encoder.finish()]);

  await maybeSyncWait();
  syphonWin.syphon.publishFrame();

  try {
    syphonWin.present();
  } catch (err) {
    console.error("Present error:", err);
    break;
  }

  if (frame % 120 === 0 && false) {
    console.log(
      `[syphon] frame=${frame} hasClients=${syphonWin.syphon.hasClients} intercepts=${syphonWin.syphon.interceptCount.toString()}`,
    );
  }

  if (frame % 60 === 0 && frame > 0) {
    const elapsedSec = (performance.now() - startMs) / 1000;
    const avgFps = elapsedSec > 0 ? frame / elapsedSec : 0;
    const syncWaitAvgMs = syncWaitSamples > 0 ? syncWaitTotalMs / syncWaitSamples : 0;
    const syncWaitText = SYNC_MODE === "wait" ? syncWaitAvgMs.toFixed(3) : "n/a";
    console.log(`[fps] frame=${frame} avg=${avgFps.toFixed(1)} avgDrawMs(${LOG_EVERY})=${avg(drawTimes).toFixed(2)} sync=${SYNC_MODE} wait_avg_ms=${syncWaitText}`);
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
  syphonWin.close();
} catch {
  // best-effort
}

try {
  device.destroy();
} catch {
  // best-effort
}
