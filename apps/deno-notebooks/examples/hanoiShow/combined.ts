/// <reference lib="dom" />

// Combined Hanoi Show — runs all three scenes in a single window
// with tabbed Tweakpane controls per scene.
//
// Run from apps/deno-notebooks:
//   deno run --unstable-webgpu --unstable-ffi --allow-all examples/hanoiShow/combined.ts

import {
  alphaBlit,
  blit,
  blitTile,
  type BlitPipeline,
  createAlphaBlitPipeline,
  createBlitPipeline,
  createWindowRenderManager,
  createWindowTweakpane,
  requestWebGpuDevice,
  type WindowTweakpane,
} from "../../window/mod.ts";
import { alignedBytesPerRow, HeadlessSyphonServer } from "../../syphon/mod.ts";
import { P5GPU } from "../../tools/p5gpu.ts";
import { installMacros, type MacroDef } from "../../tools/macros.ts";
import { createOSCClient, type OSCClient } from "../../tools/osc.ts";
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

import {
  cleanup as kinareeCleanup,
  draw as kinareeDraw,
  setup as kinareeSetup,
  setupPane as kinareeSetupPane,
} from "./burning_kinaree.ts";

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

// Landscape channel native dims — spatially match 3 portraits side-by-side
// in the physical show layout, independent of HANOI_ASPECT. Landscape content
// (not yet implemented) will render into this and ship over Syphon output 4
// for the downstream compositor to slice across the 3 physical screens.
const LANDSCAPE_WIDTH = 2160;
const LANDSCAPE_HEIGHT = 1280;

// Monitor window: 3 portrait tiles on top (channels 1–3), one landscape tile
// below (channel 4). Native monitor is 3×WIDTH wide × (HEIGHT + landscape
// tile height) tall. We scale the whole thing so the monitor window is
// ~1080px wide on a dev screen.
const MONITOR_TARGET_WIDTH = 1080;
const MONITOR_NATIVE_ROW_WIDTH = 3 * WIDTH;
const MONITOR_NATIVE_LANDSCAPE_TILE_HEIGHT = Math.round(
  MONITOR_NATIVE_ROW_WIDTH * LANDSCAPE_HEIGHT / LANDSCAPE_WIDTH,
);
const MONITOR_NATIVE_HEIGHT = HEIGHT + MONITOR_NATIVE_LANDSCAPE_TILE_HEIGHT;
const MONITOR_SCALE = MONITOR_TARGET_WIDTH / MONITOR_NATIVE_ROW_WIDTH;
const MONITOR_WIDTH = Math.round(MONITOR_NATIVE_ROW_WIDTH * MONITOR_SCALE);
const MONITOR_HEIGHT = Math.round(MONITOR_NATIVE_HEIGHT * MONITOR_SCALE);
const MONITOR_PORTRAIT_TILE_WIDTH = Math.round(WIDTH * MONITOR_SCALE);
const MONITOR_PORTRAIT_TILE_HEIGHT = Math.round(HEIGHT * MONITOR_SCALE);
const MONITOR_LANDSCAPE_TILE_WIDTH = MONITOR_WIDTH;
const MONITOR_LANDSCAPE_TILE_HEIGHT = MONITOR_HEIGHT -
  MONITOR_PORTRAIT_TILE_HEIGHT;

// Keep the composed sketch from spinning so hard that UDP/WebSocket callbacks
// only run in occasional timer gaps.
const COMBINED_RENDER_YIELD_MS = 4;

// Outbound OSC destination for the "External N" macro tabs on the perf pane.
// Single client; both groups send to the same host:port under different
// address prefixes (/external1/*, /external2/*).
const EXTERNAL_OSC_HOST = "127.0.0.1";
const EXTERNAL_OSC_PORT = 9004;

// Portrait-output sources (channels 1–3). "none" = publish an opaque-black
// frame; useful to mute a channel without disabling scenes upstream.
type PortraitSyphonSource =
  | "none"
  | "osc"
  | "tegaki"
  | "body"
  | "kinaree"
  | "composite";
// Landscape-output sources (channel 4). Options grow when landscape scenes
// are added; for now just the landscape composite or "none".
type LandscapeSyphonSource = "none" | "landscape";
type AnySyphonSource = PortraitSyphonSource | LandscapeSyphonSource;

