import { P5_TEST_SKETCHES } from '../../../apps/deno-notebooks/libraryIntegrationTetsts/p5_test_sketches.ts';
import type { P5GPU } from '../../../apps/deno-notebooks/tools/p5gpu_renderer.ts';
export const scenes = P5_TEST_SKETCHES;

export async function renderScene(p: P5GPU, sketch: typeof scenes[number]) {
  p.beginFrame();
  sketch.draw(p);
  p.endFrame();
  await p.loadPixels();
  return new Uint8Array(p.pixels);
}

export async function persistence(p: P5GPU) {
  p.beginFrame(); p.background(0); p.noStroke(); p.fill(255, 0, 0); p.rect(8, 8, 24, 24); p.endFrame();
  p.beginFrame(); p.fill(0, 255, 0); p.rect(40, 8, 16, 24); p.endFrame();
  await p.loadPixels();
  return { red: p.get(16, 16), green: p.get(48, 16), background: p.get(0, 0) };
}
