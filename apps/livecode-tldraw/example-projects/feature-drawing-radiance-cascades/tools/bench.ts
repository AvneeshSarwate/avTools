/**
 * GPU micro-benchmark for the two backends (Deno WebGPU): renders each
 * variant for a number of frames and prints the median GPU time per pass.
 *
 *   cd apps/deno-notebooks
 *   deno run --unstable-webgpu -A --no-lock --config deno.json \
 *     ../livecode-tldraw/example-projects/feature-drawing-radiance-cascades/tools/bench.ts \
 *     [--scale 1] [--frames 20] [--merge bilinearFix] [--variants name,name]
 */

import { bakeDrawingDocument, type DrawingDocument } from "canvas-drawing";
// deno-lint-ignore no-import-prefix
import { dirname, fromFileUrl, join } from "jsr:@std/path@1";
import {
  buildStrokeScene,
  type ComputeOptions,
  createRadianceRenderer,
  type MergeMode,
  type RadianceCascadeConfig,
  radianceDeviceDescriptor,
  type RendererBackend,
} from "../lib/radiance-cascades/mod.ts";

const HERE = dirname(fromFileUrl(import.meta.url));
const PROJECT = join(HERE, "..");
const arg = (name: string, fallback: string) => {
  const i = Deno.args.indexOf(`--${name}`);
  return i >= 0 ? Deno.args[i + 1] : fallback;
};
const scale = Number(arg("scale", "1"));
const frames = Number(arg("frames", "20"));
const merge = arg("merge", "bilinearFix") as MergeMode;
const only = arg("variants", "").split(",").filter(Boolean);
const width = Math.round(1000 * scale);
const height = Math.round(500 * scale);

const adapter = await navigator.gpu.requestAdapter();
if (!adapter) throw new Error("no WebGPU adapter");
const device = await adapter.requestDevice(radianceDeviceDescriptor(adapter));
device.addEventListener("uncapturederror", (event) => {
  console.error(
    "uncaptured:",
    (event as GPUUncapturedErrorEvent).error.message,
  );
});
const saved = JSON.parse(
  await Deno.readTextFile(
    join(PROJECT, "data/drawing/radiance-cascades_shapes.json"),
  ),
) as { data: DrawingDocument };
const scene = buildStrokeScene(bakeDrawingDocument(saved.data), { scale });

interface Variant {
  name: string;
  backend: RendererBackend;
  compute?: Partial<ComputeOptions>;
  config?: Partial<RadianceCascadeConfig>;
}

const bare = {};
export const VARIANTS: Variant[] = [
  { name: "fragment", backend: "fragment" },
  { name: "compute", backend: "compute" },
  { name: "compute patch", backend: "compute", compute: { scenePatch: true } },
  { name: "compute foot", backend: "compute", compute: { stageUpper: true } },
  {
    name: "compute noBand",
    backend: "compute",
    compute: { bounceBand: false },
  },
  { name: "compute noBundle", backend: "compute", compute: { bundle: false } },
  { name: "compute bundle", backend: "compute", compute: { bundle: true } },
  {
    name: "compute noInterleave",
    backend: "compute",
    compute: { interleave: false },
  },
  {
    name: "compute unfused",
    backend: "compute",
    compute: { fuseCascade0: false },
  },
  {
    name: "compute unfused 256",
    backend: "compute",
    compute: { fuseCascade0: false, workgroupLanes: 256 },
  },
  { name: "c0 16", backend: "compute", compute: { ...bare, reduceLanes: 16 } },
  { name: "c0 32", backend: "compute", compute: { ...bare, reduceLanes: 32 } },
  {
    name: "c0 128",
    backend: "compute",
    compute: { ...bare, reduceLanes: 128 },
  },
  {
    name: "c0 256",
    backend: "compute",
    compute: { ...bare, reduceLanes: 256 },
  },
  {
    name: "upper 32",
    backend: "compute",
    compute: { ...bare, workgroupLanes: 32 },
  },
  {
    name: "upper 128",
    backend: "compute",
    compute: { ...bare, workgroupLanes: 128 },
  },
  {
    name: "upper 256",
    backend: "compute",
    compute: { ...bare, workgroupLanes: 256 },
  },
  {
    name: "upper 64 wide16",
    backend: "compute",
    compute: { ...bare, tileWidth: 16 },
  },
  {
    name: "upper 64 wide32",
    backend: "compute",
    compute: { ...bare, tileWidth: 32 },
  },
  {
    name: "upper 64 wide4",
    backend: "compute",
    compute: { ...bare, tileWidth: 4 },
  },
  {
    name: "upper 128 wide32",
    backend: "compute",
    compute: { ...bare, workgroupLanes: 128, tileWidth: 32 },
  },
];

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

console.log(
  `${
    adapter.info.description || adapter.info.vendor
  }, ${width}x${height}, merge ${merge}, ${frames} frames; pipelined wall-clock ms/frame, then median timer ms per pass`,
);
for (const variant of VARIANTS) {
  if (only.length && !only.includes(variant.name)) continue;
  device.pushErrorScope("validation");
  const renderer = createRadianceRenderer(device, width, height, {
    probeSpacing: 1 * scale,
    intervalLength: 2 * scale,
    mergeMode: merge,
    bounceStrength: 1,
    ...variant.config,
  }, { backend: variant.backend, compute: variant.compute });
  renderer.setScene(scene);
  const samples = new Map<string, number[]>();
  // Pipelined throughput: frames submitted back to back, as the app does.
  for (let i = 0; i < 3; i++) renderer.render();
  await device.queue.onSubmittedWorkDone();
  const started = performance.now();
  for (let i = 0; i < frames; i++) renderer.render();
  await device.queue.onSubmittedWorkDone();
  const throughput = (performance.now() - started) / frames;
  // Per-pass timings, also from a busy GPU (a frame run on an idle GPU
  // reports inflated, clock-ramping pass times): yield between submits so
  // the readbacks resolve while the queue stays ahead.
  for (let i = 0; i < frames; i++) {
    renderer.render();
    await new Promise((r) => setTimeout(r, 0));
    const timings = renderer.timings;
    if (i >= 3 && timings) {
      for (const [label, ms] of Object.entries(timings)) {
        samples.set(label, [...(samples.get(label) ?? []), ms]);
      }
    }
  }
  await device.queue.onSubmittedWorkDone();
  const error = await device.popErrorScope();
  if (error) console.log(`${variant.name}: ERROR ${error.message}`);
  const parts = [...samples.entries()]
    .filter(([label]) => label !== "total")
    .map(([label, xs]) => `${label} ${median(xs).toFixed(2)}`);
  console.log(
    `${variant.name.padEnd(32)} ${
      throughput.toFixed(2).padStart(6)
    } ms/frame pipelined, timer total ${
      median(samples.get("total") ?? []).toFixed(2).padStart(6)
    } | ${parts.join(", ")}`,
  );
  if (variant.backend === "compute" && only.length) {
    for (const line of renderer.describe()) console.log(`    ${line}`);
  }
  renderer.dispose();
}
