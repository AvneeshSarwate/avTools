/// <reference lib="dom" />

/**
 * Three.js WebGPU debug window + Syphon output.
 *
 * Run with (from apps/deno-notebooks):
 * deno run --unstable-webgpu --allow-all libraryIntegrationTetsts/three_test_syphon.ts --sync=none
 *
 * Sync modes:
 * --sync=none (default): publish immediately after render()
 * --sync=wait: await device.queue.onSubmittedWorkDone() before publish()
 * --flip-y / --no-flip-y: toggle Syphon vertical orientation metadata
 *
 * Render pacing:
 * The loop is paced by `present()` + event polling (no fixed sleep),
 * and animation uses elapsed wall time instead of frame count.
 *
 * Environment alternatives:
 * SYPHON_SYNC_MODE=wait
 * SYPHON_FLIP_Y=1
 *
 * Syphon bridge debug logging:
 * SYPHON_BRIDGE_DEBUG=1
 * SYPHON_BRIDGE_DEBUG_INTERVAL_MS=1000
 * Example:
 * SYPHON_BRIDGE_DEBUG=1 SYPHON_BRIDGE_DEBUG_INTERVAL_MS=500 deno run --unstable-webgpu --allow-all libraryIntegrationTetsts/three_test_syphon.ts --sync=none
 */

// Shim globals BEFORE any Three.js import.
// deno-lint-ignore no-explicit-any
const g = globalThis as any;
if (typeof g.requestAnimationFrame === "undefined") {
  g.requestAnimationFrame = (cb: (time: number) => void): number =>
    setTimeout(() => cb(performance.now()), 16) as unknown as number;
}
if (typeof g.cancelAnimationFrame === "undefined") {
  g.cancelAnimationFrame = (id: number): void => clearTimeout(id);
}
if (typeof g.document === "undefined") {
  g.document = {
    createElementNS(_ns: string, tag: string) {
      throw new Error(`Unexpected DOM element creation: ${tag}`);
    },
  };
}

import { requestWebGpuDevice } from "./raw-webgpu-helpers.ts";
import { createSyphonGpuWindow } from "../syphon/mod.ts";

const WIDTH = 512;
const HEIGHT = 512;
const SERVER_NAME = "ThreeSyphonDebug";
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
  return !!raw && raw !== "0" && raw !== "false" && raw !== "no" && raw !== "off";
}

const SYNC_MODE = getSyncMode();
const FLIP_Y = getFlipY();

const device = await requestWebGpuDevice();
let syncWaitTotalMs = 0;
let syncWaitSamples = 0;

async function maybeSyncWait() {
  if (SYNC_MODE !== "wait") return;
  const t0 = performance.now();
  await device.queue.onSubmittedWorkDone();
  syncWaitTotalMs += performance.now() - t0;
  syncWaitSamples++;
}

device.addEventListener("uncapturederror", (event: Event) => {
  // deno-lint-ignore no-explicit-any
  const gpuError = (event as any).error;
  if (gpuError) {
    console.error("GPU ERROR:", gpuError.constructor?.name, gpuError.message);
  }
});

const win = await createSyphonGpuWindow(device, {
  width: WIDTH,
  height: HEIGHT,
  title: "Three.js Debug + Syphon",
  syphon: {
    serverName: SERVER_NAME,
    flipY: FLIP_Y,
  },
});

console.log("Window created, format:", win.format);
console.log("Syphon server:", win.syphon.name);
console.log("Syphon sync mode:", SYNC_MODE);
console.log("Syphon flipY:", FLIP_Y);

const THREE = await import("npm:three");
const { WebGPURenderer } = await import("npm:three/webgpu");

class CanvasShim {
  width: number;
  height: number;
  style: { width: string; height: string };
  private _ctx: GPUCanvasContext;

  constructor(w: number, h: number, ctx: GPUCanvasContext) {
    this.width = w;
    this.height = h;
    this._ctx = ctx;
    this.style = { width: `${w}px`, height: `${h}px` };
  }
  getContext(type: string) {
    if (type === "webgpu") return this._ctx;
    throw new Error(`Unsupported context: ${type}`);
  }
  setAttribute() {}
  addEventListener() {}
  removeEventListener() {}
}

