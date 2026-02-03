/// <reference lib="dom" />

/**
 * Headless Three.js WebGPU test -- renders a cube to an offscreen texture,
 * reads it back, and writes a PNG. No window required.
 *
 * Run with (from apps/deno-notebooks):
 *   deno run --unstable-webgpu --allow-read --allow-env --allow-net --allow-write libraryIntegrationTetsts/three_test_headless.ts
 */

import { requestWebGpuDevice, writeTextureToPng } from "./raw-webgpu-helpers.ts";
import { createDenoThreeRenderer } from "../tools/three_deno_shim.ts";

const WIDTH = 256;
const HEIGHT = 256;

console.log("=== Three.js Headless WebGPU Test ===");

// 1. Get GPU device (no window)
const device = await requestWebGpuDevice();
console.log("Device ready");

// 2. Create headless renderer (no gpuCanvasContext argument → headless mode)
const { renderer, THREE, outputTexture } = await createDenoThreeRenderer(
  device,
  WIDTH,
  HEIGHT,
);
console.log("Renderer initialized, output texture format:", outputTexture.format);

// 3. Build scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x222233);

const camera = new THREE.PerspectiveCamera(70, WIDTH / HEIGHT, 0.1, 100);
camera.position.z = 3;

const geometry = new THREE.BoxGeometry(1, 1, 1);
const material = new THREE.MeshStandardMaterial({ color: 0x44aaff });
const cube = new THREE.Mesh(geometry, material);
cube.rotation.x = 0.5;
cube.rotation.y = 0.7;
scene.add(cube);

const light = new THREE.DirectionalLight(0xffffff, 2);
light.position.set(2, 3, 4);
scene.add(light);
scene.add(new THREE.AmbientLight(0xffffff, 0.4));

console.log("Scene built, rendering...");

// 4. Render with validation error scope
device.pushErrorScope("validation");
renderer.render(scene, camera);
const validationErr = await device.popErrorScope();
if (validationErr) {
  console.error("VALIDATION ERROR:", validationErr.message);
} else {
  console.log("Render completed without validation errors");
}

// 5. Read back the output texture and write PNG
const outPath = ".output/three-headless-cube.png";
await writeTextureToPng(device, outputTexture, WIDTH, HEIGHT, outputTexture.format, outPath);
console.log(`Wrote ${outPath}`);
console.log("=== Done ===");

renderer.dispose();
device.destroy();
