/**
 * In-browser check and benchmark of both backends (bundled by
 * tools/browser_bench.sh and driven by Playwright): reports the adapter's
 * features and limits, whether `subgroups` compiles, then renders the
 * checked-in drawing with each backend and prints pipelined ms/frame and
 * per-pass GPU times. Results go to the console and `window.__result`.
 */

import { bakeDrawingDocument, type DrawingDocument } from "canvas-drawing";
import {
  backendAvailable,
  buildStrokeScene,
  createRadianceRenderer,
  type MergeMode,
  radianceDeviceDescriptor,
  RENDERER_BACKENDS,
} from "../lib/radiance-cascades/mod.ts";

/** Read an rgba16float texture back as float32 RGBA. */
async function readback(
  device: GPUDevice,
  texture: GPUTexture,
): Promise<Float32Array> {
  const bytesPerRow = Math.ceil((texture.width * 8) / 256) * 256;
  const buffer = device.createBuffer({
    size: bytesPerRow * texture.height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, {
    width: texture.width,
    height: texture.height,
  });
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

function halfToFloat(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exponent = (h >> 10) & 0x1f;
  const fraction = h & 0x3ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 31) return fraction ? NaN : sign * Infinity;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

const tonemap = (x: number) => 1 - 1 / (1 + Math.max(0, x)) ** 2.5;

/** RMS of tone-mapped luminance differences, as render_check.ts. */
function rmsError(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  const n = a.length / 4;
  for (let i = 0; i < n; i++) {
    const la = 0.2126 * a[i * 4] + 0.7152 * a[i * 4 + 1] +
      0.0722 * a[i * 4 + 2];
    const lb = 0.2126 * b[i * 4] + 0.7152 * b[i * 4 + 1] +
      0.0722 * b[i * 4 + 2];
    const d = tonemap(la) - tonemap(lb);
    sum += d * d;
  }
  return Math.sqrt(sum / n);
}

declare global {
  interface Window {
    __result?: unknown;
    __log?: string[];
  }
}
const log = (line: string) => {
  console.log(line);
  (window.__log ??= []).push(line);
  const pre = document.getElementById("out");
  if (pre) pre.textContent += line + "\n";
};

async function main() {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) throw new Error("no WebGPU adapter");
  log(
    `adapter: ${adapter.info.vendor} ${adapter.info.architecture} ${adapter.info.description}`,
  );
  const features: string[] = [];
  adapter.features.forEach((f) => features.push(f));
  log(`features (${features.length}): ${features.join(", ")}`);
  log(
    `limits: invocations ${adapter.limits.maxComputeInvocationsPerWorkgroup}, workgroup memory ${adapter.limits.maxComputeWorkgroupStorageSize}, storage binding ${adapter.limits.maxStorageBufferBindingSize}, buffer ${adapter.limits.maxBufferSize}`,
  );
  const device = await adapter.requestDevice(radianceDeviceDescriptor(adapter));
  device.addEventListener(
    "uncapturederror",
    (e) => log(`UNCAPTURED: ${(e as GPUUncapturedErrorEvent).error.message}`),
  );
  // A browser adapter yields one device; take another adapter for the probe.
  const probeAdapter = await navigator.gpu.requestAdapter();
  if (probeAdapter?.features.has("subgroups" as GPUFeatureName)) {
    const sgDevice = await probeAdapter.requestDevice({
      requiredFeatures: ["subgroups" as GPUFeatureName],
    });
    const module = sgDevice.createShaderModule({
      code: `enable subgroups;
@group(0) @binding(0) var<storage, read_write> o: array<f32>;
@compute @workgroup_size(64) fn main(@builtin(local_invocation_index) li: u32) {
  o[li] = subgroupAdd(f32(li)) + subgroupShuffleXor(f32(li), 1u);
}`,
    });
    const info = await module.getCompilationInfo();
    log(
      `subgroups: ${
        info.messages.filter((m) => m.type === "error").length === 0
          ? "compiles"
          : "compile errors"
      }`,
    );
    sgDevice.destroy();
  } else {
    log("subgroups: feature absent");
  }

  const saved = await (await fetch("./scene.json")).json() as {
    data: DrawingDocument;
  };
  const params = new URLSearchParams(location.search);
  const scale = Number(params.get("scale") ?? "1");
  const frames = Number(params.get("frames") ?? "30");
  const merge = (params.get("merge") ?? "bilinearFix") as MergeMode;
  const width = Math.round(1000 * scale);
  const height = Math.round(500 * scale);
  const scene = buildStrokeScene(bakeDrawingDocument(saved.data), { scale });
  log(
    `scene: ${scene.segmentCount} segments at ${width}x${height}, merge ${merge}, ${frames} frames`,
  );

  const results: Record<string, unknown> = {};
  const images = new Map<string, Float32Array>();
  for (const backend of RENDERER_BACKENDS) {
    if (!backendAvailable(backend, device)) {
      log(`${backend}: not available on this device`);
      continue;
    }
    device.pushErrorScope("validation");
    const renderer = createRadianceRenderer(device, width, height, {
      probeSpacing: 1 * scale,
      intervalLength: 2 * scale,
      mergeMode: merge,
      bounceStrength: 1,
    }, { backend });
    renderer.setScene(scene);
    for (const line of renderer.describe()) log(`  ${line}`);
    for (let i = 0; i < 3; i++) renderer.render();
    await device.queue.onSubmittedWorkDone();
    const started = performance.now();
    for (let i = 0; i < frames; i++) renderer.render();
    await device.queue.onSubmittedWorkDone();
    const perFrame = (performance.now() - started) / frames;
    await new Promise((r) => setTimeout(r, 50));
    const timings = renderer.timings;
    images.set(backend, await readback(device, renderer.irradiance.texture));
    const error = await device.popErrorScope();
    const gpu = timings
      ? Object.entries(timings).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(
        ", ",
      )
      : "no timings";
    log(
      `${backend}: ${perFrame.toFixed(2)} ms/frame pipelined | ${gpu}${
        error ? ` | ERROR ${error.message}` : ""
      }`,
    );
    results[backend] = { perFrame, timings, error: error?.message ?? null };
    renderer.dispose();
  }
  const reference = images.get("compute");
  if (reference) {
    for (const [backend, image] of images) {
      if (backend === "compute") continue;
      log(
        `${backend} vs compute: rms ${rmsError(image, reference).toFixed(4)}`,
      );
    }
  }
  window.__result = results;
}

main().catch((error) => {
  log(`FAILED: ${error?.stack ?? error}`);
  window.__result = { error: String(error) };
});
