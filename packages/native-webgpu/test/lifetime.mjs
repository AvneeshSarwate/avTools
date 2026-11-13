import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { create, globals } = createRequire(import.meta.url)('../build/dawn/dawn.node');
Object.assign(globalThis, globals);
const deadline = setTimeout(() => { console.error('Dawn lifetime test timed out'); process.exit(1); }, 30000);
async function makeDevice() {
  let gpu = create(['backend=metal']);
  const adapter = await gpu.requestAdapter();
  assert(adapter);
  gpu = null; globalThis.gc(); // Adapter flags and native instance must remain alive.
  return await adapter.requestDevice();
}
async function main() {
  for (let i = 0; i < 10; i++) {
    const device = await makeDevice();
    globalThis.gc();
    device.pushErrorScope('validation');
    const buffer = device.createBuffer({ size: 256, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const encoder = device.createCommandEncoder(); encoder.clearBuffer(buffer);
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    assert(new Uint8Array(buffer.getMappedRange()).every(v => v === 0));
    buffer.unmap(); buffer.destroy();
    assert.equal(await device.popErrorScope(), null);
    await device.queue.onSubmittedWorkDone(); device.destroy();
  }
  console.log('Passed 10 forced-GC instance/device lifetimes');
}
try { await main(); } finally { clearTimeout(deadline); }
globalThis.gc();
