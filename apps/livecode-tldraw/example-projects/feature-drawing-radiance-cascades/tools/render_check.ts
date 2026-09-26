/**
 * Headless render check (Deno, WebGPU): rasterizes the project's drawing,
 * runs the cascade renderer under every merge mode plus the brute-force
 * reference, reads the results back, prints timings and pixel probes, and
 * writes tone-mapped PNGs to `.output/`. Fails when a pass raises a WebGPU
 * validation error or a cascade result strays far from the reference. Runs
 * the fragment and the compute backend (`--backend fragment|compute|both`,
 * default both) and, with both, checks that they agree with each other.
 *
 *   cd apps/deno-notebooks
 *   deno run --unstable-webgpu -A --no-lock --config deno.json \
 *     ../livecode-tldraw/example-projects/feature-drawing-radiance-cascades/tools/render_check.ts [--scale 0.5] [--backend both]
 *
 * Deno-specific project tool; the renderer itself is browser code that Deno's
 * WebGPU happens to run unchanged.
 */

import { bakeDrawingDocument, type DrawingDocument } from "canvas-drawing";
// The project sits outside the deno workspace, so no import map applies.
// deno-lint-ignore no-import-prefix
import { dirname, fromFileUrl, join } from "jsr:@std/path@1";
import { encodePNG } from "@img/png";
import {
  buildStrokeScene,
  ComputeRadianceRenderer,
  createRadianceRenderer,
  DisplayPass,
  type RadianceCascadeConfig,
  radianceDeviceDescriptor,
  type RadianceRenderer,
  RENDERER_BACKENDS,
  type RendererBackend,
} from "../lib/radiance-cascades/mod.ts";

const HERE = dirname(fromFileUrl(import.meta.url));
const PROJECT = join(HERE, "..");
const OUT = join(PROJECT, ".output");
const STAGE = [1000, 500] as const;

const scaleArg = Deno.args.indexOf("--scale");
const scale = scaleArg >= 0 ? Number(Deno.args[scaleArg + 1]) : 1;
const width = Math.round(STAGE[0] * scale);
const height = Math.round(STAGE[1] * scale);
const backendArg = Deno.args.indexOf("--backend");
const backendChoice = backendArg >= 0 ? Deno.args[backendArg + 1] : "both";
const backends: RendererBackend[] = backendChoice === "both"
  ? [...RENDERER_BACKENDS]
  : [backendChoice as RendererBackend];
if (!backends.every((b) => RENDERER_BACKENDS.includes(b))) {
  throw new Error(
    `--backend must be one of ${RENDERER_BACKENDS.join(", ")}, both`,
  );
}

const adapter = await navigator.gpu.requestAdapter();
if (!adapter) throw new Error("no WebGPU adapter");
const device = await adapter.requestDevice(radianceDeviceDescriptor(adapter));
console.log(
  `adapter: ${adapter.info.description || adapter.info.vendor || "unknown"}; ` +
    `timestamp-query ${
      device.features.has("timestamp-query") ? "on" : "off"
    }, ` +
    `${
      device.limits.maxComputeWorkgroupStorageSize / 1024
    } KB workgroup memory`,
);
device.addEventListener("uncapturederror", (event) => {
  console.error(
    "uncaptured WebGPU error:",
    (event as GPUUncapturedErrorEvent).error.message,
  );
});

const saved = JSON.parse(
  await Deno.readTextFile(
    join(PROJECT, "data/drawing/radiance-cascades_shapes.json"),
  ),
) as { data: DrawingDocument };
const scene = buildStrokeScene(bakeDrawingDocument(saved.data), { scale });
console.log(
  `scene: ${scene.shapeCount} shapes, ${scene.segmentCount} segments at ${width}x${height}`,
);