let renderWidth = win.width;
let renderHeight = win.height;

const canvas = new CanvasShim(renderWidth, renderHeight, win.ctx);

console.log("Creating WebGPURenderer (antialias: false, alpha: false)...");
// deno-lint-ignore no-explicit-any
const renderer = new WebGPURenderer({
  canvas: canvas as any,
  device,
  antialias: false,
  alpha: false,
});

console.log("Calling renderer.init()...");
await renderer.init();
console.log("Renderer initialized");

renderer.setPixelRatio(1);
renderer.setSize(renderWidth, renderHeight, false);
console.log("Renderer size set");

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, renderWidth / renderHeight, 0.1, 100);
camera.position.z = 3;

const geometry = new THREE.BoxGeometry(1, 1, 1);
const material = new THREE.MeshStandardMaterial({ color: 0x44aaff });
const cube = new THREE.Mesh(geometry, material);
scene.add(cube);

const light = new THREE.DirectionalLight(0xffffff, 1.5);
light.position.set(2, 3, 4);
scene.add(light);
scene.add(new THREE.AmbientLight(0xffffff, 0.3));

console.log("Scene created, rendering first frame...");

device.pushErrorScope("validation");
renderer.render(scene, camera);
const firstErr = await device.popErrorScope();
if (firstErr) {
  console.error("FIRST FRAME VALIDATION ERROR:", firstErr.message);
} else {
  console.log("First frame rendered without validation errors");
}

await maybeSyncWait();
const firstPublished = win.syphon.publishFrame();
console.log("First Syphon publish frame id:", firstPublished.toString());

try {
  win.present();
  console.log("First frame presented successfully");
} catch (e) {
  console.error("Present error:", e);
}

let running = true;
let frame = 0;
const AUTOCLOSE = false;
const fpsStartMs = performance.now();
const animStartMs = fpsStartMs;

while (running && (!AUTOCLOSE || frame < 300)) {
  const events = win.pollEvents();
  for (const ev of events) {
    if (ev.type === "close") running = false;
    if (ev.type === "resize") {
      renderWidth = ev.width;
      renderHeight = ev.height;
      canvas.width = renderWidth;
      canvas.height = renderHeight;
      canvas.style.width = `${renderWidth}px`;
      canvas.style.height = `${renderHeight}px`;
      renderer.setSize(renderWidth, renderHeight, false);
      camera.aspect = renderWidth / renderHeight;
      camera.updateProjectionMatrix();
    }
  }
  if (!running || win.closed) break;

  const t = (performance.now() - animStartMs) / 1000;
  cube.rotation.x = t * 1.2;
  cube.rotation.y = t * 0.84;

  renderer.render(scene, camera);
  await maybeSyncWait();
  win.syphon.publishFrame();

  try {
    win.present();
  } catch (e) {
    console.error("Present error at frame", frame, ":", e);
    break;
  }

  if (frame % 120 === 0) {
    console.log(
      `[syphon] frame=${frame} hasClients=${win.syphon.hasClients} intercepts=${win.syphon.interceptCount.toString()}`,
    );
  }

  frame++;
  if (frame % 10 === 0) {
    const elapsedSec = (performance.now() - fpsStartMs) / 1000;
    const avgFps = elapsedSec > 0 ? frame / elapsedSec : 0;
    const syncWaitAvgMs = syncWaitSamples > 0 ? syncWaitTotalMs / syncWaitSamples : 0;
    const syncWaitText = SYNC_MODE === "wait" ? syncWaitAvgMs.toFixed(3) : "n/a";
    console.log(
      `[fps] frame=${frame} avg=${avgFps.toFixed(1)} sync=${SYNC_MODE} wait_avg_ms=${syncWaitText}`,
    );
  }
}

console.log(`Rendered ${frame} frames, closing`);
renderer.dispose();
win.close();
device.destroy();
