import { requestWebGpuDevice } from "../libraryIntegrationTetsts/raw-webgpu-helpers.ts";
import { P5GPU } from "../tools/p5gpu.ts";

const device = await requestWebGpuDevice();
const p = new P5GPU(device, { width: 1280, height: 720 });

const maybeTextWeight = (p as unknown as { textWeight?: (weight: number) => unknown }).textWeight;
const supportsTextWeight = typeof maybeTextWeight === "function";

p.background(14, 18, 28);
p.textFont("Inter Variable");
p.textStyle(p.NORMAL);
p.textSize(48);
p.textLeading(51);
if (supportsTextWeight) maybeTextWeight.call(p, 300);

const capture = () => ({
  textAscentMg: p.textAscent("Mg"),
  textDescentG: p.textDescent("g"),
  fontAscent: p.fontAscent(),
  fontDescent: p.fontDescent(),
});

p.textAlign(p.LEFT, p.TOP);
const top = capture();

p.textAlign(p.LEFT, p.BASELINE);
const baseline = capture();

p.textAlign(p.LEFT, p.BOTTOM);
const bottom = capture();

p.textAlign(p.LEFT, p.TOP);
const textWidthM = p.textWidth("M");
const fontWidthM = p.fontWidth("M");
const textWidthSpace = p.textWidth(" ");
const textLeading = p.textLeading();

const rawM = (p as unknown as { _layoutText: (...args: unknown[]) => unknown })._layoutText("M", null, null) as Record<string, number>;
const rawMg = (p as unknown as { _layoutText: (...args: unknown[]) => unknown })._layoutText("Mg", null, null) as Record<string, number>;
const rawUnderscore = (p as unknown as { _layoutText: (...args: unknown[]) => unknown })._layoutText("_", null, null) as Record<string, number>;

console.log(
  JSON.stringify(
    {
      textWidthM,
      fontWidthM,
      textWidthSpace,
      textLeading,
      top,
      baseline,
      bottom,
      rawM: {
        width: rawM.fontWidth,
        tight: rawM.tightWidth,
        a: rawM.ascent,
        d: rawM.descent,
        fbA: rawM.fontAscent,
        fbD: rawM.fontDescent,
      },
      rawMg: {
        width: rawMg.fontWidth,
        tight: rawMg.tightWidth,
        a: rawMg.ascent,
        d: rawMg.descent,
        fbA: rawMg.fontAscent,
        fbD: rawMg.fontDescent,
      },
      rawUnderscore: {
        width: rawUnderscore.fontWidth,
        tight: rawUnderscore.tightWidth,
        a: rawUnderscore.ascent,
        d: rawUnderscore.descent,
        fbA: rawUnderscore.fontAscent,
        fbD: rawUnderscore.fontDescent,
      },
    },
    null,
    2,
  ),
);

p.dispose();
device.destroy();
