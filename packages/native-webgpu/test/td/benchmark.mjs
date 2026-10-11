import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../../',import.meta.url));
const bundle=readFileSync(resolve(root,'build/td-plugin-path.txt'),'utf8').trim();
const args=[resolve(bundle,'Contents/MacOS/libavtools_runtime.dylib'),resolve(bundle,'Contents/Resources')];
const frames=Number(process.argv[2]??600);
function run(command,args){const child=spawn(command,args,{cwd:root,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',(code,signal)=>code===0?resolve({stdout,stderr}):reject(new Error(`${command}: ${code??signal}\n${stderr}`)));});return {child,done};}
const results={};
for(const mode of ['cpu','syphon']){
  let receiver;
  try{
    if(mode==='syphon')receiver=run(resolve(root,'build/syphon-receiver'),['--name','avTools embedded benchmark',String(frames/60+10)]);
    const result=await run(resolve(root,'build/bridge-benchmark'),[...args,mode,String(frames)]).done;
    results[mode]=JSON.parse(result.stdout.trim());
    if(receiver){const received=await receiver.done;const records=received.stdout.trim().split('\n').map(s=>JSON.parse(s)).filter(r=>r.width);assert(records.length>frames*.7,`Too few Syphon frames: ${records.length}`);for(const r of records){assert.equal(r.width,1920);assert.equal(r.height,1080);assert.deepEqual(r.top,r.bottom,'Torn or flipped corner IDs');assert.deepEqual(r.top.slice(1),[80,160,255]);}results.syphon.received=records.length;}
  }finally{receiver?.child.kill('SIGTERM');}
}
writeFileSync(resolve(root,'artifacts/embedded-benchmark.json'),JSON.stringify(results,null,2));console.log(results);
