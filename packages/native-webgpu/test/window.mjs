import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { P5GPU, GPUWindow, SyphonChannel, createGPU } from '../dist/index.js';

import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

// This test opens native GUI windows. Run only with the user's permission.
const deadline = setTimeout(() => { console.error('Window test timed out'); process.exit(1); }, 45000);
async function main() {
  const gpu = createGPU(), adapter = await gpu.requestAdapter();
  assert(adapter && !adapter.info.isFallbackAdapter);
  const device = await adapter.requestDevice();
  const errors = [];
  device.addEventListener('uncapturederror', event => errors.push(event.error.message));
  const p = new P5GPU(device, { width: 320, height: 240 });
  const totals = [];
  const channel = new SyphonChannel(device, 'avTools preview independence', {private:true});
  const descriptor = new URL('../artifacts/window-syphon.json',import.meta.url);
  await writeFile(descriptor,JSON.stringify(channel.serverDescription));
  const receiver=spawn(fileURLToPath(new URL('../build/syphon-receiver',import.meta.url)),[fileURLToPath(descriptor)]);
  const received=[];createInterface({input:receiver.stdout}).on('line',line=>{const s=JSON.parse(line);if(s.top)received.push(s.top[0]+s.top[1]*256);});
  receiver.stderr.on('data',d=>process.stderr.write(d));
  for(let n=0;n<200&&!channel.stats.hasClients;n++)await delay(10);
  assert(channel.stats.hasClients);
  let sequence=0;
  try {
    for (let cycle = 0; cycle < 3; cycle++) {
      const windows = [0, 1].map(i => new GPUWindow(device, { width: 320, height: 240, title: `avTools Dawn test ${cycle + 1}.${i + 1}` }));
      const presented = [0, 0];
      try {
        for (let frame = 0; frame < 100; frame++) {
          if (frame === 20) windows[0].resize(480, 300);
          if (frame === 35) windows.forEach(w=>w.setVisible(false));
          if (frame === 45) windows.forEach(w=>w.setVisible(true));
          if (frame === 60) windows.forEach(w=>w.setMinimized(true));
          if (frame === 70) windows.forEach(w=>w.setMinimized(false));
          p.beginFrame(); p.background(15, 22, 40); p.noStroke();
          p.fill(255, 130, 30); p.circle(40 + frame * 2, 120, 64);
          p.fill(255); p.textSize(20); p.text(`Dawn + Rust text · ${frame}`, 12, 28);
          sequence++;p.fill(sequence%256,Math.floor(sequence/256),0);p.rect(0,0,8,8);p.endFrame();
          channel.publishTexture(p.outputTexture);
          for (let i = 0; i < windows.length; i++) {
            windows[i].poll();
            const current = windows[i].acquire();
            if (current) assert.equal(windows[i].acquire(), current, 'Acquisition must be cached until present');
            if (windows[i].show(p.outputTexture)) presented[i]++;
          }
          if (frame === 40) assert.equal(windows[0].acquire(), null, 'Hidden windows must skip acquisition');
          await delay(16);
        }
        assert(presented.every(count => count > 0), `Both windows must present: ${presented}`);
        totals.push(presented);
      } finally { windows.forEach(window => window.dispose()); }
    }
    // All native windows are closed; publication must continue.
    for(let n=0;n<60;n++) {
      sequence++;p.beginFrame();p.background(sequence%256,Math.floor(sequence/256),0);p.endFrame();
      channel.publishTexture(p.outputTexture);await delay(16);
    }
    await device.queue.onSubmittedWorkDone();await delay(100);assert.deepEqual(errors, []);
    for(let cycle=0;cycle<3;cycle++)for(const [from,to] of [[36,44],[61,69]])
      assert(received.some(id=>id>=cycle*100+from&&id<=cycle*100+to),'Syphon must continue while both previews are unavailable');
    assert(received.some(id=>id>330),'Syphon must continue after all previews close');
    console.log(JSON.stringify({ cycles: 3, presented: totals, syphonFrames:received.length, finalSequence:received.at(-1), passed: true }));
  } finally { receiver.kill("SIGTERM"); channel.dispose(); p.dispose(); device.destroy(); }
}
try { await main(); } finally { clearTimeout(deadline); }
globalThis.gc?.();
