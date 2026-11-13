/// <reference lib="dom" />

// Run from apps/deno-notebooks:
//   deno run --unstable-webgpu --allow-read --allow-write --allow-run scripts/ntsc_vhs_compare.ts

import { encodePNG } from "@img/png";
import { P5GPU } from "../tools/p5gpu.ts";
import {
  DEFAULT_NTSC_VHS_SETTINGS,
  NTSC_RS_STABLE_APPROX_SETTINGS,
  NtscVhsGpuEffect,
  type NtscVhsSettings,
  VHS_LOOK_SETTINGS,
} from "../tools/ntsc_vhs_gpu.ts";

interface CompareStats {
  rmse: number;
  meanAbsError: number;
  maxError: number;
  diffPixels: number;
  totalPixels: number;
  channelRmse: {
    r: number;
    g: number;
    b: number;
  };
}

interface Candidate {
  name: string;
  settings: Partial<NtscVhsSettings>;
}

type GridMode = "off" | "coarse" | "fine" | "wide";

const args = parseArgs(Deno.args);
const WIDTH = numberArg(args, "width", 320);
const HEIGHT = numberArg(args, "height", 240);
const FRAME = numberArg(args, "frame", 0);
const OUT_DIR = args.out ?? ".output/ntsc-vhs-gpu";
const PROFILE = args.profile ?? "stable";
const GRID_MODE = gridModeArg(args, "grid");
const GRID_SEARCH = GRID_MODE !== "off";
const WRITE_TOP = numberArg(args, "write-top", 8);
const APPROACH = "v3-row-transient-snow-wide-grid";

const BASE_STABLE_COMPARE_SETTINGS: Partial<NtscVhsSettings> = {
  ...NTSC_RS_STABLE_APPROX_SETTINGS,
  scanlineIntensity: 0.0,
  edgeWaveIntensity: 0.0,
  headSwitchingHeight: 0.0,
  headSwitchingShift: 0.0,
  noiseIntensity: 0.0,
  snowDensity: 0.0,
  chromaPhaseError: 0.0,
  chromaLossDensity: 0.0,
};

const BASE_VHS_COMPARE_SETTINGS: Partial<NtscVhsSettings> = {
  ...BASE_STABLE_COMPARE_SETTINGS,
  edgeWaveIntensity: 0.5,
  edgeWaveFrequency: 0.05,
  edgeWaveSpeed: 4.0,
  snowDensity: 0.0009,
  snowStrength: 0.65,
  chromaLossDensity: 0.000025,
  chromaLossAmount: 1.0,
};

const BASE_COMPARE_SETTINGS = PROFILE === "vhs"
  ? BASE_VHS_COMPARE_SETTINGS
  : BASE_STABLE_COMPARE_SETTINGS;
const CANDIDATES = makeBaselineCandidates(BASE_COMPARE_SETTINGS, PROFILE);

const GRID_CANDIDATES: Candidate[] = GRID_MODE === "off"
  ? []
  : makeGridCandidates(BASE_COMPARE_SETTINGS, GRID_MODE);

await Deno.mkdir(OUT_DIR, { recursive: true });

const device = await requestWebGpuDevice();
const p5 = new P5GPU(device, {
  width: WIDTH,
  height: HEIGHT,
  format: "rgba8unorm",
  sampleCount: 1,
});

p5.beginFrame();
drawComparisonFrame(p5, WIDTH, HEIGHT, FRAME);
const inputTexture = p5.endFrame();
const inputPixels = await readTextureRgba8(device, inputTexture, WIDTH, HEIGHT);
await writePng(`${OUT_DIR}/input.png`, inputPixels, WIDTH, HEIGHT);
await Deno.writeFile(`${OUT_DIR}/input.rgba`, inputPixels);

const referencePixels = await runNtscReference(
  inputPixels,
  WIDTH,
  HEIGHT,
  FRAME,
  PROFILE,
);
await writePng(
  `${OUT_DIR}/reference-${PROFILE}.png`,
  referencePixels,
  WIDTH,
  HEIGHT,
);

const candidates = [...CANDIDATES, ...GRID_CANDIDATES];
const results: Array<
  { candidate: string; stats: CompareStats; settings: Partial<NtscVhsSettings> }
