/// <reference lib="dom" />

// Combined Hanoi Show — runs all three scenes in a single window
// with tabbed Tweakpane controls per scene.
//
// Run from apps/deno-notebooks:
//   deno run --unstable-webgpu --unstable-ffi --allow-all examples/hanoiShow/combined.ts

import {
  alphaBlit,
  createAlphaBlitPipeline,
  createWindowRenderManager,
  createWindowTweakpane,
  requestWebGpuDevice,
  type WindowTweakpane,
} from "../../window/mod.ts";
import { P5GPU } from "../../tools/p5gpu.ts";
import { installMacros } from "../../tools/macros.ts";
import { renderPerfShellHtml } from "../../tools/perf_shell_html.ts";

import {
  cleanup as oscCleanup,
  draw as oscDraw,
  macroDefs as oscMacroDefs,
  setup as oscSetup,
  setupPane as oscSetupPane,
  state as oscState,
} from "./p5gpu_osc_note_trail.ts";

import {
  cleanup as tegakiCleanup,
  draw as tegakiDraw,
  macroDefs as tegakiMacroDefs,
  setup as tegakiSetup,
  setupPane as tegakiSetupPane,
  state as tegakiState,
} from "./p5gpu_tegaki_handwriting.ts";

import {
  cleanup as bodyCleanup,
  draw as bodyDraw,
  macroDefs as bodyMacroDefs,
  setup as bodySetup,
  setupPane as bodySetupPane,
  state as bodyState,
} from "./p5gpu_body_text.ts";

import { createBodyContourProvider } from "./body_contour_provider.ts";
import { createHandBBoxProvider } from "./hand_bbox_provider.ts";

// Canvas aspect is picked once at startup. Edit ASPECT here, or override with
// HANOI_ASPECT=portrait (or square / landscape) in the environment. Scenes pick
// up the chosen dims at load time — no dynamic switching.
type AspectRatio = "landscape" | "portrait" | "square";
const ASPECT_DIMS: Record<AspectRatio, { width: number; height: number }> = {
  landscape: { width: 1280, height: 720 },
  portrait: { width: 720, height: 1280 },
  square: { width: 1024, height: 1024 },
};
const ASPECT: AspectRatio =
  (Deno.env.get("HANOI_ASPECT") as AspectRatio | undefined) ?? "portrait";
const { width: WIDTH, height: HEIGHT } = ASPECT_DIMS[ASPECT] ??
  ASPECT_DIMS.landscape;

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

function setupPane(pane: WindowTweakpane, refresh: () => void) {
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
  oscSetupPane(tab.pages[3], refresh);
  tegakiSetupPane(tab.pages[4], refresh);
  bodySetupPane(tab.pages[5], refresh);
}

