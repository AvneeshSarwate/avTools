import {EmbeddedP5GPU} from './embedded.ts';
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
let channels:{name:string,samples:Float32Array}[]=[];
const message=(error:any)=>String(error?.stack??error);
g.__avDone=false;g.__avError='';g.__avBytes=null;g.__avPulseNames='[]';g.__avSyphonClients=0;g.__avSyphonPublished=0;g.__avSyphonDropped=0;
let syphon:any,syphonName='';
(async()=>{
  const gpu=nativeGPU.create(['backend=metal','avtools-event-driven=1']);
  const adapter=await gpu.requestAdapter();if(!adapter)throw new Error('No Metal adapter');
  device=await adapter.requestDevice();
  device.addEventListener('uncapturederror',event=>{g.__avError=event.error.message;blocked=true;});
  device.lost.then(info=>{blocked=true;g.__avError=`Device lost: ${info.message}; reset the operator`;});
})().catch(error=>{g.__avError=message(error);}).finally(()=>{g.__avDone=true;});
g.__avInputs=()=>{channels=[];};
g.__avChannel=(name:string)=>{channels.push({name,samples:new Float32Array(__avData.buffer,__avData.byteOffset,__avData.byteLength/4)});};
g.__avImage=(index:number,w:number,h:number)=>{
  let image=images[index];
  if(!image||image.texture.width!==w||image.texture.height!==h){image?.texture.destroy();image={texture:device.createTexture({size:[w,h],format:'rgba8unorm',usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING})};images[index]=image;}
  device.queue.writeTexture({texture:image.texture},__avData,{bytesPerRow:w*4},[w,h]);
};
g.__avTrimImages=(count:number)=>{for(const image of images.splice(count))image.texture.destroy();};
g.__avRender=async()=>{
  g.__avDone=false;g.__avError='';g.__avHasFrame=false;g.__avRendered=false;g.__avDrawMs=0;g.__avReadbackMs=0;
  const frame=JSON.parse(__avFrameJSON);
  try {
    if(!device)throw new Error('GPU initialization failed');
    if(frame.reset||__avSource!==priorSource||width!==frame.width||height!==frame.height){
      priorSource=__avSource;
      let candidate:any;
      try {candidate=new Function(`${__avSource}\n;return {setup:typeof setup==='function'?setup:undefined,draw:typeof draw==='function'?draw:undefined,onPulse:typeof onPulse!=='undefined'?onPulse:undefined};`)();if(typeof candidate.draw!=='function')throw new Error('Sketch must define function draw(p, frame)');}
      catch(error){candidate=undefined;reloadError=message(error);}
      if(candidate?.draw){
        const next=new EmbeddedP5GPU(device,{width:frame.width,height:frame.height,sampleCount:1},fonts);
        try {await candidate.setup?.(next,Object.freeze({device,readFile:g.readFile}));}
        catch(error){next.dispose();throw error;}
        p?.dispose();staging?.destroy();p=next;sketch=candidate;width=frame.width;height=frame.height;
        stride=Math.ceil(width*4/256)*256;staging=device.createBuffer({size:stride*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
        blocked=false;reloadError='';g.__avPulseNames=JSON.stringify(candidate.onPulse&&typeof candidate.onPulse==='object'?Object.keys(candidate.onPulse).filter(name=>typeof candidate.onPulse[name]==='function'):[]);
      }
    }
    if(!p||!sketch)throw new Error(reloadError||'No valid sketch');
    if(width!==frame.width||height!==frame.height)throw new Error(reloadError||'Resize did not complete');
    if(blocked)throw new Error('Draw stopped after an error; edit the source or reset');
    frame.time=(frame.frame-1)/frame.rate;
    frame.controls=Object.freeze({sampleRate:frame.sampleRate,startIndex:frame.startIndex,channels});
    frame.chop=(name:string,index=0)=>channels.find(channel=>channel.name===name)?.samples[index]??0;
    frame.top=(index:number)=>images[index];
    if(syphonName!==__avSyphonName){syphon?.dispose();syphon=undefined;syphonName=__avSyphonName;if(syphonName)syphon=new (nativeGPU as any).NativeSyphon(device,syphonName,false);}
    if(frame.syphonOnly&&!syphon)throw new Error('Syphon-only output requires an enabled, named Syphon channel');
    const drawStart=g.hostNow();
    p.beginFrame();
    try {
      for(const name of JSON.parse(__avPulsesJSON)){
        const handler=typeof sketch.onPulse==='function'?()=>sketch.onPulse(name,p,frame):()=>sketch.onPulse?.[name]?.(p,frame);
        const result=handler();if(result&&typeof result.then==='function'){result.catch(()=>{});throw new Error('Pulse handlers must be synchronous');}
      }
      const value=sketch.draw(p,frame);if(value&&typeof value.then==='function'){value.catch(()=>{});throw new Error('draw() must be synchronous; prepare async assets in setup()');}}
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
g.__avDispose=()=>{g.__avUnmap();syphon?.dispose();for(const image of images)image.texture.destroy();images=[];p?.dispose();staging?.destroy();device?.destroy();};