> = [];
let best: {
  name: string;
  pixels: Uint8Array;
  diff: Uint8Array;
  stats: CompareStats;
} | null = null;
const top: Array<{
  name: string;
  pixels: Uint8Array;
  diff: Uint8Array;
  stats: CompareStats;
  settings: Partial<NtscVhsSettings>;
}> = [];
const compareEffect = new NtscVhsGpuEffect(
  device,
  { src: inputTexture },
  WIDTH,
  HEIGHT,
  BASE_COMPARE_SETTINGS,
);

for (const candidate of candidates) {
  compareEffect.setSettings(candidate.settings);
  compareEffect.setFrame(FRAME);
  compareEffect.render();
  const gpuPixels = await readTextureRgba8(
    device,
    compareEffect.outputTexture,
    WIDTH,
    HEIGHT,
  );
  const { stats, diff } = comparePixels(
    referencePixels,
    gpuPixels,
    WIDTH,
    HEIGHT,
  );
  if (!candidate.name.startsWith("grid-")) {
    await writePng(
      `${OUT_DIR}/gpu-${candidate.name}.png`,
      gpuPixels,
      WIDTH,
      HEIGHT,
    );
    await writePng(
      `${OUT_DIR}/diff-${candidate.name}.png`,
      diff,
      WIDTH,
      HEIGHT,
    );
  }

  results.push({
    candidate: candidate.name,
    stats,
    settings: candidate.settings,
  });
  insertTop(top, {
    name: candidate.name,
    pixels: gpuPixels,
    diff,
    stats,
    settings: candidate.settings,
  }, WRITE_TOP);
  if (!best || stats.rmse < best.stats.rmse) {
    best = { name: candidate.name, pixels: gpuPixels, diff, stats };
  }
}
compareEffect.dispose();

if (best) {
  await writePng(`${OUT_DIR}/gpu-best.png`, best.pixels, WIDTH, HEIGHT);
  await writePng(`${OUT_DIR}/diff-best.png`, best.diff, WIDTH, HEIGHT);
}
for (let i = 0; i < top.length; i += 1) {
  const rank = String(i + 1).padStart(2, "0");
  await writePng(
    `${OUT_DIR}/gpu-top-${rank}-${top[i].name}.png`,
    top[i].pixels,
    WIDTH,
    HEIGHT,
  );
  await writePng(
    `${OUT_DIR}/diff-top-${rank}-${top[i].name}.png`,
    top[i].diff,
    WIDTH,
    HEIGHT,
  );
}
await writeTopContactSheet(
  `${OUT_DIR}/contact-top-ranked.png`,
  `${OUT_DIR}/contact-top-ranked.md`,
  inputPixels,
  referencePixels,
  top,
  WIDTH,
  HEIGHT,
);

const visualOutputs = await writeVisualVariants(
  device,
  inputTexture,
  OUT_DIR,
  WIDTH,
  HEIGHT,
  FRAME,
);

const summary = {
  approach: APPROACH,
  width: WIDTH,
  height: HEIGHT,
  frame: FRAME,
  profile: PROFILE,
  candidateCount: candidates.length,
  gridSearch: GRID_SEARCH,
  gridMode: GRID_MODE,
  best: best ? { candidate: best.name, stats: best.stats } : null,
  top: top.map(({ name, stats, settings }) => ({
    candidate: name,
    stats,
    settings,
  })),
  visualOutputs,
  results,
};
await Deno.writeTextFile(
  `${OUT_DIR}/summary.json`,
  JSON.stringify(summary, null, 2),
);
await appendSimilarityHistory(`${OUT_DIR}/similarity-history.md`, summary);
console.log(JSON.stringify(
  {
    ...summary,
    results: `${results.length} candidates written to ${OUT_DIR}/summary.json`,
  },
  null,
  2,
));

p5.dispose();

