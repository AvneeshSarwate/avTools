import {launch,OfflineRunner,startBarrier,resolveBarrier,awaitBarrier} from '../mod.ts';
import fixtures from './fixtures.json';
export type Trace = {case:string,sequence:number,contextPath:string,logicalSeconds:number,kind:string,payload:unknown};
export async function runPortableSpecification(){
  const traces:Trace[][]=[];
  for(const tc of fixtures.cases){
    for(const mode of ['offline','realtime']){
      const events:Trace[]=[];
      const branches=new Map<string,{cancel():void}>();
      const execute=async(ctx:any,path:string,actions:any[])=>{
        for(const [kind,value,children] of actions){
          if(kind==='emit')events.push({case:tc.id,sequence:events.length,contextPath:path,logicalSeconds:ctx.time,kind:'emit',payload:value});
          else if(kind==='waitSec')await ctx.waitSec(value);
          else if(kind==='wait')await ctx.wait(value);
          else if(kind==='fork')branches.set(path+'/'+value,ctx.branch((child:any)=>execute(child,path+'/'+value,children)));
          else if(kind==='cancel')branches.get(path+'/'+value)!.cancel();
          else if(kind==='setBpm')ctx.setBpm(value);
          else if(kind==='startBarrier')startBarrier(value,ctx);
          else if(kind==='resolveBarrier')resolveBarrier(value,ctx);
          else if(kind==='awaitBarrier')await awaitBarrier(value,ctx);
          else if(kind==='join')await ctx.branchWait((child:any)=>execute(child,path+'/'+value,children));
          else throw new Error('Unknown fixture action '+kind);
        }
      };
      const block=(ctx:any)=>execute(ctx,'root',tc.actions);
      if(mode==='offline'){const runner=new OfflineRunner(block,{bpm:tc.bpm??60,seed:'spec'});await runner.stepSec(0.1);await runner.promise;}
      else await launch(block,{bpm:tc.bpm??60,seed:'spec'});
      if(events.length!==tc.expected.length)throw Error(`${tc.id}/${mode}: event count ${events.length}`);
      tc.expected.forEach(([path,time,payload],index)=>{
        const actual=events[index];if(actual.contextPath!==path||Math.abs(actual.logicalSeconds-Number(time))>fixtures.timeEpsilon||actual.payload!==payload)throw Error(`${tc.id}/${mode}: ${JSON.stringify(actual)}`);
      });
      traces.push(events);
    }
  }
  for(const vector of fixtures.rng.vectors){const values:number[]=[];await launch(async c=>{for(let n=0;n<vector.expected.length;n++)values.push(c.random());},{seed:vector.seed});
    if(JSON.stringify(values)!==JSON.stringify(vector.expected))throw Error('RNG vector mismatch: '+JSON.stringify(values));}
  const forked:number[][]=[],shared:number[]=[];
  await launch(async c=>{
    for(let i=0;i<2;i++)await c.branchWait(async child=>{forked.push([child.random(),child.random(),child.random()]);});
    await c.branchWait(async child=>{shared.push(child.random());},'',{rng:'shared'});
    shared.push(c.random());
    await c.branchWait(async child=>{shared.push(child.random());},'',{rng:'shared'});
  },{seed:fixtures.rng.branches.seed});
  if(JSON.stringify(forked)!==JSON.stringify(fixtures.rng.branches.forked)||JSON.stringify(shared)!==JSON.stringify(fixtures.rng.branches.shared))throw Error('Branch RNG vectors differ');
  return traces;
}
