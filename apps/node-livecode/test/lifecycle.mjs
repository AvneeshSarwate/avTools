import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createNodeHost } from '../host.mjs';
const logs = []; let frames = 0; let pixels;
const host = await createNodeHost({ width: 640, height: 480, log: entry => logs.push(entry),
  onFrame: (_texture, p) => { frames++; pixels ??= p.loadPixels().then(() => p.pixels.slice()); } });
const path = fileURLToPath(new URL('../examples/text.mjs', import.meta.url));
async function until(predicate) {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await delay(10); }
  throw new Error('Timed out waiting for engine lifecycle');
}
try {
  await host.launch(path); await until(() => frames >= 3);
  const firstToken = host.engine.getActiveModuleInfo('sketch').runToken;
  assert((await pixels).some(byte => byte > 0));
  await host.launch(path);
  await until(() => host.engine.getActiveModuleInfo('sketch')?.runToken !== firstToken && host.engine.activeModuleIds().length === 1);
  await until(() => frames >= 6);
  await host.engine.stopModule('sketch', 'test');
  await until(() => host.engine.activeModuleIds().length === 0);
  await host.launch(path); await until(() => host.engine.activeModuleIds().length === 1);
  await host.engine.panicRuntime('test');
  assert.equal(host.engine.activeModuleIds().length, 0);
  assert(!logs.some(entry => ['moduleError', 'gpuError', 'deviceLost'].includes(entry.type)), JSON.stringify(logs));
  console.log(JSON.stringify({ frames, replacement: true, stop: true, panic: true, passed: true }));
} finally { await host.close(); await host.close(); }