async function appendSimilarityHistory(
  path: string,
  summary: {
    approach: string;
    width: number;
    height: number;
    frame: number;
    profile: string;
    candidateCount: number;
    gridSearch: boolean;
    gridMode: GridMode;
    best: { candidate: string; stats: CompareStats } | null;
    top: Array<{
      candidate: string;
      stats: CompareStats;
      settings: Partial<NtscVhsSettings>;
    }>;
    visualOutputs: Array<{ name: string; path: string }>;
  },
): Promise<void> {
  const argsText = Deno.args.length === 0 ? "(defaults)" : Deno.args.join(" ");
  const lines = [
    `## ${new Date().toISOString()} - ${summary.approach}`,
    `args: \`${argsText}\``,
    `profile: ${summary.profile}, frame: ${summary.frame}, size: ${summary.width}x${summary.height}`,
    `grid: ${
      summary.gridSearch ? summary.gridMode : "off"
    }, candidates: ${summary.candidateCount}`,
  ];

  if (summary.best) {
    lines.push(
      `best: ${summary.best.candidate}, ${formatStats(summary.best.stats)}`,
    );
  }
  lines.push(
    "visual inspection: `contact-top-ranked.png`, `contact-visual-variants.png`, `visual-variants.md`",
  );

  lines.push("");
  lines.push(
    "| rank | candidate | rmse | mae | max | diff pixels | settings |",
  );
  lines.push("| ---: | --- | ---: | ---: | ---: | ---: | --- |");
  for (let i = 0; i < summary.top.length; i += 1) {
    const entry = summary.top[i];
    lines.push(
      `| ${i + 1} | ${entry.candidate} | ${formatNumber(entry.stats.rmse)} | ${
        formatNumber(entry.stats.meanAbsError)
      } | ${entry.stats.maxError} | ${entry.stats.diffPixels}/${entry.stats.totalPixels} | \`${
        JSON.stringify(entry.settings)
      }\` |`,
    );
  }
  lines.push("");
  lines.push(
    `visual variants: ${
      summary.visualOutputs.map((entry) => entry.name).join(", ")
    }`,
  );

  await Deno.writeTextFile(path, `${lines.join("\n")}\n\n`, {
    append: true,
    create: true,
  });
}

function formatStats(stats: CompareStats): string {
  return `rmse=${formatNumber(stats.rmse)}, mae=${
    formatNumber(stats.meanAbsError)
  }, max=${stats.maxError}, diff=${stats.diffPixels}/${stats.totalPixels}`;
}

function formatNumber(value: number): string {
  return value.toFixed(4);
}

async function writeTopContactSheet(
  imagePath: string,
  manifestPath: string,
  inputPixels: Uint8Array,
  referencePixels: Uint8Array,
  top: Array<{
    name: string;
    pixels: Uint8Array;
    diff: Uint8Array;
    stats: CompareStats;
    settings: Partial<NtscVhsSettings>;
  }>,
  width: number,
  height: number,
): Promise<void> {
  if (top.length === 0) return;
  const tiles = top.flatMap((entry) => [
    inputPixels,
    referencePixels,
    entry.pixels,
    entry.diff,
  ]);
  const sheet = composeContactSheet(tiles, width, height, 4);
  await writePng(imagePath, sheet.pixels, sheet.width, sheet.height);

  const lines = [
    "# Top Candidate Contact Sheet",
    "",
    "Columns: input, ntsc-rs reference, GPU candidate, amplified diff.",
    "",
    "| row | candidate | stats | settings |",
    "| ---: | --- | --- | --- |",
  ];
  for (let i = 0; i < top.length; i += 1) {
    const entry = top[i];
    lines.push(
      `| ${i + 1} | ${entry.name} | ${formatStats(entry.stats)} | \`${
        JSON.stringify(entry.settings)
      }\` |`,
    );
  }
  await Deno.writeTextFile(manifestPath, `${lines.join("\n")}\n`);
}

async function writeVisualVariants(
  device: GPUDevice,
  inputTexture: GPUTexture,
  outDir: string,
  width: number,
  height: number,
  frame: number,
): Promise<Array<{ name: string; path: string }>> {
  const variants = makeVisualVariants();
  const effect = new NtscVhsGpuEffect(
    device,
    { src: inputTexture },
    width,
    height,
    variants[0].settings,
  );
  const outputs: Array<{ name: string; path: string; pixels: Uint8Array }> = [];
  for (const variant of variants) {
    effect.setSettings(variant.settings);
    effect.setFrame(frame);
    effect.render();
    const pixels = await readTextureRgba8(
      device,
      effect.outputTexture,
      width,
      height,
    );
    const path = `${outDir}/visual-${variant.name}.png`;
    await writePng(path, pixels, width, height);
    if (variant.name === "vhs-look") {
      await writePng(`${outDir}/gpu-vhs-look.png`, pixels, width, height);
    }
    outputs.push({ name: variant.name, path, pixels });
  }
  effect.dispose();

  const sheet = composeContactSheet(
    outputs.map((entry) => entry.pixels),
    width,
    height,
    4,
  );
  await writePng(
    `${outDir}/contact-visual-variants.png`,
    sheet.pixels,
    sheet.width,
    sheet.height,
  );
  await writeVisualManifest(`${outDir}/visual-variants.md`, variants);
  return outputs.map(({ name, path }) => ({ name, path }));
}

