import { requestWebGpuDevice } from "../libraryIntegrationTetsts/raw-webgpu-helpers.ts";
import { P5GPU } from "../tools/p5gpu.ts";

const device = await requestWebGpuDevice();
const p = new P5GPU(device, { width: 400, height: 200 });
p.beginFrame();
p.textFont("Inter Variable");
p.textSize(40);
const maybeTextWeight = (p as unknown as { textWeight?: (weight: number) => unknown }).textWeight;
if (typeof maybeTextWeight === "function") maybeTextWeight.call(p, 400);
const rows: unknown[] = [];
for (const v of [p.TOP, p.BASELINE, p.BOTTOM, p.CENTER]) {
  p.textAlign(p.LEFT, v);
  rows.push({
    align: String(v),
    textWidthM: p.textWidth("M"),
    textAscentMg: p.textAscent("Mg"),
    textDescentg: p.textDescent("g"),
    fontAscent: p.fontAscent(),
    fontDescent: p.fontDescent(),
  });
}
console.log(JSON.stringify(rows, null, 2));
p.dispose();
device.destroy();