const globalParams = {
  bgR: 13,
  bgG: 16,
  bgB: 23,
  oscEnabled: true,
  tegakiEnabled: true,
  bodyEnabled: true,
  kinareeEnabled: true,
  showTiming: false,
  syphon1Source: "composite" as PortraitSyphonSource,
  syphon2Source: "composite" as PortraitSyphonSource,
  syphon3Source: "composite" as PortraitSyphonSource,
  syphon4Source: "landscape" as LandscapeSyphonSource,
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

// Placeholder external-sketch macro groups. Each group is two numeric sliders
// whose `apply` functions send OSC to EXTERNAL_OSC_HOST:EXTERNAL_OSC_PORT.
// Uses the same MacroDef contract as scene macros, so they render identically
// on the perf pane (numeric-slider-in-tab-page — the only shape the Vue perf
// client knows how to draw).
const externalOscClient: OSCClient = createOSCClient(
  EXTERNAL_OSC_HOST,
  EXTERNAL_OSC_PORT,
);

const external1Macros: Record<string, number> = {};
const external1MacroDefs: MacroDef[] = [
  {
    key: "param1",
    defaultValue: 0.5,
    opts: { min: 0, max: 1, label: "Param 1" },
    apply: (v) => externalOscClient.send("/external1/param1", v),
  },
  {
    key: "param2",
    defaultValue: 0.5,
    opts: { min: 0, max: 1, label: "Param 2" },
    apply: (v) => externalOscClient.send("/external1/param2", v),
  },
];

const external2Macros: Record<string, number> = {};
const external2MacroDefs: MacroDef[] = [
  {
    key: "param1",
    defaultValue: 0.5,
    opts: { min: 0, max: 1, label: "Param 1" },
    apply: (v) => externalOscClient.send("/external2/param1", v),
  },
  {
    key: "param2",
    defaultValue: 0.5,
    opts: { min: 0, max: 1, label: "Param 2" },
    apply: (v) => {
      console.log("/external2/param2", v)
      externalOscClient.send("/external2/param2", v)
    },
  },
];

function setupPane(pane: WindowTweakpane, refresh: () => void) {
  const tab = pane.addTab({
    pages: [
      { title: "Global" },
      { title: "OSC Trail" },
      { title: "Tegaki" },
      { title: "Body Text" },
      { title: "Kinaree" },
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
  scenes.addBinding(globalParams, "kinareeEnabled", { label: "Kinaree" });

  const syphonFolder = global.addFolder({ title: "Syphon Outputs" });
  const portraitSyphonOptions = {
    "None": "none",
    "Composite": "composite",
    "OSC Trail": "osc",
    "Tegaki": "tegaki",
    "Body Text": "body",
    "Kinaree": "kinaree",
  };
  const landscapeSyphonOptions = {
    "None": "none",
    "Landscape Composite": "landscape",
  };
  syphonFolder.addBinding(globalParams, "syphon1Source", {
    options: portraitSyphonOptions,
    label: "Output 1",
  });
  syphonFolder.addBinding(globalParams, "syphon2Source", {
    options: portraitSyphonOptions,
    label: "Output 2",
  });
  syphonFolder.addBinding(globalParams, "syphon3Source", {
    options: portraitSyphonOptions,
    label: "Output 3",
  });
  syphonFolder.addBinding(globalParams, "syphon4Source", {
    options: landscapeSyphonOptions,
    label: "Output 4 (landscape)",
  });

  // Shared providers — both feed multiple scenes, so they live under Global
  // as folders rather than their own tabs.
  bodyContourProvider.setupPane(
    global.addFolder({ title: "Body Contour", expanded: false }),
  );
  handBBoxProvider.setupPane(
    global.addFolder({ title: "Hands", expanded: false }),
  );

  const debug = global.addFolder({ title: "Debug" });
  debug.addBinding(globalParams, "showTiming", { label: "Frame Timing" });

  oscSetupPane(tab.pages[1], refresh);
  tegakiSetupPane(tab.pages[2], refresh);
  bodySetupPane(tab.pages[3], refresh);
  kinareeSetupPane(tab.pages[4], refresh);
}

function setupPerfPane(pane: WindowTweakpane, refresh: () => void) {
  const tab = pane.addTab({
    pages: [
      { title: "OSC" },
      { title: "Tegaki" },
      { title: "Body Text" },
      { title: "External 1" },
      { title: "External 2" },
    ],
  });
  installMacros(tab.pages[0], oscState.macros, oscMacroDefs, refresh);
  installMacros(tab.pages[1], tegakiState.macros, tegakiMacroDefs, refresh);
  installMacros(tab.pages[2], bodyState.macros, bodyMacroDefs, refresh);
  installMacros(tab.pages[3], external1Macros, external1MacroDefs, refresh);
  installMacros(tab.pages[4], external2Macros, external2MacroDefs, refresh);
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

// ── Headless Syphon output ─────────────────────────────────────────
//
// Each output owns a `bgra8unorm` staging texture and a ping-pong pair of
// readback buffers. Per frame we blit the selected source texture into the
// staging (the blit shader writes vec4f(r,g,b,a) into a bgra8unorm target,
// which stores as BGRA bytes — that's exactly what HeadlessSyphon wants),
// then queue a copyTextureToBuffer into the current write buffer.
//
// Publish runs async: we fire-and-forget a mapAsync + publishFrame + unmap on
// the buffer that's NOT the current write target. A `busy` flag prevents us
// from reusing a still-mapped buffer — if both are stuck mapped the frame
// copy is skipped (harmless; Syphon just gets one fewer update).
interface SyphonOutput {
  readonly server: HeadlessSyphonServer;
  readonly name: string;
  captureFrame(encoder: GPUCommandEncoder, sourceView: GPUTextureView): void;
  tryPublish(): void;
  destroy(): void;
}

function createSyphonOutput(
  device: GPUDevice,
  width: number,
  height: number,
  serverName: string,
  bgraBlitPipeline: BlitPipeline,
): SyphonOutput {
  const stagingTexture = device.createTexture({
    size: { width, height },
    format: "bgra8unorm",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const bytesPerRow = alignedBytesPerRow(width);
  const bufferSize = bytesPerRow * height;
  const buffers: GPUBuffer[] = [0, 1].map(() =>
    device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    })
  );
  const busy = [false, false];
  const hasData = [false, false];
  let writeIdx = 0;

  const server = new HeadlessSyphonServer({ serverName, flipY: true });

  return {
    server,
    name: serverName,

    captureFrame(encoder, sourceView) {
      if (busy[writeIdx]) return; // ping-pong buffer stuck mapped; skip
      blit(
        device,
        encoder,
        bgraBlitPipeline,
        sourceView,
        stagingTexture.createView(),
      );
      encoder.copyTextureToBuffer(
        { texture: stagingTexture },
        { buffer: buffers[writeIdx]!, bytesPerRow, rowsPerImage: height },
        { width, height, depthOrArrayLayers: 1 },
      );
      hasData[writeIdx] = true;
      writeIdx = (writeIdx + 1) % 2;
    },

    tryPublish() {
      for (let i = 0; i < 2; i += 1) {
        if (!hasData[i] || busy[i]) continue;
        busy[i] = true;
        const idx = i;
        (async () => {
          try {
            await buffers[idx]!.mapAsync(GPUMapMode.READ);
            const bytes = new Uint8Array(buffers[idx]!.getMappedRange());
            server.publishFrame(bytes, width, height, bytesPerRow);
            buffers[idx]!.unmap();
          } catch (err) {
            console.error(`syphon ${serverName} publish failed:`, err);
          } finally {
            busy[idx] = false;
            hasData[idx] = false;
          }
        })();
        return; // one publish per frame is enough
      }
    },

    destroy() {
      for (const buf of buffers) buf.destroy();
      stagingTexture.destroy();
      server.destroy();
    },
  };
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
const kinareeP5 = new P5GPU(device, { width: WIDTH, height: HEIGHT });
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

// Landscape composite — empty placeholder for now (no landscape scenes yet).
// Cleared to bg RGB each frame; Syphon output 4 samples from this. Once
// landscape scenes land, they'll render into their own P5GPU offscreens at
// LANDSCAPE_WIDTH×LANDSCAPE_HEIGHT and alphaBlit into here.
const landscapeCompositeTexture = device.createTexture({
  size: { width: LANDSCAPE_WIDTH, height: LANDSCAPE_HEIGHT },
  format: COMPOSITE_FORMAT,
  usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING |
    GPUTextureUsage.COPY_SRC,
});
const landscapeCompositeView = landscapeCompositeTexture.createView();

// Empty source: a small opaque-black texture that "None" channels sample
// from. Cleared once at startup since nothing writes to it afterwards. The
// blit path rescales it to any output size, so a 64×64 texel is plenty.
const emptyTexture = device.createTexture({
  size: { width: 64, height: 64 },
  format: COMPOSITE_FORMAT,
  usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
});
const emptyView = emptyTexture.createView();
{
  const initEncoder = device.createCommandEncoder();
  const pass = initEncoder.beginRenderPass({
    colorAttachments: [{
      view: emptyView,
      loadOp: "clear",
      storeOp: "store",
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
    }],
  });
  pass.end();
  device.queue.submit([initEncoder.finish()]);
}

// Monitor texture — what the window actually displays. 3 portrait tiles on
// top (channels 1–3), landscape tile below (channel 4). Populated by
// blitTile calls per frame. Same format as composite so the existing blit
// pipeline (from render_manager) can present it.
const monitorTexture = device.createTexture({
  size: { width: MONITOR_WIDTH, height: MONITOR_HEIGHT },
  format: COMPOSITE_FORMAT,
  usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING |
    GPUTextureUsage.COPY_SRC,
});
const monitorView = monitorTexture.createView();
const monitorBlitPipeline = createBlitPipeline(device, COMPOSITE_FORMAT);

// Syphon outputs: channels 1–3 are portrait, channel 4 is landscape. Channels
// 1–3 are independently routable to any scene texture or the portrait
// composite via the Global > Syphon Outputs tab. Channel 4 is hardcoded to
// the landscape composite until a landscape source selector exists.
// bgra8unorm matches what HeadlessSyphon expects on disk (pixel_format = BGRA8).
const syphonBgraBlitPipeline = createBlitPipeline(device, "bgra8unorm");
const syphonOutputs: readonly SyphonOutput[] = [
  createSyphonOutput(device, WIDTH, HEIGHT, "Hanoi Show 1", syphonBgraBlitPipeline),
  createSyphonOutput(device, WIDTH, HEIGHT, "Hanoi Show 2", syphonBgraBlitPipeline),
  createSyphonOutput(device, WIDTH, HEIGHT, "Hanoi Show 3", syphonBgraBlitPipeline),
  createSyphonOutput(
    device,
    LANDSCAPE_WIDTH,
    LANDSCAPE_HEIGHT,
    "Hanoi Show 4",
    syphonBgraBlitPipeline,
  ),
];

// Initialize providers first so scenes see ready-to-use providers on state
bodyContourProvider.setup();
handBBoxProvider.setup();

// Initialize all scenes. Body loads Charmonman into its own P5GPU instance.
await Promise.all([
  oscSetup(device),
  tegakiSetup({ width: WIDTH, height: HEIGHT }),
  bodySetup(bodyP5),
]);
// Kinaree setup is sync; called outside Promise.all for clarity.
kinareeSetup({ width: WIDTH, height: HEIGHT });

// Refresh both panes on any macro change. Declared before pane construction so
// scene setupPanes can capture it by reference; reassigned once perfPane exists.
let refreshAll: () => void = () => {};
const triggerRefresh = () => refreshAll();

const renderWindow = await createWindowRenderManager({
  device,
  width: MONITOR_WIDTH,
  height: MONITOR_HEIGHT,
  title: "Hanoi Show",
  pane: {
    title: "Hanoi Show",
    panelWidth: 620,
    panelHeight: 620,
    setup: (pane) => setupPane(pane, triggerRefresh),
  },
});

const perfPane = createWindowTweakpane(renderWindow.window, {
  title: "Perf",
  panelWidth: 620,
  panelHeight: 660,
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

  kinareeP5.beginFrame();
  if (globalParams.kinareeEnabled) kinareeDraw(kinareeP5, time);
  const kinareeTex = kinareeP5.endFrame();

  overlayP5.beginFrame();
  drawTimingOverlay(overlayP5);
  const overlayTex = overlayP5.endFrame();

  // Composite: clear target to bg RGB (alpha 1 so nothing behind leaks
  // through), then alpha-blit the 4 layers in painter's-algorithm order.
  const encoder = device.createCommandEncoder();
  const clearColor = {
    r: globalParams.bgR / 255,
    g: globalParams.bgG / 255,
    b: globalParams.bgB / 255,
    a: 1,
  };
  const clearPass = encoder.beginRenderPass({
    colorAttachments: [{
      view: compositeView,
      loadOp: "clear",
      storeOp: "store",
      clearValue: clearColor,
    }],
  });
  clearPass.end();
  // Landscape composite is empty (no landscape scenes yet) — we just clear
  // it to the bg color so the Syphon 4 output and monitor tile have stable
  // content instead of whatever was left in the texture last frame.
  const landscapeClearPass = encoder.beginRenderPass({
    colorAttachments: [{
      view: landscapeCompositeView,
      loadOp: "clear",
      storeOp: "store",
      clearValue: clearColor,
    }],
  });
  landscapeClearPass.end();

  const oscView = oscTex.createView();
  const tegakiView = tegakiTex.createView();
  const bodyView = bodyTex.createView();
  const kinareeView = kinareeTex.createView();
  // Painter's algorithm order: kinaree sits above osc/tegaki/body so its
  // strobe flashes overlay everything; timing overlay stays on top.
  alphaBlit(device, encoder, alphaBlitPipeline, oscView, compositeView);
  alphaBlit(device, encoder, alphaBlitPipeline, tegakiView, compositeView);
  alphaBlit(device, encoder, alphaBlitPipeline, bodyView, compositeView);
  alphaBlit(device, encoder, alphaBlitPipeline, kinareeView, compositeView);
  alphaBlit(device, encoder, alphaBlitPipeline, overlayTex.createView(), compositeView);

  // Syphon captures: piggyback on the same encoder. Fire async publishes of
  // any previous-frame ping-pong buffers first so their map requests race in
  // parallel with this frame's GPU work.
  for (const output of syphonOutputs) output.tryPublish();
  const syphonSources: Record<AnySyphonSource, GPUTextureView> = {
    none: emptyView,
    osc: oscView,
    tegaki: tegakiView,
    body: bodyView,
    kinaree: kinareeView,
    composite: compositeView,
    landscape: landscapeCompositeView,
  };
  const syphon1View = syphonSources[globalParams.syphon1Source];
  const syphon2View = syphonSources[globalParams.syphon2Source];
  const syphon3View = syphonSources[globalParams.syphon3Source];
  const syphon4View = syphonSources[globalParams.syphon4Source];
  syphonOutputs[0]!.captureFrame(encoder, syphon1View);
  syphonOutputs[1]!.captureFrame(encoder, syphon2View);
  syphonOutputs[2]!.captureFrame(encoder, syphon3View);
  syphonOutputs[3]!.captureFrame(encoder, syphon4View);

  // Monitor view: tile the four Syphon channels into the window texture.
  // Top row: 3 portrait channels side-by-side. Bottom row: landscape channel
  // full width. blitTile uses loadOp:"load", so start with one clear pass to
  // establish the background behind any tile aspect mismatch.
  const monitorClearPass = encoder.beginRenderPass({
    colorAttachments: [{
      view: monitorView,
      loadOp: "clear",
      storeOp: "store",
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
    }],
  });
  monitorClearPass.end();
  const tw = MONITOR_PORTRAIT_TILE_WIDTH;
  const th = MONITOR_PORTRAIT_TILE_HEIGHT;
  blitTile(device, encoder, monitorBlitPipeline, syphon1View, monitorView, {
    x: 0, y: 0, width: tw, height: th,
  });
  blitTile(device, encoder, monitorBlitPipeline, syphon2View, monitorView, {
    x: tw, y: 0, width: tw, height: th,
  });
  blitTile(device, encoder, monitorBlitPipeline, syphon3View, monitorView, {
    x: 2 * tw, y: 0, width: tw, height: th,
  });
  blitTile(device, encoder, monitorBlitPipeline, syphon4View, monitorView, {
    x: 0,
    y: th,
    width: MONITOR_LANDSCAPE_TILE_WIDTH,
    height: MONITOR_LANDSCAPE_TILE_HEIGHT,
  });

  device.queue.submit([encoder.finish()]);

  updateTiming(frameStart, performance.now() - frameStart);
  return monitorView;
}, {
  yieldMs: COMBINED_RENDER_YIELD_MS,
  cleanup() {
    oscCleanup();
    tegakiCleanup();
    bodyCleanup();
    kinareeCleanup();
    bodyContourProvider.cleanup();
    handBBoxProvider.cleanup();
    perfPane.destroy();
    externalOscClient.close();
    oscP5.dispose();
    tegakiP5.dispose();
    bodyP5.dispose();
    kinareeP5.dispose();
    overlayP5.dispose();
    compositeTexture.destroy();
    landscapeCompositeTexture.destroy();
    monitorTexture.destroy();
    emptyTexture.destroy();
    for (const output of syphonOutputs) output.destroy();
  },
});
