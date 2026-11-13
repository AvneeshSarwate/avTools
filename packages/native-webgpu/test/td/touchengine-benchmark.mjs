// Real TD engine, pixel-checked CPU versus Syphon output. No editor automation.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const frames=Number(process.argv[2]??600);
const results={};
for(const mode of ['cpu','syphon']){
  const result=await new Promise((resolveResult,reject)=>{
    const child=spawn(resolve(root,'build/touchengine-probe'),[resolve(root,'artifacts/td/sketch-benchmark.tox'),String(frames),`--bench-${mode}`]);
    let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
    const timer=setTimeout(()=>child.kill('SIGTERM'),frames/60*1000+60000);
    child.on('error',reject);child.on('exit',(code,signal)=>{clearTimeout(timer);writeFileSync(resolve(root,`artifacts/td/benchmark-${mode}.jsonl`),stdout);writeFileSync(resolve(root,`artifacts/td/benchmark-${mode}.log`),stderr);code===0?resolveResult({stdout,stderr}):reject(new Error(`${code??signal}: ${stderr}`));});
  });
  const records=result.stdout.trim().split('\n').map(JSON.parse).filter(r=>r.output==='op/out1'&&r.frame>=30);
  assert.equal(records.length,frames-30);
  let previous;
  const lags=[];
  for(const r of records){
    assert.equal(r.width,1920);assert.equal(r.height,1080);
    const convert=p=>r.pixelFormat===80?[p[2],p[1],p[0],p[3]]:p;
    const rgba=convert(r.visualTop);
    // TouchEngine exposes texture origin metadata; normalize before comparing.
    assert.deepEqual(convert(r.visualBottom),[rgba[0],80,160,255],'Torn frame or vertical flip');
    assert.deepEqual(rgba.slice(1),[40,200,255],`Orientation/format at frame ${r.frame}: ${rgba}`);
    const lag=((r.frame+1)-rgba[0]+256)%256;
    assert(lag<=6,`Stale/out-of-order image: frame ${r.frame}, pixel ID ${rgba[0]}, lag ${lag}`);
    // CPU output is buffered by default; both transports may show a prior frame.
    if(previous!==undefined)assert((rgba[0]-previous+256)%256<=7,'Frame identifiers went backwards');
    previous=rgba[0];lags.push(lag);
  }
  const times=records.map(r=>r.cookMs).sort((a,b)=>a-b);
  const seconds=Number(result.stderr.match(/Measured frame-loop seconds: ([\d.]+)/)?.[1]);assert(seconds>0);
  results[mode]={frames,checkedFrames:records.length,seconds,fps:frames/seconds,cookMeanMs:times.reduce((a,b)=>a+b,0)/times.length,cookP95Ms:times[Math.floor(times.length*.95)],maxFrameLag:Math.max(...lags)};
}
writeFileSync(resolve(root,'artifacts/td/embedded-td-benchmark.json'),JSON.stringify(results,null,2));console.log(results);
