import {EmbeddedP5GPU} from './embedded.ts';
import {SketchLifetime} from './td-timing.ts';
declare const nativeGPU:{create(flags:string[]):GPU,globals:Record<string,unknown>};
declare const __avFontsJSON:string;
declare const __avSource:string;
declare const __avFrameJSON:string;
// Runtime::setBytes creates owned ArrayBuffer-backed snapshots.
declare const __avData:Uint8Array<ArrayBuffer>;
declare const __avSyphonName:string;
declare const __avPulsesJSON:string;
const g=globalThis as any;
Object.assign(g,nativeGPU.globals);
const fonts:string[]=JSON.parse(__avFontsJSON);
let device:GPUDevice, p:EmbeddedP5GPU|undefined, sketch:any, staging:GPUBuffer|undefined;
let width=0,height=0,stride=0, priorSource:string|undefined, blocked=false, reloadError='';
let images:{texture:GPUTexture}[]=[];
let channels:{name:string,samples:Float32Array}[]=[],incomingChannels:typeof channels=[];
let controlsMeta={sampleRate:0,startIndex:0};
const message=(error:any)=>String(error?.stack??error);
g.__avDone=false;g.__avError='';g.__avBytes=null;g.__avPulseNames='[]';g.__avSyphonClients=0;g.__avSyphonPublished=0;g.__avSyphonDropped=0;
let syphon:any,syphonName='';
let lifetime:SketchLifetime|undefined,sketchP:EmbeddedP5GPU|undefined;
// Channels are owned copies; callers receive fresh read-only records and sample copies.
const latestControls=()=>Object.freeze({...controlsMeta,channels:Object.freeze(channels.map(c=>Object.freeze({name:c.name,samples:c.samples.slice()})))});
const chop=(name:string,index=0)=>channels.find(channel=>channel.name===name)?.samples[index]??0;
(async()=>{
  const gpu=nativeGPU.create(['backend=metal','avtools-event-driven=1']);
  const adapter=await gpu.requestAdapter();if(!adapter)throw new Error('No Metal adapter');
  device=await adapter.requestDevice();
  device.addEventListener('uncapturederror',event=>{g.__avError=event.error.message;blocked=true;});
  device.lost.then(info=>{blocked=true;g.__avError=`Device lost: ${info.message}; reset the operator`;});
})().catch(error=>{g.__avError=message(error);}).finally(()=>{g.__avDone=true;});
g.__avInputs=()=>{incomingChannels=[];};
g.__avChannel=(name:string)=>{incomingChannels.push({name,samples:new Float32Array(__avData.buffer,__avData.byteOffset,__avData.byteLength/4)});};
g.__avImage=(index:number,w:number,h:number)=>{
  let image=images[index];
  if(!image||image.texture.width!==w||image.texture.height!==h){image?.texture.destroy();image={texture:device.createTexture({size:[w,h],format:'rgba8unorm',usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING})};images[index]=image;}
  device.queue.writeTexture({texture:image.texture},__avData,{bytesPerRow:w*4},[w,h]);
};
g.__avTrimImages=(count:number)=>{channels=incomingChannels;const f=JSON.parse(__avFrameJSON);controlsMeta={sampleRate:f.sampleRate,startIndex:f.startIndex};for(const image of images.splice(count))image.texture.destroy();};
g.__avRender=async()=>{
  g.__avDone=false;g.__avError='';g.__avHasFrame=false;g.__avRendered=false;g.__avDrawMs=0;g.__avReadbackMs=0;
  const frame=JSON.parse(__avFrameJSON);
  try {
    if(!device)throw new Error('GPU initialization failed');
    if(frame.reset||__avSource!==priorSource||width!==frame.width||height!==frame.height){
      priorSource=__avSource;
      const candidateLife=new SketchLifetime();
      let next:EmbeddedP5GPU|undefined;
      try {
        const candidate=candidateLife.run(()=>new Function(`${__avSource}\n;return {setup:typeof setup==='function'?setup:undefined,draw:typeof draw==='function'?draw:undefined,onPulse:typeof onPulse!=='undefined'?onPulse:undefined};`)());
        if(typeof candidate.draw!=='function')throw new Error('Sketch must define function draw(p, frame)');
        next=new EmbeddedP5GPU(device,{width:frame.width,height:frame.height,sampleCount:1},fonts);
        const guarded=candidateLife.guard(next);
        const host=Object.freeze({device:candidateLife.guard(device),readFile:(path:string)=>candidateLife.run(()=>g.readFile(path)),timing:candidateLife.timing,onDispose:(callback:()=>void)=>candidateLife.onDispose(callback),chop,latestControls});
        await candidateLife.run(()=>candidate.setup?.(guarded,host));
        if(candidateLife.error)throw new Error(candidateLife.error);
        await lifetime?.dispose();
        p?.dispose();staging?.destroy();p=next;sketchP=guarded;sketch=candidate;lifetime=candidateLife;width=frame.width;height=frame.height;
        stride=Math.ceil(width*4/256)*256;staging=device.createBuffer({size:stride*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
        blocked=false;reloadError='';g.__avPulseNames=JSON.stringify(candidate.onPulse&&typeof candidate.onPulse==='object'?Object.keys(candidate.onPulse).filter(name=>typeof candidate.onPulse[name]==='function'):[]);
      }catch(error){await candidateLife.dispose();next?.dispose();reloadError=message(error);}

    }
    if(!p||!sketch)throw new Error(reloadError||'No valid sketch');
    if(width!==frame.width||height!==frame.height)throw new Error(reloadError||'Resize did not complete');
    if(lifetime?.error)throw new Error(lifetime.error);
    if(g.__avBackgroundError)throw new Error(g.__avBackgroundError);
    if(blocked)throw new Error('Draw stopped after an error; edit the source or reset');
    // Accepted cook is the only frame source; real-time timers never depend on it.
    await g.__hostFrame();
    frame.time=(frame.frame-1)/frame.rate;
    frame.controls=Object.freeze({sampleRate:frame.sampleRate,startIndex:frame.startIndex,channels});
    frame.chop=chop;
    frame.top=(index:number)=>images[index];
    if(syphonName!==__avSyphonName){syphon?.dispose();syphon=undefined;syphonName=__avSyphonName;if(syphonName)syphon=new (nativeGPU as any).NativeSyphon(device,syphonName,false);}
    if(frame.syphonOnly&&!syphon)throw new Error('Syphon-only output requires an enabled, named Syphon channel');
    const drawStart=g.hostNow();
    p.beginFrame();
    try {
      for(const name of JSON.parse(__avPulsesJSON)){
        const handler=typeof sketch.onPulse==='function'?()=>sketch.onPulse(name,sketchP,frame):()=>sketch.onPulse?.[name]?.(sketchP,frame);
        const result=lifetime!.run(handler);if(result&&typeof result.then==='function'){result.catch(()=>{});throw new Error('Pulse handlers must be synchronous');}
      }
      const value=lifetime!.run(()=>sketch.draw(sketchP,frame));if(value&&typeof value.then==='function'){value.catch(()=>{});throw new Error('draw() must be synchronous; prepare async assets in setup()');}}
    catch(error){blocked=true;throw error;}
    const texture=p.endFrame();
    // TD/Syphon receivers use a bottom-left image origin; match CPU TOP orientation.
    syphon?.publish(texture,true,{x:0,y:0,width,height});
    const syphonStats=syphon?.stats();g.__avSyphonClients=Number(syphonStats?.hasClients??false);g.__avSyphonPublished=syphonStats?.published??0;g.__avSyphonDropped=syphonStats?.dropped??0;
    g.__avRendered=true;
    if(frame.syphonOnly){g.__avDrawMs=g.hostNow()-drawStart;g.__avError=reloadError;return;}
    const encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture},{buffer:staging!,bytesPerRow:stride},[width,height]);device.queue.submit([encoder.finish()]);
    g.__avSubmitted=true;g.__avDrawMs=g.hostNow()-drawStart;
    const readbackStart=g.hostNow();
    await staging!.mapAsync(GPUMapMode.READ);
    g.__avReadbackMs=g.hostNow()-readbackStart;
    g.__avBytes=new Uint8Array(staging!.getMappedRange());g.__avHasFrame=true;g.__avError=reloadError;
  }catch(error){g.__avError=message(error);}finally{g.__avDone=true;}
};
g.__avUnmap=()=>{g.__avBytes=null;if(staging?.mapState==='mapped')staging.unmap();};
g.__avDispose=async()=>{g.__avDone=false;await lifetime?.dispose();g.__avUnmap();syphon?.dispose();for(const image of images)image.texture.destroy();images=[];p?.dispose();staging?.destroy();device?.destroy();g.__avDone=true;};
