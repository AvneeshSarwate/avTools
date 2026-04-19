/// <reference lib="dom" />

// Combined Hanoi Show — runs all three scenes in a single window
// with tabbed Tweakpane controls per scene.
//
// Run from apps/deno-notebooks:
//   deno run --unstable-webgpu --unstable-ffi --allow-all \
//     examples/hanoiShow/combined.ts

import {
  createWindowRenderManager,
  requestWebGpuDevice,
  type WindowTweakpane,
} from "../../window/mod.ts";
import { P5GPU } from "../../tools/p5gpu.ts";

import {
  cleanup as oscCleanup,
  draw as oscDraw,
  setup as oscSetup,
  setupPane as oscSetupPane,
} from "./p5gpu_osc_note_trail.ts";

import {
  cleanup as tegakiCleanup,
  draw as tegakiDraw,
  setup as tegakiSetup,
  setupPane as tegakiSetupPane,
} from "./p5gpu_tegaki_handwriting.ts";

import {
  cleanup as bodyCleanup,
  draw as bodyDraw,
  setup as bodySetup,
  setupPane as bodySetupPane,
} from "./p5gpu_body_text.ts";

const WIDTH = 1280;
const HEIGHT = 720;
// Keep the composed sketch from spinning so hard that UDP/WebSocket callbacks
// only run in occasional timer gaps.
const COMBINED_RENDER_YIELD_MS = 4;

const globalParams = {
  bgR: 13,
  bgG: 16,
  bgB: 23,
  oscEnabled: true,
  tegakiEnabled: true,
  bodyEnabled: true,
};

function setupPane(pane: WindowTweakpane) {
  const tab = pane.addTab({
    pages: [
      { title: "Global" },
      { title: "OSC Trail" },
      { title: "Tegaki" },
      { title: "Body Text" },
    ],
  });

  // Global tab
  const global = tab.pages[0];
  const bg = global.addFolder({ title: "Background" });
  bg.addBinding(globalParams, "bgR", { min: 0, max: 255, step: 1, label: "R" });
  bg.addBinding(globalParams, "bgG", { min: 0, max: 255, step: 1, label: "G" });
  bg.addBinding(globalParams, "bgB", { min: 0, max: 255, step: 1, label: "B" });

  const scenes = global.addFolder({ title: "Scenes" });
  scenes.addBinding(globalParams, "oscEnabled", { label: "OSC Trail" });
  scenes.addBinding(globalParams, "tegakiEnabled", { label: "Tegaki" });
  scenes.addBinding(globalParams, "bodyEnabled", { label: "Body Text" });

  // Per-scene tabs — cast to any since TabPageProxy and WindowTweakpane
  // share the same container API but don't share a typed interface
  // deno-lint-ignore no-explicit-any
  oscSetupPane(tab.pages[1] as any);
  // deno-lint-ignore no-explicit-any
  tegakiSetupPane(tab.pages[2] as any);
  // deno-lint-ignore no-explicit-any
  bodySetupPane(tab.pages[3] as any);
}

const device = await requestWebGpuDevice();
const p5 = new P5GPU(device, { width: WIDTH, height: HEIGHT });

// Initialize all scenes
await Promise.all([
  oscSetup(device),
  tegakiSetup(),
  bodySetup(),
]);

const renderWindow = await createWindowRenderManager({
  device,
  width: WIDTH,
  height: HEIGHT,
  title: "Hanoi Show",
  pane: {
    title: "Hanoi Show",
    panelWidth: 420,
    panelHeight: 520,
    setup: setupPane,
  },
});

await renderWindow.run(() => {
  const time = performance.now() * 0.001;

  p5.beginFrame();
  p5.background(globalParams.bgR, globalParams.bgG, globalParams.bgB);

  // Draw enabled scenes in order.
  if (globalParams.oscEnabled) {
    oscDraw(p5, time);
  }
  if (globalParams.tegakiEnabled) {
    tegakiDraw(p5);
  }
  if (globalParams.bodyEnabled) {
    bodyDraw(p5, time);
  }

  return p5.endFrame();
}, {
  yieldMs: COMBINED_RENDER_YIELD_MS,
  cleanup() {
    oscCleanup();
    tegakiCleanup();
    bodyCleanup();
    p5.dispose();
  },
});
