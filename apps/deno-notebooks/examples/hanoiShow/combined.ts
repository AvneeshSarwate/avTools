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
  createRotatedAlphaBlitPipeline,
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

import {
  cleanup as fabCleanup,
  draw as fabDraw,
  loadAssets as fabLoadAssets,
  setup as fabSetup,
  setupPane as fabSetupPane,
} from "./fab_and_lies.ts";

import { createBodyContourProvider } from "./body_contour_provider.ts";
import { createHandBBoxProvider } from "./hand_bbox_provider.ts";

// Canvas aspect is picked once at startup. Edit ASPECT here, or override with
// HANOI_ASPECT=portrait (or square / landscape) in the environment. Scenes pick
// up the chosen dims at load time — no dynamic switching.
//
// "portrait" is the source-scene aspect: 720×1280 (9:16). Scenes are
// rotated 90° clockwise and tiled into a 2×2 quadrant layout at 1080p
// (1920×1080) to form the portrait Syphon output. Each quadrant is 960×540
// (16:9), which is the rotated scene's aspect exactly — 0.75× uniform scale.
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

// Portrait quad — 1080p output with 2×2 quadrants in row-major order:
//   slot 1 top-left, slot 2 top-right, slot 3 bottom-left, slot 4 empty.
// Each scene is rotated 90° CW into its quadrant. Shipped as a single
// Syphon output; downstream maps slots 1–3 onto the three physical screens.
const QUAD_WIDTH = 1920;
const QUAD_HEIGHT = 1080;
const QUADRANT_WIDTH = QUAD_WIDTH / 2; // 960
const QUADRANT_HEIGHT = QUAD_HEIGHT / 2; // 540

// Landscape channel — same output dims as the quad (1080p). One continuous
// landscape scene (not yet implemented) will render here and ship over the
// landscape Syphon output.
const LANDSCAPE_WIDTH = QUAD_WIDTH;
const LANDSCAPE_HEIGHT = QUAD_HEIGHT;

// Monitor window: top row is the 3 vertical channels side-by-side (each
// in its native 9:16 portrait orientation, *not* the packed quad —
// packing is purely the Syphon wire format). Bottom row is the landscape
// channel tile (16:9). Sized to fit comfortably on a 1080p dev display.
//
// Portrait row math: MONITOR_WIDTH / 3 per tile, tile height scaled to
// match the source sketch's portrait aspect (HEIGHT/WIDTH = 1280/720).
// Landscape tile matches the landscape output's 16:9 at full MONITOR_WIDTH.
const MONITOR_WIDTH = 720;
const MONITOR_PORTRAIT_TILE_WIDTH = Math.floor(MONITOR_WIDTH / 3);
const MONITOR_PORTRAIT_TILE_HEIGHT = Math.round(
  MONITOR_PORTRAIT_TILE_WIDTH * HEIGHT / WIDTH,
);
const MONITOR_LANDSCAPE_TILE_HEIGHT = Math.round(
  MONITOR_WIDTH * LANDSCAPE_HEIGHT / LANDSCAPE_WIDTH,
);
const MONITOR_HEIGHT = MONITOR_PORTRAIT_TILE_HEIGHT +
  MONITOR_LANDSCAPE_TILE_HEIGHT;

// Keep the composed sketch from spinning so hard that UDP/WebSocket callbacks
// only run in occasional timer gaps.
const COMBINED_RENDER_YIELD_MS = 4;

// Outbound OSC destination for the "External N" macro tabs on the perf pane.
// Single client; both groups send to the same host:port under different
// address prefixes (/external1/*, /external2/*).
const EXTERNAL_OSC_HOST = "127.0.0.1";
const EXTERNAL_OSC_PORT = 9004;

// Channel sources. Conceptually there are 4 channels — 3 vertical (portrait)
// + 1 horizontal (landscape) — each independently selectable. The 2×2 quad
// tiling of the vertical channels is purely the wire format for packing
// them into one Syphon output; the "what's in this slot" decision stays
// per channel, and each channel can pick any individual sketch's output
// (not just the stacked composite).
//
// Fills: "none" = opaque black; "red" = solid red debug fill.
// Sketches: each listed below maps to one sketch's own 720×1280 P5GPU
// render texture, composited over the quadrant's bg-clear via the
// rotated-alpha-blit pipeline.
// Composites: "portrait" = all portrait sketches stacked (handy "show
// everything" option); "landscape" = the landscape channel's composite
// (empty placeholder until landscape sketches exist).
type ChannelSource =
  | "none"
  | "red"
  | "osc"
  | "tegaki"
  | "body"
  | "kinaree"
  | "fab"
  | "portrait"
  | "landscape";

