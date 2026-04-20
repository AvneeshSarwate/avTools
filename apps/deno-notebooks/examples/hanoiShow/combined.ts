/// <reference lib="dom" />

// Combined Hanoi Show — runs all three scenes in a single window
// with tabbed Tweakpane controls per scene.
//
// Run from apps/deno-notebooks:
//   deno run --unstable-webgpu --unstable-ffi --allow-all examples/hanoiShow/combined.ts

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
  state as tegakiState,
} from "./p5gpu_tegaki_handwriting.ts";

import {
  cleanup as bodyCleanup,
  draw as bodyDraw,
  setup as bodySetup,
  setupPane as bodySetupPane,
  state as bodyState,
} from "./p5gpu_body_text.ts";

import { createBodyContourProvider } from "./body_contour_provider.ts";
import { createHandBBoxProvider } from "./hand_bbox_provider.ts";

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
  showTiming: false,
};

const timing = {
  frame: 0,
  lastFrameStart: 0,
  cpuMs: 0,
  cpuAvgMs: 0,
  cpuMaxMs: 0,
  intervalMs: 0,
  intervalAvgMs: 0,
  intervalMaxMs: 0,
};

const bodyContourProvider = createBodyContourProvider();
const handBBoxProvider = createHandBBoxProvider();
tegakiState.contourProvider = bodyContourProvider;
tegakiState.handBBoxProvider = handBBoxProvider;
bodyState.contourProvider = bodyContourProvider;

function setupPane(pane: WindowTweakpane) {
  const tab = pane.addTab({
    pages: [
      { title: "Global" },
      { title: "Body Contour" },
      { title: "Hands" },
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

  const debug = global.addFolder({ title: "Debug" });
  debug.addBinding(globalParams, "showTiming", { label: "Frame Timing" });

  bodyContourProvider.setupPane(tab.pages[1]);
  handBBoxProvider.setupPane(tab.pages[2]);
  oscSetupPane(tab.pages[3]);
  tegakiSetupPane(tab.pages[4]);
  bodySetupPane(tab.pages[5]);
}

function updateTiming(frameStart: number, cpuMs: number): void {
  const intervalMs = timing.lastFrameStart > 0
    ? frameStart - timing.lastFrameStart
    : 0;
  timing.lastFrameStart = frameStart;
  timing.frame += 1;

  const smooth = 0.08;
  timing.cpuMs = cpuMs;
  timing.cpuAvgMs = timing.cpuAvgMs === 0
    ? cpuMs
    : timing.cpuAvgMs + (cpuMs - timing.cpuAvgMs) * smooth;
  timing.cpuMaxMs = timing.frame % 120 === 1
    ? cpuMs
    : Math.max(timing.cpuMaxMs, cpuMs);

  if (intervalMs > 0) {
    timing.intervalMs = intervalMs;
    timing.intervalAvgMs = timing.intervalAvgMs === 0
      ? intervalMs
      : timing.intervalAvgMs + (intervalMs - timing.intervalAvgMs) * smooth;
    timing.intervalMaxMs = timing.frame % 120 === 1
      ? intervalMs
      : Math.max(timing.intervalMaxMs, intervalMs);
  }
}

function drawTimingOverlay(p5: P5GPU): void {
  if (!globalParams.showTiming) {
    return;
  }

  const fps = timing.intervalAvgMs > 0 ? 1000 / timing.intervalAvgMs : 0;
  const lines = [
    `frame ${timing.frame}`,
    `cpu ${timing.cpuMs.toFixed(2)} ms  avg ${
      timing.cpuAvgMs.toFixed(2)
    }  max ${timing.cpuMaxMs.toFixed(2)}`,
    `loop ${timing.intervalMs.toFixed(2)} ms  avg ${
      timing.intervalAvgMs.toFixed(2)
    }  max ${timing.intervalMaxMs.toFixed(2)}`,
    `fps ${fps.toFixed(1)}  yield ${COMBINED_RENDER_YIELD_MS} ms`,
  ];

  p5.push();
  p5.noStroke();
  p5.fill(0, 0, 0, 180);
  p5.rect(16, 16, 440, 112);
  p5.textFont("Inter Variable");
  p5.textSize(15);
  p5.textAlign("left", "top");
  p5.fill(230, 235, 245, 255);
  for (let i = 0; i < lines.length; i += 1) {
    p5.text(lines[i], 28, 28 + i * 23);
  }
  p5.pop();
}

const device = await requestWebGpuDevice();
const p5 = new P5GPU(device, { width: WIDTH, height: HEIGHT });

// Initialize providers first so scenes see ready-to-use providers on state
bodyContourProvider.setup();
handBBoxProvider.setup();

// Initialize all scenes
await Promise.all([
  oscSetup(device),
  tegakiSetup(),
  bodySetup(p5),
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
  const frameStart = performance.now();
  const time = performance.now() * 0.001;

  // Advance shared contour + hand data once before any consumer reads.
  bodyContourProvider.tick();
  handBBoxProvider.tick();

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
  drawTimingOverlay(p5);

  const output = p5.endFrame();
  updateTiming(frameStart, performance.now() - frameStart);
  return output;
}, {
  yieldMs: COMBINED_RENDER_YIELD_MS,
  cleanup() {
    oscCleanup();
    tegakiCleanup();
    bodyCleanup();
    bodyContourProvider.cleanup();
    handBBoxProvider.cleanup();
    p5.dispose();
  },
});
