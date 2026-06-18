import { visualizedAwait as __tcvVisualizedAwait } from "file:///Users/avneeshsarwate/agentCombine/avTools/apps/deno-notebooks/livecode/visualizer/runtime.ts";
import type { TimeContext } from "@avtools/core-timing";
import { P5GPU } from "../../../../deno-notebooks/tools/p5gpu.ts";
import {
  createWindowRenderManager,
  requestWebGpuDevice,
  type WindowRenderManager,
} from "../../../../deno-notebooks/window/mod.ts";
import {
  writeTextureToPng,
} from "../../../../deno-notebooks/libraryIntegrationTetsts/raw-webgpu-helpers.ts";
import { state } from "./state.ts";

const WIDTH = 640;
const HEIGHT = 360;
const DIAMETER = 96;

interface SketchResources {
  device: GPUDevice;
  p5: P5GPU;
  renderWindow: WindowRenderManager;
}

let resources: SketchResources | null = null;

async function openSketchWindow(_ctx: unknown): Promise<SketchResources> {
  const device = await requestWebGpuDevice();
  const renderWindow = await createWindowRenderManager({
    device,
    width: WIDTH,
    height: HEIGHT,
    title: "minimal p5gpu livecode",
  });
  const p5 = new P5GPU(device, {
    width: WIDTH,
    height: HEIGHT,
    sampleCount: 1,
  });
  return { device, p5, renderWindow };
}

async function saveCurrentFrame(
  device: GPUDevice,
  p5: P5GPU,
  texture: GPUTexture,
) {
  await writeTextureToPng(
    device,
    texture,
    WIDTH,
    HEIGHT,
    p5.format,
    state.snapshotPath,
  );
}

function disposeSketchResources() {
  resources?.p5.dispose();
  resources = null;
}

async function runSketchWindow(_ctx: unknown, current: SketchResources) {
  resources = current;
  await current.renderWindow.run(renderFrame, {
    cleanup: disposeSketchResources,
    yieldMs: 1,
  });
}

function renderFrame() {
  if (!resources) {
    throw new Error("Sketch resources are not initialized.");
  }
  const { device, p5 } = resources;

  state.x += state.direction * state.speed;
  const radius = DIAMETER / 2;
  if (state.x > WIDTH - radius || state.x < radius) {
    state.direction *= -1;
    state.x = Math.max(radius, Math.min(WIDTH - radius, state.x));
  }

  p5.beginFrame();
  p5.background(18, 22, 34, 255);
  p5.noStroke();
  p5.fill(state.color[0], state.color[1], state.color[2], 255);
  p5.circle(state.x, HEIGHT / 2, DIAMETER);
  const texture = p5.endFrame();
  state.frame += 1;

  if (state.snapshotRequested) {
    state.snapshotRequested = false;
    void saveCurrentFrame(device, p5, texture)
      .then(() => console.log("[minimal-p5gpu] saved", state.snapshotPath))
      .catch((error) =>
        console.error("[minimal-p5gpu] snapshot failed", error)
      );
  }

  return texture;
}

export function stop() {
  resources?.renderWindow.stop();
  resources?.renderWindow.dispose();
}

export async function runFunc (ctx: TimeContext) {
  stop();
  const current = await __tcvVisualizedAwait("modules/sketch.ts", "da47dd66-8866-468c-8ecc-9437ffe34cde", openSketchWindow(ctx));
  try {
    await __tcvVisualizedAwait("modules/sketch.ts", "fc31d70a-aec2-4ec7-9f8b-3958b3dfb629", runSketchWindow(ctx, current));
  } finally {
    stop();
  }
}

export default runFunc;
