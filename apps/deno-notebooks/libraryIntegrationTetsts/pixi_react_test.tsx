/** @jsxImportSource react */
/// <reference lib="dom" />

// Run from apps/deno-notebooks:
// deno run --unstable-webgpu --unstable-ffi --allow-all libraryIntegrationTetsts/pixi_react_test.tsx

import { setupPixiDenoForReact, runPixiReactRenderLoop, cleanupPixiDenoReact } from "./pixi_deno_shim.ts";
import React, { useState, useCallback } from "react";
import { Container, Graphics, Text, type Ticker } from "pixi.js";
import { createRoot, extend, useTick } from "@pixi/react";

// Register pixi classes with the react reconciler
extend({ Container, Graphics, Text });

// ─── Components ───────────────────────────────────────────────────────────

function RotatingCircle() {
  const [rotation, setRotation] = useState(0);

  useTick((ticker: Ticker) => {
    setRotation((r) => r + 0.02 * ticker.deltaTime);
  });

  const draw = useCallback((g: Graphics) => {
    g.clear();
    g.circle(0, 0, 50);
    g.fill({ color: 0x4ecdc4, alpha: 0.9 });
    g.stroke({ color: 0xffffff, width: 3 });
    // Add a line to show rotation
    g.moveTo(0, 0);
    g.lineTo(0, -50);
    g.stroke({ color: 0xffffff, width: 2 });
  }, []);

  return (
    <pixiGraphics
      draw={draw}
      x={200}
      y={300}
      rotation={rotation}
    />
  );
}

const COLORS = [0xff6b6b, 0xf9ca24, 0x6c5ce7, 0x00b894, 0xe17055];

function ClickableRect() {
  const [colorIndex, setColorIndex] = useState(0);

  const draw = useCallback((g: Graphics) => {
    g.clear();
    g.roundRect(-60, -30, 120, 60, 10);
    g.fill({ color: COLORS[colorIndex], alpha: 0.95 });
    g.stroke({ color: 0xffffff, width: 2 });
  }, [colorIndex]);

  const handleClick = useCallback(() => {
    const next = (colorIndex + 1) % COLORS.length;
    console.log(`Click! Color index: ${colorIndex} → ${next}`);
    setColorIndex(next);
  }, [colorIndex]);

  return (
    <pixiGraphics
      draw={draw}
      x={500}
      y={300}
      eventMode="static"
      cursor="pointer"
      onClick={handleClick}
    />
  );
}

function App() {
  return (
    <pixiContainer>
      <pixiText
        text="pixi-react in Deno!"
        x={30}
        y={30}
        style={{ fontSize: 36, fill: 0xffffff }}
      />
      <pixiText
        text="Rotating circle (useTick)"
        x={120}
        y={200}
        style={{ fontSize: 18, fill: 0xa0a0a0 }}
      />
      <RotatingCircle />
      <pixiText
        text="Click me! (onClick)"
        x={430}
        y={200}
        style={{ fontSize: 18, fill: 0xa0a0a0 }}
      />
      <ClickableRect />
      <pixiText
        text="WebGPU + React + Deno"
        x={250}
        y={500}
        anchor={0.5}
        style={{ fontSize: 24, fill: 0x636e72 }}
      />
    </pixiContainer>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────

const WIDTH = 800;
const HEIGHT = 600;

const ctx = await setupPixiDenoForReact({
  width: WIDTH,
  height: HEIGHT,
  title: "pixi-react Deno Test",
  backgroundColor: 0x1a1a2e,
  enableText: true,
});

const { canvas, adapter, device } = ctx;

// Create the pixi-react root and render the React tree
const root = createRoot(canvas as unknown as HTMLCanvasElement);
type RootRenderOptions = Exclude<Parameters<typeof root.render>[1], undefined>;
const app = await root.render(
  <App />,
  {
    gpu: { adapter, device },
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: 0x1a1a2e,
    resolution: 1,
    antialias: false,
  } as RootRenderOptions,
);

// Stop pixi's auto rAF ticker — we drive manually via winit
app.ticker.stop();

console.log("pixi-react app initialized, starting render loop...");

await runPixiReactRenderLoop(ctx, app, {
  autoClose: true,
  maxFrames: 3000,
});

cleanupPixiDenoReact(ctx);
Deno.exit(0);
