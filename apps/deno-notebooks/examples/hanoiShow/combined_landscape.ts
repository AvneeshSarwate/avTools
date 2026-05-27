/// <reference lib="dom" />

// Combined Hanoi Show — landscape variant.
//
// Simplified routing: every sketch renders natively at 1920×1080
// (landscape 1080p) and alpha-blends into a single composite. One Syphon
// output ("Hanoi Show L") ships that composite verbatim — downstream
// handles column slicing and any physical-display mapping. No per-channel
// routing, no 2×2 packing, no rotation. Scenes that are aware of the 3-
// column projection (e.g. fab_and_lies' middle-third blackout) still
// encode that internally.
//
// Run from apps/deno-notebooks:
//   deno run --unstable-webgpu --unstable-ffi --allow-all examples/hanoiShow/combined_landscape.ts

import {
  alphaBlit,
  blit,
  type BlitPipeline,
  blitTile,
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
import { MidiAccess, type MidiInput } from "../../midi/mod.ts";

import {
  cleanup as tegakiCleanup,
  draw as tegakiDraw,
  macroDefs as tegakiMacroDefs,
  setup as tegakiSetup,
  setupPane as tegakiSetupPane,
  state as tegakiState,
} from "./p5gpu_tegaki_handwriting.ts";

import {
  cleanup as kinareeCleanup,
  draw as kinareeDraw,
  macroDefs as kinareeMacroDefs,
  setup as kinareeSetup,
  setupPane as kinareeSetupPane,
  state as kinareeState,
} from "./burning_kinaree.ts";

import {
  cleanup as ashesCleanup,
  draw as ashesDraw,
  macroDefs as ashesMacroDefs,
  setup as ashesSetup,
  setupPane as ashesSetupPane,
  state as ashesState,
} from "./ashes.ts";

import {
  cleanup as kinareeRingCleanup,
  draw as kinareeRingDraw,
  macroDefs as kinareeRingMacroDefs,
  setup as kinareeRingSetup,
  setupPane as kinareeRingSetupPane,
  state as kinareeRingState,
} from "./kinaree_ring.ts";

import {
  cleanup as plorkCleanup,
  draw as plorkDraw,
  macroDefs as plorkMacroDefs,
  setup as plorkSetup,
  setupPane as plorkSetupPane,
  state as plorkState,
} from "./plorkSketch.ts";

import {
  cleanup as fabCleanup,
  draw as fabDraw,
  loadAssets as fabLoadAssets,
  macroDefs as fabMacroDefs,
  setup as fabSetup,
  setupPane as fabSetupPane,
  state as fabState,
} from "./fab_and_lies.ts";

import { createBodyContourProvider } from "./body_contour_provider.ts";
import { createHandBBoxProvider } from "./hand_bbox_provider.ts";

// Landscape 1080p. Everything downstream (column slicing, physical display
// mapping) lives outside this process.
const WIDTH = 1920;
const HEIGHT = 1080;

// Monitor preview — single tile showing the composite at a readable size.
// Aspect matches WIDTH/HEIGHT so there's no distortion.
const MONITOR_WIDTH = 1280;
const MONITOR_HEIGHT = Math.round(MONITOR_WIDTH * HEIGHT / WIDTH);

// Keep the composed sketch from spinning so hard that UDP/WebSocket callbacks
// only run in occasional timer gaps.
const COMBINED_RENDER_YIELD_MS = 4;

// Outbound OSC destination for external-scene macro tabs on the perf pane.
const EXTERNAL_OSC_HOST = "127.0.0.1";
const EXTERNAL_OSC_PORT = 9004;
const PHYSICAL_MIDI_CONTROLLER_NAME = "Ableton Push 2 Live Port";
const MIDI_FALLBACK_PORT_NAME = "IAC Driver Bus 1";
const MIDI_FIGHTER_TWISTER_ENCODER_CHANNEL = 0;
const MIDI_FIGHTER_TWISTER_ENCODER_CC_MAX = 63;

const globalParams = {
  tegakiEnabled: true,
  kinareeRingEnabled: true,
  kinareeEnabled: true,
  ashesEnabled: true,
  plorkEnabled: true,
  fabEnabled: true,
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

// Body contour / hand bbox providers are shared infrastructure — tegaki
// reads from both even though the body-text scene is not in this variant.
const bodyContourProvider = createBodyContourProvider();
const handBBoxProvider = createHandBBoxProvider();
tegakiState.contourProvider = bodyContourProvider;
tegakiState.handBBoxProvider = handBBoxProvider;

const externalOscClient: OSCClient = createOSCClient(
  EXTERNAL_OSC_HOST,
  EXTERNAL_OSC_PORT,
);

const mirageMacros: Record<string, number> = {};
const mirageMacroDefs: MacroDef<number>[] = [
  {
    key: "sceneFade",
    defaultValue: 0.0,
    opts: { min: 0, max: 1, step: 0.001, label: "Scene Fade" },
    apply: (v) => externalOscClient.send("/mirage/sceneFade", v),
  },
  {
    key: "displace",
    defaultValue: 0.03,
    opts: { min: 0, max: 0.2, step: 0.001, label: "Displace" },
    apply: (v) => externalOscClient.send("/mirage/displace", v),
  },
  {
    key: "speed",
    defaultValue: 0.5,
    opts: { min: 0, max: 2, step: 0.01, label: "Speed" },
    apply: (v) => externalOscClient.send("/mirage/speed", v),
  },
];

const pickingKinarreeMacros: Record<string, number> = {};
const pickingKinarreeMacroDefs: MacroDef<number>[] = [
  {
    key: "sceneFade",
    defaultValue: 0.0,
    opts: { min: 0, max: 1, step: 0.001, label: "Scene Fade" },
    apply: (v) => externalOscClient.send("/picking_kinarree/sceneFade", v),
  },
  {
    key: "crossfade",
    defaultValue: 0.33,
    opts: { min: 0, max: 1, step: 0.001, label: "Crossfade" },
    apply: (v) => externalOscClient.send("/picking_kinarree/crossfade", v),
  },
  {
    key: "spread",
    defaultValue: 1.0,
    opts: { min: 0, max: 1, step: 0.001, label: "Spread" },
    apply: (v) => externalOscClient.send("/picking_kinarree/spread", v),
  },
];

function setupPane(pane: WindowTweakpane, refresh: () => void) {
  const tab = pane.addTab({
    pages: [
      { title: "Global" },
      { title: "Tegaki" },
      { title: "Fab & Lies" },
      { title: "Plork" },
      { title: "Kinaree Ring" },
      { title: "Kinaree" },
      { title: "Ashes" },
    ],
  });

  const global = tab.pages[0];

  const scenes = global.addFolder({ title: "Scenes" });
  scenes.addBinding(globalParams, "tegakiEnabled", { label: "Tegaki" });
  scenes.addBinding(globalParams, "fabEnabled", { label: "Fab & Lies" });
  scenes.addBinding(globalParams, "plorkEnabled", { label: "Plork" });
  scenes.addBinding(globalParams, "kinareeRingEnabled", {
    label: "Kinaree Ring",
  });
  scenes.addBinding(globalParams, "kinareeEnabled", { label: "Kinaree" });
  scenes.addBinding(globalParams, "ashesEnabled", { label: "Ashes" });

  bodyContourProvider.setupPane(
    global.addFolder({ title: "Body Contour", expanded: false }),
  );
  handBBoxProvider.setupPane(
    global.addFolder({ title: "Hands", expanded: false }),
  );

  const debug = global.addFolder({ title: "Debug" });
  debug.addBinding(globalParams, "showTiming", { label: "Frame Timing" });

  tegakiSetupPane(tab.pages[1], refresh);
  fabSetupPane(tab.pages[2], refresh);
  plorkSetupPane(tab.pages[3], refresh);
  kinareeRingSetupPane(tab.pages[4], refresh);
  kinareeSetupPane(tab.pages[5], refresh);
  ashesSetupPane(tab.pages[6], refresh);
}

function setupPerfPane(pane: WindowTweakpane, refresh: () => void) {
  const tab = pane.addTab({
    pages: [
      { title: "Tegaki" },
      { title: "Fab & Lies" },
      { title: "Plork" },
      { title: "Kinaree Ring" },
      { title: "Kinaree" },
      { title: "Ashes" },
      { title: "Mirage" },
      { title: "picking_kinarree" },
    ],
  });
  installMacros(tab.pages[0], tegakiState.macros, tegakiMacroDefs, refresh);
  installMacros(tab.pages[1], fabState.macros, fabMacroDefs, refresh);
  installMacros(tab.pages[2], plorkState.macros, plorkMacroDefs, refresh);
  installMacros(
    tab.pages[3],
    kinareeRingState.macros,
    kinareeRingMacroDefs,
    refresh,
  );
  installMacros(tab.pages[4], kinareeState.macros, kinareeMacroDefs, refresh);
  installMacros(tab.pages[5], ashesState.macros, ashesMacroDefs, refresh);
  installMacros(tab.pages[6], mirageMacros, mirageMacroDefs, refresh);
  installMacros(
    tab.pages[7],
    pickingKinarreeMacros,
    pickingKinarreeMacroDefs,
    refresh,
  );
}

interface PerfPaneMidiBinding {
  readonly midi: MidiAccess;
  readonly input: MidiInput;
}

function decodeTwisterRelativeDelta(ctrlVal: number): number {
  return ctrlVal - 64;
}

function decodePush2RelativeDelta(ctrlVal: number): number {
  return ctrlVal > 64 ?  -(128 - ctrlVal) : ctrlVal
}

function findMidiInputPort(midi: MidiAccess) {
  const inputs = midi.listInputs();
  const twister = inputs.find((port) =>
    port.name.toLowerCase().includes(PHYSICAL_MIDI_CONTROLLER_NAME.toLowerCase())
  );
  if (twister) {
    return {
      port: twister,
      source: PHYSICAL_MIDI_CONTROLLER_NAME,
    };
  }

  const fallback = inputs.find((port) =>
    port.name.toLowerCase().includes(MIDI_FALLBACK_PORT_NAME.toLowerCase())
  );
  if (fallback) {
    return {
      port: fallback,
      source: MIDI_FALLBACK_PORT_NAME,
    };
  }

  return null;
}

function attachPerfPaneMidi(pane: WindowTweakpane): PerfPaneMidiBinding | null {
  let midi: MidiAccess | null = null;
  try {
    midi = MidiAccess.open();
    const selected = findMidiInputPort(midi);

    if (!selected) {
      console.warn(
        `[combined_landscape] No ${PHYSICAL_MIDI_CONTROLLER_NAME} or ${MIDI_FALLBACK_PORT_NAME} MIDI input found; perf-pane MIDI disabled.`,
      );
      midi.close();
      return null;
    }

    const input = midi.openInput(selected.port.id, {
      rateHz: 500,
      rawCC: true,
    });

    input.onCC((evt) => {
      console.log(evt)
      if (evt.channel !== MIDI_FIGHTER_TWISTER_ENCODER_CHANNEL) return;
      // if (evt.ctrlNum < 0 || evt.ctrlNum > MIDI_FIGHTER_TWISTER_ENCODER_CC_MAX) return;

      const delta = decodePush2RelativeDelta(evt.ctrlVal);
      if (delta === 0) return;

      pane.sendClientMessage({
        type: "midiEncoderDelta",
        channel: evt.channel,
        cc: evt.ctrlNum - 71,
        delta,
      });
    });

    console.log(
      `[combined_landscape] Perf-pane MIDI attached to "${selected.port.name}" via ${selected.source} using default Twister encoder CCs.`,
    );

    return { midi, input };
  } catch (err) {
    console.warn("[combined_landscape] Failed to initialize perf-pane MIDI:", err);
    midi?.close();
    return null;
  }
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
// Single output: blit composite into a bgra8unorm staging texture, copy to
// a ping-pong readback buffer, fire-and-forget map + publish on the other
// buffer. Same structure as combined.ts, just one instance.
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
      if (busy[writeIdx]) return;
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
        return;
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
  if (!globalParams.showTiming) return;

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

// Per-scene P5GPU instances, all at native 1920×1080. Scenes MUST NOT call
// background() — the transparent clear is what makes alpha compositing work.
const tegakiP5 = new P5GPU(device, { width: WIDTH, height: HEIGHT });
const kinareeRingP5 = new P5GPU(device, { width: WIDTH, height: HEIGHT });
const kinareeP5 = new P5GPU(device, { width: WIDTH, height: HEIGHT });
const ashesP5 = new P5GPU(device, { width: WIDTH, height: HEIGHT });
const plorkP5 = new P5GPU(device, { width: WIDTH, height: HEIGHT });
const fabP5 = new P5GPU(device, { width: WIDTH, height: HEIGHT });
const overlayP5 = new P5GPU(device, { width: WIDTH, height: HEIGHT });

const COMPOSITE_FORMAT: GPUTextureFormat = "rgba8unorm";

// Single composite at 1920×1080 — all scenes alpha-blend into this, Syphon
// ships it verbatim, monitor scales it for preview.
const compositeTexture = device.createTexture({
  size: { width: WIDTH, height: HEIGHT },
  format: COMPOSITE_FORMAT,
  usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING |
    GPUTextureUsage.COPY_SRC,
});
const compositeView = compositeTexture.createView();
const alphaBlitPipeline = createAlphaBlitPipeline(device, COMPOSITE_FORMAT);

// Monitor texture — what the window displays. Scaled-down composite.
const monitorTexture = device.createTexture({
  size: { width: MONITOR_WIDTH, height: MONITOR_HEIGHT },
  format: COMPOSITE_FORMAT,
  usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING |
    GPUTextureUsage.COPY_SRC,
});
const monitorView = monitorTexture.createView();

// Single Syphon output at native 1920×1080. bgra8unorm matches what
// HeadlessSyphon expects on disk.
const syphonBgraBlitPipeline = createBlitPipeline(device, "bgra8unorm");
const syphonOutput = createSyphonOutput(
  device,
  WIDTH,
  HEIGHT,
  "Hanoi Show L",
  syphonBgraBlitPipeline,
);

// Initialize providers first so scenes see ready-to-use providers on state.
bodyContourProvider.setup();
handBBoxProvider.setup();

// Initialize all scenes. fab_and_lies loads Ayuthaya (Thai glyphs) into
// fabP5's text engine during the async phase.
await Promise.all([
  tegakiSetup({ width: WIDTH, height: HEIGHT }),
  plorkSetup({ width: WIDTH, height: HEIGHT, device }),
  fabLoadAssets(fabP5),
]);
kinareeRingSetup();
kinareeSetup({ width: WIDTH, height: HEIGHT });
ashesSetup({ width: WIDTH, height: HEIGHT });
fabSetup({ width: WIDTH, height: HEIGHT });

// Refresh both panes on any macro change. Declared before pane construction
// so scene setupPanes can capture it by reference.
let refreshAll: () => void = () => {};
const triggerRefresh = () => refreshAll();

const renderWindow = await createWindowRenderManager({
  device,
  width: MONITOR_WIDTH,
  height: MONITOR_HEIGHT,
  title: "Hanoi Show (landscape)",
  pane: {
    title: "Hanoi Show (landscape)",
    panelWidth: 620,
    panelHeight: 620,
    setup: (pane) => setupPane(pane, triggerRefresh),
  },
});

const perfPane = createWindowTweakpane(renderWindow.window, {
  title: "Perf",
  panelWidth: 700,
  panelHeight: 660,
  renderShell: (args) =>
    renderPerfShellHtml({
      title: args.title,
      wsUrl: args.wsUrl,
      mobileUrl: args.mobileUrl,
      qrSvg: args.qrSvg,
    }),
});
setupPerfPane(perfPane, triggerRefresh);
const perfPaneMidi = attachPerfPaneMidi(perfPane);

refreshAll = () => {
  renderWindow.pane?.refresh();
  perfPane.refresh();
};

await renderWindow.run(() => {
  const frameStart = performance.now();
  const time = performance.now() * 0.001;

  bodyContourProvider.tick();
  handBBoxProvider.tick();

  // Each scene draws into its own P5GPU. We always begin/end the frame so
  // every layer produces a valid texture (transparent when disabled).
  tegakiP5.beginFrame();
  if (globalParams.tegakiEnabled) {
    tegakiDraw(tegakiP5);
  } else {
    tegakiP5.clear();
  }
  const tegakiTex = tegakiP5.endFrame();

  kinareeRingP5.beginFrame();
  if (globalParams.kinareeRingEnabled) {
    kinareeRingDraw(kinareeRingP5, time);
  } else {
    kinareeRingP5.clear();
  }
  const kinareeRingTex = kinareeRingP5.endFrame();

  kinareeP5.beginFrame();
  if (globalParams.kinareeEnabled) {
    kinareeDraw(kinareeP5, time);
  } else {
    kinareeP5.clear();
  }
  const kinareeTex = kinareeP5.endFrame();

  ashesP5.beginFrame();
  if (globalParams.ashesEnabled) {
    ashesDraw(ashesP5, time);
  } else {
    ashesP5.clear();
  }
  const ashesTex = ashesP5.endFrame();

  const plorkView = plorkDraw(plorkP5, true, !globalParams.plorkEnabled);

  fabP5.beginFrame();
  if (globalParams.fabEnabled) {
    fabDraw(fabP5, time);
  } else {
    fabP5.clear();
  }
  const fabTex = fabP5.endFrame();

  overlayP5.beginFrame();
  drawTimingOverlay(overlayP5);
  const overlayTex = overlayP5.endFrame();

  // Composite: clear to transparent so downstream (Syphon consumer) sees
  // the sketches on a true alpha=0 backdrop and can composite over whatever
  // it wants. Every scene itself draws with transparent clear, so
  // alpha-blitting them over a transparent composite just stacks alpha.
  const encoder = device.createCommandEncoder();
  const transparentClear = { r: 0, g: 0, b: 0, a: 0 };
  const clearPass = encoder.beginRenderPass({
    colorAttachments: [{
      view: compositeView,
      loadOp: "clear",
      storeOp: "store",
      clearValue: transparentClear,
    }],
  });
  clearPass.end();

  alphaBlit(
    device,
    encoder,
    alphaBlitPipeline,
    tegakiTex.createView(),
    compositeView,
  );
  alphaBlit(
    device,
    encoder,
    alphaBlitPipeline,
    fabTex.createView(),
    compositeView,
  );
  alphaBlit(device, encoder, alphaBlitPipeline, plorkView, compositeView);
  alphaBlit(
    device,
    encoder,
    alphaBlitPipeline,
    kinareeRingTex.createView(),
    compositeView,
  );
  alphaBlit(
    device,
    encoder,
    alphaBlitPipeline,
    kinareeTex.createView(),
    compositeView,
  );
  alphaBlit(
    device,
    encoder,
    alphaBlitPipeline,
    ashesTex.createView(),
    compositeView,
  );
  alphaBlit(
    device,
    encoder,
    alphaBlitPipeline,
    overlayTex.createView(),
    compositeView,
  );

  // Syphon capture: fire async publish of any previous-frame mapped buffer
  // first so its request races alongside this frame's GPU work.
  syphonOutput.tryPublish();
  syphonOutput.captureFrame(encoder, compositeView);

  // Monitor: clear to opaque black so transparent regions of the composite
  // have something to sit on in the preview window. This matches what a
  // typical Syphon consumer does (premultiplied-over-black), so the
  // preview is an honest approximation of the downstream result.
  const monitorClearPass = encoder.beginRenderPass({
    colorAttachments: [{
      view: monitorView,
      loadOp: "clear",
      storeOp: "store",
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
    }],
  });
  monitorClearPass.end();
  blitTile(device, encoder, alphaBlitPipeline, compositeView, monitorView, {
    x: 0,
    y: 0,
    width: MONITOR_WIDTH,
    height: MONITOR_HEIGHT,
  });

  device.queue.submit([encoder.finish()]);

  updateTiming(frameStart, performance.now() - frameStart);
  return monitorView;
}, {
  yieldMs: COMBINED_RENDER_YIELD_MS,
  cleanup() {
    perfPaneMidi?.input.close();
    perfPaneMidi?.midi.close();
    tegakiCleanup();
    kinareeRingCleanup();
    kinareeCleanup();
    ashesCleanup();
    plorkCleanup();
    fabCleanup();
    bodyContourProvider.cleanup();
    handBBoxProvider.cleanup();
    perfPane.destroy();
    externalOscClient.close();
    tegakiP5.dispose();
    kinareeRingP5.dispose();
    kinareeP5.dispose();
    ashesP5.dispose();
    plorkP5.dispose();
    fabP5.dispose();
    overlayP5.dispose();
    compositeTexture.destroy();
    monitorTexture.destroy();
    syphonOutput.destroy();
  },
});
