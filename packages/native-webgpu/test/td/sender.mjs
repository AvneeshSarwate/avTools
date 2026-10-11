// Public, offscreen test senders for TouchDesigner. No native preview windows.
import { setTimeout as delay } from 'node:timers/promises';
import { createGPU, P5GPU, SyphonChannel } from '../../dist/index.js';
const gpu = createGPU(), adapter = await gpu.requestAdapter(), device = await adapter.requestDevice();
const outputs = [0,1,2].map(i => ({ p: new P5GPU(device, {width: 320+i*80,height:240+i*40}), channel: new SyphonChannel(device, `avTools TD ${i}`) }));
let running = true;
process.once('SIGINT', () => { running = false; }); process.once('SIGTERM', () => { running = false; });
try {
  for (let frame = 0; running && frame < 18000; frame++) {
    for (let i=0;i<outputs.length;i++) {
      const {p,channel} = outputs[i]; p.beginFrame(); p.background(20+i*50,30,70); p.noStroke();
      p.fill(255,120,0); p.circle(30+(frame*3)%(p.width-60),p.height/2,50);
      p.fill(255); p.textSize(22); p.text(`Dawn channel ${i} / frame ${frame}`,10,32); p.endFrame(); channel.publishTexture(p.outputTexture);
    }
    if (frame%120 === 0) console.log(JSON.stringify(outputs.map(o => o.channel.stats)));
    await delay(1000/60);
  }
} finally { await device.queue.onSubmittedWorkDone(); outputs.forEach(({p,channel}) => {channel.dispose();p.dispose();});device.destroy(); }
