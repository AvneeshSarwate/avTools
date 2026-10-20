import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,copyFileSync,mkdirSync,rmSync,statSync,renameSync} from 'node:fs';
import {execFileSync,spawn} from 'node:child_process';
import {resolve} from 'node:path';
const tool=resolve(import.meta.dirname,'..'),repo=resolve(tool,'../..');
const binary=process.env.AVTOOLS_BUILD_BINARY??resolve(tool,'target/debug/avtools-build');
const env={...process.env,PATH:'/usr/bin:/bin'};
function fixture(t){const dir=mkdtempSync('/private/tmp/avtools-project-');t.after(()=>rmSync(dir,{recursive:true,force:true}));execFileSync(binary,['init',dir],{env});return dir;}
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
test('runtime guards and transitive raw library bundling',t=>{
 const dir=fixture(t),path=resolve(dir,'sketches/background/main.ts');
 assert.equal(build(dir).state,'ready');const good=readFileSync(resolve(dir,'dist/background.js'),'utf8');
 for(const code of ['export function draw(){return document.title}', 'export function draw(){return import("./palette.ts")}', 'import {launch} from "@avtools/core-timing";export function draw(){return launch}', 'export function setup(){}']) {
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
