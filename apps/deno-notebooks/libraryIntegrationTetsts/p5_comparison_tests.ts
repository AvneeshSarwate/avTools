/// <reference lib="dom" />

// Run from apps/deno-notebooks:
// deno run --unstable-webgpu --unstable-ffi --allow-ffi --allow-read --allow-env --allow-write \
//   libraryIntegrationTetsts/p5_comparison_tests.ts

import { setupP5Deno, snapshotP5Frame, cleanupP5Deno } from "../tools/p5_deno_shim.ts";
import { P5GPU } from "../tools/p5gpu.ts";
import { requestWebGpuDevice, writeTextureToPng } from "./raw-webgpu-helpers.ts";
import type { DrawingAPI, TestSketch } from "./p5_test_sketches.ts";
import { P5_TEST_SKETCHES } from "./p5_test_sketches.ts";
import { comparePngFiles } from "./compare_renders.ts";

const OUTPUT_ROOT = ".output";
const REFERENCE_DIR = `${OUTPUT_ROOT}/p5-reference`;
const GPU_DIR = `${OUTPUT_ROOT}/p5gpu`;
const DIFF_DIR = `${OUTPUT_ROOT}/p5-diff`;

const MAX_PHASE = Number(Deno.env.get("P5GPU_MAX_PHASE") ?? 1);
const NAME_FILTER = Deno.env.get("P5GPU_NAME_FILTER")?.trim() ?? "";
const RMSE_THRESHOLD = Number(Deno.env.get("P5GPU_RMSE_THRESHOLD") ?? 8.0);
const MAX_ERROR_THRESHOLD = Number(Deno.env.get("P5GPU_MAX_ERROR_THRESHOLD") ?? 255);
const DIFF_RATIO_THRESHOLD = Number(Deno.env.get("P5GPU_DIFF_RATIO_THRESHOLD") ?? 0.05);

interface SketchResult {
  name: string;
  rmse: number;
  maxError: number;
  diffPixels: number;
  totalPixels: number;
  pass: boolean;
}

async function renderReference(sketch: TestSketch, outPath: string): Promise<void> {
  const ctx = await setupP5Deno(
    // deno-lint-ignore no-explicit-any
    (p: any) => {
      p.setup = () => {
        p.createCanvas(sketch.width, sketch.height);
        p.noLoop();
      };
      p.draw = () => {
        sketch.draw(p as DrawingAPI);
      };
    },
    { headless: true, width: sketch.width, height: sketch.height },
  );

  try {
    await snapshotP5Frame(ctx, outPath);
  } finally {
    cleanupP5Deno(ctx);
  }
}

async function renderGpu(sketch: TestSketch, device: GPUDevice, outPath: string): Promise<void> {
  const p5gpu = new P5GPU(device, { width: sketch.width, height: sketch.height });

  try {
    p5gpu.beginFrame();
    sketch.draw(p5gpu as unknown as DrawingAPI);
    const texture = p5gpu.endFrame();
    await writeTextureToPng(device, texture, sketch.width, sketch.height, p5gpu.format, outPath);
  } finally {
    p5gpu.dispose();
  }
}

async function runOne(sketch: TestSketch, device: GPUDevice): Promise<SketchResult> {
  const referencePath = `${REFERENCE_DIR}/${sketch.name}.png`;
  const gpuPath = `${GPU_DIR}/${sketch.name}.png`;
  const diffPath = `${DIFF_DIR}/${sketch.name}.png`;

  console.log(`\n[${sketch.name}] rendering reference...`);
  await renderReference(sketch, referencePath);

  console.log(`[${sketch.name}] rendering p5gpu...`);
  await renderGpu(sketch, device, gpuPath);

  console.log(`[${sketch.name}] comparing...`);
  const stats = await comparePngFiles(referencePath, gpuPath, diffPath, {
    pixelThreshold: 3,
    diffAmplify: 4,
  });

  const diffRatio = stats.diffPixels / Math.max(1, stats.totalPixels);
  const pass =
    stats.rmse <= RMSE_THRESHOLD &&
    stats.maxError <= MAX_ERROR_THRESHOLD &&
    diffRatio <= DIFF_RATIO_THRESHOLD;

  return {
    name: sketch.name,
    rmse: stats.rmse,
    maxError: stats.maxError,
    diffPixels: stats.diffPixels,
    totalPixels: stats.totalPixels,
    pass,
  };
}

function formatResultLine(result: SketchResult): string {
  const diffPct = (result.diffPixels / Math.max(1, result.totalPixels)) * 100;
  const status = result.pass ? "PASS" : "FAIL";
  return `${result.name.padEnd(24)} RMSE=${result.rmse.toFixed(2).padStart(6)}  max=${String(result.maxError).padStart(3)}  diff=${diffPct
    .toFixed(2)
    .padStart(6)}%  ${status}`;
}

async function main(): Promise<void> {
  await Promise.all([
    Deno.mkdir(REFERENCE_DIR, { recursive: true }),
    Deno.mkdir(GPU_DIR, { recursive: true }),
    Deno.mkdir(DIFF_DIR, { recursive: true }),
  ]);

  const device = await requestWebGpuDevice();
  const results: SketchResult[] = [];
  let sketches = P5_TEST_SKETCHES.filter((sketch) => sketch.phase <= MAX_PHASE);
  if (NAME_FILTER) {
    const re = new RegExp(NAME_FILTER);
    sketches = sketches.filter((sketch) => re.test(sketch.name));
  }

  if (sketches.length === 0) {
    throw new Error(`No test sketches selected for phase ${MAX_PHASE}${NAME_FILTER ? ` and filter /${NAME_FILTER}/` : ""}`);
  }

  console.log(
    `Running ${sketches.length} sketch(es) for phase <= ${MAX_PHASE}${NAME_FILTER ? ` and filter /${NAME_FILTER}/` : ""}`,
  );

  try {
    for (const sketch of sketches) {
      const result = await runOne(sketch, device);
      results.push(result);
      console.log(formatResultLine(result));
    }
  } finally {
    try { device.destroy(); } catch (_) { /* ignore */ }
  }

  const passCount = results.filter((r) => r.pass).length;
  const failCount = results.length - passCount;

  console.log("\n── Results ──");
  for (const result of results) {
    console.log(formatResultLine(result));
  }
  console.log(`\nThresholds: RMSE<=${RMSE_THRESHOLD}, max<=${MAX_ERROR_THRESHOLD}, diffRatio<=${(DIFF_RATIO_THRESHOLD * 100).toFixed(2)}%`);
  console.log(`Summary: ${passCount}/${results.length} passed`);

  if (failCount > 0) {
    Deno.exitCode = 1;
  }
}

await main();
