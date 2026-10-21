import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,copyFileSync,mkdirSync,rmSync,statSync,renameSync,symlinkSync,cpSync} from 'node:fs';
import {execFileSync,spawn} from 'node:child_process';
import {resolve,relative} from 'node:path';
const tool=resolve(import.meta.dirname,'..'),repo=resolve(tool,'../..');
const binary=process.env.AVTOOLS_BUILD_BINARY??resolve(tool,'target/debug/avtools-build');
const env={...process.env,PATH:'/usr/bin:/bin'};
function fixture(t){const dir=mkdtempSync('/private/tmp/avtools-project-');t.after(()=>rmSync(dir,{recursive:true,force:true}));execFileSync(binary,['init',dir],{env});writeFileSync(resolve(dir,'avtools.json'),readFileSync(resolve(repo,'tools/td-native-build/tests/legacy-project.json')));return dir;}
function build(dir,command='build'){try {return JSON.parse(execFileSync(binary,[command,dir],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']}));}catch(e){return JSON.parse(e.stdout.toString());}}
const source=(dir)=>readFileSync(resolve(dir,'dist/channels.js'),'utf8');
test('offline copied template, callbacks, unchanged output, syntax/type diagnostics, last-good, relocation',t=>{
 const dir=fixture(t);let result=build(dir);assert.equal(result.state,'ready',JSON.stringify(result));
 const first=source(dir),mtime=statSync(resolve(dir,'dist/channels.js')).mtimeMs;
 let value;const callbacks=new Function(first+';return {onCook}')();callbacks.onCook({inputs:{get:()=>7},outputs:{set:(n,v)=>value=v}});assert.equal(value,14);
 assert.deepEqual(build(dir).changed,[]);assert.equal(statSync(resolve(dir,'dist/channels.js')).mtimeMs,mtime);
 const path=resolve(dir,'sketches/channels/math.ts');writeFileSync(path,'export const scale = (value: number): number => "bad";');
 result=build(dir);assert.equal(result.state,'error');assert.ok(result.diagnostics.some(d=>d.code===2322&&d.line===1));assert.equal(source(dir),first);
 writeFileSync(path,'export const scale = ;');result=build(dir);assert.equal(result.state,'error');assert.ok(result.diagnostics.some(d=>d.line===1));assert.equal(source(dir),first);
 writeFileSync(path,'export const scale = (value: number): number => value * 3;');assert.equal(build(dir,'check').state,'ready');assert.equal(source(dir),first);assert.equal(build(dir).state,'ready');assert.notEqual(source(dir),first);
 const moved=dir+'-relocated';renameSync(dir,moved);t.after(()=>rmSync(moved,{recursive:true,force:true}));assert.equal(build(moved).state,'ready');
});
test('four existing shader generators in QuickJS, WGSL text imports, invalid/deleted shaders',t=>{
 const dir=fixture(t),shaders=resolve(dir,'sketches/shaders');mkdirSync(shaders);
 copyFileSync(resolve(repo,'apps/td-projects/starter/sketches/particles/shaders/dot.material.wgsl'),resolve(shaders,'dot.material.wgsl'));
 copyFileSync(resolve(repo,'apps/td-projects/starter/sketches/background/shaders/waves.fragFunc.wgsl'),resolve(shaders,'waves.fragFunc.wgsl'));
 writeFileSync(resolve(shaders,'basic.strokeMaterial.wgsl'),'struct Uniforms { color: vec4f }; fn vertShader(position: vec2f, uv: vec2f, normal: vec2f, side: f32, arcLength: f32, normalizedArc: f32, miterFactor: f32, uniforms: Uniforms) -> vec2f { return position; } fn fragShader(uv: vec2f, normal: vec2f, side: f32, arcLength: f32, normalizedArc: f32, miterFactor: f32, uniforms: Uniforms) -> vec4f { return uniforms.color; }');
 writeFileSync(resolve(shaders,'step.compute.wgsl'),'@group(0) @binding(0) var<storage, read_write> values: array<f32>; @compute @workgroup_size(1) fn main(@builtin(global_invocation_id) id: vec3u) { values[id.x] = 1.0; }');
 writeFileSync(resolve(shaders,'plain.wgsl'),'// plain source');
 writeFileSync(resolve(dir,'sketches/background/main.ts'),'import source from "../shaders/plain.wgsl"; export function draw(){return source;}');
 const result=build(dir);assert.equal(result.state,'ready',JSON.stringify(result));
 for(const name of ['dot.material','waves.frag','basic.strokeMaterial','step.compute'])assert.match(readFileSync(resolve(dir,'generated/sketches/shaders',name+'.raw.generated.ts'),'utf8'),/Auto-generated/);
 const first=source(dir);writeFileSync(resolve(shaders,'waves.fragFunc.wgsl'),'this is invalid wgsl');assert.equal(build(dir).state,'error');assert.equal(source(dir),first);
 rmSync(resolve(shaders,'waves.fragFunc.wgsl'));assert.equal(build(dir).state,'ready');assert.throws(()=>statSync(resolve(dir,'generated/sketches/shaders/waves.frag.raw.generated.ts')));
});
test('watch handles atomic saves, failed checks, missing files and recovery; idle outputs are stable',async t=>{
 const dir=fixture(t),child=spawn(binary,['watch',dir],{env,stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);t.after(()=>child.kill('SIGTERM'));
 const wait=async predicate=>{const end=Date.now()+15000;while(Date.now()<end){try{if(predicate())return;}catch{}await new Promise(r=>setTimeout(r,50));}throw Error(log);};
 await wait(()=>source(dir).includes('value * 2'));
 const first=source(dir),path=resolve(dir,'sketches/channels/math.ts');
 writeFileSync(path+'.save','export const scale = (value:number):number => value * 7;');renameSync(path+'.save',path);
 await wait(()=>source(dir).includes('value * 7'));const good=source(dir);
 rmSync(path);await wait(()=>JSON.parse(readFileSync(resolve(dir,'.avtools/status.json'))).state==='error');assert.equal(source(dir),good);
 writeFileSync(path,'export const scale = (value:number):number => value * 9;');await wait(()=>source(dir).includes('value * 9'));assert.notEqual(source(dir),first);
 await wait(()=>log.includes(JSON.parse(readFileSync(resolve(dir,'.avtools/status.json'))).revision.slice(0,12)));
 const count=(log.match(/ready:/g)??[]).length;await new Promise(r=>setTimeout(r,1200));assert.equal((log.match(/ready:/g)??[]).length,count,'watch should become idle');
});
test('entry contract and transitive raw library bundling',t=>{
 const dir=fixture(t),path=resolve(dir,'sketches/background/main.ts');
 assert.equal(build(dir).state,'ready');const good=readFileSync(resolve(dir,'dist/background.js'),'utf8');
 for(const code of ['export function draw(){return import("./missing.ts")}', 'export function setup(){}']) {
  writeFileSync(path,code);assert.equal(build(dir).state,'error',code);assert.equal(readFileSync(resolve(dir,'dist/background.js'),'utf8'),good);
 }
 writeFileSync(path,'import {StyledShape} from "@avtools/power2d/raw";export function draw(){return StyledShape}');
 const result=build(dir);assert.equal(result.state,'ready',JSON.stringify(result));
});

test('an edit during an in-flight snapshot build cannot replace last-good output',async t=>{
 const dir=fixture(t);assert.equal(build(dir).state,'ready');const good=source(dir);
 const path=resolve(dir,'sketches/channels/math.ts');writeFileSync(path,'export const scale = (value:number):number => value * 3;');
 const child=spawn(binary,['build',dir],{env,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);t.after(()=>child.kill('SIGTERM'));
 const done=new Promise(resolve=>child.once('exit',resolve));
 const deadline=Date.now()+10000;let captured=false;
 while(Date.now()<deadline){try{statSync(resolve(dir,'.avtools/session'));captured=true;break;}catch{}await new Promise(r=>setTimeout(r,1));}
 assert.ok(captured,'build must capture its session before the racing edit');
 writeFileSync(path,'export const scale = (value:number):number => value * 11;');
 await done;const result=JSON.parse(output);assert.equal(result.state,'stale');assert.equal(source(dir),good);
 assert.equal(build(dir).state,'ready');assert.match(source(dir),/value \* 11/);
});

function put(dir,path,text){const full=resolve(dir,path);mkdirSync(resolve(full,'..'),{recursive:true});writeFileSync(full,text);}
function evaluateChannels(dir){let value;new Function(source(dir)+';return {onCook}')().onCook({inputs:{get:()=>7},outputs:{set:(_n,v)=>value=v}});return value;}
test('npm ESM exports, CommonJS, JSON, package imports and external aliases in one bundle',t=>{
 const dir=fixture(t), external=mkdtempSync('/private/tmp/avtools-library-');t.after(()=>rmSync(external,{recursive:true,force:true}));
 put(dir,'node_modules/esm-math/package.json',JSON.stringify({name:'esm-math',type:'module',exports:{'.':{types:'./index.d.ts',import:'./index.js',default:'./wrong.js'}}}));
 put(dir,'node_modules/esm-math/index.js','export const add = (a,b) => a+b;');
 put(dir,'node_modules/esm-math/index.d.ts','export declare function add(a:number,b:number):number;');
 put(dir,'node_modules/cjs-math/package.json',JSON.stringify({name:'cjs-math',main:'index.cjs',types:'index.d.ts'}));
 put(dir,'node_modules/cjs-math/index.cjs',"const config=require('./config.json');module.exports={factor:config.factor};");
 put(dir,'node_modules/cjs-math/config.json','{"factor":3}');
 put(dir,'node_modules/cjs-math/index.d.ts','declare const math:{factor:number};export = math;');
 put(external,'helper.ts','export const extra=5;');
 put(dir,'package.json',JSON.stringify({type:'module',imports:{'#offset':'./offset.ts'}}));put(dir,'offset.ts','export const offset=2;');
 const config=JSON.parse(readFileSync(resolve(dir,'tsconfig.json')));config.compilerOptions.paths={'@external/*':[external+'/*']};writeFileSync(resolve(dir,'tsconfig.json'),JSON.stringify(config));
 // Keep the starter's SDK aliases inherited; overriding paths replaces them, so avoid host type imports in this test.
 put(dir,'sketches/background/main.ts','export function draw(){}');
 put(dir,'sketches/channels/main.ts',`import {add} from 'esm-math';import math from 'cjs-math';import {extra} from '@external/helper';import {offset} from '#offset';export function onCook(host:any){host.outputs.set('value',add(host.inputs.get('value')*math.factor,extra+offset));}`);
 let result=build(dir);assert.equal(result.state,'ready',JSON.stringify(result));assert.equal(evaluateChannels(dir),28);
 put(external,'helper.ts','export const extra=6;');result=build(dir);assert.equal(result.state,'ready',JSON.stringify(result));assert.equal(evaluateChannels(dir),29);
 // A compatible dependency is allowed to contain an unused browser-only branch.
 put(dir,'sketches/background/main.ts','declare const document:{title:string}|undefined;export function draw(){if(typeof document!=="undefined")return document.title;}');assert.equal(build(dir).state,'ready');
});
test('workspace symlinks, pnpm-style package layout, external relative imports and config extends',t=>{
 const dir=fixture(t),external=mkdtempSync('/private/tmp/avtools-workspace-');t.after(()=>rmSync(external,{recursive:true,force:true}));
 put(external,'package.json',JSON.stringify({name:'linked-math',type:'module',exports:'./index.ts'}));
 put(external,'index.ts','export const linked=13;');put(external,'config.json',JSON.stringify({compilerOptions:{strict:true}}));
 put(dir,'node_modules/.pnpm/local@1/node_modules/local/package.json','{"name":"local","main":"index.js","types":"index.d.ts"}');
 put(dir,'node_modules/.pnpm/local@1/node_modules/local/index.js','exports.value=3;');put(dir,'node_modules/.pnpm/local@1/node_modules/local/index.d.ts','export declare const value:number;');
 symlinkSync('.pnpm/local@1/node_modules/local',resolve(dir,'node_modules/local'),'dir');symlinkSync(external,resolve(dir,'node_modules/linked-math'),'dir');
 const config=JSON.parse(readFileSync(resolve(dir,'tsconfig.json')));config.extends=[external+'/config.json','./sdk/tsconfig.json'];writeFileSync(resolve(dir,'tsconfig.json'),JSON.stringify(config));
 put(external,'relative.ts','export const extra=5;');
 put(dir,'sketches/channels/main.ts',`import {linked} from 'linked-math';import {value} from 'local';import {extra} from '${relative(resolve(dir,'sketches/channels'),external)}/relative.ts';export function onCook(host:any){host.outputs.set('value',linked+value+extra);}`);
 const result=build(dir);assert.equal(result.state,'ready',JSON.stringify(result));assert.equal(evaluateChannels(dir),21);
});
test('external package watcher follows edits, metadata, deletion/recreation and missing dependency installation',async t=>{
 const dir=fixture(t),external=mkdtempSync('/private/tmp/avtools-linked-watch-');t.after(()=>rmSync(external,{recursive:true,force:true}));
 put(external,'package.json','{"name":"linked","type":"module","exports":"./index.ts"}');put(external,'index.ts','export const scale=(value:number)=>value*3;');
 mkdirSync(resolve(dir,'node_modules'));symlinkSync(external,resolve(dir,'node_modules/linked'),'dir');
 put(dir,'sketches/channels/math.ts',"export {scale} from 'linked';");
 const child=spawn(binary,['watch',dir],{env,stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);t.after(()=>child.kill('SIGTERM'));
 const wait=async predicate=>{const end=Date.now()+20000;while(Date.now()<end){try{if(predicate())return;}catch{}await new Promise(r=>setTimeout(r,50));}throw Error(log);};
 await wait(()=>evaluateChannels(dir)===21);
 put(external,'index.ts.save','export const scale=(value:number)=>value*4;');renameSync(resolve(external,'index.ts.save'),resolve(external,'index.ts'));await wait(()=>evaluateChannels(dir)===28);
 const good=source(dir);rmSync(resolve(external,'index.ts'));await wait(()=>JSON.parse(readFileSync(resolve(dir,'.avtools/status.json'))).state==='error');assert.equal(source(dir),good);
 put(external,'next.ts','export const scale=(value:number)=>value*5;');put(external,'package.json','{"name":"linked","type":"module","exports":"./next.ts"}');await wait(()=>evaluateChannels(dir)===35);
 put(external,'next.ts',"export {scale} from 'new-math';");await wait(()=>JSON.parse(readFileSync(resolve(dir,'.avtools/status.json'))).state==='error');
 put(external,'node_modules/new-math/package.json','{"name":"new-math","types":"index.d.ts","main":"index.js"}');put(external,'node_modules/new-math/index.d.ts','export declare const scale:(value:number)=>number;');put(external,'node_modules/new-math/index.js','exports.scale=value=>value*6;');await wait(()=>evaluateChannels(dir)===42);
 await new Promise(r=>setTimeout(r,600));const count=(log.match(/ready:/g)??[]).length;await new Promise(r=>setTimeout(r,1200));assert.equal((log.match(/ready:/g)??[]).length,count,'external watcher should become idle');
});

test('real installed earcut package and separate @types resolve without SDK aliases',t=>{
 const dir=fixture(t);mkdirSync(resolve(dir,'node_modules/@types'),{recursive:true});
 for(const name of ['earcut','@types/earcut'])cpSync(resolve(repo,'packages/native-webgpu/node_modules',name),resolve(dir,'node_modules',name),{recursive:true});
 const config=JSON.parse(readFileSync(resolve(dir,'tsconfig.json')));config.compilerOptions.paths={};writeFileSync(resolve(dir,'tsconfig.json'),JSON.stringify(config));
 put(dir,'sketches/background/main.ts','export function draw(){}');
 put(dir,'sketches/channels/main.ts',"import earcut from 'earcut';export function onCook(host:any){const indices=earcut([0,0,1,0,1,1,0,1]);host.outputs.set('value',indices.length);}");
 const result=build(dir);assert.equal(result.state,'ready',JSON.stringify(result));assert.equal(evaluateChannels(dir),6);
});


test('a later entry bundling error preserves every last-good bundle',t=>{
 const dir=fixture(t);assert.equal(build(dir).state,'ready');
 const good=source(dir),background=readFileSync(resolve(dir,'dist/background.js'),'utf8');
 put(dir,'sketches/background/main.ts','export function draw(){return 42;}');
 // Ambient declarations allow checking; runtime resolution must still reject Node built-ins.
 put(dir,'sketches/node.d.ts','declare module "node:fs" { export function readFileSync(path:string):string; }');
 put(dir,'sketches/channels/main.ts','import {readFileSync} from "node:fs";export function onCook(){return readFileSync("file");}');
 const result=build(dir);assert.equal(result.state,'error');assert.match(JSON.stringify(result.diagnostics),/node:fs/);
 assert.deepEqual(result.changed,[]);assert.equal(source(dir),good);assert.equal(readFileSync(resolve(dir,'dist/background.js'),'utf8'),background);
});
