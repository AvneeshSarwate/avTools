/// <reference lib="dom" />

// Run from apps/deno-notebooks:
// deno run --unstable-webgpu --unstable-ffi --allow-ffi --allow-read --allow-env --allow-net --allow-write \
//   examples/p5_text_metrics_nan_debug.ts

import { cleanupP5Deno, runP5RenderLoop, setupP5Deno } from "../tools/p5_deno_shim.ts";

const WIDTH = 1200;
const HEIGHT = 780;
const FRAMES = Number(Deno.env.get("P5_METRICS_DEBUG_FRAMES") ?? 360);
const LOG_EVERY = Number(Deno.env.get("P5_METRICS_DEBUG_LOG_EVERY") ?? 30);
const STRESS_ITERS = Math.max(0, Number(Deno.env.get("P5_METRICS_STRESS_ITERS") ?? 64));
const REPORT_JSON = Deno.env.get("P5_METRICS_REPORT_JSON") === "1";

type ProbeSnapshot = {
  frame: number;
  family: string;
  style: "normal" | "italic";
  size: number;
  weight: number;
  text: string;
  p5TextAscent: number;
  p5TextDescent: number;
  p5TextWidth: number;
  p5FontWidth: number;
  p5TextAscentNoArg: number;
  p5TextDescentNoArg: number;
  stressBad: number;
  ctxFont: string;
  ctxWidth: number;
  ctxAscent: number;
  ctxDescent: number;
  ctxFontBBoxAscent: number;
  ctxFontBBoxDescent: number;
};

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function hasNonFiniteProbe(snapshot: ProbeSnapshot): boolean {
  return !(
    isFiniteNumber(snapshot.p5TextAscent) &&
    isFiniteNumber(snapshot.p5TextDescent) &&
    isFiniteNumber(snapshot.p5TextWidth) &&
    isFiniteNumber(snapshot.p5FontWidth) &&
    isFiniteNumber(snapshot.p5TextAscentNoArg) &&
    isFiniteNumber(snapshot.p5TextDescentNoArg) &&
    isFiniteNumber(snapshot.ctxWidth) &&
    isFiniteNumber(snapshot.ctxAscent) &&
    isFiniteNumber(snapshot.ctxDescent) &&
    isFiniteNumber(snapshot.ctxFontBBoxAscent) &&
    isFiniteNumber(snapshot.ctxFontBBoxDescent) &&
    snapshot.stressBad === 0
  );
}

