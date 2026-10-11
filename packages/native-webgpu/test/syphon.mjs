import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { createGPU, P5GPU, SyphonChannel } from '../dist/index.js';
const deadline = setTimeout(() => { console.error('Syphon test timed out'); process.exit(1); }, 30000);
const gpu = createGPU(), adapter = await gpu.requestAdapter(), device = await adapter.requestDevice();
const errors = []; device.addEventListener('uncapturederror', e => errors.push(e.error.message));
const channels = [], renderers = [], receivers = [], samples = [[], [], []], timings = [];
async function connect(i) {
  const path = new URL(`../artifacts/syphon-${i}.json`, import.meta.url);
  await writeFile(path, JSON.stringify(channels[i].serverDescription));
  const receiver = spawn(fileURLToPath(new URL('../build/syphon-receiver', import.meta.url)), [fileURLToPath(path)], { stdio: ['ignore', 'pipe', 'inherit'] });
  receivers[i] = receiver;
  createInterface({ input: receiver.stdout }).on('line', line => {
    try { const sample = JSON.parse(line); if (!sample.ready) samples[i].push(sample); } catch { errors.push(line); }
  });
  receiver.on('error', e => errors.push(e.message));
  await until(() => channels[i].stats.hasClients, `channel ${i} connect`);
  const before = samples[i].length;
  await until(() => { channels[i].publishTexture(renderers[i].outputTexture); return samples[i].length > before; }, `channel ${i} first frame`);
  samples[i].length = 0;

}
async function stopReceiver(i) {
  const receiver = receivers[i];
  if (receiver.exitCode !== null || receiver.signalCode !== null) return;
  const exited = once(receiver, 'exit'); receiver.kill('SIGTERM'); await exited;
}
async function until(predicate, label) {
  for (let n = 0; n < 200; n++) { if (predicate()) return; await delay(10); }
  throw new Error(`Timed out: ${label}`);
}
try {
  await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
  for (let i = 0; i < 3; i++) {
    channels.push(new SyphonChannel(device, `avTools test ${i}`, { private: true }));
    renderers.push(new P5GPU(device, { width: 64 + i * 16, height: 48 + i * 8 }));
    assert.equal(channels[i].publishTexture(renderers[i].outputTexture), false, 'No-client publication skips');
    const p = renderers[i];
    p.beginFrame(); p.background(0, i * 70, 0, 128); p.noStroke(); p.fill(0, 0, 255);
    p.rect(0, p.height / 2, p.width, p.height / 2); p.endFrame();
    await connect(i);
  }
  for (let frame = 1; frame <= 80; frame++) {
    for (let i = 0; i < 3; i++) {
      if (frame === 40) { renderers[i].dispose(); renderers[i] = new P5GPU(device, { width: 96 + i * 16, height: 72 + i * 8 }); }
      const p = renderers[i];
      p.beginFrame(); p.background(frame, i * 70, 0, 128); p.noStroke(); p.fill(0, 0, 255);
      p.rect(0, p.height / 2, p.width, p.height / 2); p.endFrame();
      const start = performance.now(); channels[i].publishTexture(p.outputTexture); timings.push(performance.now() - start);
    }
    await delay(frame % 3 === 0 ? 15 : 5);
  }
  await device.queue.onSubmittedWorkDone(); await delay(100);
  for (let i = 0; i < 3; i++) {
    assert(samples[i].length >= 5, `Channel ${i} received ${samples[i].length} samples`);
    let last = 0;
    for (const sample of samples[i]) {
      assert(sample.top[0] >= last, 'Frame identifiers must not go backwards'); last = sample.top[0];
      assert.deepEqual(sample.top.slice(1), [i * 70, 0, 128]);
      assert.deepEqual(sample.bottom, [0, 0, 255, 255]);
    }
    assert(samples[i].some(s => s.width === 96 + i * 16), 'Resize must reach receiver');
    assert.equal(channels[i].stats.failed, 0);
    assert.equal(channels[i].stats.inFlight, 0);
  }
  // Invalid ownership/lifetime must fail at the native boundary.
  let count = samples[0].length;
  channels[0].publishTexture(renderers[0].outputTexture, { flipped: true });
  await until(() => samples[0].length > count, 'flipped frame');
  assert.deepEqual(samples[0].at(-1).top, [0, 0, 255, 255]);
  assert.deepEqual(samples[0].at(-1).bottom, [80, 0, 0, 128]);
  count = samples[0].length;
  channels[0].publishTexture(renderers[0].outputTexture, { region: { x: 10, y: 40, width: 20, height: 12 } });
  await until(() => samples[0].length > count, 'cropped frame');
  assert.deepEqual(samples[0].at(-1), { width: 20, height: 12, top: [0, 0, 255, 255], bottom: [0, 0, 255, 255] });
  const otherDevice = await (await gpu.requestAdapter()).requestDevice();
  const foreign = otherDevice.createTexture({ size: [16, 16], format: 'rgba8unorm', usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING });
  assert.throws(() => channels[0].publishTexture(foreign), /belong/); foreign.destroy(); otherDevice.destroy();
  const dead = device.createTexture({ size: [16, 16], format: 'rgba8unorm', usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING });
  dead.destroy(); assert.throws(() => channels[0].publishTexture(dead), /live/);
  assert.throws(() => channels[0].publishTexture(renderers[0].outputTexture, { region: { x: -1, y: 0, width: 8, height: 8 } }), /outside/);
  // Receiver disappearance/reconnection must not strand the channel.
  await stopReceiver(0);
  await until(() => { channels[0].publishTexture(renderers[0].outputTexture); return !channels[0].stats.hasClients; }, 'receiver disconnect');
  assert.equal(channels[0].publishTexture(renderers[0].outputTexture), false);
  await connect(0); count = samples[0].length;
  channels[0].publishTexture(renderers[0].outputTexture);
  await until(() => samples[0].length > count, 'receiver reconnect');
  assert.deepEqual(samples[0].at(-1).top, [80, 0, 0, 128]);
  // Destroy the source and channel immediately after encoding GPU work.
  for (let cycle = 0; cycle < 12; cycle++) {
    await stopReceiver(0);
    channels[0].dispose(); renderers[0].dispose();
    channels[0] = new SyphonChannel(device, `avTools lifetime ${cycle}`, {private:true});
    renderers[0] = new P5GPU(device, {width:640,height:360});
    await connect(0);
    renderers[0].beginFrame();renderers[0].background(cycle,50,100);renderers[0].endFrame();
    assert(channels[0].publishTexture(renderers[0].outputTexture));
    channels[0].dispose(); renderers[0].dispose();
    await device.queue.onSubmittedWorkDone();
  }
  assert.deepEqual(errors, []);
  const result = { passed: true, rapidDisposalCycles: 12, received: samples.map(s => s.length), stats: channels.map(c => c.stats),
    publishCallMeanMs: timings.reduce((a,b) => a+b, 0) / timings.length, publishCallMaxMs: Math.max(...timings) };
  await writeFile(new URL('../artifacts/syphon-result.json', import.meta.url), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) { console.error(error); console.error(channels.map(c => c.stats), samples.map(s => s.slice(-2))); throw error;
} finally {
  receivers.forEach(r => r.kill('SIGTERM')); renderers.forEach(p => p.dispose()); channels.forEach(c => c.dispose());
  await device.queue.onSubmittedWorkDone(); device.destroy(); clearTimeout(deadline);
}
