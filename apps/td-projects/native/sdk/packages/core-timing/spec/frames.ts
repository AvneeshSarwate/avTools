import {launchBrowser} from '../mod.ts';
/** Controlled frame source tests subscription lifetime without claiming wall-time parity. */
export async function runFrameSpecification(){
 const g=globalThis as any,originalRAF=g.requestAnimationFrame,originalCancel=g.cancelAnimationFrame;
 const pending=new Map<number,Function>();let sequence=0,ticks=0;
 g.requestAnimationFrame=(fn:Function)=>{pending.set(++sequence,fn);return sequence;};g.cancelAnimationFrame=(id:number)=>pending.delete(id);
 try{
  const root=launchBrowser(async c=>{await c.waitFrame();ticks++;await c.waitFrame();ticks++;});
  if(pending.size!==1)throw Error('Frame subscription missing');
  const turn=[...pending.values()];pending.clear();turn.forEach(fn=>fn(0));
  await new Promise(resolve=>setTimeout(resolve,5));
  if(ticks!==1||pending.size!==1)throw Error('Frame continuation subscription failed');
  root.cancel();await root.catch(()=>{});
  if(pending.size)throw Error('Canceled frame subscription leaked');
  let shared=0;
  const multiple=launchBrowser(async c=>{
    await Promise.all([c.branchWait(async child=>{await (child as any).waitFrame();shared++;}),c.branchWait(async child=>{await (child as any).waitFrame();shared++;})]);
  });
  if(pending.size!==1)throw Error('Multiple waiters should share one frame subscription');
  const sharedTurn=[...pending.values()];pending.clear();sharedTurn.forEach(fn=>fn(8));await multiple;
  if(shared!==2||pending.size)throw Error('Multiple frame waiters did not settle');
  const once=launchBrowser(async c=>{await c.waitFrame();});
  const next=[...pending.values()];pending.clear();next.forEach(fn=>fn(10));await once;
  if(pending.size)throw Error('Completed frame subscription leaked');
 }finally{g.requestAnimationFrame=originalRAF;g.cancelAnimationFrame=originalCancel;}
}
