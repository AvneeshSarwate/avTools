import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { P5GPU, NodeTextEngine, createGPU } from '../dist/index.js';
import { scenes, renderScene, persistence } from '../build/scenes.js';

const deadline = setTimeout(() => { console.error('P5 integration timed out'); process.exit(1); }, 120000);
async function main() {
  const text = new NodeTextEngine();
  try {
    const request = { text: 'office AV ffi é العربية', family: 'Inter', fontSize: 32, lineHeight: 40,
      width: null, height: null, alignH: 0, wrapMode: 0, weight: 400, style: 0, axisQuantization: 0.01, axes: {} };
    const layout = text.layoutText(request);
    assert(layout.glyphs.length > 0 && layout.fontWidth > 0 && layout.ascent > 0);
    assert(layout.glyphs.every(g => typeof g.key === 'bigint'));
    const glyph = layout.glyphs.find(g => text.rasterizeGlyph(g.key));
    assert(glyph, 'Rust glyph rasterization must produce pixels');
    const raster = text.rasterizeGlyph(glyph.key);
    assert(raster.pixels.some(v => v > 0));
    const wide = text.layoutText({ ...request, family: 'Roboto Flex', axes: { wdth: 150 } });
    const narrow = text.layoutText({ ...request, family: 'Roboto Flex', axes: { wdth: 50 } });
    assert.notEqual(wide.fontWidth, narrow.fontWidth, 'Variable font width axis must affect layout');
    assert.throws(() => text.rasterizeGlyph(2n ** 64n));
    text.dispose(); text.dispose();
    assert.throws(() => text.layoutText(request), /disposed/);
  } finally { text.dispose(); }

  const gpu = createGPU();
  const adapter = await gpu.requestAdapter();
  assert(adapter && !adapter.info.isFallbackAdapter);
  const device = await adapter.requestDevice();
  const errors = [];
  device.addEventListener('uncapturederror', event => errors.push(event.error.message));
  const comparisons = [];
  await mkdir(new URL('../artifacts/node/', import.meta.url), { recursive: true });
  try {
    for (const sketch of scenes) {
      device.pushErrorScope('validation');
      const p = new P5GPU(device, { width: sketch.width, height: sketch.height });
      try {
        const actual = await renderScene(p, sketch);
        await writeFile(new URL(`../artifacts/node/${sketch.name}.rgba`, import.meta.url), actual);
        const expected = await readFile(new URL(`../artifacts/deno/${sketch.name}.rgba`, import.meta.url));
        assert.equal(actual.length, expected.length);
        let sum = 0, differing = 0, max = 0;
        for (let i = 0; i < actual.length; i++) {
          const d = Math.abs(actual[i] - expected[i]); sum += d * d;
          max = Math.max(max, d); if (d > 2) differing++;
        }
        const comparison = { name: sketch.name, rmse: Math.sqrt(sum / actual.length), max,
          differingFraction: differing / actual.length };
        comparisons.push(comparison); console.log(comparison);
        // Different native implementations can round raster edges differently.
        // Report every difference, and fail substantial image changes.
        assert(comparison.rmse <= 3 && comparison.differingFraction <= 0.02, `Deno/Dawn mismatch: ${sketch.name}`);
      } finally { p.dispose(); }
      const error = await device.popErrorScope(); assert.equal(error, null, error?.message);
    }
    const p = new P5GPU(device, { width: 64, height: 64 });
    try {
      assert.deepEqual(await persistence(p), { red: [255, 0, 0, 255], green: [0, 255, 0, 255], background: [0, 0, 0, 255] });
    } finally { p.dispose(); }
    await device.queue.onSubmittedWorkDone(); assert.deepEqual(errors, []);
    await writeFile(new URL('../artifacts/p5-comparison.json', import.meta.url), JSON.stringify(comparisons, null, 2));
  } finally { device.destroy(); }
}
try { await main(); } finally { clearTimeout(deadline); }
globalThis.gc?.();
