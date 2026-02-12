/// <reference lib="dom" />

// Run from apps/deno-notebooks:
// deno run --unstable-webgpu --unstable-ffi --allow-ffi --allow-read --allow-env --allow-net --allow-write \
//   libraryIntegrationTetsts/p5_test.ts

import { setupP5Deno, runP5RenderLoop, cleanupP5Deno } from "../tools/p5_deno_shim.ts";

// deno-lint-ignore no-explicit-any
const ctx = await setupP5Deno((p: any) => {
  p.setup = () => {
    p.createCanvas(512, 512);
  };
  p.draw = () => {
    p.background(30);

    // Rotating red rectangle
    p.push();
    p.translate(256, 256);
    p.rotate(p.frameCount * 0.02);
    p.fill(220, 50, 50);
    p.stroke(255);
    p.strokeWeight(2);
    p.rect(-60, -40, 120, 80);
    p.pop();

    // Bouncing blue circle
    p.noStroke();
    p.fill(50, 150, 255, 180);
    const cx = 256 + Math.cos(p.frameCount * 0.03) * 150;
    const cy = 256 + Math.sin(p.frameCount * 0.02) * 100;
    p.circle(cx, cy, 80);

    // Green triangle
    p.fill(0, 200, 100);
    p.stroke(255, 255, 0);
    p.strokeWeight(3);
    p.triangle(100, 420, 60, 480, 140, 480);

    // Lines from corner
    p.stroke(255, 100, 100, 100);
    p.strokeWeight(1);
    for (let i = 0; i < 20; i++) {
      const angle = (i / 20) * p.HALF_PI;
      p.line(0, 0, Math.cos(angle) * 200, Math.sin(angle) * 200);
    }
  };
}, { width: 512, height: 512, title: "p5.js Deno" });

await runP5RenderLoop(ctx);
cleanupP5Deno(ctx);
Deno.exit(0);
