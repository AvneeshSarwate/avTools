/// <reference lib="dom" />

// Run from apps/deno-notebooks:
// deno run --unstable-webgpu --allow-all libraryIntegrationTetsts/pixi_ui_test.ts

import { setupPixiDeno, runPixiRenderLoop, cleanupPixiDeno } from "./pixi_deno_shim.ts";

const WIDTH = 900;
const HEIGHT = 700;

const ctx = await setupPixiDeno({
  width: WIDTH,
  height: HEIGHT,
  title: "Pixi.js UI Test",
  backgroundColor: 0x16213e,
  enableLayout: true,
  enableUI: true,
});

const { PIXI, layoutComponents, ui } = ctx;
const { LayoutContainer } = layoutComponents!;
const { FancyButton, CheckBox, Slider, ProgressBar } = ui!;

// NOTE: We use only Graphics (no PIXI.Text) because Deno's WebGPU doesn't support
// copyExternalImageToTexture needed for canvas-based text rendering.

// ─── Helpers ─────────────────────────────────────────────────────────────

function makeRoundedRect(w: number, h: number, color: number, radius = 8, alpha = 1): InstanceType<typeof PIXI.Graphics> {
  const g = new PIXI.Graphics();
  g.roundRect(0, 0, w, h, radius);
  g.fill({ color, alpha });
  return g;
}

// Simple icon shapes instead of text labels
function makeIconCircle(radius: number, color: number): InstanceType<typeof PIXI.Graphics> {
  const g = new PIXI.Graphics();
  g.circle(0, 0, radius);
  g.fill(color);
  return g;
}

function makeIconStar(size: number, color: number): InstanceType<typeof PIXI.Graphics> {
  const g = new PIXI.Graphics();
  const points = 5;
  const outerR = size;
  const innerR = size * 0.4;
  g.moveTo(0, -outerR);
  for (let i = 0; i < points; i++) {
    const outerAngle = (i * 2 * Math.PI / points) - Math.PI / 2;
    const innerAngle = outerAngle + Math.PI / points;
    g.lineTo(Math.cos(outerAngle) * outerR, Math.sin(outerAngle) * outerR);
    g.lineTo(Math.cos(innerAngle) * innerR, Math.sin(innerAngle) * innerR);
  }
  g.closePath();
  g.fill(color);
  return g;
}

function makeCheckmark(size: number, color: number): InstanceType<typeof PIXI.Graphics> {
  const g = new PIXI.Graphics();
  g.moveTo(size * 0.2, size * 0.5);
  g.lineTo(size * 0.4, size * 0.75);
  g.lineTo(size * 0.8, size * 0.25);
  g.stroke({ color, width: 3 });
  return g;
}

// ─── Build UI scene ──────────────────────────────────────────────────────

const stage = new PIXI.Container();

// deno-lint-ignore no-explicit-any
(stage as any).layout = {
  width: WIDTH,
  height: HEIGHT,
  flexDirection: "column",
  padding: 20,
  gap: 16,
};

// ── Title bar ────────────────────────────────────────────────────────────

const titleBar = new LayoutContainer({
  layout: {
    width: "100%",
    height: 50,
    backgroundColor: 0x0f3460,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 0x533483,
    justifyContent: "center",
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    // deno-lint-ignore no-explicit-any
  } as any,
});

// Title dots instead of text
const titleDots = [0xe94560, 0xfeca57, 0x48dbfb, 0x55efc4, 0xff6b6b];
for (const c of titleDots) {
  const dot = makeIconCircle(8, c);
  // deno-lint-ignore no-explicit-any
  (dot as any).layout = { width: 16, height: 16 };
  titleBar.addChild(dot);
}
stage.addChild(titleBar);

// ── Main content ─────────────────────────────────────────────────────────

const mainRow = new LayoutContainer({
  layout: {
    width: "100%",
    flex: 1,
    flexDirection: "row",
    gap: 16,
    // deno-lint-ignore no-explicit-any
  } as any,
});
stage.addChild(mainRow);

// ── Left column: Fancy Buttons ───────────────────────────────────────────

const leftCol = new LayoutContainer({
  layout: {
    width: 260,
    height: "100%",
    backgroundColor: 0x1a1a40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 0x533483,
    flexDirection: "column",
    padding: 16,
    gap: 10,
    // deno-lint-ignore no-explicit-any
  } as any,
});

// Section indicator
const btnIndicator = makeRoundedRect(220, 4, 0xe94560, 2);
// deno-lint-ignore no-explicit-any
(btnIndicator as any).layout = { width: "100%", height: 4 };
leftCol.addChild(btnIndicator);

// FancyButtons with different visual states
const buttonConfigs = [
  { name: "Action", color: 0xe94560, hover: 0xff6b81, icon: 0xffffff },
  { name: "Success", color: 0x00b894, hover: 0x55efc4, icon: 0xffffff },
  { name: "Info", color: 0x0984e3, hover: 0x74b9ff, icon: 0xffffff },
  { name: "Warning", color: 0xfdcb6e, hover: 0xffeaa7, icon: 0x2d3436 },
  { name: "Danger", color: 0xd63031, hover: 0xff7675, icon: 0xffffff },
];

