/// <reference lib="dom" />

// Run from apps/deno-notebooks:
// deno run --unstable-webgpu --allow-all libraryIntegrationTetsts/pixi_layout_test.ts

import { setupPixiDeno, runPixiRenderLoop, cleanupPixiDeno } from "./pixi_deno_shim.ts";

const WIDTH = 800;
const HEIGHT = 600;

// Import @pixi/layout BEFORE setupPixiDeno so the LayoutSystem extension
// gets registered before renderer.init() (which is where Yoga WASM loads)
console.log("Pre-importing @pixi/layout...");
await import("npm:@pixi/layout@^3");
const { LayoutContainer } = await import("npm:@pixi/layout@^3/components");
console.log("Layout library loaded!");

const ctx = await setupPixiDeno({
  width: WIDTH,
  height: HEIGHT,
  title: "Pixi.js Layout Test",
  backgroundColor: 0x1a1a2e,
});

const { PIXI } = ctx;

// ─── Build layout scene ──────────────────────────────────────────────────

const stage = new PIXI.Container();

// Root layout — fills the screen, column direction
// deno-lint-ignore no-explicit-any
(stage as any).layout = {
  width: WIDTH,
  height: HEIGHT,
  flexDirection: "column",
  padding: 16,
  gap: 12,
};

// ── Header bar ───────────────────────────────────────────────────────────

const header = new LayoutContainer({
  layout: {
    width: "100%",
    height: 60,
    backgroundColor: 0x2d3436,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 0x636e72,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingLeft: 20,
    paddingRight: 20,
  },
});

// Header items — three colored indicators
const headerColors = [0xff6b6b, 0xfeca57, 0x48dbfb];
for (const color of headerColors) {
  const dot = new PIXI.Graphics();
  dot.circle(0, 0, 8);
  dot.fill(color);
  // deno-lint-ignore no-explicit-any
  (dot as any).layout = { width: 16, height: 16 };
  header.addChild(dot);
}

stage.addChild(header);

// ── Main content: sidebar + content area ─────────────────────────────────

const mainRow = new LayoutContainer({
  layout: {
    width: "100%",
    flex: 1,
    flexDirection: "row",
    gap: 12,
  },
});
stage.addChild(mainRow);

// Sidebar
const sidebar = new LayoutContainer({
  layout: {
    width: 180,
    height: "100%",
    backgroundColor: 0x2d3436,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 0x636e72,
    flexDirection: "column",
    padding: 12,
    gap: 8,
  },
});

// Sidebar items
const sidebarColors = [0x6c5ce7, 0x00b894, 0xfd79a8, 0xe17055, 0x0984e3];
for (let i = 0; i < sidebarColors.length; i++) {
  const item = new LayoutContainer({
    layout: {
      width: "100%",
      height: 36,
      backgroundColor: sidebarColors[i],
      borderRadius: 6,
      // deno-lint-ignore no-explicit-any
    } as any,
  });
  sidebar.addChild(item);
}
mainRow.addChild(sidebar);

// Content area
const content = new LayoutContainer({
  layout: {
    flex: 1,
    height: "100%",
    backgroundColor: 0x2d3436,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 0x636e72,
    padding: 16,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    alignContent: "flex-start",
  },
});

// Content cards — a grid of colored boxes
const cardColors = [0xe74c3c, 0x3498db, 0x2ecc71, 0xf39c12, 0x9b59b6, 0x1abc9c, 0xe67e22, 0x2980b9, 0x27ae60];
for (let i = 0; i < cardColors.length; i++) {
  const card = new LayoutContainer({
    layout: {
      width: 140,
      height: 100,
      backgroundColor: cardColors[i],
      borderRadius: 10,
      borderWidth: 2,
      borderColor: 0xffffff,
      justifyContent: "center",
      alignItems: "center",
      // deno-lint-ignore no-explicit-any
    } as any,
  });

  // Add a small circle inside each card
  const innerCircle = new PIXI.Graphics();
  innerCircle.circle(0, 0, 15);
  innerCircle.fill({ color: 0xffffff, alpha: 0.3 });
  // deno-lint-ignore no-explicit-any
  (innerCircle as any).layout = { width: 30, height: 30 };
  card.addChild(innerCircle);

  content.addChild(card);
}
mainRow.addChild(content);

// ── Footer ───────────────────────────────────────────────────────────────

const footer = new LayoutContainer({
  layout: {
    width: "100%",
    height: 40,
    backgroundColor: 0x2d3436,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 0x636e72,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
});

// Footer dots
for (let i = 0; i < 5; i++) {
  const dot = new PIXI.Graphics();
  dot.circle(0, 0, 4);
  dot.fill(0x636e72);
  // deno-lint-ignore no-explicit-any
  (dot as any).layout = { width: 8, height: 8 };
  footer.addChild(dot);
}
stage.addChild(footer);

console.log("Layout scene built!");

// ─── Render loop with subtle animation ───────────────────────────────────

await runPixiRenderLoop(ctx, stage, {
  autoClose: true,
  maxFrames: 300,
  onFrame: (frame) => {
    const t = frame * 0.02;
    // Subtle pulsing on the content cards
    for (let i = 0; i < cardColors.length; i++) {
      const card = content.children[i];
      if (card) {
        const scale = 1.0 + Math.sin(t + i * 0.5) * 0.03;
        card.scale.set(scale, scale);
      }
    }
  },
});

cleanupPixiDeno(ctx);
Deno.exit(0);
