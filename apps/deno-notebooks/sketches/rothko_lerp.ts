import { launch, type DateTimeContext } from "@avtools/core-timing";
import { createOSCClient } from "@/tools/osc.ts";

const client = createOSCClient("127.0.0.1", 10000);

const baseRectangleConfig = [
  { yPos: 0.4, height: 0.1 },
  { yPos: 0.15, height: 0.15 },
  { yPos: -0.25, height: 0.25 },
]

client.send('/yPos0', baseRectangleConfig[0].yPos)
client.send('/height0', baseRectangleConfig[0].height)
client.send('/yPos1', baseRectangleConfig[1].yPos)
client.send('/height1', baseRectangleConfig[1].height)
client.send('/yPos2', baseRectangleConfig[2].yPos)
client.send('/height2', baseRectangleConfig[2].height)

const liveRectVals = baseRectangleConfig.map(o => ({...o}))

function choose2NoReplacement(N: number) {
  if (!Number.isInteger(N) || N < 2) {
    throw new Error("N must be an integer >= 2");
  }

  const a = Math.floor(Math.random() * N);
  const b = Math.floor(Math.random() * (N - 1));
  // Map b from [0..N-2] into [0..N-1] \ {a}
  const bMapped = b >= a ? b + 1 : b;

  return [a, bMapped];
}

const SWAP_TIME = 3
const BETWEEN_SWAP_TIME = 10

const lerp = (a: number, b: number, p: number) => b*p + a*(1-p)

launch(async (ctx: DateTimeContext) => {
  await ctx.wait(5)
  while (true) {

    const [iA, iB] = choose2NoReplacement(liveRectVals.length)

    ctx.branch(async ctx => {
      const lerpStartTime = ctx.beats
      const lrv = liveRectVals

      let yPosA = lerp(lrv[iA].yPos, lrv[iB].yPos, 0)
      let yPosB = lerp(lrv[iB].yPos, lrv[iA].yPos, 0)
      let heightA = lerp(lrv[iA].height, lrv[iB].height, 0)
      let heightB = lerp(lrv[iB].height, lrv[iA].height, 0)


      while (ctx.beats < lerpStartTime + SWAP_TIME) {
        const normProg = (ctx.beats - lerpStartTime) / SWAP_TIME

        yPosA = lerp(lrv[iA].yPos, lrv[iB].yPos, normProg)
        yPosB = lerp(lrv[iB].yPos, lrv[iA].yPos, normProg)
        heightA = lerp(lrv[iA].height, lrv[iB].height, normProg)
        heightB = lerp(lrv[iB].height, lrv[iA].height, normProg)

        client.send(`/yPos${iA}`, yPosA)
        client.send(`/height${iA}`, heightA)
        client.send(`/yPos${iB}`, yPosB)
        client.send(`/height${iB}`, heightB)
        // console.log(yPosA, yPosB, heightA, heightB)
        await ctx.wait(0.016)
      }

      // Send exact final values at normProg=1
      yPosA = lrv[iB].yPos
      yPosB = lrv[iA].yPos
      heightA = lrv[iB].height
      heightB = lrv[iA].height

      client.send(`/yPos${iA}`, yPosA)
      client.send(`/height${iA}`, heightA)
      client.send(`/yPos${iB}`, yPosB)
      client.send(`/height${iB}`, heightB)

      liveRectVals[iA].yPos = yPosA
      liveRectVals[iB].yPos = yPosB
      liveRectVals[iA].height = heightA
      liveRectVals[iB].height = heightB
    })


    // client.send("/hello", "world", ctx.beats);
    await ctx.wait(BETWEEN_SWAP_TIME);
  }
}, { bpm: 60 });




/// <reference lib="dom" />

// P5GPU WebGPU text rendering benchmark.
//
// Run from apps/deno-notebooks:
//   P5_LFO_MAX_FRAMES=300 deno run --unstable-webgpu --unstable-ffi --allow-ffi \
//     --allow-read --allow-env --allow-net --allow-write \
//     examples/p5gpu_text_lfo_perf.ts

import { P5GPU } from "../tools/p5gpu.ts";
import { createBlitPipeline, blit } from "../window/mod.ts";
import { createSyphonGpuWindow } from "../syphon/mod.ts";