// deno-lint-ignore no-explicit-any
const ctx = await setupP5Deno((p: any) => {
  const families = ["monospace", "Noto Sans", "Inter", "Inter Variable", "Roboto Flex"];
  const weights = [300, 400, 450, 600, 750, 900];
  const sizes = [16, 24, 36, 52];
  const texts = ["M", "Mg", "tight width", "0123456789", "Lorem"];
  const styles = ["normal", "italic"] as const;

  let supportsTextWeight = false;
  let probes = 0;
  let nonFiniteCount = 0;
  let firstBad: ProbeSnapshot | null = null;
  let recentBad: ProbeSnapshot | null = null;
  let recentGood: ProbeSnapshot | null = null;

  const drawProbe = (snapshot: ProbeSnapshot): void => {
    p.background(20, 24, 34);
    p.fill(236);
    p.noStroke();
    p.textAlign(p.LEFT, p.TOP);
    p.textFont("Noto Sans");
    p.textStyle(p.NORMAL);
    p.textSize(18);

    const lines = [
      "p5 text metrics NaN debug",
      `frame=${snapshot.frame} probes=${probes} bad=${nonFiniteCount}`,
      `family=${snapshot.family} style=${snapshot.style} size=${snapshot.size} weight=${snapshot.weight}`,
      `ctx.font=${snapshot.ctxFont}`,
      `text='${snapshot.text}'`,
      `p5Ascent=${snapshot.p5TextAscent} p5Descent=${snapshot.p5TextDescent} p5Width=${snapshot.p5TextWidth} p5FontWidth=${snapshot.p5FontWidth}`,
      `p5Ascent()=${snapshot.p5TextAscentNoArg} p5Descent()=${snapshot.p5TextDescentNoArg} stressBad=${snapshot.stressBad}`,
      `ctxWidth=${snapshot.ctxWidth} ctxAsc=${snapshot.ctxAscent} ctxDesc=${snapshot.ctxDescent}`,
      `ctxFontBBoxAsc=${snapshot.ctxFontBBoxAscent} ctxFontBBoxDesc=${snapshot.ctxFontBBoxDescent}`,
      `supportsTextWeight=${supportsTextWeight ? "yes" : "no"}`,
    ];
    for (let i = 0; i < lines.length; i++) {
      p.text(lines[i], 24, 24 + i * 26);
    }
  };

  p.setup = () => {
    p.createCanvas(WIDTH, HEIGHT);
    p.pixelDensity(1);
    p.textAlign(p.LEFT, p.TOP);
    p.noStroke();
    supportsTextWeight = typeof p.textWeight === "function";

    console.log(
      `[metrics-debug] start frames=${FRAMES} logEvery=${LOG_EVERY} textWeight=${supportsTextWeight ? "yes" : "no"}`,
    );
  };

  p.draw = () => {
    const i = p.frameCount - 1;
    const family = families[i % families.length];
    const weight = weights[Math.floor(i / families.length) % weights.length];
    const size = sizes[Math.floor(i / (families.length * weights.length)) % sizes.length];
    const text = texts[Math.floor(i / (families.length * weights.length * sizes.length)) % texts.length];
    const style = styles[Math.floor(i / (families.length * weights.length * sizes.length * texts.length)) % styles.length];

    p.textFont(family);
    p.textSize(size);
    p.textStyle(style === "italic" ? p.ITALIC : p.NORMAL);
    if (supportsTextWeight) p.textWeight(weight);

    const p5TextAscent = Number(p.textAscent(text));
    const p5TextDescent = Number(p.textDescent(text));
    const p5TextWidth = Number(p.textWidth(text));
    const p5FontWidth = Number(typeof p.fontWidth === "function" ? p.fontWidth(text) : NaN);
    const p5TextAscentNoArg = Number(p.textAscent());
    const p5TextDescentNoArg = Number(p.textDescent());

    let stressBad = 0;
    for (let j = 0; j < STRESS_ITERS; j++) {
      const waveW = Math.round(300 + (0.5 + 0.5 * Math.sin((p.frameCount * 0.15) + j * 0.33)) * 600);
      if (supportsTextWeight) p.textWeight(waveW);
      const wa = Number(p.textAscent("M"));
      const wd = Number(p.textDescent("g"));
      const wt = Number(p.textWidth("M"));
      const wf = Number(typeof p.fontWidth === "function" ? p.fontWidth("M") : NaN);
      if (!Number.isFinite(wa) || !Number.isFinite(wd) || !Number.isFinite(wt) || !Number.isFinite(wf)) {
        stressBad += 1;
      }
    }
    if (supportsTextWeight) p.textWeight(weight);

    const dc = p.drawingContext as CanvasRenderingContext2D;
    const m = dc.measureText(text);
    const snapshot: ProbeSnapshot = {
      frame: p.frameCount,
      family,
      style,
      size,
      weight,
      text,
      p5TextAscent,
      p5TextDescent,
      p5TextWidth,
      p5FontWidth,
      p5TextAscentNoArg,
      p5TextDescentNoArg,
      stressBad,
      ctxFont: String(dc.font),
      ctxWidth: Number(m.width),
      ctxAscent: Number((m as TextMetrics).actualBoundingBoxAscent),
      ctxDescent: Number((m as TextMetrics).actualBoundingBoxDescent),
      ctxFontBBoxAscent: Number((m as TextMetrics).fontBoundingBoxAscent),
      ctxFontBBoxDescent: Number((m as TextMetrics).fontBoundingBoxDescent),
    };

    probes += 1;
    recentGood = snapshot;
    if (hasNonFiniteProbe(snapshot)) {
      nonFiniteCount += 1;
      recentBad = snapshot;
      if (!firstBad) firstBad = snapshot;
      console.log(`[metrics-debug][BAD] ${JSON.stringify(snapshot)}`);
    } else if (p.frameCount % LOG_EVERY === 0) {
      console.log(
        `[metrics-debug] frame=${p.frameCount} probes=${probes} bad=${nonFiniteCount} family='${family}' size=${size} weight=${weight} width=${snapshot.p5TextWidth.toFixed(2)} fontWidth=${snapshot.p5FontWidth.toFixed(2)} ascent=${snapshot.p5TextAscent.toFixed(2)} descent=${snapshot.p5TextDescent.toFixed(2)} stressBad=${snapshot.stressBad}`,
      );
    }

    drawProbe(recentBad ?? snapshot);

    if (p.frameCount >= FRAMES) {
      console.log(`[metrics-debug] done probes=${probes} bad=${nonFiniteCount}`);
      if (firstBad) {
        console.log(`[metrics-debug] firstBad=${JSON.stringify(firstBad)}`);
      } else if (recentGood) {
        console.log(`[metrics-debug] finalGood=${JSON.stringify(recentGood)}`);
      }
      if (REPORT_JSON) {
        const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
        const outDir = new URL("../.output/browser_analysis/", import.meta.url);
        Deno.mkdirSync(outDir, { recursive: true });
        const outPath = new URL(`run_${stamp}_metrics_nan_debug.json`, outDir);
        const payload = {
          frames: FRAMES,
          probes,
          nonFiniteCount,
          firstBad,
          finalGood: recentGood,
          stressIters: STRESS_ITERS,
        };
        Deno.writeTextFileSync(outPath, JSON.stringify(payload, null, 2));
        console.log(`[metrics-debug] wrote report ${outPath.pathname}`);
      }
      p.noLoop();
    }
  };
}, {
  width: WIDTH,
  height: HEIGHT,
  title: "p5 text metrics NaN debug",
});

try {
  await runP5RenderLoop(ctx, { autoClose: true, maxFrames: FRAMES + 10 });
} finally {
  cleanupP5Deno(ctx);
}
