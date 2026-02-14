import { requestWebGpuDevice } from "../libraryIntegrationTetsts/raw-webgpu-helpers.ts";
import { P5GPU } from "../tools/p5gpu.ts";

const device = await requestWebGpuDevice();
const p = new P5GPU(device, { width: 400, height: 200 });
p.beginFrame();
p.textFont("Inter Variable");
p.textSize(40);
p.textAlign(p.LEFT, p.TOP);
const maybeTextWeight = (p as unknown as { textWeight?: (weight: number) => unknown }).textWeight;
if (typeof maybeTextWeight === "function") {
  maybeTextWeight.call(p, 400);
}
const anyP = p as unknown as {
  _layoutText: (text: string, width: number | null, height: number | null) => Record<string, unknown>;
};
const rawM = anyP._layoutText("M", null, null);
const rawPhrase = anyP._layoutText("The quick brown fox", null, null);
const pick = (raw: Record<string, unknown>) => ({
  tightWidth: raw.tightWidth,
  fontWidth: raw.fontWidth,
  ascent: raw.ascent,
  descent: raw.descent,
  fontAscent: raw.fontAscent,
  fontDescent: raw.fontDescent,
  firstBaseline: raw.firstBaseline,
  totalHeight: raw.totalHeight,
  lineCount: raw.lineCount,
});
const out = {
  textWidthM: p.textWidth("M"),
  fontWidthM: p.fontWidth("M"),
  textAscentMg: p.textAscent("Mg"),
  textDescentg: p.textDescent("g"),
  textWidthPhrase: p.textWidth("The quick brown fox"),
  fontWidthPhrase: p.fontWidth("The quick brown fox"),
  layoutM: pick(rawM),
  layoutPhrase: pick(rawPhrase),
};
console.log(JSON.stringify(out, null, 2));
p.dispose();
device.destroy();
