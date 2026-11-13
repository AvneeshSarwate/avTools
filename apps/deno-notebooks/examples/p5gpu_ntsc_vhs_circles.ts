/// <reference lib="dom" />

// RGB circle demo routed through the WebGPU-only NTSC/VHS compute effect.
//
// Run from apps/deno-notebooks:
//   deno run --unstable-webgpu --unstable-ffi --allow-all examples/p5gpu_ntsc_vhs_circles.ts

import {
  createWindowRenderManager,
  requestWebGpuDevice,
  type WindowTweakpane,
} from "../window/mod.ts";
import { P5GPU } from "../tools/p5gpu.ts";
import {
  DEFAULT_NTSC_VHS_SETTINGS,
  NTSC_RS_STABLE_APPROX_SETTINGS,
  NtscVhsGpuEffect,
  type NtscVhsSettings,
  VHS_LOOK_SETTINGS,
} from "../tools/ntsc_vhs_gpu.ts";

const WIDTH = 960;
const HEIGHT = 540;

const sceneParams = {
  speed: 1.0,
  circleSize: 120,
  orbitRadius: 140,
  glowSize: 260,
  trailAlpha: 255,
  enabled: true,
};

const effectParams = { ...VHS_LOOK_SETTINGS } as
  & NtscVhsSettings
  & Record<string, number>;

const device = await requestWebGpuDevice();
const renderWindow = await createWindowRenderManager({
  device,
  width: WIDTH,
  height: HEIGHT,
  title: "p5gpu NTSC/VHS Circles",
  pane: {
    title: "NTSC/VHS",
    panelWidth: 420,
    panelHeight: 760,
    setup: setupPane,
  },
});

const p5 = new P5GPU(device, {
  width: WIDTH,
  height: HEIGHT,
  format: "rgba8unorm",
  sampleCount: 1,
});
const placeholder = device.createTexture({
  size: { width: WIDTH, height: HEIGHT },
  format: "rgba8unorm",
  usage: GPUTextureUsage.TEXTURE_BINDING,
});
const ntsc = new NtscVhsGpuEffect(
  device,
  { src: placeholder },
  WIDTH,
  HEIGHT,
  effectParams,
);

let frame = 0;

await renderWindow.run(renderFrame, { cleanup, yieldMs: 1 });

function renderFrame() {
  const time = performance.now() * 0.001 * sceneParams.speed;

  p5.beginFrame();
  drawCircles(time);
  const sceneTexture = p5.endFrame();

  if (!sceneParams.enabled) {
    return sceneTexture;
  }

  ntsc.setSrcs({ src: sceneTexture });
  ntsc.setSettings(effectParams);
  ntsc.setFrame(frame);
  ntsc.render();
  frame += 1;
  return ntsc;
}

function drawCircles(time: number): void {
  p5.background(4, 5, 8, sceneParams.trailAlpha);
  p5.noStroke();

  drawGrid(time);

  const colors: Array<[number, number, number]> = [
    [255, 36, 28],
    [40, 245, 90],
    [36, 132, 255],
  ];

  for (let i = 0; i < colors.length; i += 1) {
    const phase = time * (0.72 + i * 0.13) + i * Math.PI * 2 / colors.length;
    const wobble = Math.sin(time * 0.41 + i * 1.7);
    const x = WIDTH * 0.5 +
      Math.cos(phase) * (sceneParams.orbitRadius + wobble * 44) +
      Math.sin(time * 0.23 + i) * WIDTH * 0.16;
    const y = HEIGHT * 0.5 +
      Math.sin(phase * 1.17) * (sceneParams.orbitRadius * 0.58 + wobble * 26);
    const [r, g, b] = colors[i];

    p5.fill(r, g, b, 38);
    p5.circle(x, y, sceneParams.glowSize);
    p5.fill(r, g, b, 112);
    p5.circle(x, y, sceneParams.glowSize * 0.52);
    p5.fill(r, g, b, 235);
    p5.circle(x, y, sceneParams.circleSize);
  }

  p5.fill(255, 255, 255, 180);
  p5.circle(
    WIDTH * 0.5 + Math.cos(time * 0.37) * sceneParams.orbitRadius * 1.7,
    HEIGHT * 0.5 + Math.sin(time * 0.51) * sceneParams.orbitRadius * 0.8,
    sceneParams.circleSize * 0.32,
  );
}

function drawGrid(time: number): void {
  p5.stroke(255, 255, 255, 32);
  p5.strokeWeight(1);
  for (let y = 60; y < HEIGHT; y += 60) {
    const offset = Math.sin(time * 0.4 + y * 0.01) * 12;
    p5.line(0, y + offset, WIDTH, y - offset);
  }
  for (let x = 80; x < WIDTH; x += 80) {
    p5.line(x, 0, x + Math.sin(time * 0.3 + x) * 18, HEIGHT);
  }
  p5.noStroke();
}

