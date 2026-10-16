import {build} from 'esbuild';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
const file='artifacts/timing/core-benchmark.js';
await build({entryPoints:['test/timing/core-benchmark.ts'],outfile:file,bundle:true,format:'iife',platform:'neutral',target:'es2022',nodePaths:[resolve('node_modules')]});
if(process.argv[2]==='native'){
  const result=spawnSync('upstream/node-webgpu/third_party/dawn/out/avtools-v8/embedded-probe',[file],{encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024});
  const output=(result.stdout??'')+(result.stderr??'');writeFileSync('artifacts/timing/core-benchmark-native.log',output);
  const records=output.split('\n').filter(s=>s.startsWith('{"suite":"core-benchmark"')).map(JSON.parse);
  console.log(JSON.stringify(records.map(({raw,...rest})=>rest)));
  if(result.status!==0||records.length!==12)throw Error('Native benchmark failed: '+output.slice(-2000));
}else{
  const records=[];const source=readFileSync(file,'utf8');
  // Match the pure native probe: two independent realms serviced on one owner.
  // The actual TD plugin has one owner thread per TOP.
  await Promise.all(Array.from({length:2},()=>new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('Benchmark timeout')),60000);
    const box={performance,setTimeout,clearTimeout,setImmediate,clearImmediate,queueMicrotask,AbortController,AbortSignal,Event,EventTarget,crypto,console:{log:s=>records.push(JSON.parse(s)),error:console.error},__benchmarkDone:()=>{clearTimeout(timeout);box.failure?reject(Error(box.failure)):resolve();}};
    vm.runInNewContext(source,box);
  })));
  if(records.length!==12)throw Error('Incomplete benchmark');
  writeFileSync('artifacts/timing/core-benchmark-node.log',records.map(x=>JSON.stringify(x)).join('\n')+'\n');
  console.log(JSON.stringify(records.map(({raw,...rest})=>rest)));
}
