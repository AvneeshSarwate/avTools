import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createGPU, P5GPU } from '../dist/index.js';
const gpu = createGPU(), adapter = await gpu.requestAdapter(), device = await adapter.requestDevice();
const errors = []; device.addEventListener('uncapturederror', e => errors.push(e.error.message));
const memory = []; let grows = 0, uploads = 0;
try {
  for (let cycle = 0; cycle < 20; cycle++) {
    const p = new P5GPU(device, { width: 640, height: 360 });
    try {
      for (let frame = 0; frame < 8; frame++) {
        p.beginFrame(); p.background(0); p.fill(255); p.noStroke(); p.textSize(110);
        p.text(Array.from({ length: 94 }, (_, i) => String.fromCharCode(33 + i)).join(''), 0, 120);
        p.endFrame(); const stats = p.textStats(); grows += stats.grows; uploads += stats.uploads;
        await device.queue.onSubmittedWorkDone();
      }
      await p.loadPixels(); assert(p.pixels.some(v => v > 0));
    } finally { p.dispose(); }
    await device.queue.onSubmittedWorkDone(); globalThis.gc?.(); await delay(10);
    memory.push(process.memoryUsage().rss);
  }
  assert(grows > 0, 'Stress text must exercise atlas growth');
  assert.deepEqual(errors, []);
  const tailGrowth = memory.at(-1) - memory[9];
  assert(tailGrowth < 64 * 1024 * 1024, `RSS grew by ${tailGrowth} bytes in second half`);
  console.log(JSON.stringify({ cycles: 20, grows, uploads, rssMiB: memory.map(n => Math.round(n / 1048576)), passed: true }));
} finally { device.destroy(); }