function makeVisualVariants(): Candidate[] {
  return [
    {
      name: "vhs-look",
      settings: VHS_LOOK_SETTINGS,
    },
    {
      name: "snow-sparse",
      settings: {
        ...VHS_LOOK_SETTINGS,
        edgeWaveIntensity: 0.0,
        snowDensity: 0.00035,
        snowStrength: 0.55,
        chromaLossDensity: 0.0,
      },
    },
    {
      name: "snow-transients",
      settings: {
        ...VHS_LOOK_SETTINGS,
        edgeWaveIntensity: 0.0,
        snowDensity: 0.0009,
        snowStrength: 0.65,
        chromaLossDensity: 0.0,
      },
    },
    {
      name: "snow-heavy",
      settings: {
        ...VHS_LOOK_SETTINGS,
        edgeWaveIntensity: 0.0,
        snowDensity: 0.002,
        snowStrength: 0.75,
        chromaLossDensity: 0.0,
      },
    },
    {
      name: "chroma-loss-soft",
      settings: {
        ...VHS_LOOK_SETTINGS,
        snowDensity: 0.0,
        chromaLossDensity: 0.002,
        chromaLossAmount: 0.45,
      },
    },
    {
      name: "chroma-loss-hard",
      settings: {
        ...VHS_LOOK_SETTINGS,
        snowDensity: 0.0,
        chromaLossDensity: 0.004,
        chromaLossAmount: 1.0,
      },
    },
    {
      name: "color-noise",
      settings: {
        ...VHS_LOOK_SETTINGS,
        snowDensity: 0.0,
        chromaLossDensity: 0.0,
        noiseIntensity: 0.012,
        chromaPhaseError: 0.018,
      },
    },
    {
      name: "tracking-ish",
      settings: {
        ...VHS_LOOK_SETTINGS,
        snowDensity: 0.00065,
        chromaLossDensity: 0.001,
        edgeWaveIntensity: 1.6,
        headSwitchingHeight: 10.0,
        headSwitchingShift: 28.0,
      },
    },
  ];
}

async function writeVisualManifest(
  path: string,
  variants: Candidate[],
): Promise<void> {
  const lines = [
    "# Visual Variant Contact Sheet",
    "",
    "Image: `contact-visual-variants.png`",
    "",
    "Read left-to-right, top-to-bottom.",
    "",
    "| index | variant | file | settings |",
    "| ---: | --- | --- | --- |",
  ];
  for (let i = 0; i < variants.length; i += 1) {
    const variant = variants[i];
    lines.push(
      `| ${i + 1} | ${variant.name} | \`visual-${variant.name}.png\` | \`${
        JSON.stringify(variant.settings)
      }\` |`,
    );
  }
  await Deno.writeTextFile(path, `${lines.join("\n")}\n`);
}

function composeContactSheet(
  tiles: Uint8Array[],
  tileWidth: number,
  tileHeight: number,
  columns: number,
): { pixels: Uint8Array; width: number; height: number } {
  const gutter = 8;
  const rows = Math.ceil(tiles.length / columns);
  const width = columns * tileWidth + (columns + 1) * gutter;
  const height = rows * tileHeight + (rows + 1) * gutter;
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 12;
    pixels[i + 1] = 14;
    pixels[i + 2] = 18;
    pixels[i + 3] = 255;
  }

  for (let tileIndex = 0; tileIndex < tiles.length; tileIndex += 1) {
    const tile = tiles[tileIndex];
    const col = tileIndex % columns;
    const row = Math.floor(tileIndex / columns);
    const dstX = gutter + col * (tileWidth + gutter);
    const dstY = gutter + row * (tileHeight + gutter);
    blitTile(tile, pixels, tileWidth, tileHeight, width, dstX, dstY);
  }

  return { pixels, width, height };
}

