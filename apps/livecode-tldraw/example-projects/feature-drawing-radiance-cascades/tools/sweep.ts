/**
 * Quality per millisecond (Deno WebGPU): renders the checked-in drawing
 * under a set of cascade configurations, and prints for each the pipelined
 * frame time and the RMS against the brute-force reference, sorted by time.
 * Points on this frontier decide how to spend the frame; re-run it on a
 * drawing of your own by pointing --drawing at its JSON.
 *
 *   cd apps/deno-notebooks
 *   deno run --unstable-webgpu -A --no-lock --config deno.json \
 *     ../livecode-tldraw/example-projects/feature-drawing-radiance-cascades/tools/sweep.ts \
 *     [--scale 1] [--frames 30] [--backend compute] [--drawing path.json] [--png]
 *
 * `--png` also writes each point's tone-mapped irradiance to
 * `.output/sweep-*.png` (RMS is global; leaks and rings are local, so look).
 */

import { bakeDrawingDocument, type DrawingDocument } from "canvas-drawing";
// deno-lint-ignore no-import-prefix
import { dirname, fromFileUrl, join } from "jsr:@std/path@1";
import {
  buildStrokeScene,
  createRadianceRenderer,
  type RadianceCascadeConfig,
  radianceDeviceDescriptor,
  type RendererBackend,
} from "../lib/radiance-cascades/mod.ts";
import { encodePNG } from "@img/png";
import { readback, rmsError, tonemap } from "./readback.ts";

const HERE = dirname(fromFileUrl(import.meta.url));
const PROJECT = join(HERE, "..");
const arg = (name: string, fallback: string) => {
  const i = Deno.args.indexOf(`--${name}`);
  return i >= 0 ? Deno.args[i + 1] : fallback;
};
const scale = Number(arg("scale", "1"));
const frames = Number(arg("frames", "30"));
const backend = arg("backend", "compute") as RendererBackend;
const drawingPath = arg(
  "drawing",
  join(PROJECT, "data/drawing/radiance-cascades_shapes.json"),
);
const width = Math.round(1000 * scale);
const height = Math.round(500 * scale);
const writePngs = Deno.args.includes("--png");
const OUT = join(PROJECT, ".output");

async function writePng(name: string, rgba: Float32Array): Promise<void> {
  const encode = (x: number) => Math.round(255 * Math.min(1, x) ** (1 / 2.2));
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = encode(tonemap(rgba[i * 4]));
    pixels[i * 4 + 1] = encode(tonemap(rgba[i * 4 + 1]));
    pixels[i * 4 + 2] = encode(tonemap(rgba[i * 4 + 2]));
    pixels[i * 4 + 3] = 255;
  }
  await Deno.mkdir(OUT, { recursive: true });
  const png = await encodePNG(pixels, {
    width,
    height,
    compression: 0,
    filter: 0,
    interlace: 0,
  });
  await Deno.writeFile(
    join(OUT, `sweep-${name.replace(/[^a-z0-9]+/gi, "-")}.png`),
    png,
  );
}

const adapter = await navigator.gpu.requestAdapter();
if (!adapter) throw new Error("no WebGPU adapter");
const device = await adapter.requestDevice(radianceDeviceDescriptor(adapter));
device.addEventListener("uncapturederror", (event) => {
  console.error(
    "uncaptured:",
    (event as GPUUncapturedErrorEvent).error.message,
  );
});
const saved = JSON.parse(await Deno.readTextFile(drawingPath)) as {
  data: DrawingDocument;
};
const scene = buildStrokeScene(bakeDrawingDocument(saved.data), { scale });

interface Point {
  name: string;
  config: Partial<RadianceCascadeConfig>;
}

const base: Partial<RadianceCascadeConfig> = {
  probeSpacing: 1 * scale,
  intervalLength: 2 * scale,
  mergeMode: "bilinearFix",
  referenceRays: 256,
};

export const POINTS: Point[] = [
  { name: "bilinear (default)", config: {} },
  { name: "vanilla", config: { mergeMode: "vanilla" } },
  { name: "parallax", config: { mergeMode: "parallaxFix" } },
  { name: "pre-average all", config: { preAverage: true } },
  ...[1, 2, 3, 4].map((from) => ({
    name: `far vanilla from c${from}`,
    config: { farMergeMode: "vanilla" as const, farMergeFrom: from },
  })),
  ...[1, 2, 3, 4].map((from) => ({
    name: `far parallax from c${from}`,
    config: { farMergeMode: "parallaxFix" as const, farMergeFrom: from },
  })),
  ...[1, 2, 3, 4].map((from) => ({
    name: `pre-average from c${from}`,
    config: { preAverageFrom: from },
  })),
  {
    name: "pre-average from c2 + far vanilla from c4",
    config: { preAverageFrom: 2, farMergeMode: "vanilla", farMergeFrom: 4 },
  },
  {
    name: "pre-average from c1 + far parallax from c3",
    config: { preAverageFrom: 1, farMergeMode: "parallaxFix", farMergeFrom: 3 },
  },
  {
    name: "2 px, 4 rays x4",
    config: {
      probeSpacing: 2 * scale,
      intervalLength: 4 * scale,
      baseRayCount: 4,
      branching: 4,
    },
  },
];

const renderer = createRadianceRenderer(device, width, height, base, {
  backend,
});
renderer.setScene(scene);
device.pushErrorScope("validation");
renderer.renderReference();
await device.queue.onSubmittedWorkDone();
const reference = await readback(device, renderer.reference.texture);
if (writePngs) await writePng("reference", reference);
console.log(
  `${
    adapter.info.description || adapter.info.vendor
  }, ${backend} backend, ${width}x${height}, ${frames} frames; ms/frame pipelined, rms vs reference (256 rays/px)`,
);

const rows: { name: string; ms: number; rms: number; plan: string }[] = [];
for (const point of POINTS) {
  const plan = renderer.configure({ ...base, ...point.config });
  for (let i = 0; i < 3; i++) renderer.render();
  await device.queue.onSubmittedWorkDone();
  const started = performance.now();
  for (let i = 0; i < frames; i++) renderer.render();
  await device.queue.onSubmittedWorkDone();
  const ms = (performance.now() - started) / frames;
  const image = await readback(device, renderer.irradiance.texture);
  const rms = rmsError(image, reference);
  if (writePngs) await writePng(point.name, image);
  const warnings = plan.warnings.length ? ` (${plan.warnings.join("; ")})` : "";
  rows.push({ name: point.name, ms, rms, plan: warnings });
  console.log(
    `${point.name.padEnd(44)} ${ms.toFixed(2).padStart(6)} ms  rms ${
      rms.toFixed(4)
    }${warnings}`,
  );
  // Reset any level-structural change before the next point.
  renderer.configure(base);
}
const error = await device.popErrorScope();
if (error) console.log(`ERROR: ${error.message}`);
renderer.dispose();

console.log("\nsorted by time:");
for (const row of [...rows].sort((a, b) => a.ms - b.ms)) {
  console.log(
    `${row.name.padEnd(44)} ${row.ms.toFixed(2).padStart(6)} ms  rms ${
      row.rms.toFixed(4)
    }`,
  );
}