for (const cfg of buttonConfigs) {
  // Create button with different states - use Container to hold bg + icon
  const defaultView = new PIXI.Container();
  const defaultBg = makeRoundedRect(220, 42, cfg.color, 8);
  const icon = makeIconStar(10, cfg.icon);
  icon.position.set(110, 21);
  defaultView.addChild(defaultBg);
  defaultView.addChild(icon);

  const hoverBg = makeRoundedRect(220, 42, cfg.hover, 8);
  const pressedBg = makeRoundedRect(220, 42, cfg.color, 8, 0.6);

  const btn = new FancyButton({
    defaultView,
    hoverView: hoverBg,
    pressedView: pressedBg,
    anchor: 0,
  });

  btn.onPress.connect(() => {
    console.log(`[Button] "${cfg.name}" PRESSED!`);
  });
  btn.onHover.connect(() => {
    console.log(`[Button] "${cfg.name}" hover`);
  });
  btn.onOut.connect(() => {
    console.log(`[Button] "${cfg.name}" out`);
  });

  // deno-lint-ignore no-explicit-any
  (btn as any).layout = { width: "100%", height: 42 };
  leftCol.addChild(btn);
}

// ── Checkboxes ───────────────────────────────────────────────────────────

const cbIndicator = makeRoundedRect(220, 4, 0x6c5ce7, 2);
// deno-lint-ignore no-explicit-any
(cbIndicator as any).layout = { width: "100%", height: 4, marginTop: 8 };
leftCol.addChild(cbIndicator);

const checkboxColors = [0x6c5ce7, 0x00b894, 0xfd79a8];
for (let i = 0; i < 3; i++) {
  const color = checkboxColors[i];

  // Unchecked: empty rounded box
  const unchecked = new PIXI.Graphics();
  unchecked.roundRect(0, 0, 28, 28, 6);
  unchecked.stroke({ color: 0x636e72, width: 2 });
  unchecked.fill({ color: 0x2d3436, alpha: 0.5 });

  // Checked: filled box with checkmark
  const checked = new PIXI.Graphics();
  checked.roundRect(0, 0, 28, 28, 6);
  checked.fill(color);
  checked.stroke({ color: 0xffffff, width: 2 });
  // Checkmark
  checked.moveTo(6, 14);
  checked.lineTo(12, 20);
  checked.lineTo(22, 8);
  checked.stroke({ color: 0xffffff, width: 3 });

  const cb = new CheckBox({
    style: { unchecked, checked },
    checked: false,
  });

  cb.onCheck.connect((isChecked: boolean) => {
    console.log(`[Checkbox ${i + 1}] = ${isChecked}`);
  });

  // deno-lint-ignore no-explicit-any
  (cb as any).layout = { width: 28, height: 28 };
  leftCol.addChild(cb);
}

mainRow.addChild(leftCol);

// ── Middle column: Sliders & Progress ────────────────────────────────────

const midCol = new LayoutContainer({
  layout: {
    flex: 1,
    height: "100%",
    backgroundColor: 0x1a1a40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 0x533483,
    flexDirection: "column",
    padding: 16,
    gap: 14,
    // deno-lint-ignore no-explicit-any
  } as any,
});

// Slider indicator
const sliderIndicator = makeRoundedRect(300, 4, 0x0984e3, 2);
// deno-lint-ignore no-explicit-any
(sliderIndicator as any).layout = { width: "100%", height: 4 };
midCol.addChild(sliderIndicator);

// Create sliders
const sliderConfigs = [
  { name: "Red", color: 0xe94560, value: 50 },
  { name: "Green", color: 0x00b894, value: 75 },
  { name: "Blue", color: 0x0984e3, value: 30 },
  { name: "Alpha", color: 0xfdcb6e, value: 100 },
];

const sliders: InstanceType<typeof Slider>[] = [];

for (const cfg of sliderConfigs) {
  // Color indicator dot
  const dot = makeIconCircle(6, cfg.color);
  // deno-lint-ignore no-explicit-any
  (dot as any).layout = { width: 12, height: 12 };
  midCol.addChild(dot);

  const sliderBg = makeRoundedRect(300, 14, 0x2d3436, 7);
  const sliderFill = makeRoundedRect(300, 14, cfg.color, 7);
  const sliderHandle = new PIXI.Graphics();
  sliderHandle.circle(0, 0, 12);
  sliderHandle.fill(0xffffff);
  sliderHandle.stroke({ color: cfg.color, width: 3 });

  const slider = new Slider({
    bg: sliderBg,
    fill: sliderFill,
    slider: sliderHandle,
    min: 0,
    max: 100,
    value: cfg.value,
  });

  slider.onUpdate.connect((value: number) => {
    // Update the color preview in real-time
    void value; // just to avoid lint
  });
  slider.onChange.connect((value: number) => {
    console.log(`[Slider] "${cfg.name}" = ${Math.round(value)}`);
  });

  // deno-lint-invoke no-explicit-any
  // deno-lint-ignore no-explicit-any
  (slider as any).layout = { width: "100%", height: 26 };
  midCol.addChild(slider);
  sliders.push(slider);
}

