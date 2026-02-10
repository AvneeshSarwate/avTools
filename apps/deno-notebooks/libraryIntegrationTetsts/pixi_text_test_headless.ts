/// <reference lib="dom" />

/**
 * Headless pixi.js text rendering test — renders one frame to PNG for analysis.
 *
 * Run from apps/deno-notebooks:
 *   deno run --unstable-webgpu --unstable-ffi --allow-all libraryIntegrationTetsts/pixi_text_test_headless.ts
 */

import { setupPixiDeno, snapshotPixiFrame, cleanupPixiDeno } from "./pixi_deno_shim.ts";

const WIDTH = 800;
const HEIGHT = 600;

const ctx = await setupPixiDeno({
  width: WIDTH,
  height: HEIGHT,
  title: "Pixi.js Text Headless",
  backgroundColor: 0x1a1a2e,
  enableText: true,
  headless: true,
});

const { PIXI } = ctx;

// ─── Build text scene ────────────────────────────────────────────────────

const stage = new PIXI.Container();

// ── Left column: text styles ─────────────────────────────────────────────

// 1. Large title
const title = new PIXI.Text({
  text: "Pixi.js Text in Deno!",
  style: { fontSize: 42, fill: 0xffffff },
});
title.position.set(30, 20);
stage.addChild(title);

// 2. Subtitle with descenders to test clipping (g, y, p, q, j)
const descenders = new PIXI.Text({
  text: "Typography: gyp qj descenders",
  style: { fontSize: 28, fill: 0xa0a0a0 },
});
descenders.position.set(30, 80);
stage.addChild(descenders);

// 3. Text with stroke
const stroked = new PIXI.Text({
  text: "Stroked Text",
  style: {
    fontSize: 36,
    fill: 0xf9ca24,
    stroke: { color: 0xffffff, width: 6 },
  },
});
stroked.position.set(30, 130);
stage.addChild(stroked);

// 4. Small text
const small = new PIXI.Text({
  text: "Small text for labels and UI",
  style: { fontSize: 14, fill: 0x808080 },
});
small.position.set(30, 185);
stage.addChild(small);

// 5. Text on background
const bg = new PIXI.Graphics();
bg.roundRect(25, 215, 350, 45, 8);
bg.fill({ color: 0x2d3436, alpha: 0.8 });
bg.stroke({ color: 0x636e72, width: 1 });
stage.addChild(bg);

const bgLabel = new PIXI.Text({
  text: "Text with background",
  style: { fontSize: 26, fill: 0x48dbfb },
});
bgLabel.position.set(35, 222);
stage.addChild(bgLabel);

// 6. Bold-style text
const bold = new PIXI.Text({
  text: "WebGPU + Native Canvas",
  style: { fontSize: 30, fill: 0x4ecdc4, fontWeight: "bold" },
});
bold.position.set(30, 280);
stage.addChild(bold);

// ── Right column: color labels ───────────────────────────────────────────

const colorLabelHeader = new PIXI.Text({
  text: "Color test:",
  style: { fontSize: 20, fill: 0xffffff },
});
colorLabelHeader.position.set(500, 20);
stage.addChild(colorLabelHeader);

const colorLabels = [
  { text: "Red",    fill: 0xff0000 },
  { text: "Green",  fill: 0x00ff00 },
  { text: "Blue",   fill: 0x0000ff },
  { text: "Yellow", fill: 0xffff00 },
  { text: "Cyan",   fill: 0x00ffff },
  { text: "White",  fill: 0xffffff },
];
for (let i = 0; i < colorLabels.length; i++) {
  // Colored square
  const swatch = new PIXI.Graphics();
  swatch.rect(0, 0, 18, 18);
  swatch.fill(colorLabels[i].fill);
  swatch.position.set(500, 55 + i * 32);
  stage.addChild(swatch);

  // Label
  const t = new PIXI.Text({
    text: colorLabels[i].text,
    style: { fontSize: 20, fill: colorLabels[i].fill },
  });
  t.position.set(528, 53 + i * 32);
  stage.addChild(t);
}

// ── Bottom: mixed graphics + text ────────────────────────────────────────

// Circle
const circle = new PIXI.Graphics();
circle.circle(0, 0, 25);
circle.fill({ color: 0xff6b6b, alpha: 0.9 });
circle.stroke({ color: 0xffffff, width: 2 });
circle.position.set(60, 380);
stage.addChild(circle);

const circleLabel = new PIXI.Text({
  text: "Circle",
  style: { fontSize: 16, fill: 0xff6b6b },
});
circleLabel.position.set(95, 372);
stage.addChild(circleLabel);

// Rectangle
const rect = new PIXI.Graphics();
rect.roundRect(0, 0, 50, 30, 6);
rect.fill({ color: 0x3498db });
rect.position.set(180, 365);
stage.addChild(rect);

const rectLabel = new PIXI.Text({
  text: "Rectangle",
  style: { fontSize: 16, fill: 0x3498db },
});
rectLabel.position.set(240, 372);
stage.addChild(rectLabel);

// Star (triangle)
const tri = new PIXI.Graphics();
tri.moveTo(0, -20);
tri.lineTo(18, 15);
tri.lineTo(-18, 15);
tri.closePath();
tri.fill({ color: 0x2ecc71 });
tri.position.set(380, 382);
stage.addChild(tri);

const triLabel = new PIXI.Text({
  text: "Triangle",
  style: { fontSize: 16, fill: 0x2ecc71 },
});
triLabel.position.set(410, 372);
stage.addChild(triLabel);

// ── Font size comparison row ─────────────────────────────────────────────

const sizes = [10, 14, 18, 24, 32, 48];
let xPos = 30;
for (const size of sizes) {
  const t = new PIXI.Text({
    text: `${size}px`,
    style: { fontSize: size, fill: 0xdfe6e9 },
  });
  t.position.set(xPos, 440);
  stage.addChild(t);
  xPos += size * 3 + 20;
}

console.log("Text scene built, rendering snapshot...");

// ─── Snapshot ─────────────────────────────────────────────────────────────

const outPath = ".output/pixi-text-snapshot.png";
await snapshotPixiFrame(ctx, stage, outPath);

cleanupPixiDeno(ctx);
console.log("Done!");
Deno.exit(0);