function setupPerfPane(pane: WindowTweakpane, refresh: () => void) {
  const tab = pane.addTab({
    pages: [
      { title: "OSC" },
      { title: "Tegaki" },
      { title: "Body Text" },
    ],
  });
  installMacros(tab.pages[0], oscState.macros, oscMacroDefs, refresh);
  installMacros(tab.pages[1], tegakiState.macros, tegakiMacroDefs, refresh);
  installMacros(tab.pages[2], bodyState.macros, bodyMacroDefs, refresh);
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

// Per-scene P5GPU instances. Each scene draws into its own offscreen texture;
// the frame callback alpha-composites them onto `compositeTexture` in draw
// order. Scenes MUST NOT call `background()` — the transparent clear
// (P5GPU's default) is what makes alpha compositing work.
const oscP5 = new P5GPU(device, { width: WIDTH, height: HEIGHT });
const tegakiP5 = new P5GPU(device, { width: WIDTH, height: HEIGHT });
const bodyP5 = new P5GPU(device, { width: WIDTH, height: HEIGHT });
const overlayP5 = new P5GPU(device, { width: WIDTH, height: HEIGHT });

const COMPOSITE_FORMAT: GPUTextureFormat = "rgba8unorm";
const compositeTexture = device.createTexture({
  size: { width: WIDTH, height: HEIGHT },
  format: COMPOSITE_FORMAT,
  usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING |
    GPUTextureUsage.COPY_SRC,
});
const compositeView = compositeTexture.createView();
const alphaBlitPipeline = createAlphaBlitPipeline(device, COMPOSITE_FORMAT);

// Initialize providers first so scenes see ready-to-use providers on state
bodyContourProvider.setup();
handBBoxProvider.setup();

// Initialize all scenes. Body loads Charmonman into its own P5GPU instance.
await Promise.all([
  oscSetup(device),
  tegakiSetup({ width: WIDTH, height: HEIGHT }),
  bodySetup(bodyP5),
]);

// Refresh both panes on any macro change. Declared before pane construction so
// scene setupPanes can capture it by reference; reassigned once perfPane exists.
let refreshAll: () => void = () => {};
const triggerRefresh = () => refreshAll();

const renderWindow = await createWindowRenderManager({
  device,
  width: WIDTH,
  height: HEIGHT,
  title: "Hanoi Show",
  syphon: {
    serverName: "Hanoi Show",
    flipY: true,
  },
  pane: {
    title: "Hanoi Show",
    panelWidth: 420,
    panelHeight: 520,
    setup: (pane) => setupPane(pane, triggerRefresh),
  },
});

const perfPane = createWindowTweakpane(renderWindow.window, {
  title: "Perf",
  panelWidth: 420,
  panelHeight: 560,
  renderShell: (args) => renderPerfShellHtml({
    title: args.title,
    wsUrl: args.wsUrl,
    mobileUrl: args.mobileUrl,
    qrSvg: args.qrSvg,
  }),
});
setupPerfPane(perfPane, triggerRefresh);

refreshAll = () => {
  renderWindow.pane?.refresh();
  perfPane.refresh();
};

await renderWindow.run(() => {
  const frameStart = performance.now();
  const time = performance.now() * 0.001;

  // Advance shared contour + hand data once before any consumer reads.
  bodyContourProvider.tick();
  handBBoxProvider.tick();

  // Each scene draws into its own P5GPU. We always begin/end the frame so
  // every layer produces a valid texture (transparent if the scene is
  // disabled or early-returned). alphaBlit of an all-transparent layer is a
  // no-op visually, so we don't gate the composite step on the enable flags.
  oscP5.beginFrame();
  if (globalParams.oscEnabled) oscDraw(oscP5, time);
  const oscTex = oscP5.endFrame();

  tegakiP5.beginFrame();
  if (globalParams.tegakiEnabled) tegakiDraw(tegakiP5);
  const tegakiTex = tegakiP5.endFrame();

  bodyP5.beginFrame();
  if (globalParams.bodyEnabled) bodyDraw(bodyP5, time);
  const bodyTex = bodyP5.endFrame();

  overlayP5.beginFrame();
  drawTimingOverlay(overlayP5);
  const overlayTex = overlayP5.endFrame();

  // Composite: clear target to bg RGB (alpha 1 so nothing behind leaks
  // through), then alpha-blit the 4 layers in painter's-algorithm order.
  const encoder = device.createCommandEncoder();
  const clearPass = encoder.beginRenderPass({
    colorAttachments: [{
      view: compositeView,
      loadOp: "clear",
      storeOp: "store",
      clearValue: {
        r: globalParams.bgR / 255,
        g: globalParams.bgG / 255,
        b: globalParams.bgB / 255,
        a: 1,
      },
    }],
  });
  clearPass.end();
  alphaBlit(device, encoder, alphaBlitPipeline, oscTex.createView(), compositeView);
  alphaBlit(device, encoder, alphaBlitPipeline, tegakiTex.createView(), compositeView);
  alphaBlit(device, encoder, alphaBlitPipeline, bodyTex.createView(), compositeView);
  alphaBlit(device, encoder, alphaBlitPipeline, overlayTex.createView(), compositeView);
  device.queue.submit([encoder.finish()]);

  updateTiming(frameStart, performance.now() - frameStart);
  return compositeView;
}, {
  yieldMs: COMBINED_RENDER_YIELD_MS,
  cleanup() {
    oscCleanup();
    tegakiCleanup();
    bodyCleanup();
    bodyContourProvider.cleanup();
    handBBoxProvider.cleanup();
    perfPane.destroy();
    oscP5.dispose();
    tegakiP5.dispose();
    bodyP5.dispose();
    overlayP5.dispose();
    compositeTexture.destroy();
  },
});