function blitTile(
  src: Uint8Array,
  dst: Uint8Array,
  tileWidth: number,
  tileHeight: number,
  dstWidth: number,
  dstX: number,
  dstY: number,
): void {
  for (let y = 0; y < tileHeight; y += 1) {
    const srcStart = y * tileWidth * 4;
    const dstStart = ((dstY + y) * dstWidth + dstX) * 4;
    dst.set(src.subarray(srcStart, srcStart + tileWidth * 4), dstStart);
  }
}

function drawComparisonFrame(
  p5: P5GPU,
  width: number,
  height: number,
  frame: number,
): void {
  p5.background(16, 18, 22, 255);
  p5.noStroke();

  const bars = [
    [235, 235, 235],
    [232, 221, 42],
    [36, 220, 220],
    [38, 215, 42],
    [220, 42, 220],
    [220, 42, 42],
    [42, 42, 220],
    [18, 18, 18],
  ];
  const barW = width / bars.length;
  for (let i = 0; i < bars.length; i += 1) {
    const [r, g, b] = bars[i];
    p5.fill(r, g, b, 255);
    p5.rect(i * barW, 0, barW + 1, height * 0.22);
  }

  p5.fill(245, 245, 235, 255);
  for (let x = 0; x < width; x += 12) {
    p5.rect(x, height * 0.28, 6, height * 0.12);
  }

  p5.fill(20, 24, 32, 255);
  p5.rect(0, height * 0.43, width, height * 0.18);
  for (let i = 0; i < 18; i += 1) {
    const t = i / 17;
    const v = Math.round(255 * t);
    p5.fill(v, v, v, 255);
    p5.rect(i * width / 18, height * 0.45, width / 18 + 1, height * 0.14);
  }

  p5.stroke(255, 255, 255, 255);
  p5.strokeWeight(2);
  for (let i = 0; i < 9; i += 1) {
    const y = height * (0.66 + i * 0.03);
    p5.line(0, y, width, y + Math.sin(frame * 0.2 + i) * 8);
  }

  p5.stroke(255, 128, 40, 255);
  p5.strokeWeight(5);
  p5.noFill();
  p5.circle(width * 0.25, height * 0.77, Math.min(width, height) * 0.27);
  p5.stroke(70, 170, 255, 255);
  p5.circle(width * 0.25, height * 0.77, Math.min(width, height) * 0.16);

  p5.noStroke();
  for (let i = 0; i < 22; i += 1) {
    const t = i / 21;
    p5.fill(255 * (1 - t), 80 + 160 * t, 255 * t, 220);
    p5.circle(
      width * (0.55 + 0.36 * t),
      height * (0.76 + 0.09 * Math.sin(t * Math.PI * 4)),
      8 + t * 18,
    );
  }

  p5.stroke(255, 255, 255, 190);
  p5.strokeWeight(1);
  for (let x = 0; x < width; x += 16) {
    p5.line(x, height * 0.63, width - x * 0.35, height - 1);
  }
}

async function requestWebGpuDevice(): Promise<GPUDevice> {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("No WebGPU adapter available");
  const device = await adapter.requestDevice();
  device.addEventListener("uncapturederror", (event: Event) => {
    const gpuEvent = event as Event & { error?: { message?: string } };
    console.error(
      "WebGPU uncaptured error:",
      gpuEvent.error?.message ?? gpuEvent,
    );
  });
  return device;
}

