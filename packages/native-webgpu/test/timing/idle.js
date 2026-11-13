(async()=>{
 Object.assign(globalThis,nativeGPU.globals);
 const gpu=nativeGPU.create(['backend=metal','avtools-event-driven=1']);
 const adapter=await gpu.requestAdapter(),device=await adapter.requestDevice();
 device.lost.then(()=>{});await device.queue.onSubmittedWorkDone();
 await new Promise(resolve=>setTimeout(resolve,20));
 const before=__hostStats(),start=performance.now();
 await new Promise(resolve=>setTimeout(resolve,1500));
 const after=__hostStats();
 if(after.immediateCallbacks!==before.immediateCallbacks)throw Error('Idle GPU spun its progress driver');
 if(after.timerCallbacks-before.timerCallbacks!==1)throw Error('Unexpected periodic timers');
 console.log(JSON.stringify({suite:'idle-gpu',elapsedMs:performance.now()-start,before,after,pass:true}));
 device.destroy();
})().catch(error=>{globalThis.failure=String(error.stack??error);console.error(failure);}).finally(()=>globalThis.done=true);