// ─── Config ──────────────────────────────────────────────────────────────

const WIDTH = 1280;
const HEIGHT = 720;
const LOG_EVERY = 20;
const CHAR_COUNT = 900;
const GRID_COLS = 40;
const TEXT_SIZE = 40;
const FONT_FAMILY = "Inter Variable";
const MAX_FRAMES = Number(Deno.env.get("P5_LFO_MAX_FRAMES") ?? 60000);
const SERVER_NAME = "P5GPU_LFO_Perf";
const WEIGHT_STEPS = 32;
const WEIGHT_MIN = 300;
const WEIGHT_MAX = 900;

// ─── Character grid (same LOREM as p5_text_lfo_perf.ts) ─────────────────

const LOREM = `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Morbi sed finibus lacus, vel lacinia nisi. Duis nisi est, pellentesque sit amet consequat in, maximus eu velit. Duis vitae aliquet urna. Nam finibus laoreet massa. In commodo elit vitae efficitur iaculis. Phasellus ullamcorper, ex eget porta ullamcorper, justo elit sollicitudin dui, vitae porttitor leo urna et ante. Cras venenatis scelerisque diam ac tristique. Proin lobortis facilisis leo eget tristique. Proin congue maximus neque auctor facilisis. Nam non sodales dui. Maecenas a vulputate dui. Donec a tellus vel ante accumsan rutrum. Duis est augue, scelerisque semper sollicitudin vitae, finibus in mauris. Nam ac purus mauris. Donec in venenatis urna, ut euismod velit. Sed blandit luctus convallis. Maecenas volutpat, augue at tempor ullamcorper, sem magna hendrerit turpis, et porttitor magna augue ac lorem. Integer malesuada placerat lorem vel semper. Ut ligula nunc, sollicitudin in euismod sed, pretium ac magna. Aliquam tempor nisl ante, sit amet euismod ex faucibus eget. Quisque ultrices, enim in rhoncus molestie, purus diam malesuada nisl, eget varius justo diam et sapien. Donec eleifend sodales mauris quis rhoncus. Nullam pharetra odio purus, id convallis tellus blandit vel. Duis ac sollicitudin tellus, a rhoncus quam. Integer feugiat felis in urna ornare eleifend. Aenean et mattis purus. Fusce porta enim vitae nisi viverra pellentesque. Ut laoreet, leo at accumsan laoreet, justo nibh ultricies mi, a dapibus urna dui sed libero. Maecenas aliquet at diam sit amet tempor. Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Proin vehicula vestibulum tortor sit amet auctor. Nullam sit amet pellentesque urna. Nullam dolor augue, porttitor luctus tristique a, egestas vel ante. Maecenas quis purus id tortor euismod vulputate. Sed posuere interdum sapien non bibendum. Fusce pulvinar sit amet magna sed sollicitudin. Orci varius natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus. Morbi feugiat rutrum odio, in vehicula elit scelerisque ac. Suspendisse id varius nunc, non porttitor velit. Mauris a ligula id mi ultrices vehicula. Morbi elit leo, consectetur at mattis ultricies, gravida et leo. `.slice(0, CHAR_COUNT);

const CHARS = LOREM.split("");
const GRID_ROWS = Math.ceil(CHARS.length / GRID_COLS);

// ─── Weight quantization ─────────────────────────────────────────────────
// Fewer unique weights → better glyph atlas cache hits.
// Mild power curve (exp > 1) gives more resolution at lighter weights
// where perceptual differences are more noticeable.

function quantizeWeight(lfo: number): number {
  const curved = Math.pow(lfo, 1.3);
  const step = Math.round(curved * (WEIGHT_STEPS - 1));
  return WEIGHT_MIN + (step / (WEIGHT_STEPS - 1)) * (WEIGHT_MAX - WEIGHT_MIN);
}

// Cell sizing: use the same heuristics as the Canvas2D benchmark
const cellW = TEXT_SIZE * 0.75;
const cellH = TEXT_SIZE * 1.3;
const startX = Math.floor((WIDTH - GRID_COLS * cellW) * 0.5);
const startY = Math.floor((HEIGHT - GRID_ROWS * cellH) * 0.4);

