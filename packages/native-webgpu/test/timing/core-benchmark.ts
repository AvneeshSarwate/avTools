import {launch} from '../../../core-timing/mod.ts';
const g=globalThis as any;
const summary=(raw:number[])=>{const v=[...raw].sort((a,b)=>a-b);return {count:v.length,p50:v[Math.floor(v.length*.5)],p95:v[Math.floor(v.length*.95)],p99:v[Math.floor(v.length*.99)],max:v[v.length-1]};};
(async()=>{
  for(const hz of [60,240,1000]){
    const raw:number[]=[];
    await launch(async c=>{const start=performance.now();for(let n=0;n<hz*2;n++){await c.waitSec(1/hz);raw.push(performance.now()-start-c.time*1000);}},{seed:'benchmark'});
    console.log(JSON.stringify({suite:'core-benchmark',case:'single-'+hz,latenessMs:summary(raw),raw}));
  }
  for(const mode of ['branches','roots','tempo']){
    const raw:number[]=[];
    if(mode==='branches')await launch(async c=>{
      const start=performance.now();await Promise.all(Array.from({length:64},()=>c.branchWait(async child=>{
        for(let n=0;n<20;n++){await child.waitSec(.005);raw.push(performance.now()-start-child.time*1000);}
      })));
    },{seed:'benchmark'});
    else if(mode==='roots')await Promise.all(Array.from({length:64},()=>launch(async c=>{
      const start=performance.now();for(let n=0;n<20;n++){await c.waitSec(.005);raw.push(performance.now()-start-c.time*1000);}
    },{seed:'benchmark'})));
    else await launch(async c=>{
      const start=performance.now();for(let n=0;n<60;n++){c.setBpm(n%2?240:60);await c.wait(.02);raw.push(performance.now()-start-c.time*1000);}
    },{seed:'benchmark'});
    if(raw.length!==(mode==='tempo'?60:1280))throw Error('Incomplete workload');
    console.log(JSON.stringify({suite:'core-benchmark',case:mode,latenessMs:summary(raw),raw}));
  }
})().catch(error=>{g.failure=String(error.stack??error);console.error(g.failure);}).finally(()=>{g.done=true;g.__benchmarkDone?.();});
