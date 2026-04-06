/// <reference lib="dom" />

/**
 * Babylon.js WebGPU spinning cube test on Deno with a native window.
 *
 * Run with (from apps/deno-notebooks):
 *   deno run --unstable-webgpu --unstable-ffi --allow-ffi --allow-read --allow-env --allow-net --allow-write libraryIntegrationTetsts/babylon_test.ts
 */

import { requestWebGpuDevice } from "./raw-webgpu-helpers.ts";
import { createGpuWindow } from "../window/mod.ts";
import { createDenoBabylonEngine } from "../tools/babylon_deno_shim.ts";

const WIDTH = 512;
const HEIGHT = 512;

const device = await requestWebGpuDevice();

device.removeEventListener("uncapturederror", () => {});
device.addEventListener("uncapturederror", (event: Event) => {
  const gpuError = (event as Record<string, unknown>).error as
    | { message?: string; constructor?: { name?: string } }
    | undefined;
  if (gpuError) {
    console.error("GPU ERROR:", gpuError.constructor?.name, gpuError.message);
  } else {
    console.error("GPU ERROR (no .error field):", event);
  }
});

const win = await createGpuWindow(device, {
  width: WIDTH,
  height: HEIGHT,
  title: "Babylon.js Deno WebGPU",
});

let renderWidth = win.width;
let renderHeight = win.height;

const { BABYLON, engine, canvas } = await createDenoBabylonEngine(
  device,
  renderWidth,
  renderHeight,
  win.ctx,
  win.format,
);

// Flush any surface texture acquired during init.
try { win.present(); } catch { /* ok */ }

// Scene
const scene = new BABYLON.Scene(engine);
scene.clearColor = new BABYLON.Color4(0.13, 0.13, 0.2, 1);

const camera = new BABYLON.FreeCamera(
  "camera",
  new BABYLON.Vector3(0, 0, -3),
  scene,
);
camera.setTarget(BABYLON.Vector3.Zero());

const light = new BABYLON.HemisphericLight(
  "light",
  new BABYLON.Vector3(0, 1, 0),
  scene,
);
light.intensity = 0.9;

const dirLight = new BABYLON.DirectionalLight(
  "dirLight",
  new BABYLON.Vector3(-0.5, -1, -0.7),
  scene,
);
dirLight.intensity = 0.6;

const cube = BABYLON.MeshBuilder.CreateBox("cube", { size: 1 }, scene);
const mat = new BABYLON.StandardMaterial("mat", scene);
mat.diffuseColor = new BABYLON.Color3(0.27, 0.67, 1);
cube.material = mat;

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
      canvas.resize(renderWidth, renderHeight);
      engine.setSize(renderWidth, renderHeight);
    }
  }
  if (!running || win.closed) break;

  const t = frame * 0.02;
  cube.rotation.x = t;
  cube.rotation.y = t * 0.7;

  engine.beginFrame();
  scene.render();
  engine.endFrame();
  win.present();

  frame += 1;
  await new Promise((resolve) => setTimeout(resolve, 0));
}

console.log(`Rendered ${frame} frames`);
engine.dispose();
win.close();
device.destroy();