function setupPane(pane: WindowTweakpane): void {
  const presets = pane.addFolder({ title: "Presets" });
  presets.addButton({ title: "VHS look" }).on(
    "click",
    () => applyPreset(pane, VHS_LOOK_SETTINGS),
  );
  presets.addButton({ title: "ntsc-rs stable approx" }).on("click", () => {
    applyPreset(pane, NTSC_RS_STABLE_APPROX_SETTINGS);
  });
  presets.addButton({ title: "Default NTSC/VHS" }).on(
    "click",
    () => applyPreset(pane, DEFAULT_NTSC_VHS_SETTINGS),
  );

  const scene = pane.addFolder({ title: "Scene" });
  scene.addBinding(sceneParams, "enabled", { label: "Enable Effect" });
  scene.addBinding(sceneParams, "speed", {
    min: 0,
    max: 3,
    step: 0.01,
    label: "Speed",
  });
  scene.addBinding(sceneParams, "circleSize", {
    min: 20,
    max: 260,
    step: 1,
    label: "Circle Size",
  });
  scene.addBinding(sceneParams, "orbitRadius", {
    min: 20,
    max: 300,
    step: 1,
    label: "Orbit Radius",
  });
  scene.addBinding(sceneParams, "glowSize", {
    min: 40,
    max: 520,
    step: 1,
    label: "Glow Size",
  });
  scene.addBinding(sceneParams, "trailAlpha", {
    min: 0,
    max: 255,
    step: 1,
    label: "BG Alpha",
  });

  const signal = pane.addFolder({ title: "NTSC Signal" });
  signal.addBinding(effectParams, "lumaSmear", {
    min: 0,
    max: 1,
    step: 0.001,
    label: "Luma Smear",
  });
  signal.addBinding(effectParams, "chromaBlur", {
    min: 0,
    max: 1.5,
    step: 0.001,
    label: "Chroma Blur",
  });
  signal.addBinding(effectParams, "chromaDelayX", {
    min: -8,
    max: 8,
    step: 0.1,
    label: "Chroma Delay X",
  });
  signal.addBinding(effectParams, "chromaDelayY", {
    min: -4,
    max: 4,
    step: 1,
    label: "Chroma Delay Y",
  });
  signal.addBinding(effectParams, "compositeSharpness", {
    min: -1,
    max: 2.5,
    step: 0.001,
    label: "Composite Sharp",
  });
  signal.addBinding(effectParams, "ringingIntensity", {
    min: 0,
    max: 2.5,
    step: 0.001,
    label: "Ringing",
  });
  signal.addBinding(effectParams, "ringingFrequency", {
    min: 0,
    max: 1,
    step: 0.001,
    label: "Ring Freq",
  });
  signal.addBinding(effectParams, "vhsSharpen", {
    min: -0.5,
    max: 1,
    step: 0.001,
    label: "VHS Sharpen",
  });
  signal.addBinding(effectParams, "verticalBlend", {
    min: 0,
    max: 1,
    step: 0.001,
    label: "Vert Blend",
  });
  signal.addBinding(effectParams, "tapeSpeed", {
    min: 0.25,
    max: 2,
    step: 0.01,
    label: "Tape Speed",
  });

  const instability = pane.addFolder({ title: "VHS Instability" });
  instability.addBinding(effectParams, "scanlineIntensity", {
    min: 0,
    max: 0.6,
    step: 0.001,
    label: "Scanlines",
  });
  instability.addBinding(effectParams, "edgeWaveIntensity", {
    min: 0,
    max: 8,
    step: 0.01,
    label: "Edge Wave",
  });
  instability.addBinding(effectParams, "edgeWaveFrequency", {
    min: 0,
    max: 0.2,
    step: 0.001,
    label: "Wave Freq",
  });
  instability.addBinding(effectParams, "edgeWaveSpeed", {
    min: 0,
    max: 8,
    step: 0.01,
    label: "Wave Speed",
  });
  instability.addBinding(effectParams, "headSwitchingHeight", {
    min: 0,
    max: 60,
    step: 1,
    label: "Head Height",
  });
  instability.addBinding(effectParams, "headSwitchingShift", {
    min: -80,
    max: 80,
    step: 1,
    label: "Head Shift",
  });

  const noise = pane.addFolder({ title: "Noise and Color" });
  noise.addBinding(effectParams, "noiseIntensity", {
    min: 0,
    max: 0.08,
    step: 0.0005,
    label: "Noise",
  });
  noise.addBinding(effectParams, "snowDensity", {
    min: 0,
    max: 0.02,
    step: 0.0001,
    label: "Snow Density",
  });
  noise.addBinding(effectParams, "snowStrength", {
    min: 0,
    max: 2,
    step: 0.001,
    label: "Snow Strength",
  });
  noise.addBinding(effectParams, "chromaPhaseError", {
    min: -0.25,
    max: 0.25,
    step: 0.001,
    label: "Hue Drift",
  });
  noise.addBinding(effectParams, "chromaLossDensity", {
    min: 0,
    max: 0.05,
    step: 0.0005,
    label: "Chroma Loss Density",
  });
  noise.addBinding(effectParams, "chromaLossAmount", {
    min: 0,
    max: 1,
    step: 0.001,
    label: "Chroma Loss Amount",
  });
}

function applyPreset(pane: WindowTweakpane, preset: NtscVhsSettings): void {
  Object.assign(effectParams, preset);
  pane.refresh();
}

function cleanup(): void {
  ntsc.dispose();
  placeholder.destroy();
  p5.dispose();
}
