/// <reference lib="dom" />

// Run from apps/deno-notebooks:
// deno run --unstable-webgpu --unstable-ffi --allow-ffi --allow-read --allow-env --allow-write \
//   libraryIntegrationTetsts/p5_test_headless.ts

import { setupP5Deno, snapshotP5Frame, cleanupP5Deno } from "../tools/p5_deno_shim.ts";

// deno-lint-ignore no-explicit-any
const ctx = await setupP5Deno((p: any) => {
  p.setup = () => {
    p.createCanvas(400, 400);
    p.noLoop();
  };
  p.draw = () => {
    p.background(220);

    // Red rectangle
    p.fill(255, 0, 0);
    p.noStroke();
    p.rect(50, 50, 100, 80);

    // Blue ellipse
    p.fill(0, 0, 255);
    p.ellipse(300, 200, 120, 80);

    // Green diagonal line
    p.stroke(0, 150, 0);
    p.strokeWeight(4);
    p.line(0, 0, 400, 400);

    // Yellow circle with stroke
    p.fill(255, 255, 0, 200);
    p.stroke(0);
    p.strokeWeight(2);
    p.circle(200, 350, 60);
  };
}, { headless: true });

await snapshotP5Frame(ctx, ".output/p5-headless-test.png");
cleanupP5Deno(ctx);
console.log("Done");
Deno.exit(0);