// ─── GPU + window setup ─────────────────────────────────────────────────

console.log("Requesting WebGPU adapter...");
const adapter = await navigator.gpu.requestAdapter();
if (!adapter) throw new Error("No WebGPU adapter");
const device = await adapter.requestDevice();
console.log("GPU device ready");

console.log("Creating window...");
const win = await createSyphonGpuWindow(device, {
  width: WIDTH,
  height: HEIGHT,
  title: "P5GPU text LFO perf benchmark",
  syphon: {
    serverName: SERVER_NAME,
    flipY: true,
  },
});
console.log("Window created, format:", win.format);

const blitPipeline = createBlitPipeline(device, win.format);

// ─── P5GPU instance ─────────────────────────────────────────────────────

const p5 = new P5GPU(device, { width: WIDTH, height: HEIGHT });
console.log(`[p5gpu-lfo-perf] start chars=${CHARS.length} font=${FONT_FAMILY} maxFrames=${MAX_FRAMES}`);
console.log(`[p5gpu-lfo-perf] logging running averages every ${LOG_EVERY} frames`);

// ─── Perf tracking ──────────────────────────────────────────────────────

const drawTimes: number[] = [];

function pushSample(arr: number[], v: number, maxSamples = LOG_EVERY): void {
  arr.push(v);
  if (arr.length > maxSamples) arr.shift();
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (const v of arr) sum += v;
  return sum / arr.length;
}

// ─── Render loop ────────────────────────────────────────────────────────

let running = true;

for (let frame = 0; frame < MAX_FRAMES && running; frame++) {
  // Poll window events
  const events = win.pollEvents();
  for (const ev of events) {
    if (ev.type === "close") running = false;
  }
  if (!running || win.closed) break;

  const drawStart = performance.now();

  p5.beginFrame();

  // Background
  p5.background(0,0,0,0);

  // Text setup
  p5.textFont(FONT_FAMILY);
  p5.textSize(TEXT_SIZE);
  p5.textStyle("normal");
  p5.noStroke();
  p5.textAlign("left", "top");

  // Animated character grid with per-character variable weight
  const t = performance.now() * 0.001;
  for (let i = 0; i < CHARS.length; i++) {
    const row = Math.floor(i / GRID_COLS);
    const col = i % GRID_COLS;
    const ch = CHARS[i];
    const x = startX + col * cellW;
    const y = startY + row * cellH;

    const lfo = 0.5 + 0.5 * Math.sin(t * -3.2 + i * 0.17);
    const weight = quantizeWeight(lfo);
    p5.textWeight(weight);

    const c = Math.round(170 + lfo * 70);
    p5.fill(c, c, c + 5);
    p5.text(ch, x, y);
  }

  // Title overlay
  // p5.textWeight(400);
  // p5.textStyle("normal");
  // p5.textSize(18);
  // p5.fill(138, 170, 255);
  // p5.text(
  //   `LFO weight modulation, manual character layout (${FONT_FAMILY}) [P5GPU]`,
  //   24,
  //   20,
  // );

  const texture = p5.endFrame();
  const drawMs = performance.now() - drawStart;
  pushSample(drawTimes, drawMs);

  // Blit P5GPU output texture to window surface
  try {
    const swapTexture = win.ctx.getCurrentTexture();
    const encoder = device.createCommandEncoder();
    blit(device, encoder, blitPipeline, texture.createView(), swapTexture.createView());
    device.queue.submit([encoder.finish()]);
    win.syphon.publishFrame();
    win.present();
  } catch (e) {
    console.error("Present error at frame", frame, ":", e);
    break;
  }

  // Log every LOG_EVERY frames
  if ((frame + 1) % LOG_EVERY === 0) {
    const avgDrawMs = avg(drawTimes);
    // console.log(`[p5gpu-lfo-perf] frame=${String(frame + 1).padStart(5)} avgDrawMs(${LOG_EVERY})=${avgDrawMs.toFixed(2)} syphonClients=${win.syphon.hasClients}`);
  }

  await new Promise((r) => setTimeout(r, 0));
}

console.log(`[p5gpu-lfo-perf] done, rendered ${MAX_FRAMES} frames`);

p5.dispose();
win.close();