/** Read an rgba16float texture back as float32 RGBA. */
async function readback(texture: GPUTexture): Promise<Float32Array> {
  const bytesPerRow = Math.ceil((texture.width * 8) / 256) * 256;
  const buffer = device.createBuffer({
    size: bytesPerRow * texture.height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer(
    { texture },
    { buffer, bytesPerRow },
    { width: texture.width, height: texture.height },
  );
  device.queue.submit([encoder.finish()]);
  await buffer.mapAsync(GPUMapMode.READ);
  const halves = new Uint16Array(buffer.getMappedRange());
  const out = new Float32Array(texture.width * texture.height * 4);
  const rowHalves = bytesPerRow / 2;
  for (let y = 0; y < texture.height; y++) {
    for (let i = 0; i < texture.width * 4; i++) {
      out[y * texture.width * 4 + i] = halfToFloat(halves[y * rowHalves + i]);
    }
  }
  buffer.unmap();
  buffer.destroy();
  return out;
}

/** Read an 8-bit RGBA texture back. */
async function readbackBytes(texture: GPUTexture): Promise<Uint8Array> {
  const bytesPerRow = Math.ceil((texture.width * 4) / 256) * 256;
  const buffer = device.createBuffer({
    size: bytesPerRow * texture.height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer(
    { texture },
    { buffer, bytesPerRow },
    { width: texture.width, height: texture.height },
  );
  device.queue.submit([encoder.finish()]);
  await buffer.mapAsync(GPUMapMode.READ);
  const rows = new Uint8Array(buffer.getMappedRange());
  const out = new Uint8Array(texture.width * texture.height * 4);
  for (let y = 0; y < texture.height; y++) {
    out.set(
      rows.subarray(y * bytesPerRow, y * bytesPerRow + texture.width * 4),
      y * texture.width * 4,
    );
  }
  buffer.unmap();
  buffer.destroy();
  return out;
}

function halfToFloat(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exponent = (h >> 10) & 0x1f;
  const fraction = h & 0x3ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 31) return fraction ? NaN : sign * Infinity;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

const tonemap = (x: number) => 1 - 1 / (1 + Math.max(0, x)) ** 2.5;
const encode = (x: number) => Math.round(255 * Math.min(1, x) ** (1 / 2.2));

async function writePng(
  name: string,
  rgba: Float32Array,
  size: readonly [number, number] = [width, height],
): Promise<void> {
  const [w, h] = size;
  const pixels = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    pixels[i * 4] = encode(tonemap(rgba[i * 4]));
    pixels[i * 4 + 1] = encode(tonemap(rgba[i * 4 + 1]));
    pixels[i * 4 + 2] = encode(tonemap(rgba[i * 4 + 2]));
    pixels[i * 4 + 3] = 255;
  }
  await Deno.mkdir(OUT, { recursive: true });
  const png = await encodePNG(pixels, {
    width: w,
    height: h,
    compression: 0,
    filter: 0,
    interlace: 0,
  });
  await Deno.writeFile(join(OUT, `${name}.png`), png);
}

const PROBES: Array<[string, number, number]> = [
  ["near sun", 250, 130],
  ["left of wall", 405, 200],
  ["right of wall", 475, 200],
  ["far corner", 960, 470],
  ["near lamp", 850, 265],
];

const probe = (rgba: Float32Array, x: number, y: number) => {
  const i = (Math.round(y * scale) * width + Math.round(x * scale)) * 4;
  return [rgba[i], rgba[i + 1], rgba[i + 2]].map((v) => v.toFixed(3)).join(" ");
};

const luminance = (rgba: Float32Array, i: number) =>
  0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2];

/** Relative RMS luminance error against the reference, on tone-mapped values. */
function rmsError(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  const n = width * height;
  for (let i = 0; i < n; i++) {
    const d = tonemap(luminance(a, i)) - tonemap(luminance(b, i));
    sum += d * d;
  }
  return Math.sqrt(sum / n);
}

async function timed(label: string, run: () => void): Promise<number> {
  device.pushErrorScope("validation");
  const started = performance.now();
  run();
  await device.queue.onSubmittedWorkDone();
  const elapsed = performance.now() - started;
  const error = await device.popErrorScope();
  if (error) throw new Error(`${label}: ${error.message}`);
  return elapsed;
}

let failures = 0;

/** Wait for the compute backend's asynchronous timing readback. */
async function settledTimings(
  renderer: RadianceRenderer,
): Promise<Readonly<Record<string, number>> | null> {
  await device.queue.onSubmittedWorkDone();
  for (let i = 0; i < 20 && !renderer.timings; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return renderer.timings;
}

function formatTimings(timings: Readonly<Record<string, number>>): string {
  return Object.entries(timings)
    .filter(([label]) => label !== "total")
    .map(([label, ms]) => `${label} ${ms.toFixed(2)}`)
    .join(", ") + ` | total ${timings.total.toFixed(2)} ms GPU`;
}

interface SuiteResult {
  irradiance: Map<string, Float32Array>;
  reference: Float32Array;
}

async function runSuite(backend: RendererBackend): Promise<SuiteResult> {
  console.log(`\n=== ${backend} backend ===`);
  const renderer = createRadianceRenderer(device, width, height, {
    probeSpacing: 1 * scale,
    intervalLength: 2 * scale,
    referenceRays: 256,
  }, { backend });
  renderer.setScene(scene);
  const plan = renderer.plan;
  console.log(
    `${plan.effective.cascadeCount} cascades: ${
      plan.levels.map((l) =>
        `c${l.index} ${l.rayCount} rays [${l.intervalStart.toFixed(0)}, ${
          l.intervalEnd.toFixed(0)
        }] ${l.textureSize.join("x")}`
      ).join("; ")
    }`,
  );
  for (const line of renderer.describe()) console.log(`  ${line}`);
  for (const warning of plan.warnings) console.warn("plan:", warning);
  const png = (
    name: string,
    rgba: Float32Array,
    size?: readonly [number, number],
  ) => writePng(`${backend}-${name}`, rgba, size);
  const results = new Map<string, Float32Array>();

  const referenceMs = await timed(
    "reference",
    () => renderer.renderReference(),
  );
  const reference = await readback(renderer.reference.texture);
  await png("reference", reference);
  console.log(
    `reference (${renderer.currentConfig.referenceRays} rays/px): ${
      referenceMs.toFixed(1)
    } ms`,
  );
  for (const [name, x, y] of PROBES) {
    console.log(`  ${name}: ${probe(reference, x, y)}`);
  }

  const cases: Array<[string, Partial<RadianceCascadeConfig>]> = [
    ["vanilla", { mergeMode: "vanilla" }],
    ["bilinearFix", { mergeMode: "bilinearFix" }],
    ["parallaxFix", { mergeMode: "parallaxFix" }],
    ["preAverage", { mergeMode: "vanilla", preAverage: true }],
    ["fixedStep", { preAverage: false, useDistanceField: false, stepSize: 1 }],
    ["sky", { useDistanceField: true, sky: [0.2, 0.25, 0.4] }],
  ];
  for (const [name, config] of cases) {
    renderer.configure({ ...renderer.currentConfig, ...config });
    // Warm-up frame so pipeline creation is not in the timing.
    await timed(name, () => renderer.render());
    const ms = await timed(name, () => renderer.render());
    const irradiance = await readback(renderer.irradiance.texture);
    results.set(name, irradiance);
    await png(name, irradiance);
    const error = name === "sky" ? NaN : rmsError(irradiance, reference);
    const verdict = Number.isNaN(error)
      ? ""
      : error < 0.08
      ? "ok"
      : "FAR FROM REFERENCE";
    if (verdict.startsWith("FAR")) failures++;
    console.log(
      `${name}: ${ms.toFixed(1)} ms/frame${
        Number.isNaN(error)
          ? ""
          : `, rms vs reference ${error.toFixed(4)} ${verdict}`
      }`,
    );
    const timings = await settledTimings(renderer);
    if (timings) console.log(`  gpu: ${formatTimings(timings)}`);
    for (const [label, x, y] of PROBES) {
      console.log(`  ${label}: ${probe(irradiance, x, y)}`);
    }
  }

  // Bounce: the white wall's far side should brighten once bounce feeds back.
  renderer.configure({
    ...renderer.currentConfig,
    sky: [0, 0, 0],
    mergeMode: "vanilla",
    bounceStrength: 1,
  });
  // Each frame adds one bounce; the feedback must settle, not run away.
  const settling: number[] = [];
  for (let i = 0; i < 24; i++) {
    await timed("bounce", () => renderer.render());
    if (i % 4 === 3) {
      settling.push(at(await readback(renderer.irradiance.texture), 475, 200));
    }
  }
  const bounced = await readback(renderer.irradiance.texture);
  results.set("bounce", bounced);
  await png("bounce", bounced);
  const lastStep = Math.abs(settling[5] - settling[4]) /
    Math.max(1e-6, settling[5]);
  console.log(
    `bounce settling (right of wall, every 4 frames): ${
      settling.map((v) => v.toFixed(3)).join(" ")
    }`,
  );
  if (!(lastStep < 0.02)) {
    failures++;
    console.log("  FAIL: bounce feedback has not settled after 24 frames");
  }
  if (renderer instanceof ComputeRadianceRenderer) {
    await device.queue.onSubmittedWorkDone();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const band = renderer.bandStats;
    console.log(
      `bounce band: ${band.lastCount} probes of ${band.capacity} slots, grown ${band.growths}x`,
    );
    if (band.lastCount <= 0) {
      failures++;
      console.log("  FAIL: no probe joined the bounce band");
    }
  }
  renderer.configure({ ...renderer.currentConfig, bounceStrength: 0 });
  await timed("no bounce", () => renderer.render());
  const unbounced = await readback(renderer.irradiance.texture);
  const bounceGain = at(bounced, 475, 200) /
    Math.max(1e-6, at(unbounced, 475, 200));
  console.log(
    `bounce: right of wall ${at(unbounced, 475, 200).toFixed(4)} -> ${
      at(bounced, 475, 200).toFixed(4)
    } (x${bounceGain.toFixed(2)})`,
  );
  if (!(bounceGain > 1.05)) {
    failures++;
    console.log("  FAIL: bounce did not brighten the wall's shadow side");
  }

  // The smoothness lever: 2 px cascade-0 spacing for comparison with 1 px.
  renderer.configure({
    ...renderer.currentConfig,
    mergeMode: "bilinearFix",
    probeSpacing: 2 * scale,
    intervalLength: 4 * scale,
    baseRayCount: 4,
    branching: 4,
  });
  await timed("coarse", () => renderer.render());
  const coarseMs = await timed("coarse", () => renderer.render());
  const coarse = await readback(renderer.irradiance.texture);
  results.set("coarse", coarse);
  await png("coarse-2px-4rays", coarse);
  console.log(
    `coarse (2 px, 4 rays x4): ${
      coarseMs.toFixed(1)
    } ms/frame, rms vs reference ${rmsError(coarse, reference).toFixed(4)}`,
  );
  renderer.configure({
    ...renderer.currentConfig,
    probeSpacing: 1 * scale,
    intervalLength: 2 * scale,
    baseRayCount: 16,
    branching: 2,
  });

  // Debug attachments: every cascade's merged and raw radiance, at texture size.
  renderer.setDebugViews(true);
  await timed("debug", () => renderer.render());
  const debugMs = await timed("debug", () => renderer.render());
  const cascadeViews = renderer.views.cascades;
  for (const [index, cascade] of cascadeViews.entries()) {
    const [mergedTexture, rawTexture] = renderer.cascadeTextures(index);
    await png(
      `cascade${index}-merged`,
      await readback(mergedTexture),
      cascade.size,
    );
    await png(`cascade${index}-raw`, await readback(rawTexture), cascade.size);
  }
  console.log(
    `debug views: ${cascadeViews.length} cascades, raw+merged each, ${
      debugMs.toFixed(1)
    } ms/frame with debug on`,
  );
  renderer.setDebugViews(false);
  await timed("debug off", () => renderer.render());

  // The display pass (what the canvas shows) into an offscreen target: ACES on
  // the irradiance must light the sun's neighbourhood and leave the boulder dark.
  const display = new DisplayPass(device, "rgba8unorm");
  const shown = device.createTexture({
    size: { width, height },
    format: "rgba8unorm",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  await timed(
    "display",
    () =>
      display.draw(renderer.irradiance.output, shown.createView(), [
        width,
        height,
      ], {
        mode: "hdr",
        exposure: 1,
        toneMap: "aces",
      }),
  );
  const shownBytes = await readbackBytes(shown);
  const byteAt = (x: number, y: number) =>
    shownBytes[(Math.round(y * scale) * width + Math.round(x * scale)) * 4];
  console.log(
    `display (ACES): near sun ${byteAt(250, 130)}, inside boulder ${
      byteAt(660, 350)
    }`,
  );
  if (!(byteAt(250, 130) > 128 && byteAt(660, 350) < 40)) {
    failures++;
    console.log("  FAIL: display pass output is not the lit scene");
  }
  display.dispose();
  shown.destroy();
  renderer.dispose();
  return { irradiance: results, reference };
}

const at = (rgba: Float32Array, x: number, y: number) =>
  luminance(rgba, Math.round(y * scale) * width + Math.round(x * scale));

const suites = new Map<RendererBackend, SuiteResult>();
for (const backend of backends) {
  suites.set(backend, await runSuite(backend));
}

if (suites.size === 2) {
  // The backends implement the same algorithm; they may differ only by the
  // compute backend's lower-bound distance field far from outlines (which
  // moves where sphere tracing lands within half a pixel of a surface) and
  // by f16 packing of the stored levels.
  console.log("\n=== fragment vs compute ===");
  const fragment = suites.get("fragment")!;
  const compute = suites.get("compute")!;
  const referenceGap = rmsError(fragment.reference, compute.reference);
  console.log(`reference: rms between backends ${referenceGap.toFixed(4)}`);
  for (const [name, a] of fragment.irradiance) {
    const b = compute.irradiance.get(name);
    if (!b) continue;
    const gap = rmsError(a, b);
    const limit = name === "bounce" ? 0.02 : 0.01;
    const verdict = gap < limit ? "ok" : "BACKENDS DISAGREE";
    if (gap >= limit) failures++;
    console.log(`${name}: rms between backends ${gap.toFixed(4)} ${verdict}`);
  }
}

console.log(failures ? `FAILED (${failures})` : "PASS");
console.log(`PNGs in ${OUT}`);
Deno.exit(failures ? 1 : 0);
