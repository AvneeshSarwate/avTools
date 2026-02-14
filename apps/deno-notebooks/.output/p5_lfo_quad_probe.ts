import { P5GPU } from "../tools/p5gpu.ts";
import { requestWebGpuDevice } from "../libraryIntegrationTetsts/raw-webgpu-helpers.ts";
import { P5_TEST_SKETCHES } from "../libraryIntegrationTetsts/p5_test_sketches.ts";

const sketch = P5_TEST_SKETCHES.find((s) => s.name === "text-lfo-perf-frame0");
if (!sketch) throw new Error('missing');
const device = await requestWebGpuDevice();
const p = new P5GPU(device, { width: sketch.width, height: sketch.height });
p.beginFrame();
sketch.draw(p as never);
const atlas = (p as unknown as { _textAtlas: { size: number; entries: Map<bigint, any> } | null })._textAtlas;
if (!atlas) throw new Error('no atlas');
const entries = Array.from(atlas.entries.values()) as Array<{x:number;y:number;width:number;height:number;u0:number;v0:number;u1:number;v1:number;top:number;left:number;key:bigint}>;

const v = (p as unknown as { _textVertices: number[] })._textVertices;
let count = 0;
for (let q = 0; q < v.length / 48; q++) {
  const base = q * 48;
  const xs = [v[base + 0], v[base + 8], v[base + 16], v[base + 24], v[base + 32], v[base + 40]];
  const ys = [v[base + 1], v[base + 9], v[base + 17], v[base + 25], v[base + 33], v[base + 41]];
  const us = [v[base + 2], v[base + 10], v[base + 18], v[base + 26], v[base + 34], v[base + 42]];
  const vs = [v[base + 3], v[base + 11], v[base + 19], v[base + 27], v[base + 35], v[base + 43]];
  const xMin = Math.min(...xs), xMax = Math.max(...xs), yMin = Math.min(...ys), yMax = Math.max(...ys);
  if (xMax < 0 || xMin > sketch.width || yMax < 30 || yMin > 280) continue;
  const uMin = Math.min(...us), uMax = Math.max(...us), vMin = Math.min(...vs), vMax = Math.max(...vs);
  const match = entries.find((e)=> Math.abs(e.u0 - uMin) < 1e-6 && Math.abs(e.u1 - uMax) < 1e-6 && Math.abs(e.v0 - vMin) < 1e-6 && Math.abs(e.v1 - vMax) < 1e-6);
  console.log('visibleTopQuad', {q, xMin,xMax,yMin,yMax,uMin,uMax,vMin,vMax, match: match ? {x:match.x,y:match.y,w:match.width,h:match.height,top:match.top,left:match.left,key:match.key.toString(16)} : null});
  count++;
  if (count >= 30) break;
}

console.log('stats', p.textStats());
p.endFrame();
p.dispose();
device.destroy();