function alignTo(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

async function readTextureRgba8(
  device: GPUDevice,
  texture: GPUTexture,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const bytesPerRow = alignTo(width * 4, 256);
  const buffer = device.createBuffer({
    size: bytesPerRow * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer(
    { texture },
    { buffer, bytesPerRow, rowsPerImage: height },
    { width, height, depthOrArrayLayers: 1 },
  );
  device.queue.submit([encoder.finish()]);
  await buffer.mapAsync(GPUMapMode.READ);
  const mapped = new Uint8Array(buffer.getMappedRange());
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    pixels.set(
      mapped.subarray(y * bytesPerRow, y * bytesPerRow + width * 4),
      y * width * 4,
    );
  }
  buffer.unmap();
  buffer.destroy();
  return pixels;
}

async function writePng(
  path: string,
  pixels: Uint8Array,
  width: number,
  height: number,
): Promise<void> {
  const pngInput = new Uint8Array(pixels.length);
  pngInput.set(pixels);
  const png = await encodePNG(pngInput, {
    width,
    height,
    compression: 0,
    filter: 0,
    interlace: 0,
  });
  await Deno.writeFile(path, png);
}

async function runNtscReference(
  inputPixels: Uint8Array,
  width: number,
  height: number,
  frame: number,
  profile: string,
): Promise<Uint8Array> {
  const inputRaw = `${OUT_DIR}/reference-input.rgba`;
  const outputRaw = `${OUT_DIR}/reference-output.rgba`;
  await Deno.writeFile(inputRaw, inputPixels);

  const manifestPath = decodeURIComponent(
    new URL("../../../agentScratch/ntsc_ref_runner/Cargo.toml", import.meta.url)
      .pathname,
  );
  const command = new Deno.Command("cargo", {
    args: [
      "run",
      "--quiet",
      "--manifest-path",
      manifestPath,
      "--",
      inputRaw,
      outputRaw,
      String(width),
      String(height),
      String(frame),
      profile,
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const result = await command.output();
  if (!result.success) {
    const stderr = new TextDecoder().decode(result.stderr);
    const stdout = new TextDecoder().decode(result.stdout);
    throw new Error(
      `ntsc reference failed\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    );
  }
  return await Deno.readFile(outputRaw);
}

function comparePixels(
  reference: Uint8Array,
  candidate: Uint8Array,
  width: number,
  height: number,
): { stats: CompareStats; diff: Uint8Array } {
  if (reference.length !== candidate.length) {
    throw new Error(
      `buffer length mismatch: ${reference.length} vs ${candidate.length}`,
    );
  }

  const diff = new Uint8Array(reference.length);
  let sumSq = 0;
  let sumAbs = 0;
  let sumSqR = 0;
  let sumSqG = 0;
  let sumSqB = 0;
  let maxError = 0;
  let diffPixels = 0;
  const totalPixels = width * height;
  for (let i = 0; i < totalPixels; i += 1) {
    const base = i * 4;
    const dr = Math.abs(reference[base] - candidate[base]);
    const dg = Math.abs(reference[base + 1] - candidate[base + 1]);
    const db = Math.abs(reference[base + 2] - candidate[base + 2]);
    sumSq += dr * dr + dg * dg + db * db;
    sumSqR += dr * dr;
    sumSqG += dg * dg;
    sumSqB += db * db;
    sumAbs += dr + dg + db;
    const pixelError = Math.max(dr, dg, db);
    maxError = Math.max(maxError, pixelError);
    if (pixelError > 3) diffPixels += 1;
    diff[base] = Math.min(255, dr * 4);
    diff[base + 1] = Math.min(255, dg * 4);
    diff[base + 2] = Math.min(255, db * 4);
    diff[base + 3] = 255;
  }

  return {
    stats: {
      rmse: Math.sqrt(sumSq / (totalPixels * 3)),
      meanAbsError: sumAbs / (totalPixels * 3),
      maxError,
      diffPixels,
      totalPixels,
      channelRmse: {
        r: Math.sqrt(sumSqR / totalPixels),
        g: Math.sqrt(sumSqG / totalPixels),
        b: Math.sqrt(sumSqB / totalPixels),
      },
    },
    diff,
  };
}

function makeBaselineCandidates(
  base: Partial<NtscVhsSettings>,
  profile: string,
): Candidate[] {
  return [
    {
      name: `v3-${profile}-base`,
      settings: base,
    },
    {
      name: "v1-default",
      settings: {
        ...DEFAULT_NTSC_VHS_SETTINGS,
        scanlineIntensity: 0.0,
        edgeWaveIntensity: profile === "vhs" ? 0.5 : 0.0,
        edgeWaveFrequency: profile === "vhs" ? 0.05 : 0.045,
        edgeWaveSpeed: profile === "vhs" ? 4.0 : 0.9,
        headSwitchingHeight: 0.0,
        headSwitchingShift: 0.0,
        noiseIntensity: 0.0,
        snowDensity: profile === "vhs" ? 0.0009 : 0.0,
        chromaPhaseError: 0.0,
        chromaLossDensity: profile === "vhs" ? 0.000025 : 0.0,
      },
    },
    {
      name: "v2-softer",
      settings: {
        ...base,
        lumaSmear: 0.32,
        chromaBlur: 0.92,
        compositeSharpness: 0.45,
        ringingIntensity: 0.65,
        vhsSharpen: 0.10,
      },
    },
    {
      name: "v2-sharper",
      settings: {
        ...base,
        lumaSmear: 0.18,
        chromaBlur: 0.55,
        compositeSharpness: 0.88,
        ringingIntensity: 1.25,
        vhsSharpen: 0.24,
      },
    },
    {
      name: "v2-wide-smear",
      settings: {
        ...base,
        lumaSmear: 0.46,
        chromaBlur: 1.16,
        compositeSharpness: 0.55,
        ringingIntensity: 0.80,
        vhsSharpen: 0.08,
      },
    },
    {
      name: "v2-low-delay",
      settings: {
        ...base,
        lumaSmear: 0.28,
        chromaBlur: 0.80,
        chromaDelayX: 1.0,
        compositeSharpness: 0.65,
        ringingIntensity: 0.95,
        vhsSharpen: 0.14,
      },
    },
  ];
}

function makeGridCandidates(
  base: Partial<NtscVhsSettings>,
  mode: Exclude<GridMode, "off">,
): Candidate[] {
  const candidates: Candidate[] = [];
  const lumaSmears = mode === "wide"
    ? [0.00, 0.02, 0.04, 0.08]
    : mode === "fine"
    ? [0.00, 0.04, 0.08, 0.12]
    : [0.08, 0.14, 0.20, 0.28];
  const chromaBlurs = mode === "wide"
    ? [0.00, 0.15, 0.30, 0.45, 0.60]
    : mode === "fine"
    ? [0.00, 0.15, 0.30, 0.45]
    : [0.30, 0.45, 0.60, 0.80];
  const compositeSharpnesses = mode === "wide"
    ? [1.15, 1.35, 1.55, 1.75]
    : mode === "fine"
    ? [0.95, 1.15, 1.35, 1.55]
    : [0.65, 0.90, 1.15];
  const ringingIntensities = mode === "wide"
    ? [0.00, 0.20, 0.45]
    : mode === "fine"
    ? [0.00, 0.30, 0.65, 0.90]
    : [0.65, 1.0, 1.35];
  const vhsSharpens = mode === "wide"
    ? [0.00, 0.08, 0.16, 0.24]
    : mode === "fine"
    ? [0.00, 0.05, 0.10, 0.16]
    : [0.10, 0.20, 0.32];
  const chromaDelayXs = mode === "wide"
    ? [0.0, 1.0, 2.0]
    : mode === "fine"
    ? [0.0, 1.0, 2.0]
    : [1.0, 2.0, 3.0];
  const baseVerticalBlend = base.verticalBlend ??
    NTSC_RS_STABLE_APPROX_SETTINGS.verticalBlend;
  const verticalBlends = mode === "wide"
    ? [0.0, 0.5, 1.0]
    : [baseVerticalBlend];

  for (const lumaSmear of lumaSmears) {
    for (const chromaBlur of chromaBlurs) {
      for (const compositeSharpness of compositeSharpnesses) {
        for (const ringingIntensity of ringingIntensities) {
          for (const vhsSharpen of vhsSharpens) {
            for (const chromaDelayX of chromaDelayXs) {
              for (const verticalBlend of verticalBlends) {
                candidates.push({
                  name: `grid-${candidates.length.toString().padStart(4, "0")}`,
                  settings: {
                    ...base,
                    lumaSmear,
                    chromaBlur,
                    compositeSharpness,
                    ringingIntensity,
                    vhsSharpen,
                    chromaDelayX,
                    verticalBlend,
                  },
                });
              }
            }
          }
        }
      }
    }
  }

  return candidates;
}

function insertTop<T extends { stats: CompareStats }>(
  items: T[],
  item: T,
  limit: number,
): void {
  if (limit <= 0) return;
  items.push(item);
  items.sort((a, b) => a.stats.rmse - b.stats.rmse);
  if (items.length > limit) {
    items.length = limit;
  }
}

function parseArgs(rawArgs: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const arg of rawArgs) {
    if (!arg.startsWith("--")) continue;
    const [key, value = "1"] = arg.slice(2).split("=", 2);
    parsed[key] = value;
  }
  return parsed;
}

function numberArg(
  args: Record<string, string>,
  key: string,
  fallback: number,
): number {
  const value = args[key];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function gridModeArg(args: Record<string, string>, key: string): GridMode {
  const value = args[key];
  if (value === undefined || value === "0" || value === "false") {
    return "off";
  }
  if (value === "fine" || value === "wide") {
    return value;
  }
  return "coarse";
}
