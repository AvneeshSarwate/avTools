import { requestWebGpuDevice } from "../libraryIntegrationTetsts/raw-webgpu-helpers.ts";
import { P5GPU } from "../tools/p5gpu.ts";

const device = await requestWebGpuDevice();
const p = new P5GPU(device, { width: 1280, height: 720 });

const fonts = [
  "NotoSans-Regular.ttf",
  "Inter-Regular.ttf",
  "Inter-Bold.ttf",
  "InterVariable.ttf",
  "InterVariable-Italic.ttf",
  "RobotoFlex-Variable.ttf",
];
for (const file of fonts) {
  try {
    await p.loadFont(new URL(`../assets/fonts/${file}`, import.meta.url));
  } catch (err) {
    console.error("load failed", file, err);
  }
}

const maybeTextWeight = (p as unknown as { textWeight?: (weight: number) => unknown }).textWeight;
const supportsTextWeight = typeof maybeTextWeight === "function";

const families = ["Inter Variable", "Inter", "Roboto Flex", "Noto Sans"];

for (const family of families) {
  p.background(14, 18, 28);
  p.textFont(family);
  p.textStyle(p.NORMAL);
  p.textSize(40);
  if (supportsTextWeight) maybeTextWeight.call(p, 400);

  p.textAlign(p.LEFT, p.TOP);
  const top = { a: p.textAscent("Mg"), d: p.textDescent("g"), fa: p.fontAscent(), fd: p.fontDescent() };
  p.textAlign(p.LEFT, p.BASELINE);
  const base = { a: p.textAscent("Mg"), d: p.textDescent("g"), fa: p.fontAscent(), fd: p.fontDescent() };
  p.textAlign(p.LEFT, p.BOTTOM);
  const bottom = { a: p.textAscent("Mg"), d: p.textDescent("g"), fa: p.fontAscent(), fd: p.fontDescent() };
  p.textAlign(p.LEFT, p.TOP);

  const rawM = (p as unknown as { _layoutText: (...args: unknown[]) => Record<string, number> })._layoutText("M", null, null);
  const rawMg = (p as unknown as { _layoutText: (...args: unknown[]) => Record<string, number> })._layoutText("Mg", null, null);

  console.log(JSON.stringify({
    family,
    textWidthM: p.textWidth("M"),
    fontWidthM: p.fontWidth("M"),
    textWidthSpace: p.textWidth(" "),
    textLeading: p.textLeading(),
    top,
    baseline: base,
    bottom,
    rawM: {
      width: rawM.fontWidth,
      tight: rawM.tightWidth,
      a: rawM.ascent,
      d: rawM.descent,
      fbA: rawM.fontAscent,
      fbD: rawM.fontDescent,
      cap: rawM.fontCapHeight,
    },
    rawMg: {
      width: rawMg.fontWidth,
      tight: rawMg.tightWidth,
      a: rawMg.ascent,
      d: rawMg.descent,
      fbA: rawMg.fontAscent,
      fbD: rawMg.fontDescent,
      cap: rawMg.fontCapHeight,
    },
  }));
}

p.dispose();
device.destroy();
