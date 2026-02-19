/// <reference lib="dom" />

// Run from apps/deno-notebooks:
//   SYPHON_BRIDGE_DEBUG=1 P5_HEADLESS_MAX_FRAMES=240 deno run \
//     --unstable-webgpu --unstable-ffi --allow-ffi --allow-read \
//     --allow-env --allow-write --config deno.json \
//     examples/p5gpu_text_lfo_perf_syphon_headless.ts

import { P5GPU } from "../tools/p5gpu.ts";
import { createHeadlessSyphonRenderer } from "../syphon/mod.ts";

const WIDTH = Number(Deno.env.get("P5_HEADLESS_WIDTH") ?? 1280);
const HEIGHT = Number(Deno.env.get("P5_HEADLESS_HEIGHT") ?? 720);
const FPS = Number(Deno.env.get("P5_HEADLESS_FPS") ?? 60);
const MAX_FRAMES = Number(Deno.env.get("P5_HEADLESS_MAX_FRAMES") ?? 2400);
const LOG_EVERY = 20;
const SERVER_NAME = "P5GPU_LFO_Headless";
const CHAR_COUNT = 900;
const GRID_COLS = 40;
const TEXT_SIZE = 40;
const FONT_FAMILY = "Inter Variable";
const WEIGHT_STEPS = 32;
const WEIGHT_MIN = 300;
const WEIGHT_MAX = 900;

const LOREM =
  `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Morbi sed finibus lacus, vel lacinia nisi. Duis nisi est, pellentesque sit amet consequat in, maximus eu velit. Duis vitae aliquet urna. Nam finibus laoreet massa. In commodo elit vitae efficitur iaculis. Phasellus ullamcorper, ex eget porta ullamcorper, justo elit sollicitudin dui, vitae porttitor leo urna et ante. Cras venenatis scelerisque diam ac tristique. Proin lobortis facilisis leo eget tristique. Proin congue maximus neque auctor facilisis. Nam non sodales dui. Maecenas a vulputate dui. Donec a tellus vel ante accumsan rutrum. Duis est augue, scelerisque semper sollicitudin vitae, finibus in mauris. Nam ac purus mauris. Donec in venenatis urna, ut euismod velit. Sed blandit luctus convallis. Maecenas volutpat, augue at tempor ullamcorper, sem magna hendrerit turpis, et porttitor magna augue ac lorem. Integer malesuada placerat lorem vel semper. Ut ligula nunc, sollicitudin in euismod sed, pretium ac magna. Aliquam tempor nisl ante, sit amet euismod ex faucibus eget. Quisque ultrices, enim in rhoncus molestie, purus diam malesuada nisl, eget varius justo diam et sapien. Donec eleifend sodales mauris quis rhoncus. Nullam pharetra odio purus, id convallis tellus blandit vel. Duis ac sollicitudin tellus, a rhoncus quam. Integer feugiat felis in urna ornare eleifend. Aenean et mattis purus. Fusce porta enim vitae nisi viverra pellentesque. Ut laoreet, leo at accumsan laoreet, justo nibh ultricies mi, a dapibus urna dui sed libero. Maecenas aliquet at diam sit amet tempor. Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Proin vehicula vestibulum tortor sit amet auctor. Nullam sit amet pellentesque urna. Nullam dolor augue, porttitor luctus tristique a, egestas vel ante. Maecenas quis purus id tortor euismod vulputate. Sed posuere interdum sapien non bibendum. Fusce pulvinar sit amet magna sed sollicitudin. Orci varius natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus. Morbi feugiat rutrum odio, in vehicula elit scelerisque ac. Suspendisse id varius nunc, non porttitor velit. Mauris a ligula id mi ultrices vehicula. Morbi elit leo, consectetur at mattis ultricies, gravida et leo. `
    .slice(
      0,
      CHAR_COUNT,
    );

const CHARS = LOREM.split("");
const GRID_ROWS = Math.ceil(CHARS.length / GRID_COLS);

function quantizeWeight(lfo: number): number {
  const curved = Math.pow(lfo, 1.3);
  const step = Math.round(curved * (WEIGHT_STEPS - 1));
  return WEIGHT_MIN + (step / (WEIGHT_STEPS - 1)) * (WEIGHT_MAX - WEIGHT_MIN);
}

const cellW = TEXT_SIZE * 0.75;
const cellH = TEXT_SIZE * 1.3;
const startX = Math.floor((WIDTH - GRID_COLS * cellW) * 0.5);
const startY = Math.floor((HEIGHT - GRID_ROWS * cellH) * 0.4);

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
    p5.background(0, 0, 0, 0);

    p5.textFont(FONT_FAMILY);
    p5.textSize(TEXT_SIZE);
    p5.textStyle("normal");
    p5.textAlign("left", "top");
    p5.noStroke();

    for (let i = 0; i < CHARS.length; i += 1) {
      const row = Math.floor(i / GRID_COLS);
      const col = i % GRID_COLS;
      const ch = CHARS[i];
      const x = startX + col * cellW;
      const y = startY + row * cellH;
      const lfo = 0.5 + 0.5 * Math.sin(t * -3.2 + i * 0.17);
      const weight = quantizeWeight(lfo);
      const c = Math.round(170 + lfo * 70);

      p5.textWeight(weight);
      p5.fill(c, c, c + 5);
      p5.text(ch, x, y);
    }

    const sourceTexture = p5.endFrame();
    pushSample(performance.now() - drawStart);

    const encoder = device.createCommandEncoder();
    encoder.copyTextureToTexture(
      { texture: sourceTexture },
      { texture: renderTexture },
      {
        width: WIDTH,
        height: HEIGHT,
        depthOrArrayLayers: 1,
      },
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
