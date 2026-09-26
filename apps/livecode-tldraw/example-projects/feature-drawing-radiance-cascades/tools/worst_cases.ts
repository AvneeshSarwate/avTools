/**
 * Synthetic stress scenes for the merge and pre-averaging levers (Deno
 * WebGPU): each is built to expose lost angular resolution (small distant
 * lights, fine shadow stripes, a slit beam, thin far emitters, dense
 * occluders, stacked tinted glass). For each scene it renders the
 * brute-force reference and the configured variants, prints frame time
 * and RMS, writes every image to `.output/worst-<scene>-<variant>.png`
 * and a 2x2 grid `.output/worst-<scene>-grid.png` (reference, then the
 * variants in order, row-major) for side-by-side viewing, plus
 * `.output/worst-cases.html`, a viewer (`worst_cases_viewer.ts`): scene
 * tabs, variant buttons with their timings, keys to flick between
 * variants, a wipe slider between any two. Open it from the file system.
 *
 *   cd apps/deno-notebooks
 *   deno run --unstable-webgpu -A --no-lock --config deno.json \
 *     ../livecode-tldraw/example-projects/feature-drawing-radiance-cascades/tools/worst_cases.ts \
 *     [--scale 1] [--frames 20] [--backend compute] [--scenes points,fence] [--html-only]
 *
 * `--html-only` rewrites the page from the saved `worst-cases.json` without
 * rendering.
 */

import type { DrawingRenderData } from "canvas-drawing";
// deno-lint-ignore no-import-prefix
import { dirname, fromFileUrl, join } from "jsr:@std/path@1";
import { encodePNG } from "@img/png";
import {
  buildStrokeScene,
  createRadianceRenderer,
  DEFAULT_CONFIG,
  type RadianceCascadeConfig,
  radianceDeviceDescriptor,
  type RendererBackend,
} from "../lib/radiance-cascades/mod.ts";
import { readback, rmsError, tonemap } from "./readback.ts";
import { viewerHtml, type ViewerResult } from "./worst_cases_viewer.ts";

const HERE = dirname(fromFileUrl(import.meta.url));
const OUT = join(HERE, "../.output");
const arg = (name: string, fallback: string) => {
  const i = Deno.args.indexOf(`--${name}`);
  return i >= 0 ? Deno.args[i + 1] : fallback;
};
const scale = Number(arg("scale", "1"));
const frames = Number(arg("frames", "20"));
const backend = arg("backend", "compute") as RendererBackend;
const only = arg("scenes", "").split(",").filter(Boolean);
const STAGE_W = 1000;
const STAGE_H = 500;
const width = Math.round(STAGE_W * scale);
const height = Math.round(STAGE_H * scale);

// ------------------------------------------------------------ scene builder

type Meta = Record<string, unknown>;
interface Builder {
  data: DrawingRenderData;
  polygon(points: { x: number; y: number }[], metadata: Meta): void;
  circle(x: number, y: number, r: number, metadata: Meta, ry?: number): void;
  line(a: [number, number], b: [number, number], metadata: Meta): void;
  stroke(points: { x: number; y: number }[], metadata: Meta): void;
}

function builder(): Builder {
  let n = 0;
  const data: DrawingRenderData = {
    freehand: [{ type: "strokeGroup", id: "g", children: [] }],
    freehandGroupMap: {},
    polygon: [],
    circle: [],
    circleGroupMap: {},
  };
  return {
    data,
    polygon(points, metadata) {
      data.polygon.push({ type: "polygon", id: `p${n++}`, points, metadata });
    },
    circle(x, y, r, metadata, ry = r) {
      data.circle.push({
        type: "circle",
        id: `c${n++}`,
        center: { x, y },
        rx: r,
        ry,
        rotation: 0,
        metadata,
      });
    },
    line(a, b, metadata) {
      // An open freehand stroke of two points: one segment.
      data.freehand[0].children.push({
        type: "stroke",
        id: `l${n++}`,
        points: [{ x: a[0], y: a[1], ts: 0 }, { x: b[0], y: b[1], ts: 1 }],
        metadata,
      });
    },
    stroke(points, metadata) {
      data.freehand[0].children.push({
        type: "stroke",
        id: `s${n++}`,
        points: points.map((p, i) => ({ ...p, ts: i })),
        metadata,
      });
    },
  };
}