const globalParams = {
  bgR: 13,
  bgG: 16,
  bgB: 23,
  oscEnabled: true,
  tegakiEnabled: true,
  bodyEnabled: true,
  kinareeEnabled: true,
  fabEnabled: true,
  showTiming: false,
  // Per-channel source selection. Channels 1–3 are the vertical portrait
  // outputs (packed into quad slots 1/2/3); channel 4 is the landscape
  // output. Quad slot 4 is wire slack — no channel assigned.
  channel1Source: "kinaree" as ChannelSource,
  channel2Source: "fab" as ChannelSource,
  channel3Source: "tegaki" as ChannelSource,
  channel4Source: "landscape" as ChannelSource,
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
      { title: "Fab & Lies" },
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
  scenes.addBinding(globalParams, "fabEnabled", { label: "Fab & Lies" });

  const syphonFolder = global.addFolder({ title: "Channel Sources" });
  const channelSourceOptions = {
    "None": "none",
    "Red (debug)": "red",
    "OSC Trail": "osc",
    "Tegaki": "tegaki",
    "Body Text": "body",
    "Kinaree": "kinaree",
    "Fab & Lies": "fab",
    "All Portrait (stacked)": "portrait",
    "Landscape Composite": "landscape",
  };
  syphonFolder.addBinding(globalParams, "channel1Source", {
    options: channelSourceOptions,
    label: "Ch 1 (vert, slot 1)",
  });
  syphonFolder.addBinding(globalParams, "channel2Source", {
    options: channelSourceOptions,
    label: "Ch 2 (vert, slot 2)",
  });
  syphonFolder.addBinding(globalParams, "channel3Source", {
    options: channelSourceOptions,
    label: "Ch 3 (vert, slot 3)",
  });
  syphonFolder.addBinding(globalParams, "channel4Source", {
    options: channelSourceOptions,
    label: "Ch 4 (horiz)",
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
  fabSetupPane(tab.pages[5], refresh);
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
const fabP5 = new P5GPU(device, { width: WIDTH, height: HEIGHT });
const overlayP5 = new P5GPU(device, { width: WIDTH, height: HEIGHT });

const COMPOSITE_FORMAT: GPUTextureFormat = "rgba8unorm";

// Per-scene portrait composite: scenes alphaBlit into this at their native
// dims (WIDTH×HEIGHT = 720×1280 for portrait mode). Until the composition
// model lands, all 3 populated quadrants of the quad texture show this same
// composite; later, per-slot composites differentiate.
const compositeTexture = device.createTexture({
  size: { width: WIDTH, height: HEIGHT },
  format: COMPOSITE_FORMAT,
  usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING |
    GPUTextureUsage.COPY_SRC,
});
const compositeView = compositeTexture.createView();
const alphaBlitPipeline = createAlphaBlitPipeline(device, COMPOSITE_FORMAT);

// Portrait quad — 1080p, 2×2 layout. Slots 1–3 get the composite rotated
// 90° CW and scaled into the quadrant (960×540); slot 4 (bottom-right) is
// left cleared to the bg color. Shipped as Syphon output 1.
const portraitQuadTexture = device.createTexture({
  size: { width: QUAD_WIDTH, height: QUAD_HEIGHT },
  format: COMPOSITE_FORMAT,
  usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING |
    GPUTextureUsage.COPY_SRC,
});
const portraitQuadView = portraitQuadTexture.createView();
// Alpha-blending rotated blit so transparent regions of a per-sketch
// source (e.g. fab_and_lies' non-drawn pixels) preserve the quad's
// bg-color clear instead of overwriting it with alpha=0.
const rotatedBlitPipeline = createRotatedAlphaBlitPipeline(device, COMPOSITE_FORMAT);

// Landscape composite — empty placeholder (no landscape scenes yet). Cleared
// to bg RGB each frame; Syphon output 2 samples from this. When landscape
// scenes land, they'll alphaBlit into here at LANDSCAPE_WIDTH×LANDSCAPE_HEIGHT.
const landscapeCompositeTexture = device.createTexture({
  size: { width: LANDSCAPE_WIDTH, height: LANDSCAPE_HEIGHT },
  format: COMPOSITE_FORMAT,
  usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING |
    GPUTextureUsage.COPY_SRC,
});
const landscapeCompositeView = landscapeCompositeTexture.createView();

// Static source textures for None / Red / other fixed-fill channels.
// Allocated at a small size (the blit path rescales to any output size) and
// cleared once at startup since nothing writes to them afterwards.
function createFillTexture(clear: GPUColor): {
  texture: GPUTexture;
  view: GPUTextureView;
} {
  const texture = device.createTexture({
    size: { width: 64, height: 64 },
    format: COMPOSITE_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.TEXTURE_BINDING,
  });
  const view = texture.createView();
  const enc = device.createCommandEncoder();
  const pass = enc.beginRenderPass({
    colorAttachments: [{
      view,
      loadOp: "clear",
      storeOp: "store",
      clearValue: clear,
    }],
  });
  pass.end();
  device.queue.submit([enc.finish()]);
  return { texture, view };
}

const { texture: emptyTexture, view: emptyView } = createFillTexture({
  r: 0, g: 0, b: 0, a: 1,
});
const { texture: redTexture, view: redView } = createFillTexture({
  r: 1, g: 0, b: 0, a: 1,
});

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

// Syphon outputs: output 1 is the portrait quad (1080p, 2×2); output 2 is
// the landscape channel. Each has its own Global > Syphon Outputs selector
// (including None / Red debug fills).
// bgra8unorm matches what HeadlessSyphon expects on disk (pixel_format = BGRA8).
const syphonBgraBlitPipeline = createBlitPipeline(device, "bgra8unorm");
const syphonOutputs: readonly SyphonOutput[] = [
  createSyphonOutput(
    device,
    QUAD_WIDTH,
    QUAD_HEIGHT,
    "Hanoi Show 1",
    syphonBgraBlitPipeline,
  ),
  createSyphonOutput(
    device,
    LANDSCAPE_WIDTH,
    LANDSCAPE_HEIGHT,
    "Hanoi Show 2",
    syphonBgraBlitPipeline,
  ),
];

// Initialize providers first so scenes see ready-to-use providers on state
bodyContourProvider.setup();
handBBoxProvider.setup();

// Initialize all scenes. Body loads Charmonman into its own P5GPU instance;
// fab_and_lies loads the Thai font (Ayuthaya) into its own P5GPU instance.
await Promise.all([
  oscSetup(device),
  tegakiSetup({ width: WIDTH, height: HEIGHT }),
  bodySetup(bodyP5),
  fabLoadAssets(fabP5),
]);
// Kinaree + fab_and_lies setup are sync; called outside Promise.all for clarity.
kinareeSetup({ width: WIDTH, height: HEIGHT });
fabSetup({ width: WIDTH, height: HEIGHT });

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
  panelWidth: 720,
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

  fabP5.beginFrame();
  if (globalParams.fabEnabled) fabDraw(fabP5, time);
  const fabTex = fabP5.endFrame();

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
  // Portrait quad — clear once so the three rotated quadrant blits lay into
  // a stable background (slot 4 stays the bg color, never overwritten).
  const quadClearPass = encoder.beginRenderPass({
    colorAttachments: [{
      view: portraitQuadView,
      loadOp: "clear",
      storeOp: "store",
      clearValue: clearColor,
    }],
  });
  quadClearPass.end();
  // Landscape composite is empty (no landscape scenes yet) — we just clear
  // it to the bg color so Syphon output 2 and the monitor tile have stable
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
  const fabView = fabTex.createView();
  // Painter's algorithm order: kinaree + fab_and_lies sit above osc/tegaki/
  // body so their strobe flashes and middle-third blackout overlay
  // everything; timing overlay stays on top.
  alphaBlit(device, encoder, alphaBlitPipeline, oscView, compositeView);
  alphaBlit(device, encoder, alphaBlitPipeline, tegakiView, compositeView);
  alphaBlit(device, encoder, alphaBlitPipeline, bodyView, compositeView);
  alphaBlit(device, encoder, alphaBlitPipeline, kinareeView, compositeView);
  alphaBlit(device, encoder, alphaBlitPipeline, fabView, compositeView);
  alphaBlit(device, encoder, alphaBlitPipeline, overlayTex.createView(), compositeView);

  // Resolve each channel's source view. Sketches render at 720×1280
  // (portrait); rotated 90° CW into a 960×540 (16:9) quadrant the aspect
  // matches exactly. Landscape in a vertical slot (or vertical in the
  // landscape slot) will rotate+stretch — kept selectable for debugging.
  // Ch 4 doesn't rotate; its view drives the landscape Syphon output
  // directly.
  const channelSources: Record<ChannelSource, GPUTextureView> = {
    none: emptyView,
    red: redView,
    osc: oscView,
    tegaki: tegakiView,
    body: bodyView,
    kinaree: kinareeView,
    fab: fabView,
    portrait: compositeView,
    landscape: landscapeCompositeView,
  };
  const channel1View = channelSources[globalParams.channel1Source];
  const channel2View = channelSources[globalParams.channel2Source];
  const channel3View = channelSources[globalParams.channel3Source];
  const channel4View = channelSources[globalParams.channel4Source];

  // Pack the 3 vertical channels into slots 1–3 of the quad wire format
  // (row-major: top-left, top-right, bottom-left), each rotated 90° CW
  // into its 16:9 quadrant. Slot 4 stays cleared (wire slack).
  const quadSlots: Array<{ x: number; y: number; view: GPUTextureView }> = [
    { x: 0, y: 0, view: channel1View }, // slot 1: top-left
    { x: QUADRANT_WIDTH, y: 0, view: channel2View }, // slot 2: top-right
    { x: 0, y: QUADRANT_HEIGHT, view: channel3View }, // slot 3: bottom-left
  ];
  for (const slot of quadSlots) {
    blitTile(
      device,
      encoder,
      rotatedBlitPipeline,
      slot.view,
      portraitQuadView,
      { x: slot.x, y: slot.y, width: QUADRANT_WIDTH, height: QUADRANT_HEIGHT },
    );
  }

  // Syphon captures: piggyback on the same encoder. Fire async publishes of
  // any previous-frame ping-pong buffers first so their map requests race in
  // parallel with this frame's GPU work.
  for (const output of syphonOutputs) output.tryPublish();
  // Output 1 always ships the packed quad (per-channel content lives inside);
  // Output 2 ships the selected landscape channel directly.
  const syphon1View = portraitQuadView;
  const syphon2View = channel4View;
  syphonOutputs[0]!.captureFrame(encoder, syphon1View);
  syphonOutputs[1]!.captureFrame(encoder, syphon2View);

  // Monitor view: top row is the 3 vertical channels side-by-side in
  // their native portrait orientation (*not* the packed quad — packing
  // is only for the Syphon wire). Bottom row is the landscape channel.
  // Clear to bg RGB so each sketch's transparent regions show the same
  // backdrop the Syphon output uses; alpha-blend per tile so
  // sketches-with-transparency composite correctly.
  const monitorClearPass = encoder.beginRenderPass({
    colorAttachments: [{
      view: monitorView,
      loadOp: "clear",
      storeOp: "store",
      clearValue: clearColor,
    }],
  });
  monitorClearPass.end();
  const portraitTiles: Array<{ x: number; view: GPUTextureView }> = [
    { x: 0, view: channel1View },
    { x: MONITOR_PORTRAIT_TILE_WIDTH, view: channel2View },
    { x: 2 * MONITOR_PORTRAIT_TILE_WIDTH, view: channel3View },
  ];
  for (const tile of portraitTiles) {
    blitTile(device, encoder, alphaBlitPipeline, tile.view, monitorView, {
      x: tile.x,
      y: 0,
      width: MONITOR_PORTRAIT_TILE_WIDTH,
      height: MONITOR_PORTRAIT_TILE_HEIGHT,
    });
  }
  blitTile(device, encoder, alphaBlitPipeline, channel4View, monitorView, {
    x: 0,
    y: MONITOR_PORTRAIT_TILE_HEIGHT,
    width: MONITOR_WIDTH,
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
    fabCleanup();
    bodyContourProvider.cleanup();
    handBBoxProvider.cleanup();
    perfPane.destroy();
    externalOscClient.close();
    oscP5.dispose();
    tegakiP5.dispose();
    bodyP5.dispose();
    kinareeP5.dispose();
    fabP5.dispose();
    overlayP5.dispose();
    compositeTexture.destroy();
    portraitQuadTexture.destroy();
    landscapeCompositeTexture.destroy();
    monitorTexture.destroy();
    emptyTexture.destroy();
    redTexture.destroy();
    for (const output of syphonOutputs) output.destroy();
  },
});
