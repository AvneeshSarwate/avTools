/// <reference lib="dom" />

// Shim globals BEFORE any Three.js import
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
import { createGpuWindow } from "./window/mod.ts";

const WIDTH = 512;
const HEIGHT = 512;

const device = await requestWebGpuDevice();

// Replace the default error handler with one that shows the actual error message
device.addEventListener("uncapturederror", (event: Event) => {
  // deno-lint-ignore no-explicit-any
  const gpuError = (event as any).error;
  if (gpuError) {
    console.error("GPU ERROR:", gpuError.constructor?.name, gpuError.message);
  }
});

const win = await createGpuWindow(device, {
  width: WIDTH,
  height: HEIGHT,
  title: "Three.js Debug",
});

console.log("Window created, format:", win.format);

// Import Three.js
const THREE = await import("npm:three");
const { WebGPURenderer } = await import("npm:three/webgpu");

// Canvas shim
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
const renderer = new WebGPURenderer({ canvas: canvas as any, device, antialias: false, alpha: false });

console.log("Calling renderer.init()...");
await renderer.init();
console.log("Renderer initialized");

renderer.setPixelRatio(1);
renderer.setSize(renderWidth, renderHeight, false);
console.log("Renderer size set");

// Scene
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

// First frame with error scope
device.pushErrorScope("validation");
renderer.render(scene, camera);
const firstErr = await device.popErrorScope();
if (firstErr) {
  console.error("FIRST FRAME VALIDATION ERROR:", firstErr.message);
} else {
  console.log("First frame rendered without validation errors");
}

try {
  win.present();
  console.log("First frame presented successfully");
} catch (e) {
  console.error("Present error:", e);
}

// More frames
let running = true;
let frame = 0;
while (running && frame < 300) {
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

  cube.rotation.x = frame * 0.02;
  cube.rotation.y = frame * 0.014;

  renderer.render(scene, camera);
  try {
    win.present();
  } catch (e) {
    console.error("Present error at frame", frame, ":", e);
    break;
  }

  frame++;
  await new Promise((r) => setTimeout(r, 16));
}

console.log(`Rendered ${frame} frames, closing`);
renderer.dispose();
win.close();
device.destroy();
