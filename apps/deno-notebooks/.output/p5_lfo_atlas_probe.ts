import { P5GPU } from "../tools/p5gpu.ts";
import { requestWebGpuDevice } from "../libraryIntegrationTetsts/raw-webgpu-helpers.ts";
import { P5_TEST_SKETCHES } from "../libraryIntegrationTetsts/p5_test_sketches.ts";

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
  for (let y = 0; y < h; y++) {
    out.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + w), y * w);
  }
  buf.unmap();
  buf.destroy();
  return out;
}

const sketch = P5_TEST_SKETCHES.find((s) => s.name === "text-lfo-perf-frame0");
if (!sketch) throw new Error("missing sketch");
const device = await requestWebGpuDevice();
const p = new P5GPU(device, { width: sketch.width, height: sketch.height });
p.beginFrame();
sketch.draw(p as never);
const atlas = (p as unknown as { _textAtlas: { size: number; texture: GPUTexture; entries: Map<bigint, any> } | null })._textAtlas;
if (!atlas) throw new Error('no atlas');
console.log('atlas size', atlas.size, 'entry count', atlas.entries.size, 'stats', p.textStats());
const entries = Array.from(atlas.entries.values()) as Array<{x:number;y:number;width:number;height:number;left:number;top:number;u0:number;v0:number;u1:number;v1:number;key:bigint}>;
entries.sort((a,b)=> (a.y-b.y) || (a.x-b.x));
for (const e of entries.slice(0, 16)) {
  console.log('entry', {x:e.x,y:e.y,w:e.width,h:e.height,left:e.left,top:e.top,u0:e.u0,v0:e.v0,u1:e.u1,v1:e.v1,key:e.key.toString(16)});
}

const atlasPixels = await readR8(device, atlas.texture, atlas.size, atlas.size);

function inspectEntry(e: {x:number;y:number;width:number;height:number}) {
  const rowSums: number[] = [];
  for (let yy=0; yy<e.height; yy++) {
    let sum = 0;
    for (let xx=0; xx<e.width; xx++) {
      sum += atlasPixels[(e.y + yy) * atlas.size + (e.x + xx)];
    }
    rowSums.push(sum);
  }
  const nonZeroRows = rowSums.map((s,i)=>({s,i})).filter((r)=>r.s>0);
  console.log('inspect', {x:e.x,y:e.y,w:e.width,h:e.height,nonZeroRows: nonZeroRows.slice(0,6), nonZeroRowsTail: nonZeroRows.slice(-6)});
}

const firstRowEntries = entries.filter((e)=>e.y===0).slice(0,8);
for (const e of firstRowEntries) inspectEntry(e);

p.endFrame();
p.dispose();
device.destroy();
