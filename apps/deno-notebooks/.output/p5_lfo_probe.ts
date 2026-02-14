import { P5GPU } from "../tools/p5gpu.ts";
import { requestWebGpuDevice, writeTextureToPng } from "../libraryIntegrationTetsts/raw-webgpu-helpers.ts";
import { P5_TEST_SKETCHES } from "../libraryIntegrationTetsts/p5_test_sketches.ts";

const sketch = P5_TEST_SKETCHES.find((s) => s.name === "text-lfo-perf-frame0");
if (!sketch) throw new Error("missing sketch");

const device = await requestWebGpuDevice();
const p = new P5GPU(device, { width: sketch.width, height: sketch.height });
const atlas = (p as unknown as { _textAtlas: { size: number; version: number } | null })._textAtlas;
console.log("atlas before", atlas?.size, atlas?.version);

p.beginFrame();
sketch.draw(p as never);
console.log("stats after draw", p.textStats());
console.log("atlas after draw", atlas?.size, atlas?.version);

const v = (p as unknown as { _textVertices: number[] })._textVertices;
console.log("text vertices", v.length / 8);

const texture = p.endFrame();
await writeTextureToPng(device, texture, sketch.width, sketch.height, p.format, ".output/p5gpu/text-lfo-probe.png");
console.log("stats after endFrame", p.textStats());

p.dispose();
device.destroy();
