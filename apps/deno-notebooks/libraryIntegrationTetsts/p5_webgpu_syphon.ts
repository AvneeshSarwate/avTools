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

function drawAnimatedScene(api: P5GPU, tSec: number) {
  const w = api.width;
  const h = api.height;
  const cx = w * 0.5;
  const cy = h * 0.5;

  api.clear();

  api.noStroke();
  api.fill(18, 24, 36, 180);
  api.circle(cx, cy, Math.min(w, h) * 0.9);

  api.noFill();
  api.strokeWeight(8);
  api.stroke(72, 132, 255, 230);
  api.curveTightness(0.0);
  api.curve(
    40,
    cy + Math.sin(tSec * 1.1) * 120,
    w * 0.15,
    h * 0.25 + Math.sin(tSec * 0.8) * 70,
    w * 0.42,
    h * 0.75 + Math.cos(tSec * 1.3) * 80,
    w * 0.82,
    h * 0.2 + Math.sin(tSec * 1.7) * 65,
  );
  api.curve(
    w * 0.15,
    h * 0.25 + Math.sin(tSec * 0.8) * 70,
    w * 0.42,
    h * 0.75 + Math.cos(tSec * 1.3) * 80,
    w * 0.82,
    h * 0.2 + Math.sin(tSec * 1.7) * 65,
    w - 40,
    h * 0.55 + Math.cos(tSec * 1.2) * 90,
  );

  api.strokeWeight(6);
  api.stroke(255, 100, 130, 220);
  api.bezier(
    60,
    h * 0.78,
    w * 0.20,
    h * 0.18 + Math.cos(tSec * 0.7) * 40,
    w * 0.72,
    h * 0.86 + Math.sin(tSec * 0.9) * 40,
    w - 60,
    h * 0.24,
  );

  api.stroke(164, 96, 245, 210);
  api.strokeWeight(5);
  api.curveTightness(-0.5);
  api.beginShape();
  api.curveVertex(40, h * 0.16);
  api.curveVertex(40, h * 0.16);
  api.curveVertex(w * 0.18, h * 0.14 + Math.sin(tSec * 0.9) * 25);
  api.curveVertex(w * 0.34, h * 0.20 + Math.cos(tSec * 1.2) * 20);
  api.curveVertex(w * 0.52, h * 0.12 + Math.sin(tSec * 1.5) * 24);
  api.curveVertex(w * 0.72, h * 0.18 + Math.cos(tSec * 0.8) * 26);
  api.curveVertex(w * 0.90, h * 0.14 + Math.sin(tSec * 1.1) * 20);
  api.curveVertex(w * 0.90, h * 0.14 + Math.sin(tSec * 1.1) * 20);
  api.endShape();

  api.noStroke();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + tSec * 0.7;
    const r = 90 + Math.sin(tSec * 1.2 + i * 0.8) * 36;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a * 1.3 + tSec * 0.6) * r * 0.55;
    const d = 14 + Math.sin(tSec * 2.0 + i) * 6;
    api.fill(80 + i * 12, 180 - i * 8, 255 - i * 10, 170);
    api.circle(x, y, d);
  }

  api.fill(255, 255, 255, 180);
  api.circle(
    cx + Math.cos(tSec * 1.8) * 140,
    cy + Math.sin(tSec * 1.3) * 90,
    22,
  );
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
  p5.beginFrame();
  drawAnimatedScene(p5, tSec);
  const frameTexture = p5.endFrame();
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

  if (frame % 120 === 0) {
    console.log(
      `[syphon] frame=${frame} hasClients=${syphonWin.syphon.hasClients} intercepts=${syphonWin.syphon.interceptCount.toString()}`,
    );
  }

  if (frame % 60 === 0 && frame > 0) {
    const elapsedSec = (performance.now() - startMs) / 1000;
    const avgFps = elapsedSec > 0 ? frame / elapsedSec : 0;
    const syncWaitAvgMs = syncWaitSamples > 0 ? syncWaitTotalMs / syncWaitSamples : 0;
    const syncWaitText = SYNC_MODE === "wait" ? syncWaitAvgMs.toFixed(3) : "n/a";
    console.log(`[fps] frame=${frame} avg=${avgFps.toFixed(1)} sync=${SYNC_MODE} wait_avg_ms=${syncWaitText}`);
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
