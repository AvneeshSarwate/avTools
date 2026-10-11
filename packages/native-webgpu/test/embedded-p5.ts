import {EmbeddedP5GPU} from '../src/embedded.ts';
declare const nativeGPU:{create(flags:string[]):GPU,globals:Record<string,unknown>};
declare const fontPaths:readonly string[];
Object.assign(globalThis,nativeGPU.globals);
const result=globalThis as typeof globalThis & {done?:boolean,failure?:string};
(async()=>{
  const gpu=nativeGPU.create(['backend=metal']);const adapter=await gpu.requestAdapter();if(!adapter)throw new Error('No adapter');
  const device=await adapter.requestDevice();device.addEventListener('uncapturederror',e=>{result.failure=e.error.message;});
  const p=new EmbeddedP5GPU(device,{width:128,height:64,sampleCount:1},fontPaths);
  try {
    p.beginFrame();p.background(10,20,80);p.noStroke();p.fill(255);p.textSize(24);p.text('Dawn',8,36);p.endFrame();
    await p.loadPixels();
    if(p.pixels[0]!==10||p.pixels[2]!==80)throw new Error('Background mismatch');
    let white=0;for(let i=0;i<p.pixels.length;i+=4)if(p.pixels[i]>240&&p.pixels[i+1]>240&&p.pixels[i+2]>240)white++;
    if(white<30)throw new Error(`Rust text missing: ${white} white pixels`);
    console.log(`Embedded P5 + Rust text: ${white} white pixels`);
  } finally {p.dispose();await device.queue.onSubmittedWorkDone();device.destroy();}
  result.done=true;
})().catch(e=>{result.failure=String(e.stack??e);result.done=true;});
