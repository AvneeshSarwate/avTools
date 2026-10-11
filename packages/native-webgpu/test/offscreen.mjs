import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';

// The same fixture exercises the npm baseline and an explicitly selected source build.
const binding = process.env.AVTOOLS_DAWN_ADDON
  ? createRequire(import.meta.url)(resolve(process.env.AVTOOLS_DAWN_ADDON))
  : await import('webgpu');
Object.assign(globalThis, binding.globals);
const deadline = setTimeout(() => { console.error('GPU baseline timed out'); process.exit(1); }, 30000);

async function main() {
  const gpu = binding.create(['backend=metal']);
  const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  assert(adapter, 'A hardware Metal adapter is required; no software fallback');
  assert.equal(adapter.info.isFallbackAdapter, false);
  const device = await adapter.requestDevice();
  const errors = [];
  let shuttingDown = false;
  device.addEventListener('uncapturederror', event => errors.push(event.error.message));
  device.lost.then(info => { if (!shuttingDown) errors.push(`Device lost: ${info.reason}: ${info.message}`); });
  device.pushErrorScope('validation');
  const width = 64, height = 64, bytesPerRow = 256;
  const texture = device.createTexture({ size: [width, height], format: 'rgba8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: bytesPerRow * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  try {
    const shader = device.createShaderModule({ code: `
      @vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
        let p = array<vec2f, 3>(vec2f(-0.8, -0.8), vec2f(0.8, -0.8), vec2f(0.0, 0.8));
        return vec4f(p[i], 0.0, 1.0);
      }
      @fragment fn fs() -> @location(0) vec4f { return vec4f(1.0, 0.25, 0.0, 1.0); }
    ` });
    const diagnostics = await shader.getCompilationInfo();
    assert.deepEqual(diagnostics.messages.filter(m => m.type === 'error'), []);
    const pipeline = await device.createRenderPipelineAsync({ layout: 'auto',
      vertex: { module: shader, entryPoint: 'vs' },
      fragment: { module: shader, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] } });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: texture.createView(),
      clearValue: [0, 0, 1, 1], loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(pipeline); pass.draw(3); pass.end();
    encoder.copyTextureToBuffer({ texture }, { buffer: readback, bytesPerRow }, [width, height]);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const bytes = new Uint8Array(readback.getMappedRange());
    const pixel = (x, y) => Array.from(bytes.slice(y * bytesPerRow + x * 4, y * bytesPerRow + x * 4 + 4));
    assert.deepEqual(pixel(0, 0), [0, 0, 255, 255]);
    assert.deepEqual(pixel(32, 32), [255, 64, 0, 255]);
    const output = { node: process.version, platform: process.platform, arch: process.arch,
      binding: process.env.AVTOOLS_DAWN_ADDON ?? 'webgpu@0.6.1',
      adapter: { vendor: adapter.info.vendor, architecture: adapter.info.architecture,
        device: adapter.info.device, description: adapter.info.description,
        isFallbackAdapter: adapter.info.isFallbackAdapter },
      corners: pixel(0, 0), center: pixel(32, 32), passed: true };
    readback.unmap();
    const validation = await device.popErrorScope();
    assert.equal(validation, null, validation?.message);
    assert.deepEqual(errors, []);
    await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
    await writeFile(new URL(`../artifacts/baseline-${process.env.AVTOOLS_DAWN_ADDON ? 'source' : 'npm'}.json`, import.meta.url), JSON.stringify(output, null, 2) + '\n');
    console.log(JSON.stringify(output, null, 2));
  } finally {
    readback.destroy(); texture.destroy(); shuttingDown = true; device.destroy();
  }
}
try { await main(); } finally { clearTimeout(deadline); }
// Dawn's instance owns event-loop work until collected. Do not force a successful exit.
globalThis.gc?.();