/** Deterministic pseudo-random numbers (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const opaque = (strokeWidth: number, albedo = 0.6): Meta => ({
  strokeWidth,
  transmittance: 0,
  albedo: [albedo, albedo, albedo],
});
const emitter = (strokeWidth: number, emission: number[]): Meta => ({
  strokeWidth,
  emission,
  transmittance: 0,
  albedo: [0.3, 0.3, 0.3],
});

const SCENES: Record<string, () => DrawingRenderData> = {
  /** Ten tiny lights and thin bars: many small distant sources, fine multi-shadows. */
  points() {
    const b = builder();
    const random = rng(1);
    const colors = [[6, 5, 4], [1, 5, 8], [8, 2, 1], [2, 8, 3], [8, 7, 1]];
    for (let i = 0; i < 10; i++) {
      const x = 60 + random() * 880;
      const y = 30 + random() * 150;
      b.circle(x, y, 1.5, emitter(3, colors[i % colors.length]));
    }
    for (let i = 0; i < 5; i++) {
      const x = 150 + i * 175;
      b.line([x, 220], [x, 300], opaque(4));
    }
    b.line([0, 480], [1000, 480], opaque(3, 0.9));
    return b.data;
  },
  /** A wide warm emitter above a picket fence: shadow stripes far below. */
  fence() {
    const b = builder();
    b.line([200, 40], [800, 40], emitter(6, [5, 4, 2.5]));
    for (let i = 0; i < 40; i++) {
      const x = 210 + i * 15;
      b.line([x, 180], [x, 230], opaque(3));
    }
    b.line([0, 490], [1000, 490], opaque(3, 0.9));
    return b.data;
  },
  /** A bright emitter behind a wall with a 6 px slit: one narrow beam. */
  slit() {
    const b = builder();
    b.circle(60, 250, 30, emitter(8, [8, 7, 6]));
    b.line([160, 0], [160, 246], opaque(6, 0.9));
    b.line([160, 254], [160, 500], opaque(6, 0.9));
    b.circle(700, 250, 25, opaque(6));
    b.line([980, 0], [980, 500], opaque(4, 0.95));
    return b.data;
  },
  /** Thin, long emitting lines at the far right, opaque discs in between. */
  thinlines() {
    const b = builder();
    const colors = [[6, 2, 1], [1, 6, 2], [1, 2, 6], [6, 6, 1], [6, 1, 6], [
      1,
      6,
      6,
    ]];
    for (let i = 0; i < 6; i++) {
      const y = 60 + i * 76;
      b.line([900, y], [990, y + 20], emitter(1, colors[i]));
    }
    for (let i = 0; i < 4; i++) {
      b.circle(500 + (i % 2) * 120, 120 + i * 90, 18, opaque(8));
    }
    b.line([20, 0], [20, 500], opaque(4, 0.95));
    return b.data;
  },
  /** Forty dense scribbles as occluders, one sun: shadow texture and bin load. */
  scribble() {
    const b = builder();
    const random = rng(7);
    b.circle(120, 90, 40, emitter(8, [5, 4, 2.5]));
    for (let s = 0; s < 40; s++) {
      const cx = 300 + random() * 600;
      const cy = 60 + random() * 380;
      const points: { x: number; y: number }[] = [];
      let x = cx;
      let y = cy;
      for (let i = 0; i < 30; i++) {
        x += (random() - 0.5) * 24;
        y += (random() - 0.5) * 24;
        points.push({ x, y });
      }
      b.stroke(points, opaque(2, 0.5));
    }
    return b.data;
  },
  /** Stacked tinted glass ellipses in front of a white emitter. */
  glass() {
    const b = builder();
    b.line([40, 100], [40, 400], emitter(10, [6, 6, 6]));
    const tints = [[0.95, 0.5, 0.5], [0.5, 0.95, 0.5], [0.5, 0.5, 0.95], [
      0.9,
      0.9,
      0.4,
    ], [0.4, 0.9, 0.9]];
    for (let i = 0; i < 5; i++) {
      b.circle(260 + i * 120, 250 + (i % 2 ? 40 : -40), 90, {
        strokeWidth: 16,
        transmittance: tints[i],
        albedo: [0.1, 0.1, 0.1],
      }, 120);
    }
    b.line([985, 0], [985, 500], opaque(4, 0.95));
    return b.data;
  },
};

interface Variant {
  name: string;
  config: Partial<RadianceCascadeConfig>;
}

const VARIANTS: Variant[] = [
  { name: "bilinear-all", config: {} },
  { name: "preaverage-all", config: { preAverage: true } },
  { name: "preaverage-c1", config: { preAverageFrom: 1 } },
];

// ---------------------------------------------------------------- output

function toPixels(rgba: Float32Array, w: number, h: number): Uint8Array {
  const encode = (x: number) => Math.round(255 * Math.min(1, x) ** (1 / 2.2));
  const pixels = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    pixels[i * 4] = encode(tonemap(rgba[i * 4]));
    pixels[i * 4 + 1] = encode(tonemap(rgba[i * 4 + 1]));
    pixels[i * 4 + 2] = encode(tonemap(rgba[i * 4 + 2]));
    pixels[i * 4 + 3] = 255;
  }
  return pixels;
}

