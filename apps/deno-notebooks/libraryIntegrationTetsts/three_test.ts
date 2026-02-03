/// <reference lib="dom" />

/**
 * Three.js WebGPU spinning cube test on Deno with a native window.
 *
 * Run with (from apps/deno-notebooks):
 *   deno run --unstable-webgpu --unstable-ffi --allow-ffi --allow-read --allow-env --allow-net --allow-write libraryIntegrationTetsts/three_test.ts
 */

import { requestWebGpuDevice } from "./raw-webgpu-helpers.ts";
import { createGpuWindow } from "../window/mod.ts";
import { createDenoThreeRenderer } from "../tools/three_deno_shim.ts";

const WIDTH = 512;
const HEIGHT = 512;

const device = await requestWebGpuDevice();

// Replace default error handler with one that shows actual error messages
device.removeEventListener("uncapturederror", () => {});
device.addEventListener("uncapturederror", (event: Event) => {
  const gpuError = (event as Record<string, unknown>).error as { message?: string; constructor?: { name?: string } } | undefined;
  if (gpuError) {
    console.error("GPU ERROR:", gpuError.constructor?.name, gpuError.message);
  } else {
    console.error("GPU ERROR (no .error field):", event);
  }
});

const win = await createGpuWindow(device, {
  width: WIDTH,
  height: HEIGHT,
  title: "Three.js Deno WebGPU",
});

let renderWidth = win.width;
let renderHeight = win.height;

const { renderer, THREE } = await createDenoThreeRenderer(
  device,
  renderWidth,
  renderHeight,
  win.ctx,
);

// Flush the surface texture that init may have acquired
try { win.present(); } catch { /* ok if nothing was acquired */ }

// Scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x222233);

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

// Render loop
let running = true;
let frame = 0;

while (running) {
  const events = win.pollEvents();
  for (const event of events) {
    if (event.type === "close") {
      running = false;
    } else if (event.type === "resize") {
      renderWidth = event.width;
      renderHeight = event.height;
      renderer.setSize(renderWidth, renderHeight, false);
      camera.aspect = renderWidth / renderHeight;
      camera.updateProjectionMatrix();
    }
  }
  if (!running || win.closed) break;

  const t = frame * 0.02;
  cube.rotation.x = t;
  cube.rotation.y = t * 0.7;

  renderer.render(scene, camera);
  win.present();

  frame += 1;
  await new Promise((resolve) => setTimeout(resolve, 0));
}

console.log(`Rendered ${frame} frames`);
renderer.dispose();
win.close();
device.destroy();