// Progress bars
const progIndicator = makeRoundedRect(300, 4, 0x00b894, 2);
// deno-lint-ignore no-explicit-any
(progIndicator as any).layout = { width: "100%", height: 4, marginTop: 12 };
midCol.addChild(progIndicator);

const progressBars: InstanceType<typeof ProgressBar>[] = [];
const progColors = [0xe94560, 0x00b894, 0xfdcb6e, 0x6c5ce7, 0x0984e3];

for (let i = 0; i < progColors.length; i++) {
  const bg = makeRoundedRect(300, 18, 0x2d3436, 9);
  const fill = makeRoundedRect(300, 18, progColors[i], 9);

  const prog = new ProgressBar({
    bg,
    fill,
    progress: (i + 1) * 15,
  });

  // deno-lint-ignore no-explicit-any
  (prog as any).layout = { width: "100%", height: 18 };
  midCol.addChild(prog);
  progressBars.push(prog);
}

mainRow.addChild(midCol);

// ── Right column: Color preview driven by sliders ────────────────────────

const rightCol = new LayoutContainer({
  layout: {
    width: 220,
    height: "100%",
    backgroundColor: 0x1a1a40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 0x533483,
    flexDirection: "column",
    padding: 16,
    gap: 12,
    alignItems: "center",
    // deno-lint-ignore no-explicit-any
  } as any,
});

// Color preview box that reacts to sliders
const colorPreview = new PIXI.Graphics();
colorPreview.roundRect(0, 0, 180, 120, 12);
colorPreview.fill(0x808080);
colorPreview.stroke({ color: 0xffffff, width: 2 });
// deno-lint-ignore no-explicit-any
(colorPreview as any).layout = { width: 180, height: 120 };
rightCol.addChild(colorPreview);

// Grid of interactive colored squares
const gridContainer = new LayoutContainer({
  layout: {
    width: "100%",
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "center",
    alignContent: "flex-start",
    // deno-lint-ignore no-explicit-any
  } as any,
});

const gridColors = [
  0xff6b6b, 0xee5a24, 0xfeca57, 0x55efc4,
  0x48dbfb, 0x6c5ce7, 0xfd79a8, 0x636e72,
  0x00b894, 0x0984e3, 0xe17055, 0xdfe6e9,
];

for (let i = 0; i < gridColors.length; i++) {
  const square = new PIXI.Graphics();
  square.roundRect(0, 0, 50, 50, 8);
  square.fill(gridColors[i]);
  square.stroke({ color: 0xffffff, width: 1, alpha: 0.3 });

  // Make interactive
  square.eventMode = "static";
  square.cursor = "pointer";
  square.on("pointertap", () => {
    console.log(`[Grid] Color square ${i} clicked: #${gridColors[i].toString(16).padStart(6, "0")}`);
  });
  square.on("pointerover", () => {
    square.alpha = 0.7;
  });
  square.on("pointerout", () => {
    square.alpha = 1.0;
  });

  // deno-lint-ignore no-explicit-any
  (square as any).layout = { width: 50, height: 50 };
  gridContainer.addChild(square);
}

rightCol.addChild(gridContainer);
mainRow.addChild(rightCol);

// ── Status bar ───────────────────────────────────────────────────────────

const statusBar = new LayoutContainer({
  layout: {
    width: "100%",
    height: 36,
    backgroundColor: 0x0f3460,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 0x533483,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingLeft: 16,
    paddingRight: 16,
    // deno-lint-ignore no-explicit-any
  } as any,
});

// Status dots instead of text
for (let i = 0; i < 8; i++) {
  const dot = makeIconCircle(3, 0x636e72);
  // deno-lint-ignore no-explicit-any
  (dot as any).layout = { width: 6, height: 6 };
  statusBar.addChild(dot);
}
stage.addChild(statusBar);

console.log("UI scene built!");

// ─── Render loop ─────────────────────────────────────────────────────────

await runPixiRenderLoop(ctx, stage, {
  autoClose: false,
  maxFrames: Infinity,
  onFrame: (frame) => {
    const t = frame * 0.015;

    // Animate progress bars
    for (let i = 0; i < progressBars.length; i++) {
      progressBars[i].progress = 50 + Math.sin(t + i * 1.2) * 45;
    }

    // Update color preview based on slider values
    if (frame % 3 === 0) {
      const r = Math.round((sliders[0].value / 100) * 255);
      const gv = Math.round((sliders[1].value / 100) * 255);
      const b = Math.round((sliders[2].value / 100) * 255);
      const previewColor = (r << 16) | (gv << 8) | b;
      const alpha = sliders[3].value / 100;

      colorPreview.clear();
      colorPreview.roundRect(0, 0, 180, 120, 12);
      colorPreview.fill({ color: previewColor, alpha });
      colorPreview.stroke({ color: 0xffffff, width: 2 });
    }
  },
});

cleanupPixiDeno(ctx);
Deno.exit(0);
