(async()=>{
 const assert=(condition,message)=>{if(!condition)throw Error(message);};
 const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const order=[];
 setImmediate(()=>{order.push('A');Promise.resolve().then(()=>order.push('microtask'));setImmediate(()=>order.push('C'));});
 setImmediate(()=>order.push('B'));
 await sleep(12);assert(order.join(',')==='A,microtask,B,C','callback checkpoint/turn ordering: '+order);
 let fired=0;const canceled=setTimeout(()=>fired++,1);clearTimeout(canceled);clearTimeout(canceled);
 const ids=new Set();for(let i=0;i<10000;i++){const id=setTimeout(()=>fired++,10000);assert(!ids.has(id),'handle reused');ids.add(id);clearTimeout(id);}
 const before=performance.now();await new Promise(resolve=>setTimeout((a,b)=>{assert(a===42&&b==='ok','timeout arguments');resolve();},2.8,42,'ok'));
 assert(performance.now()-before>=2,'early timer');assert(!fired,'canceled timer');
 for(const delay of [0,-10,NaN,2147483648]){
   const begin=performance.now();await new Promise(resolve=>setTimeout(resolve,delay));
   assert(performance.now()-begin>=1,'normalized timer fired early');
 }
 for(const schedule of [setTimeout,setImmediate,queueMicrotask]){let threw=false;try{schedule(null);}catch(e){threw=e instanceof TypeError;}assert(threw,'callback validation missing');}
 let selection=0,later;setTimeout(()=>clearTimeout(later),1);later=setTimeout(()=>selection++,1);await sleep(5);assert(selection===0,'cancellation before due-task selection');
 assert(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(crypto.randomUUID()),'UUID v4');
 assert(new Set(Array.from({length:1000},()=>crypto.randomUUID())).size===1000,'UUID uniqueness');
 const abort=new AbortController(),events=[];const removed=()=>events.push('removed');
 abort.signal.addEventListener('abort',()=>{events.push('first');abort.signal.removeEventListener('abort',removed);abort.signal.addEventListener('abort',()=>events.push('late'));},{once:true});
 abort.signal.addEventListener('abort',removed);abort.signal.onabort=()=>events.push('onabort');
 abort.abort('reason');abort.abort('other');assert(events.join(',')==='first,onabort','abort dispatch mutation: '+events);assert(abort.signal.reason==='reason','abort reason');
 try{abort.signal.throwIfAborted();throw Error('did not throw');}catch(e){assert(e==='reason','throwIfAborted');}
 if(globalThis.__hostGeneration){
   const errors=[];globalThis.__hostError=(error,generation)=>errors.push({error:String(error),generation});
   const seen=[];let resolveOld;
   const owner=__hostRegister();__hostGeneration(owner);
   const old=new Promise(resolve=>{resolveOld=resolve;});
   const continuation=(async()=>{await old;seen.push(['await',__hostGeneration()]);setTimeout(()=>seen.push(['stale',0]),1);})();
   Promise.resolve().then(()=>seen.push(['then',__hostGeneration()]));
   queueMicrotask(()=>seen.push(['microtask',__hostGeneration()]));
   setTimeout(()=>{seen.push(['timer',__hostGeneration()]);},1);
   __hostGeneration(0);await sleep(5);__hostInvalidate(owner);resolveOld();await continuation;await sleep(5);
   assert(seen.every(x=>x[1]===owner)&&seen.length===4,'continuation ownership: '+JSON.stringify(seen));
   const errorsOwner=__hostRegister();__hostGeneration(errorsOwner);queueMicrotask(()=>{throw Error('microtask-error');});Promise.reject(Error('handled')).catch(()=>{});Promise.reject(Error('unhandled'));__hostGeneration(0);
   await sleep(5);assert(errors.length===2&&errors.every(x=>x.generation===errorsOwner),'exception vs rejection ownership: '+JSON.stringify(errors));
   __hostInvalidate(errorsOwner);
   for(let cycle=0;cycle<10000;cycle++){const id=__hostRegister();__hostGeneration(id);setTimeout(()=>{},60000);setImmediate(()=>{});__hostGeneration(0);__hostInvalidate(id);}
   assert(__hostStats().generations===0&&__hostStats().tasks===0,'generation churn leaked tasks');
   const rejected=[];const handler=e=>{e.preventDefault();rejected.push(e.reason);};addEventListener('unhandledrejection',handler);Promise.reject('observed');await sleep(5);removeEventListener('unhandledrejection',handler);assert(rejected[0]==='observed'&&errors.length===2,'rejection observer');
 }
 console.log('HOST CONFORMANCE PASS');
})().catch(error=>{globalThis.failure=String(error.stack??error);console.error(failure);}).finally(()=>{globalThis.done=true;});
