// Same scene/resolution/receivers, actual retained Deno CPU bridge vs Node GPU bridge.
// Receiver readback is instrumentation and contributes to observed latency.
import assert from 'node:assert/strict';
import process from 'node:process';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {writeFile} from 'node:fs/promises';
const mode=process.argv[2]??'new',seconds=Number(process.argv[3]??60),root=fileURLToPath(new URL('../',import.meta.url));
assert(['old','new'].includes(mode));const width=1920,height=1080,count=3;
let P5GPU,device,Channel,stagingFactory;
if(mode==='new') {
  const api=await import('../dist/index.js');P5GPU=api.P5GPU;Channel=api.SyphonChannel;
  device=await(await api.createGPU().requestAdapter()).requestDevice();
} else {
  ({P5GPU}=await import('../../../apps/deno-notebooks/tools/p5gpu.ts'));
  ({HeadlessSyphonServer:Channel}=await import('../../../apps/deno-notebooks/syphon/headless_syphon.ts'));
  ({createStagingBufferPair:stagingFactory}=await import('../../../apps/deno-notebooks/syphon/staging_buffers.ts'));
  device=await(await navigator.gpu.requestAdapter()).requestDevice();
}
const errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
const names=Array.from({length:count},(_,i)=>`avTools benchmark ${process.pid} ${i}`);
const received=[[],[],[]],waiting=[false,false,false],receivers=[];
const renderers=[],channels=[],staging=[];
async function until(fn) {for(let i=0;i<1000;i++){if(fn())return;await delay(10);}throw new Error('Receiver timeout');}
const mean=a=>a.reduce((s,n)=>s+n,0)/a.length;
const p95=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length*.95)];
try {
  for(let i=0;i<count;i++) {
    const child=spawn(`${root}/build/syphon-receiver`,['--name',names[i],String(seconds+30),'--timed'],{stdio:['ignore','pipe','inherit']});receivers.push(child);
    createInterface({input:child.stdout}).on('line',line=>{const s=JSON.parse(line);if(s.waiting)waiting[i]=true;else if(s.top)received[i].push(s);});
  }
  await until(()=>waiting.every(Boolean));
  for(let i=0;i<count;i++) {
    renderers.push(new P5GPU(device,{width,height,format:'bgra8unorm',sampleCount:1}));
    channels.push(mode==='new'?new Channel(device,names[i]):new Channel({serverName:names[i],frameworkPath:`${root}/build/syphon/Syphon.framework`,libPath:`${root}/../../apps/deno-notebooks/native/syphon_bridge/target/release/libsyphon_bridge.dylib`}));
    if(mode==='old')staging.push(stagingFactory());
  }
  await until(()=>channels.every(c=>mode==='new'?c.stats.hasClients:c.hasClients));
  const started=performance.now(),cpuStart=process.cpuUsage(),frameTimes=[],publication=[],rss=[];
  let frames=0,nextRSS=0;
  while(performance.now()-started<seconds*1000) {
    const tick=performance.now();
    for(let i=0;i<count;i++) {
      const pubStart=performance.now();
      if(mode==='old') {
        const read=staging[i].getReadBuffer();if(read){await device.queue.onSubmittedWorkDone();await read.buffer.mapAsync(GPUMapMode.READ);channels[i].publishFrame(new Uint8Array(read.buffer.getMappedRange()),width,height,read.bytesPerRow);read.buffer.unmap();}
      }
      const stamp=Date.now()%16777216,p=renderers[i];
      p.beginFrame();p.background(stamp%256,Math.floor(stamp/256)%256,Math.floor(stamp/65536));p.noStroke();p.fill(255,120,0);p.circle(100+(frames*3)%(width-200),height/2,80);p.fill(255);p.textSize(32);p.text(`Channel ${i} / frame ${frames}`,20,60);p.endFrame();
      if(mode==='new')channels[i].publishTexture(p.outputTexture);
      else {const write=staging[i].getWriteBuffer(device,width,height),encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture:p.outputTexture},{buffer:write.buffer,bytesPerRow:write.bytesPerRow},[width,height]);device.queue.submit([encoder.finish()]);staging[i].advance();}
      publication.push(performance.now()-pubStart);
    }
    frames++;frameTimes.push(performance.now()-tick);
    if(performance.now()-started>=nextRSS){rss.push(process.memoryUsage().rss/1048576);nextRSS+=5000;}
    await delay(Math.max(0,1000/60-(performance.now()-tick)));
  }
  await device.queue.onSubmittedWorkDone();await delay(100);
  const elapsedMs=performance.now()-started,cpu=process.cpuUsage(cpuStart);
  const latency=received.flat().map(s=>((s.receivedMs%16777216)-(s.top[0]+s.top[1]*256+s.top[2]*65536)+16777216)%16777216).filter(n=>n<10000);
  assert(received.every(a=>a.length>Math.min(60, seconds*5)), `Frames produced ${frames}, received ${received.map(a=>a.length)}`);assert.deepEqual(errors,[]);
  if(mode==='new')assert(channels.every(c=>c.stats.failed===0&&c.stats.inFlight===0));
  const growth=rss.at(-1)-Math.min(...rss.slice(Math.floor(rss.length/2)));
  if(mode==='new')assert(growth<64,`Second-half RSS growth ${growth} MiB`);
  const result={mode,width,height,channels:count,seconds,frames,elapsedMs,fps:frames*1000/elapsedMs,cpuMsPerFrame:(cpu.user+cpu.system)/1000/frames,frameWorkMeanMs:mean(frameTimes),frameWorkP95Ms:p95(frameTimes),channelRenderAndPublishMeanMs:mean(publication),observedLatencyMeanMs:mean(latency),observedLatencyP95Ms:p95(latency),latencyIncludesReceiverReadback:true,received:received.map(a=>a.length),rssMiB:rss,secondHalfRSSGrowthMiB:growth,stats:mode==='new'?channels.map(c=>c.stats):undefined};
  await writeFile(`${root}/artifacts/syphon-benchmark-${mode}.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} finally {
  for(const receiver of receivers) {if(receiver.exitCode===null&&receiver.signalCode===null){const stopped=once(receiver,'exit');receiver.kill('SIGTERM');await stopped;}}
  await device.queue.onSubmittedWorkDone();staging.forEach(s=>s.destroy());renderers.forEach(p=>p.dispose());channels.forEach(c=>mode==='new'?c.dispose():c.destroy());device.destroy();
}
