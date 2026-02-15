import { P5GPU } from "../tools/p5gpu.ts";
import { requestWebGpuDevice } from "../libraryIntegrationTetsts/raw-webgpu-helpers.ts";

function align(v: number, a: number): number { return Math.ceil(v / a) * a; }

async function readR8(device: GPUDevice, texture: GPUTexture, w: number, h: number): Promise<Uint8Array> {
  const bytesPerRow = align(w, 256);
  const buf = device.createBuffer({ size: bytesPerRow * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture }, { buffer: buf, bytesPerRow, rowsPerImage: h }, { width: w, height: h, depthOrArrayLayers: 1 });
  device.queue.submit([enc.finish()]);
  await buf.mapAsync(GPUMapMode.READ);
  const mapped = new Uint8Array(buf.getMappedRange());
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) out.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + w), y * w);
  buf.unmap();
  buf.destroy();
  return out;
}

function boundsAtThreshold(alpha: Uint8Array, w: number, h: number, thr: number): { x0: number; x1: number; width: number } {
  let minX = w;
  let maxX = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (alpha[row + x] >= thr) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
  }
  if (maxX < minX) return { x0: 0, x1: 0, width: 0 };
  return { x0: minX, x1: maxX + 1, width: maxX - minX + 1 };
}

function fractionalEdge(alpha: Uint8Array, w: number, h: number): { left: number; right: number; width: number } {
  // Find first/last non-zero columns and use alpha-weighted edge interpolation.
  let minX = w;
  let maxX = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (alpha[row + x] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
  }
  if (maxX < minX) return { left: 0, right: 0, width: 0 };

  let leftMax = 0;
  let rightMax = 0;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    leftMax = Math.max(leftMax, alpha[row + minX]);
    rightMax = Math.max(rightMax, alpha[row + maxX]);
  }

  const left = minX + (1 - leftMax / 255);
  const right = maxX + (rightMax / 255);
  return { left, right, width: right - left };
}

const device = await requestWebGpuDevice();
const p = new P5GPU(device, { width: 300, height: 200 });

for (const file of [
  "NotoSans-Regular.ttf",
  "Inter-Regular.ttf",
  "Inter-Bold.ttf",
  "InterVariable.ttf",
  "InterVariable-Italic.ttf",
  "RobotoFlex-Variable.ttf",
]) {
  await p.loadFont(new URL(`../assets/fonts/${file}`, import.meta.url));
}

const maybeTextWeight = (p as unknown as { textWeight?: (weight: number) => unknown }).textWeight;
p.textFont("Inter Variable");
p.textStyle(p.NORMAL);
p.textSize(40);
if (typeof maybeTextWeight === "function") maybeTextWeight.call(p, 400);

p.beginFrame();
p.text("M", 20, 60);

const atlas = (p as unknown as { _textAtlas: { size: number; texture: GPUTexture; entries: Map<bigint, {x:number;y:number;width:number;height:number;left:number;top:number;inkX0:number;inkX1:number}> } | null })._textAtlas;
if (!atlas) throw new Error("no atlas");

const entry = Array.from(atlas.entries.values())[0];
if (!entry) throw new Error("no glyph entry");

const pixels = await readR8(device, atlas.texture, atlas.size, atlas.size);
const glyph = new Uint8Array(entry.width * entry.height);
for (let y = 0; y < entry.height; y++) {
  const srcRow = (entry.y + y) * atlas.size + entry.x;
  glyph.set(pixels.subarray(srcRow, srcRow + entry.width), y * entry.width);
}

console.log("entry", {
  width: entry.width,
  height: entry.height,
  left: entry.left,
  top: entry.top,
  inkX0: entry.inkX0,
  inkX1: entry.inkX1,
  textWidthM: p.textWidth("M"),
  fontWidthM: p.fontWidth("M"),
});

for (const thr of [1, 64, 96, 112, 128, 144, 160, 176, 192, 208, 224]) {
  console.log("thr", thr, boundsAtThreshold(glyph, entry.width, entry.height, thr));
}
console.log("frac", fractionalEdge(glyph, entry.width, entry.height));

p.endFrame();
p.dispose();
device.destroy();
