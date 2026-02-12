/// <reference lib="dom" />

import { decodePNG, encodePNG } from "@img/png";

export interface CompareOptions {
  pixelThreshold?: number;
  diffAmplify?: number;
}

export interface CompareStats {
  width: number;
  height: number;
  rmse: number;
  maxError: number;
  diffPixels: number;
  totalPixels: number;
}

export interface CompareResult {
  stats: CompareStats;
  diffImage: Uint8Array;
}

type DecodedPng = {
  width: number;
  height: number;
  pixels: Uint8Array;
};

async function decodePng(path: string): Promise<DecodedPng> {
  const encoded = await Deno.readFile(path);
  const decoded = await decodePNG(encoded);
  return {
    width: decoded.header.width,
    height: decoded.header.height,
    pixels: decoded.body,
  };
}

export function comparePixelBuffers(
  reference: Uint8Array,
  candidate: Uint8Array,
  width: number,
  height: number,
  opts: CompareOptions = {},
): CompareResult {
  if (reference.length !== candidate.length) {
    throw new Error(`Buffer length mismatch: ref=${reference.length} candidate=${candidate.length}`);
  }

  const pixelThreshold = opts.pixelThreshold ?? 3;
  const amplify = opts.diffAmplify ?? 4;
  const diffImage = new Uint8Array(reference.length);

  let sumSq = 0;
  let maxError = 0;
  let diffPixels = 0;

  const pixelCount = width * height;

  for (let i = 0; i < pixelCount; i++) {
    const base = i * 4;

    const dr = Math.abs(reference[base] - candidate[base]);
    const dg = Math.abs(reference[base + 1] - candidate[base + 1]);
    const db = Math.abs(reference[base + 2] - candidate[base + 2]);
    const da = Math.abs(reference[base + 3] - candidate[base + 3]);

    sumSq += dr * dr + dg * dg + db * db + da * da;
    maxError = Math.max(maxError, dr, dg, db, da);

    const pixelError = Math.max(dr, dg, db, da);
    if (pixelError > pixelThreshold) {
      diffPixels += 1;
    }

    diffImage[base] = Math.min(255, dr * amplify);
    diffImage[base + 1] = Math.min(255, dg * amplify);
    diffImage[base + 2] = Math.min(255, db * amplify);
    diffImage[base + 3] = 255;
  }

  const rmse = Math.sqrt(sumSq / (pixelCount * 4));

  return {
    stats: {
      width,
      height,
      rmse,
      maxError,
      diffPixels,
      totalPixels: pixelCount,
    },
    diffImage,
  };
}

export async function comparePngFiles(
  referencePath: string,
  candidatePath: string,
  diffOutPath: string,
  opts: CompareOptions = {},
): Promise<CompareStats> {
  const [ref, cand] = await Promise.all([decodePng(referencePath), decodePng(candidatePath)]);

  if (ref.width !== cand.width || ref.height !== cand.height) {
    throw new Error(
      `Image size mismatch: ref=${ref.width}x${ref.height} candidate=${cand.width}x${cand.height}`,
    );
  }

  const { stats, diffImage } = comparePixelBuffers(ref.pixels, cand.pixels, ref.width, ref.height, opts);

  const dir = diffOutPath.slice(0, Math.max(0, diffOutPath.lastIndexOf("/")));
  if (dir) await Deno.mkdir(dir, { recursive: true });

  const pngInput = new Uint8ClampedArray(diffImage.length);
  pngInput.set(diffImage);
  const png = await encodePNG(pngInput, {
    width: ref.width,
    height: ref.height,
    compression: 0,
    filter: 0,
    interlace: 0,
  });
  await Deno.writeFile(diffOutPath, png);

  return stats;
}
