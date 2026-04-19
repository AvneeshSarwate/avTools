/// <reference lib="dom" />

// Closed curve test: a filled+stroked blob with smoothly varying radius.
// Tests that curveVertex + endShape(CLOSE) renders correctly for thick strokes.
//
// Run from apps/deno-notebooks:
//   deno run --unstable-webgpu --unstable-ffi --allow-all examples/p5gpu_closed_curve_test.ts

import {
  createWindowRenderManager,
  requestWebGpuDevice,
  type WindowTweakpane,
} from "../window/mod.ts";
import { P5GPU } from "../tools/p5gpu.ts";

const WIDTH = 800;
const HEIGHT = 800;
const NUM_POINTS = 40;

const params = {
  baseRadius: 200,
  radiusVariation: 80,
  strokeWeight: 8,
  noiseSpeed: 0.3,
  fillAlpha: 80,
};

// Pre-generate random phase offsets for each point so the variation is smooth
const phases = Array.from({ length: NUM_POINTS }, () => Math.random() * Math.PI * 2);

const device = await requestWebGpuDevice();
const renderWindow = await createWindowRenderManager({
  device,
  width: WIDTH,
  height: HEIGHT,
  title: "Closed Curve Test",
  pane: {
    title: "Blob",
    panelWidth: 300,
    panelHeight: 200,
    setup: setupPane,
  },
});
const p5 = new P5GPU(device, { width: WIDTH, height: HEIGHT });

await renderWindow.run(renderFrame);

function renderFrame() {
  const time = performance.now() * 0.001;
  p5.beginFrame();
  p5.clear();

  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;

  // Compute radii for each point
  const radii: number[] = [];
  for (let i = 0; i < NUM_POINTS; i++) {
    const r = params.baseRadius + params.radiusVariation * Math.sin(phases[i] + time * params.noiseSpeed * (1 + i * 0.05));
    radii.push(r);
  }

  // Compute the curve points
  const pts: [number, number][] = [];
  for (let i = 0; i < NUM_POINTS; i++) {
    const angle = (i / NUM_POINTS) * Math.PI * 2;
    const r = radii[i];
    pts.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
  }

  // Draw filled + stroked closed curve
  p5.fill(100, 150, 255, params.fillAlpha);
  p5.stroke(255, 255, 255);
  p5.strokeWeight(params.strokeWeight);
  p5.strokeJoin(p5.ROUND);

  p5.beginShape();
  // For closed Catmull-Rom: prepend the last point, then append the first two
  // points. Appending the third point would emit the first curve segment twice.
  p5.curveVertex(pts[NUM_POINTS - 1][0], pts[NUM_POINTS - 1][1]);
  for (let i = 0; i < NUM_POINTS; i++) {
    p5.curveVertex(pts[i][0], pts[i][1]);
  }
  p5.curveVertex(pts[0][0], pts[0][1]);
  p5.curveVertex(pts[1][0], pts[1][1]);
  p5.endShape(p5.CLOSE);

  return p5.endFrame();
}

function setupPane(pane: WindowTweakpane): void {
  pane.addBinding(params, "baseRadius", { min: 50, max: 350, step: 1, label: "Base Radius" });
  pane.addBinding(params, "radiusVariation", { min: 0, max: 200, step: 1, label: "Variation" });
  pane.addBinding(params, "strokeWeight", { min: 0.5, max: 30, step: 0.5, label: "Stroke Weight" });
  pane.addBinding(params, "noiseSpeed", { min: 0, max: 2, step: 0.05, label: "Speed" });
  pane.addBinding(params, "fillAlpha", { min: 0, max: 255, step: 1, label: "Fill Alpha" });
}
