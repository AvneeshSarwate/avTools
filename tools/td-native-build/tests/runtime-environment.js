// Run with the native embedded-probe executable (two independent V8 runtimes).
(async()=>{
 const check=(value,label)=>{if(!value)throw Error(label);};
 for(const name of ['window','document','fetch','WebSocket','process','Buffer','MessageChannel','URL','GPUBufferUsage'])check(typeof globalThis[name]==='undefined','Unexpected common global '+name);
 check(Object.keys(console).sort().join(',')==='debug,error,log,warn','console profile');
 check(typeof performance.now()==='number'&&performance.mark===undefined,'performance profile');
 check(/^[\da-f-]{36}$/.test(crypto.randomUUID())&&!crypto.subtle&&!crypto.getRandomValues,'crypto profile');

 let ticks=0;const cancel=setTimeout(()=>ticks++,1000);check(typeof cancel==='number','numeric timeout');clearTimeout(cancel);
 await new Promise(resolve=>setTimeout((a,b)=>{check(a===3&&b==='x','timer arguments');resolve();},1,3,'x'));
 await new Promise(resolve=>{const id=setImmediate((a)=>{check(a===7,'immediate arguments');resolve();},7);check(typeof id==='number','numeric immediate');});
 const immediate=setImmediate(()=>ticks++);clearImmediate(immediate);await new Promise(resolve=>queueMicrotask(resolve));check(ticks===0,'canceled callbacks');
 const target=new EventTarget();let count=0;target.addEventListener('x',e=>{count++;e.preventDefault();},{once:true});check(!target.dispatchEvent(new Event('x',{cancelable:true})),'cancelable event');target.dispatchEvent(new Event('x'));check(count===1,'once');
 const ac=new AbortController();ac.abort('reason');check(ac.signal.aborted&&ac.signal.reason==='reason','abort');try{ac.signal.throwIfAborted();throw Error('missing abort throw')}catch(e){check(e==='reason','abort reason')}
 check(!AbortSignal.timeout&&!AbortSignal.any&&!AbortSignal.abort,'no abort statics');try{new AbortSignal();throw Error('constructible signal')}catch(e){check(e instanceof TypeError,'illegal signal constructor');}
 let frameTime;const frame=requestAnimationFrame(t=>frameTime=t);check(typeof frame==='number','numeric RAF');await new Promise(resolve=>setTimeout(resolve,5));check(frameTime===undefined,'RAF independent from timeout');await __hostFrame();check(typeof frameTime==='number','accepted frame');cancelAnimationFrame(requestAnimationFrame(()=>ticks++));
 Object.assign(globalThis,nativeGPU.globals);
 const gpu=nativeGPU.create(['backend=metal','avtools-event-driven=1']);const adapter=await gpu.requestAdapter();const device=await adapter.requestDevice();
 device.pushErrorScope('validation');device.createBuffer({size:4,usage:0});const error=await device.popErrorScope();check(error?.message,'GPU validation');
 const event=new GPUUncapturedErrorEvent('uncapturederror',{error});
 console.log(JSON.stringify({gpuEvent:{type:event.type,preventDefault:typeof event.preventDefault,stopImmediatePropagation:typeof event.stopImmediatePropagation,cancelable:event.cancelable},gpuError:error.constructor.name}));
 const pipeline=new GPUPipelineError('test',{reason:'validation'});check(pipeline.reason==='validation','pipeline constructor');

 device.destroy();console.log('PASS TD runtime declarations: globals, partial APIs, timers, events, RAF and Dawn constructors');globalThis.done=true;
})().catch(e=>{globalThis.failure=String(e.stack??e);globalThis.done=true;});
