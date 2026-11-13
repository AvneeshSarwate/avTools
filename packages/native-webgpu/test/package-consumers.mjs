// Verify prebuilt consumers with no development tools reachable through PATH.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const temp=mkdtempSync('/private/tmp/avtools-consumers-');
const env={...process.env,PATH:'/nonexistent'};
function run(command,args,cwd=temp){return execFileSync(command,args,{cwd,env,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});}
writeFileSync(resolve(temp,'package.json'),JSON.stringify({private:true,type:'module'}));
const npm=resolve(dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js');
run(process.execPath,[npm,'install','--offline','--ignore-scripts','--no-audit','--no-fund','--cache','/private/tmp/avtools-npm-cache',resolve(root,'avtools-native-webgpu-0.1.0.tgz')]);
writeFileSync(resolve(temp,'check.mjs'),`import assert from 'node:assert/strict';
import {createGPU,P5GPU} from '@avtools/native-webgpu';
const gpu=createGPU(),adapter=await gpu.requestAdapter();assert(adapter&&!adapter.info.isFallbackAdapter);
const device=await adapter.requestDevice();const p=new P5GPU(device,{width:128,height:64});
try {p.beginFrame();p.background(0,20,80);p.fill(255);p.textSize(22);p.text('installed',5,30);p.endFrame();await p.loadPixels();assert(p.pixels.some(v=>v===255));assert.equal(p.pixels[2],80);console.log(JSON.stringify({passed:true,node:process.version,path:process.env.PATH}));}finally{p.dispose();device.destroy();}`);
const nodeResult=JSON.parse(run(process.execPath,['check.mjs']).trim());
writeFileSync(resolve(temp,'check.mts'),`import {P5GPU,createGPU,SyphonChannel,type P5GPUImage} from '@avtools/native-webgpu';
import type {Draw,OnPulse,SketchFrame} from '@avtools/native-webgpu/td-sketch';
const draw:Draw=(p,f)=>{p.image(f.top(0)!,0,0);p.circle(0,0,f.chop('radius'));};
const pulse:OnPulse=(name,p,f)=>{if(name==='Trigger')p.circle(0,0,f.chop('missing'));};
const gpu:GPU=createGPU();void gpu;void draw;void pulse;void P5GPU;void SyphonChannel;`);
run(process.execPath,[resolve(root,'node_modules/typescript/bin/tsc'),'--strict','--noEmit','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext','--allowImportingTsExtensions','check.mts']);
const unpack=resolve(temp,'td');mkdirSync(unpack);
run('/usr/bin/ditto',['-x','-k',resolve(root,'artifacts/avtools-sketch-macos-arm64-0.1.0.zip'),unpack]);
const release=resolve(unpack,'avtools-sketch-macos-arm64');
const bundle=resolve(release,'Plugins',readdirSync(resolve(release,'Plugins')).find(s=>s.endsWith('.plugin')));
run('/usr/bin/codesign',['--verify','--deep','--strict',bundle]);
for(const file of ['AvToolsSketch','libavtools_runtime.dylib']){const deps=run('/usr/bin/otool',['-L',resolve(bundle,'Contents/MacOS',file)]).split('\n').slice(1).join('\n');assert(!deps.includes('/Users/'),'Build-machine dependency leaked into plugin');}
const bridge=run(resolve(root,'build/bridge-probe'),[resolve(bundle,'Contents/MacOS/libavtools_runtime.dylib'),resolve(bundle,'Contents/Resources')]);
writeFileSync(resolve(root,'artifacts/td/clean-runtime.log'),bridge);
const output=run(resolve(root,'build/touchengine-probe'),[resolve(release,'Sketch.tox'),'60','--sketch'],release);
writeFileSync(resolve(root,'artifacts/td/clean-package.jsonl'),output);
const records=output.trim().split('\n').map(JSON.parse);
for(let i=0;i<2;i++){const frames=records.filter(r=>r.output===`op/out${i+1}`);assert.equal(frames.length,60);for(const r of frames){assert.equal(r.width,191+i*16);assert.equal(r.height,79+i*8);const red=r.center[r.pixelFormat===80?2:0];assert.equal(red,r.frame<45?40:90);}}
const result={passed:true,temp,node:nodeResult,declarations:true,tdBundle:bundle,tdFramesPerOutput:60,buildToolsPath:env.PATH};
writeFileSync(resolve(root,'artifacts/package-consumers.json'),JSON.stringify(result,null,2));console.log(result);
