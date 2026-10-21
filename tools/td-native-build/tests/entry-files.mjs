import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync,existsSync,symlinkSync,copyFileSync,renameSync} from 'node:fs';
import {execFileSync,spawn} from 'node:child_process';
import {resolve,dirname} from 'node:path';
const repo=resolve(import.meta.dirname,'../../..');
const binary=resolve(process.env.AVTOOLS_BUILD_BINARY??resolve(repo,'tools/td-native-build/target/debug/avtools-build'));
function put(root,file,text){const p=resolve(root,file);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,text);return p;}
function fixture(t){const root=mkdtempSync('/private/tmp/avtools-entry-');t.after(()=>rmSync(root,{recursive:true,force:true}));execFileSync(binary,['init',root]);return root;}
function build(file,target='chop',check=false){try{return JSON.parse(execFileSync(binary,[check?'check-file':'build-file',file,target],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));}catch(e){return JSON.parse(e.stdout);}}
function code(result){return readFileSync(result.changed.find(p=>p.endsWith('/sketch.js')),'utf8');}
function value(code){let value;new Function(code+';return onCook')()({inputs:{get:()=>7},outputs:{set:(_n,v)=>value=v}});return value;}
test('manifest-free template builds entries independently with shared helpers, ambient types and separate caches',t=>{
 const root=fixture(t);assert.equal(existsSync(resolve(root,'avtools.json')),false);
 // Unrelated media is not captured as compiler input.
 put(root,'media/clip.bin','unrelated media');
 const a=resolve(root,'sketches/channels/main.ts'),b=resolve(root,'sketches/background/main.ts');
 const ra=build(a),rb=build(b,'top');assert.equal(ra.state,'ready',JSON.stringify(ra));assert.equal(rb.state,'ready',JSON.stringify(rb));assert.equal(value(code(ra)),14);
 assert.ok(!readFileSync(resolve(dirname(ra.changed[0]),'dependencies.json'),'utf8').includes('clip.bin'));
 const shared=put(root,'sketches/shared.ts','export const factor=3;');
 const other=put(root,'sketches/other.ts','import {factor} from "./shared.ts";export function onCook(h:any){h.outputs.set("out",factor);}');
 let r=build(other);assert.equal(r.state,'ready');assert.equal(value(code(r)),3);assert.notEqual(dirname(r.changed[0]),dirname(ra.changed[0]));
 put(root,'sketches/background/main.ts','export const draw=notDefined;');assert.equal(build(b,'top').state,'error');assert.equal(build(a).state,'ready');
 put(root,'sketches/channels/math.ts','export const scale=(v:number)=>v*4;');r=build(a);assert.equal(r.state,'ready');assert.equal(value(code(r)),28);
 writeFileSync(shared,'export const factor:number="bad";');assert.equal(build(other).state,'error');assert.equal(build(a).state,'ready');
 put(root,'sketches/channels/math.ts','export const scale=(v:number)=>{fetch("x");return v;};');r=build(a);assert.equal(r.state,'error');assert.ok(r.diagnostics.some(d=>d.file.endsWith('math.ts')));
});
test('nearest tsconfig, entries excluded from include, linked helpers, and relocation',t=>{
 const root=fixture(t);put(root,'isolated/tsconfig.json',JSON.stringify({extends:'../sdk/tsconfig.json',compilerOptions:{lib:['ES2022'],module:'ESNext',moduleResolution:'Bundler',allowImportingTsExtensions:true,strict:true,noEmit:true},include:['*.d.ts']}));
 put(root,'isolated/globals.d.ts','declare const custom:number;');
 const entry=put(root,'isolated/main.ts','export function onCook(h:any){h.outputs.set("v",typeof custom==="undefined"?2:custom);}');
 let r=build(entry);assert.equal(r.state,'ready',JSON.stringify(r));assert.equal(value(code(r)),2);
 // Explicit files lists must not drag unrelated entry diagnostics into this build.
 const config=JSON.parse(readFileSync(resolve(root,'isolated/tsconfig.json')));config.files=['main.ts','globals.d.ts','unrelated.ts'];put(root,'isolated/tsconfig.json',JSON.stringify(config));put(root,'isolated/unrelated.ts','export const broken=missing;');assert.equal(build(entry).state,'ready');
 put(root,'isolated/main.ts','export function onCook(){return GPUBufferUsage.COPY_DST;}');assert.equal(build(entry).state,'error');
 const external=mkdtempSync('/private/tmp/avtools-helper-');t.after(()=>rmSync(external,{recursive:true,force:true}));put(external,'math.ts','export const n=5;');symlinkSync(external,resolve(root,'shared'));
 put(root,'isolated/main.ts','import {n} from "../shared/math.ts";export function onCook(h:any){h.outputs.set("v",n);}');r=build(entry);assert.equal(r.state,'ready');assert.equal(value(code(r)),5);
 const moved=root+'-moved';renameSync(root,moved);t.after(()=>rmSync(moved,{recursive:true,force:true}));assert.equal(build(resolve(moved,'isolated/main.ts')).state,'ready');
});
test('template creation preserves unrelated TD content and refuses collisions and symlinks',t=>{
 const root=mkdtempSync('/private/tmp/avtools-init-');t.after(()=>rmSync(root,{recursive:true,force:true}));put(root,'show.toe','keep');execFileSync(binary,['init',root]);assert.equal(readFileSync(resolve(root,'show.toe'),'utf8'),'keep');
 const source=resolve(root,'sketches/channels/main.ts');writeFileSync(source,'user edits');assert.throws(()=>execFileSync(binary,['init',root],{stdio:'pipe'}));assert.equal(readFileSync(source,'utf8'),'user edits');
 const second=mkdtempSync('/private/tmp/avtools-init-link-');t.after(()=>rmSync(second,{recursive:true,force:true}));symlinkSync('/missing-template-target',resolve(second,'sdk'));assert.throws(()=>execFileSync(binary,['init',second],{stdio:'pipe'}));assert.equal(existsSync(resolve(second,'tsconfig.json')),false);
});
test('only requested WGSL wrappers affect an entry; invalid unrelated shader does not block it',t=>{
 const root=fixture(t);const shader=resolve(root,'sketches/waves.fragFunc.wgsl');copyFileSync(resolve(repo,'apps/td-projects/starter/sketches/background/shaders/waves.fragFunc.wgsl'),shader);
 put(root,'sketches/broken.compute.wgsl','invalid shader');
 const entry=put(root,'sketches/shader.ts','import * as shader from "../generated/sketches/waves.frag.raw.generated.ts";export function draw(){return shader;}');
 let r=build(entry,'top');assert.equal(r.state,'ready',JSON.stringify(r));assert.ok(existsSync(resolve(root,'generated/sketches/waves.frag.raw.generated.ts')));
 writeFileSync(shader,'invalid shader');r=build(entry,'top');assert.equal(r.state,'error');assert.ok(r.diagnostics.some(d=>d.message.includes('waves.fragFunc.wgsl')),JSON.stringify(r));
 assert.equal(build(resolve(root,'sketches/channels/main.ts')).state,'ready');
});
test('entry watch through a macOS path alias recovers missing inputs and rebuilds shared dependencies',async t=>{
 const root=fixture(t),entry=resolve(root,'sketches/channels/main.ts');let r=build(entry);const output=r.changed.find(p=>p.endsWith('/sketch.js')),status=resolve(dirname(output),'status.json');
 const child=spawn(binary,['watch-file',entry.replace('/private/tmp/','/tmp/'),'chop'],{stdio:['ignore','pipe','pipe']});t.after(()=>child.kill('SIGTERM'));let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 const wait=async f=>{const end=Date.now()+15000;while(Date.now()<end){try{if(f())return;}catch{}await new Promise(r=>setTimeout(r,50));}throw Error(log);};
 await wait(()=>log.includes('ready:'));
 put(root,'sketches/background/main.ts','export const draw=invalid;');
 put(root,'sketches/channels/math.ts','export const scale=(v:number)=>v*5;');await wait(()=>value(readFileSync(output,'utf8'))===35);
 rmSync(entry);await wait(()=>JSON.parse(readFileSync(status)).state==='error');assert.equal(value(readFileSync(output,'utf8')),35);
 put(root,'sketches/channels/main.ts','export function onCook(h:any){h.outputs.set("v",12);}');await wait(()=>value(readFileSync(output,'utf8'))===12);
 await new Promise(r=>setTimeout(r,500));const count=(log.match(/ready:/g)||[]).length;await new Promise(r=>setTimeout(r,1000));assert.equal((log.match(/ready:/g)||[]).length,count);
});
