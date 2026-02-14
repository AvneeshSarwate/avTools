/// <reference lib="dom" />

// Run from apps/deno-notebooks:
// deno run --unstable-webgpu --unstable-ffi --allow-ffi --allow-read --allow-env --allow-net --allow-write \
//   examples/p5_text_lfo_perf.ts

import { cleanupP5Deno, runP5RenderLoop, setupP5Deno, snapshotP5Frame } from "../tools/p5_deno_shim.ts";

const WIDTH = 1280;
const HEIGHT = 720;
const LOG_EVERY = 20;
const CHAR_COUNT = 900;
const GRID_COLS = 20;
const TEXT_SIZE = 40;
const FONT_FAMILY = "Inter Variable";
const DEBUG_LAYOUT = Deno.env.get("P5_LFO_DEBUG_LAYOUT") === "1";
const DEBUG_LAYOUT_FRAMES = Number(Deno.env.get("P5_LFO_DEBUG_LAYOUT_FRAMES") ?? 3);
const DEBUG_DRAW_GRID = Deno.env.get("P5_LFO_DEBUG_DRAW_GRID") === "1";
const MAX_FRAMES = Number(Deno.env.get("P5_LFO_MAX_FRAMES") ?? 0);
const SNAPSHOT_FRAME = Number(Deno.env.get("P5_LFO_SNAPSHOT_FRAME") ?? 0);
const SNAPSHOT_PATH = Deno.env.get("P5_LFO_SNAPSHOT_PATH") ??
  `.output/p5_text_lfo_perf_frame${Math.max(1, SNAPSHOT_FRAME)}.png`;

