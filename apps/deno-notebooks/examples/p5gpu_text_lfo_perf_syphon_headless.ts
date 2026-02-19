/// <reference lib="dom" />

// Run from apps/deno-notebooks:
//   SYPHON_BRIDGE_DEBUG=1 P5_HEADLESS_MAX_FRAMES=240 deno run \
//     --unstable-webgpu --unstable-ffi --allow-ffi --allow-read \
//     --allow-env --allow-write --config deno.json \
//     examples/p5gpu_text_lfo_perf_syphon_headless.ts

import { P5GPU } from "../tools/p5gpu.ts";
import { blit, createBlitPipeline } from "../window/blit.ts";
import { createHeadlessSyphonRenderer } from "../syphon/mod.ts";

const WIDTH = Number(Deno.env.get("P5_HEADLESS_WIDTH") ?? 1280);
const HEIGHT = Number(Deno.env.get("P5_HEADLESS_HEIGHT") ?? 720);
const FPS = Number(Deno.env.get("P5_HEADLESS_FPS") ?? 60);
const MAX_FRAMES = Number(Deno.env.get("P5_HEADLESS_MAX_FRAMES") ?? 240);
const LOG_EVERY = 20;
const SERVER_NAME = "P5GPU_LFO_Headless";
const CHAR_COUNT = 720;
const GRID_COLS = 36;
const TEXT_SIZE = 34;
const FONT_FAMILY = "Inter Variable";

const GLYPHS = "AVTOOLS-SYPHON-HEADLESS-0123456789";
const CHARS = Array.from(
  { length: CHAR_COUNT },
  (_, i) => GLYPHS[i % GLYPHS.length],
);
const GRID_ROWS = Math.ceil(CHARS.length / GRID_COLS);

const cellW = TEXT_SIZE * 0.8;
const cellH = TEXT_SIZE * 1.25;
const startX = Math.floor((WIDTH - GRID_COLS * cellW) * 0.5);
const startY = Math.floor((HEIGHT - GRID_ROWS * cellH) * 0.43);

const drawTimes: number[] = [];
function pushSample(v: number, maxSamples = LOG_EVERY) {
  drawTimes.push(v);
  if (drawTimes.length > maxSamples) {
    drawTimes.shift();
  }
}
function avg(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

console.log("[p5gpu-headless] requesting WebGPU adapter");
const adapter = await navigator.gpu.requestAdapter();
if (!adapter) {
  throw new Error("No WebGPU adapter available.");
}
const device = await adapter.requestDevice();
console.log("[p5gpu-headless] GPU device ready");

const p5 = new P5GPU(device, {
  width: WIDTH,
  height: HEIGHT,
  format: "bgra8unorm",
  sampleCount: 1,
});
const renderer = createHeadlessSyphonRenderer(device, {
  width: WIDTH,
  height: HEIGHT,
  fps: FPS,
  syphon: {
    serverName: SERVER_NAME,
    flipY: true,
  },
});
const blitPipeline = createBlitPipeline(device, "bgra8unorm");

console.log(
  `[p5gpu-headless] start frames=${MAX_FRAMES} fps=${FPS} chars=${CHARS.length} server="${SERVER_NAME}"`,
);

let running = true;
let stopHandle: { stop(): void } | null = null;

try {
  stopHandle = renderer.start((frameNumber, renderTexture) => {
    const drawStart = performance.now();
    const t = performance.now() * 0.001;

    p5.beginFrame();
    p5.background(0, 0, 0, 255);

    p5.noStroke();
    p5.fill(32, 37, 54, 255);
    p5.rect(0, 0, WIDTH, HEIGHT);

    p5.textFont(FONT_FAMILY);
    p5.textSize(TEXT_SIZE);
    p5.textStyle("normal");
    p5.textAlign("left", "top");
    p5.noStroke();

    for (let i = 0; i < CHARS.length; i += 1) {
      const row = Math.floor(i / GRID_COLS);
      const col = i % GRID_COLS;
      const x = startX + col * cellW;
      const y = startY + row * cellH;
      const lfo = 0.5 + 0.5 * Math.sin(t * 2.7 + i * 0.15);
      const weight = Math.round(320 + lfo * 560);
      const c = Math.round(120 + lfo * 120);

      p5.textWeight(weight);
      p5.fill(c, 190 - lfo * 50, 240 - lfo * 40, 245);
      p5.text(CHARS[i], x, y);
    }

    p5.textWeight(500);
    p5.textSize(20);
    p5.fill(230, 236, 245, 255);
    p5.text(
      `P5GPU Headless Syphon frame ${frameNumber + 1} / ${MAX_FRAMES}`,
      24,
      20,
    );

    const sourceTexture = p5.endFrame();
    pushSample(performance.now() - drawStart);

    const encoder = device.createCommandEncoder();
    blit(
      device,
      encoder,
      blitPipeline,
      sourceTexture.createView(),
      renderTexture.createView(),
    );

    if ((frameNumber + 1) % LOG_EVERY === 0 || frameNumber === 0) {
      console.log(
        `[p5gpu-headless] frame=${
          String(frameNumber + 1).padStart(5)
        } avgDrawMs(${LOG_EVERY})=${
          avg(drawTimes).toFixed(2)
        } published=${renderer.syphon.publishedCount} clients=${renderer.syphon.hasClients}`,
      );
    }

    if (frameNumber + 1 >= MAX_FRAMES) {
      running = false;
      queueMicrotask(() => stopHandle?.stop());
    }

    return encoder;
  });

  const hardTimeoutMs = Math.ceil((MAX_FRAMES / Math.max(1, FPS)) * 1000) +
    15_000;
  const startedAt = performance.now();
  while (running) {
    if (performance.now() - startedAt > hardTimeoutMs) {
      console.error(
        "[p5gpu-headless] timeout waiting for render loop to complete",
      );
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  stopHandle.stop();
  await device.queue.onSubmittedWorkDone();

  console.log(
    `[p5gpu-headless] done rendered=${MAX_FRAMES} published=${renderer.syphon.publishedCount}`,
  );
} finally {
  stopHandle?.stop();
  renderer.destroy();
  p5.dispose();
}
