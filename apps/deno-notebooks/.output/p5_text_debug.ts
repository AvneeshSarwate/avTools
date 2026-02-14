import { NativeTextEngine } from "../tools/p5gpu_text/ffi.ts";
const e = new NativeTextEngine();
for (let i = 0; i < 10; i++) {
  const out = e.layoutText({
    text: "A",
    family: "monospace",
    fontSize: 40,
    lineHeight: 51,
    width: null,
    height: null,
    alignH: 0,
    wrapMode: 2,
    weight: 400,
    style: 0,
    axisQuantization: 1,
    axes: { wght: 400 },
  });
  const g = out.glyphs[0];
  console.log(i, "glyph", g?.x, g?.y, "ascent", out.ascent, "descent", out.descent, "baseline", out.firstBaseline, "totalHeight", out.totalHeight);
}
e.dispose();