const LOREM = `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Morbi sed finibus lacus, vel lacinia nisi. Duis nisi est, pellentesque sit amet consequat in, maximus eu velit. Duis vitae aliquet urna. Nam finibus laoreet massa. In commodo elit vitae efficitur iaculis. Phasellus ullamcorper, ex eget porta ullamcorper, justo elit sollicitudin dui, vitae porttitor leo urna et ante. Cras venenatis scelerisque diam ac tristique. Proin lobortis facilisis leo eget tristique. Proin congue maximus neque auctor facilisis. Nam non sodales dui. Maecenas a vulputate dui. Donec a tellus vel ante accumsan rutrum. Duis est augue, scelerisque semper sollicitudin vitae, finibus in mauris. Nam ac purus mauris. Donec in venenatis urna, ut euismod velit. Sed blandit luctus convallis. Maecenas volutpat, augue at tempor ullamcorper, sem magna hendrerit turpis, et porttitor magna augue ac lorem. Integer malesuada placerat lorem vel semper. Ut ligula nunc, sollicitudin in euismod sed, pretium ac magna. Aliquam tempor nisl ante, sit amet euismod ex faucibus eget. Quisque ultrices, enim in rhoncus molestie, purus diam malesuada nisl, eget varius justo diam et sapien. Donec eleifend sodales mauris quis rhoncus. Nullam pharetra odio purus, id convallis tellus blandit vel. Duis ac sollicitudin tellus, a rhoncus quam. Integer feugiat felis in urna ornare eleifend. Aenean et mattis purus. Fusce porta enim vitae nisi viverra pellentesque. Ut laoreet, leo at accumsan laoreet, justo nibh ultricies mi, a dapibus urna dui sed libero. Maecenas aliquet at diam sit amet tempor. Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Proin vehicula vestibulum tortor sit amet auctor. Nullam sit amet pellentesque urna. Nullam dolor augue, porttitor luctus tristique a, egestas vel ante. Maecenas quis purus id tortor euismod vulputate. Sed posuere interdum sapien non bibendum. Fusce pulvinar sit amet magna sed sollicitudin. Orci varius natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus. Morbi feugiat rutrum odio, in vehicula elit scelerisque ac. Suspendisse id varius nunc, non porttitor velit. Mauris a ligula id mi ultrices vehicula. Morbi elit leo, consectetur at mattis ultricies, gravida et leo. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Morbi sed finibus lacus, vel lacinia nisi. Duis nisi est, pellentesque sit amet consequat in, maximus eu velit. Duis vitae aliquet urna. Nam finibus laoreet massa. In commodo elit vitae efficitur iaculis. Phasellus ullamcorper, ex eget porta ullamcorper, justo elit sollicitudin dui, vitae porttitor leo urna et ante. Cras venenatis scelerisque diam ac tristique. Proin lobortis facilisis leo eget tristique. Proin congue maximus neque auctor facilisis. Nam non sodales dui. Maecenas a vulputate dui. Donec a tellus vel ante accumsan rutrum. Duis est augue, scelerisque semper sollicitudin vitae, finibus in mauris. Nam ac purus mauris. Donec in venenatis urna, ut euismod velit. Sed blandit luctus convallis. Maecenas volutpat, augue at tempor ullamcorper, sem magna hendrerit turpis, et porttitor magna augue ac lorem. Integer malesuada placerat lorem vel semper. Ut ligula nunc, sollicitudin in euismod sed, pretium ac magna. Aliquam tempor nisl ante, sit amet euismod ex faucibus eget. Quisque ultrices, enim in rhoncus molestie, purus diam malesuada nisl, eget varius justo diam et sapien. Donec eleifend sodales mauris quis rhoncus. Nullam pharetra odio purus, id convallis tellus blandit vel. Duis ac sollicitudin tellus, a rhoncus quam. Integer feugiat felis in urna ornare eleifend. Aenean et mattis purus. Fusce porta enim vitae nisi viverra pellentesque. Ut laoreet, leo at accumsan laoreet, justo nibh ultricies mi, a dapibus urna dui sed libero. Maecenas aliquet at diam sit amet tempor. Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Proin vehicula vestibulum tortor sit amet auctor. Nullam sit amet pellentesque urna. Nullam dolor augue, porttitor luctus tristique a, egestas vel ante. Maecenas quis purus id tortor euismod vulputate. Sed posuere interdum sapien non bibendum. Fusce pulvinar sit amet magna sed sollicitudin. Orci varius natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus. Morbi feugiat rutrum odio, in vehicula elit scelerisque ac. Suspendisse id varius nunc, non porttitor velit. Mauris a ligula id mi ultrices vehicula. Morbi elit leo, consectetur at mattis ultricies, gravida et leo. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Morbi sed finibus lacus, vel lacinia nisi. Duis nisi est, pellentesque sit amet consequat in, maximus eu velit. Duis vitae aliquet urna. Nam finibus laoreet massa. In commodo elit vitae efficitur iaculis. Phasellus ullamcorper, ex eget porta ullamcorper, justo elit sollicitudin dui, vitae porttitor leo urna et ante. Cras venenatis scelerisque diam ac tristique. Proin lobortis facilisis leo eget tristique. Proin congue maximus neque auctor facilisis. Nam non sodales dui. Maecenas a vulputate dui. Donec a tellus vel ante accumsan rutrum. Duis est augue, scelerisque semper sollicitudin vitae, finibus in mauris. Nam ac purus mauris. Donec in venenatis urna, ut euismod velit. Sed blandit luctus convallis. Maecenas volutpat, augue at tempor ullamcorper, sem magna hendrerit turpis, et porttitor magna augue ac lorem. Integer malesuada placerat lorem vel semper. Ut ligula nunc, sollicitudin in euismod sed, pretium ac magna. Aliquam tempor nisl ante, sit amet euismod ex faucibus eget. Quisque ultrices, enim in rhoncus molestie, purus diam malesuada nisl, eget varius justo diam et sapien. Donec eleifend sodales mauris quis rhoncus. Nullam pharetra odio purus, id convallis tellus blandit vel. Duis ac sollicitudin tellus, a rhoncus quam. Integer feugiat felis in urna ornare eleifend. Aenean et mattis purus. Fusce porta enim vitae nisi viverra pellentesque. Ut laoreet, leo at accumsan laoreet, justo nibh ultricies mi, a dapibus urna dui sed libero. Maecenas aliquet at diam sit amet tempor. Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Proin vehicula vestibulum tortor sit amet auctor. Nullam sit amet pellentesque urna. Nullam dolor augue, porttitor luctus tristique a, egestas vel ante. Maecenas quis purus id tortor euismod vulputate. Sed posuere interdum sapien non bibendum. Fusce pulvinar sit amet magna sed sollicitudin. Orci varius natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus. Morbi feugiat rutrum odio, in vehicula elit scelerisque ac. Suspendisse id varius nunc, non porttitor velit. Mauris a ligula id mi ultrices vehicula. Morbi elit leo, consectetur at mattis ultricies, gravida et leo. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Morbi sed finibus lacus, vel lacinia nisi. Duis nisi est, pellentesque sit amet consequat in, maximus eu velit. Duis vitae aliquet urna. Nam finibus laoreet massa. In commodo elit vitae efficitur iaculis. Phasellus ullamcorper, ex eget porta ullamcorper, justo elit sollicitudin dui, vitae porttitor leo urna et ante. Cras venenatis scelerisque diam ac tristique. Proin lobortis facilisis leo eget tristique. Proin congue maximus neque auctor facilisis. Nam non sodales dui. Maecenas a vulputate dui. Donec a tellus vel ante accumsan rutrum. Duis est augue, scelerisque semper sollicitudin vitae, finibus in mauris. Nam ac purus mauris. Donec in venenatis urna, ut euismod velit. Sed blandit luctus convallis. Maecenas volutpat, augue at tempor ullamcorper, sem magna hendrerit turpis, et porttitor magna augue ac lorem. Integer malesuada placerat lorem vel semper. Ut ligula nunc, sollicitudin in euismod sed, pretium ac magna. Aliquam tempor nisl ante, sit amet euismod ex faucibus eget. Quisque ultrices, enim in rhoncus molestie, purus diam malesuada nisl, eget varius justo diam et sapien. Donec eleifend sodales mauris quis rhoncus. Nullam pharetra odio purus, id convallis tellus blandit vel. Duis ac sollicitudin tellus, a rhoncus quam. Integer feugiat felis in urna ornare eleifend. Aenean et mattis purus. Fusce porta enim vitae nisi viverra pellentesque. Ut laoreet, leo at accumsan laoreet, justo nibh ultricies mi, a dapibus urna dui sed libero. Maecenas aliquet at diam sit amet tempor. Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Proin vehicula vestibulum tortor sit amet auctor. Nullam sit amet pellentesque urna. Nullam dolor augue, porttitor luctus tristique a, egestas vel ante. Maecenas quis purus id tortor euismod vulputate. Sed posuere interdum sapien non bibendum. Fusce pulvinar sit amet magna sed sollicitudin. Orci varius natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus. Morbi feugiat rutrum odio, in vehicula elit scelerisque ac. Suspendisse id varius nunc, non porttitor velit. Mauris a ligula id mi ultrices vehicula. Morbi elit leo, consectetur at mattis ultricies, gravida et leo. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Morbi sed finibus lacus, vel lacinia nisi. Duis nisi est, pellentesque sit amet consequat in, maximus eu velit. Duis vitae aliquet urna. Nam finibus laoreet massa. In commodo elit vitae efficitur iaculis. Phasellus ullamcorper, ex eget porta ullamcorper, justo elit sollicitudin dui, vitae porttitor leo urna et ante. Cras venenatis scelerisque diam ac tristique. Proin lobortis facilisis leo eget tristique. Proin congue maximus neque auctor facilisis. Nam non sodales dui. Maecenas a vulputate dui. Donec a tellus vel ante accumsan rutrum. Duis est augue, scelerisque semper sollicitudin vitae, finibus in mauris. Nam ac purus mauris. Donec in venenatis urna, ut euismod velit. Sed blandit luctus convallis. Maecenas volutpat, augue at tempor ullamcorper, sem magna hendrerit turpis, et porttitor magna augue ac lorem. Integer malesuada placerat lorem vel semper. Ut ligula nunc, sollicitudin in euismod sed, pretium ac magna. Aliquam tempor nisl ante, sit amet euismod ex faucibus eget. Quisque ultrices, enim in rhoncus molestie, purus diam malesuada nisl, eget varius justo diam et sapien. Donec eleifend sodales mauris quis rhoncus. Nullam pharetra odio purus, id convallis tellus blandit vel. Duis ac sollicitudin tellus, a rhoncus quam. Integer feugiat felis in urna ornare eleifend. Aenean et mattis purus. Fusce porta enim vitae nisi viverra pellentesque. Ut laoreet, leo at accumsan laoreet, justo nibh ultricies mi, a dapibus urna dui sed libero. Maecenas aliquet at diam sit amet tempor. Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Proin vehicula vestibulum tortor sit amet auctor. Nullam sit amet pellentesque urna. Nullam dolor augue, porttitor luctus tristique a, egestas vel ante. Maecenas quis purus id tortor euismod vulputate. Sed posuere interdum sapien non bibendum. Fusce pulvinar sit amet magna sed sollicitudin. Orci varius natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus. Morbi feugiat rutrum odio, in vehicula elit scelerisque ac. Suspendisse id varius nunc, non porttitor velit. Mauris a ligula id mi ultrices vehicula. Morbi elit leo, consectetur at mattis ultricies, gravida et leo. 
`.slice(0, CHAR_COUNT);