async function savePng(
  name: string,
  pixels: Uint8Array,
  w: number,
  h: number,
): Promise<void> {
  await Deno.mkdir(OUT, { recursive: true });
  // The encoder detaches the buffer it is given; hand it a copy.
  const copy = new Uint8Array(new ArrayBuffer(pixels.byteLength));
  copy.set(pixels);
  const png = await encodePNG(copy, {
    width: w,
    height: h,
    compression: 0,
    filter: 0,
    interlace: 0,
  });
  await Deno.writeFile(join(OUT, `${name}.png`), png);
}

/** A 2x2 grid of four same-sized images with a 4 px white gutter. */
function grid(
  images: Uint8Array[],
  w: number,
  h: number,
): { pixels: Uint8Array; w: number; h: number } {
  const gap = 4;
  const gw = w * 2 + gap;
  const gh = h * 2 + gap;
  const pixels = new Uint8Array(gw * gh * 4).fill(255);
  images.forEach((image, k) => {
    const ox = (k % 2) * (w + gap);
    const oy = Math.floor(k / 2) * (h + gap);
    for (let y = 0; y < h; y++) {
      pixels.set(
        image.subarray(y * w * 4, (y + 1) * w * 4),
        ((oy + y) * gw + ox) * 4,
      );
    }
  });
  return { pixels, w: gw, h: gh };
}

// ------------------------------------------------------------------ run

if (Deno.args.includes("--html-only")) {
  const saved = JSON.parse(
    await Deno.readTextFile(join(OUT, "worst-cases.json")),
  ) as ViewerResult[];
  await Deno.writeTextFile(join(OUT, "worst-cases.html"), viewerHtml(saved));
  console.log(`worst-cases.html rewritten in ${OUT}`);
  Deno.exit(0);
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
const base: Partial<RadianceCascadeConfig> = {
  probeSpacing: 1 * scale,
  intervalLength: 2 * scale,
  mergeMode: "bilinearFix",
  referenceRays: 256,
};
const renderer = createRadianceRenderer(device, width, height, base, {
  backend,
});
console.log(
  `${
    adapter.info.description || adapter.info.vendor
  }, ${backend} backend, ${width}x${height}; ms/frame pipelined, rms vs reference (256 rays/px)`,
);

const results: ViewerResult[] = [];

for (const [sceneName, make] of Object.entries(SCENES)) {
  if (only.length && !only.includes(sceneName)) continue;
  const scene = buildStrokeScene(make(), { scale });
  renderer.setScene(scene);
  renderer.configure({ ...DEFAULT_CONFIG, ...base });
  device.pushErrorScope("validation");
  renderer.renderReference();
  await device.queue.onSubmittedWorkDone();
  const reference = await readback(device, renderer.reference.texture);
  const referencePixels = toPixels(reference, width, height);
  await savePng(`worst-${sceneName}-reference`, referencePixels, width, height);
  console.log(`\n${sceneName}: ${scene.segmentCount} segments`);
  const result: ViewerResult = {
    scene: sceneName,
    segments: scene.segmentCount,
    variants: [{
      name: "reference",
      file: `worst-${sceneName}-reference.png`,
      ms: null,
      rms: 0,
    }],
  };
  results.push(result);
  const panels = [referencePixels];
  for (const variant of VARIANTS) {
    // From the full defaults: configure() merges.
    renderer.configure({ ...DEFAULT_CONFIG, ...base, ...variant.config });
    for (let i = 0; i < 3; i++) renderer.render();
    await device.queue.onSubmittedWorkDone();
    const started = performance.now();
    for (let i = 0; i < frames; i++) renderer.render();
    await device.queue.onSubmittedWorkDone();
    const ms = (performance.now() - started) / frames;
    const image = await readback(device, renderer.irradiance.texture);
    const pixels = toPixels(image, width, height);
    panels.push(pixels);
    await savePng(
      `worst-${sceneName}-${variant.name}`,
      pixels,
      width,
      height,
    );
    const rms = rmsError(image, reference);
    result.variants.push({
      name: variant.name,
      file: `worst-${sceneName}-${variant.name}.png`,
      ms,
      rms,
    });
    console.log(
      `  ${variant.name.padEnd(16)} ${ms.toFixed(2).padStart(6)} ms  rms ${
        rms.toFixed(4)
      }`,
    );
  }
  const g = grid(panels, width, height);
  await savePng(`worst-${sceneName}-grid`, g.pixels, g.w, g.h);
  const error = await device.popErrorScope();
  if (error) console.log(`  ERROR: ${error.message}`);
}
renderer.dispose();
await Deno.writeTextFile(
  join(OUT, "worst-cases.json"),
  JSON.stringify(results, null, 2),
);
await Deno.writeTextFile(join(OUT, "worst-cases.html"), viewerHtml(results));
console.log(`\nPNGs and worst-cases.html in ${OUT}`);
