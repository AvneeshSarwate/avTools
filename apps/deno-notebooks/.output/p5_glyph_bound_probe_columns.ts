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
  buf.unmap(); buf.destroy(); return out;
}

const device = await requestWebGpuDevice();
const p = new P5GPU(device, { width: 300, height: 200 });
for (const file of ["InterVariable.ttf", "InterVariable-Italic.ttf"]) {
  await p.loadFont(new URL(`../assets/fonts/${file}`, import.meta.url));
}
const maybeTextWeight = (p as unknown as { textWeight?: (weight: number) => unknown }).textWeight;
p.textFont("Inter Variable");
p.textStyle(p.NORMAL); p.textSize(40); if (typeof maybeTextWeight === "function") maybeTextWeight.call(p, 400);
p.beginFrame(); p.text("M", 20, 60);
const atlas = (p as unknown as { _textAtlas: { size: number; texture: GPUTexture; entries: Map<bigint, {x:number;y:number;width:number;height:number;left:number;top:number;inkX0:number;inkX1:number}> } | null })._textAtlas;
if (!atlas) throw new Error("no atlas");
const entry = Array.from(atlas.entries.values())[0];
const pixels = await readR8(device, atlas.texture, atlas.size, atlas.size);
const glyph = new Uint8Array(entry.width * entry.height);
for (let y = 0; y < entry.height; y++) {
  const srcRow = (entry.y + y) * atlas.size + entry.x;
  glyph.set(pixels.subarray(srcRow, srcRow + entry.width), y * entry.width);
}
const col = Array.from({length: entry.width}, (_, x) => {
  let sum = 0; let max = 0; let nonZero = 0;
  for (let y = 0; y < entry.height; y++) {
    const a = glyph[y * entry.width + x];
    sum += a;
    if (a > max) max = a;
    if (a > 0) nonZero++;
  }
  return { x, sum, mean: sum / entry.height, max, nonZero };
});
const first = col.filter((c) => c.max > 0).slice(0, 6);
const last = col.filter((c) => c.max > 0).slice(-6);
console.log(JSON.stringify({
  textWidthM: p.textWidth("M"),
  fontWidthM: p.fontWidth("M"),
  entry: { w: entry.width, h: entry.height, left: entry.left, top: entry.top, inkX0: entry.inkX0, inkX1: entry.inkX1 },
  first,
  last,
}, null, 2));
p.endFrame(); p.dispose(); device.destroy();