const CHARS = LOREM.split("");

// deno-lint-ignore no-explicit-any
const ctx = await setupP5Deno((p: any) => {
  let supportsTextWeight = false;
  let gridCols = GRID_COLS;
  let cellW = TEXT_SIZE * 0.75;
  let cellH = TEXT_SIZE * 1.3;
  let startX = 40;
  let startY = 90;
  let metricProbeWidth = NaN;
  let metricProbeAscent = NaN;
  let metricProbeDescent = NaN;
  let metricProbeLeading = NaN;
  let lastFrameTime = 0;
  const frameTimes: number[] = [];
  const drawTimes: number[] = [];

  const pushSample = (arr: number[], v: number, maxSamples = LOG_EVERY): void => {
    arr.push(v);
    if (arr.length > maxSamples) arr.shift();
  };

  const avg = (arr: number[]): number => {
    if (arr.length === 0) return 0;
    let sum = 0;
    for (const v of arr) sum += v;
    return sum / arr.length;
  };

  const recomputeLayout = (): void => {
    // Metric-driven manual layout (intentionally tied to p5 text metrics).
    p.textFont(FONT_FAMILY);
    p.textSize(TEXT_SIZE);
    p.textStyle(p.NORMAL);
    if (supportsTextWeight) p.textWeight(400);

    metricProbeWidth = Number(p.textWidth("M"));
    metricProbeAscent = Number(p.textAscent("Mg"));
    metricProbeDescent = Number(p.textDescent("g"));
    metricProbeLeading = Number(p.textLeading());

    const metricHeight = Number.isFinite(metricProbeLeading) && metricProbeLeading > 0
      ? metricProbeLeading
      : metricProbeAscent + metricProbeDescent;

    cellW = Number.isFinite(metricProbeWidth) && metricProbeWidth > 0
      ? metricProbeWidth
      : TEXT_SIZE * 0.75;
    cellH = Number.isFinite(metricHeight) && metricHeight > 0
      ? metricHeight
      : TEXT_SIZE * 1.3;

    gridCols = Math.min(GRID_COLS, CHARS.length);
    const rows = Math.ceil(CHARS.length / gridCols);
    startX = Math.floor((p.width - gridCols * cellW) * 0.5);
    startY = Math.floor((p.height - rows * cellH) * 0.4);
  };

  p.setup = () => {
    p.createCanvas(WIDTH, HEIGHT);
    p.pixelDensity(1);
    p.noStroke();
    p.textAlign(p.LEFT, p.TOP);
    p.textWrap(p.CHAR);

    supportsTextWeight = typeof p.textWeight === "function";
    recomputeLayout();
    lastFrameTime = performance.now();

    console.log(
      `[lfo-text-perf] start chars=${CHARS.length} font=${FONT_FAMILY} textWeight=${supportsTextWeight ? "yes" : "no"}`,
    );
    console.log(`[lfo-text-perf] logging running averages every ${LOG_EVERY} frames`);
  };

  p.draw = () => {
    const drawStart = performance.now();
    const frameNow = drawStart;
    const frameMs = frameNow - lastFrameTime;
    lastFrameTime = frameNow;
    pushSample(frameTimes, frameMs);

    p.background(15, 18, 26);
    p.textFont(FONT_FAMILY);
    p.textSize(TEXT_SIZE);
    p.textStyle(p.NORMAL);
    recomputeLayout();

    const t = frameNow * 0.001;
    const rows = Math.ceil(CHARS.length / gridCols);
    const uniqueYs = new Set<number>();
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let nonFiniteLayout = 0;
    const sampleLogs: string[] = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < gridCols; col++) {
        const i = row * gridCols + col;
        if (i >= CHARS.length) break;

        const ch = CHARS[i];
        const x = startX + col * cellW;
        const y = startY + row * cellH;
        uniqueYs.add(y);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          nonFiniteLayout += 1;
        }
        if (DEBUG_LAYOUT && p.frameCount <= DEBUG_LAYOUT_FRAMES && i < 24) {
          sampleLogs.push(`i=${i} r=${row} c=${col} x=${x.toFixed(1)} y=${y.toFixed(1)} ch=${JSON.stringify(ch)}`);
        }

        const lfo = 0.5 + 0.5 * Math.sin(t * 2.2 + i * 0.17);
        const weight = Math.round(300 + lfo * 600);
        if (supportsTextWeight) {
          p.textWeight(weight);
        } else {
          p.textStyle(weight >= 650 ? p.BOLD : p.NORMAL);
        }

        const c = Math.round(170 + lfo * 70);
        p.fill(c, c, c + 5);
        p.text(ch, x, y);
        if (DEBUG_DRAW_GRID) {
          p.fill(255, 80, 80, 130);
          p.rect(x, y, 2, 2);
        }
      }
    }

    if (DEBUG_LAYOUT && p.frameCount <= DEBUG_LAYOUT_FRAMES) {
      console.log(
        `[lfo-text-perf][layout] frame=${p.frameCount} rows=${rows} cols=${gridCols} chars=${CHARS.length} cellW=${cellW} cellH=${cellH} startX=${startX} startY=${startY} uniqueY=${uniqueYs.size} minY=${minY.toFixed(1)} maxY=${maxY.toFixed(1)} nonFinite=${nonFiniteLayout} metricW=${metricProbeWidth} metricAsc=${metricProbeAscent} metricDesc=${metricProbeDescent} metricLeading=${metricProbeLeading}`,
      );
      for (const line of sampleLogs) console.log(`[lfo-text-perf][layout] ${line}`);
      if (rows > 1 && uniqueYs.size === 1) {
        console.log("[lfo-text-perf][layout][WARN] rows>1 but all y values collapsed to a single line");
      }
    }

    if (supportsTextWeight) p.textWeight(400);
    p.textStyle(p.NORMAL);
    p.textSize(18);
    p.fill(138, 170, 255);
    p.text(
      `LFO weight modulation, manual character layout (${FONT_FAMILY})`,
      24,
      20,
    );

    const drawMs = performance.now() - drawStart;
    pushSample(drawTimes, drawMs);

    if (p.frameCount % LOG_EVERY === 0) {
      const avgFrameMs = avg(frameTimes);
      const avgDrawMs = avg(drawTimes);
      const approxFps = avgFrameMs > 0 ? 1000 / avgFrameMs : 0;
      console.log(
        `[lfo-text-perf] frame=${String(p.frameCount).padStart(5)} avgFrameMs(${LOG_EVERY})=${avgFrameMs.toFixed(2)} avgDrawMs(${LOG_EVERY})=${avgDrawMs.toFixed(2)} fps≈${approxFps.toFixed(1)}`,
      );
    }
  };
}, {
  width: WIDTH,
  height: HEIGHT,
  title: "p5 text LFO perf benchmark",
});

try {
  const shouldSnapshot = SNAPSHOT_FRAME > 0;
  const snapshotTarget = Math.max(1, Math.floor(SNAPSHOT_FRAME));
  const renderFrames = MAX_FRAMES > 0
    ? Math.floor(MAX_FRAMES)
    : shouldSnapshot
    ? Math.max(0, snapshotTarget - 1)
    : 0;

  await runP5RenderLoop(
    ctx,
    renderFrames > 0 ? { autoClose: true, maxFrames: renderFrames } : { autoClose: false },
  );
  if (shouldSnapshot) {
    await snapshotP5Frame(ctx, SNAPSHOT_PATH);
    console.log(`[lfo-text-perf] snapshot_frame=${snapshotTarget} path=${SNAPSHOT_PATH}`);
  }
} finally {
  cleanupP5Deno(ctx);
}
