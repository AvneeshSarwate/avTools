import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,stat,copyFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {loadProject,buildProject,watchProject,toolRoot,repoRoot} from '../runner.mjs';

const quiet={log:()=>{}};
async function fixture(t){
  await mkdir(resolve(toolRoot,'build'),{recursive:true});
  const root=await mkdtemp(resolve(toolRoot,'build/test-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(resolve(root,'sketches'),{recursive:true});
  await writeFile(resolve(root,'td-sketches.config.ts'),`export default {sketches:{a:'sketches/a.ts',b:'sketches/b.ts'}}`);
  await writeFile(resolve(root,'tsconfig.json'),JSON.stringify({extends:'./.td/tsconfig.paths.json',compilerOptions:{target:'ES2022',module:'ESNext',moduleResolution:'Bundler',strict:true,noEmit:true,allowImportingTsExtensions:true,skipLibCheck:true,lib:['ES2022','DOM']},include:['sketches/**/*.ts','generated/**/*.ts']}));
  await writeFile(resolve(root,'sketches/shared.ts'),'export const value=12;');
  for(const name of ['a','b'])await writeFile(resolve(root,`sketches/${name}.ts`),`import {value} from './shared.ts'; export function draw(p:any){p.background(value)}; export function onPulse(name:string){return name}`);
  return await loadProject(resolve(root,'td-sketches.config.ts'));
}
const bundle=(p,name='a')=>readFile(resolve(p.outDir,name+'.js'),'utf8');

test('callbacks, unchanged outputs, transitive helpers, and last-good build on errors',async t=>{
  const p=await fixture(t);
  assert.deepEqual((await buildProject(p,quiet)).changed,['a','b']);
  const first=await bundle(p);let pixel;
  const callbacks=new Function(first+';return {setup,draw,onPulse}')();callbacks.draw({background:value=>pixel=value});
  assert.equal(pixel,12);assert.equal(callbacks.onPulse('Trigger'),'Trigger');
  const modified=(await stat(resolve(p.outDir,'a.js'))).mtimeMs;
  assert.deepEqual((await buildProject(p,quiet)).changed,[]);
  assert.equal((await stat(resolve(p.outDir,'a.js'))).mtimeMs,modified);
  await writeFile(resolve(p.root,'sketches/shared.ts'),'export const value=27;');
  assert.deepEqual((await buildProject(p,quiet)).changed,['a','b']);
  const good=await bundle(p);
  await writeFile(resolve(p.root,'sketches/a.ts'),'export const draw: number = "wrong";');
  await assert.rejects(buildProject(p,quiet),/not assignable/);assert.equal(await bundle(p),good);
  await writeFile(resolve(p.root,'sketches/a.ts'),'import {readFile} from "node:fs"; export function draw(){ return readFile; }');
  await assert.rejects(buildProject(p,quiet),/node:fs/);assert.equal(await bundle(p),good);
  await writeFile(resolve(p.root,'sketches/a.ts'),'import {launch} from "@avtools/core-timing"; export function draw(){return launch;}');
  await buildProject(p,quiet);assert.match(await bundle(p),/TimeScheduler/);
  await writeFile(resolve(p.root,'sketches/a.ts'),'export function draw(){return document.title;}');
  await assert.rejects(buildProject(p,quiet),/document is unavailable/);
  await writeFile(resolve(p.root,'sketches/a.ts'),'export function draw(){return import("./shared.ts");}');
  await assert.rejects(buildProject(p,quiet),/runtime import/);
  await writeFile(resolve(p.root,'sketches/a.ts'),'export function setup(){}');
  await assert.rejects(buildProject(p,quiet),/must export draw/);
});

test('four raw shader generators, plain WGSL, broken shader recovery and deletion',async t=>{
  const p=await fixture(t),shaders=resolve(p.root,'sketches');
  await copyFile(resolve(repoRoot,'apps/td-projects/starter/sketches/particles/shaders/dot.material.wgsl'),resolve(shaders,'dot.material.wgsl'));
  await copyFile(resolve(repoRoot,'apps/td-projects/starter/sketches/background/shaders/waves.fragFunc.wgsl'),resolve(shaders,'waves.fragFunc.wgsl'));
  await writeFile(resolve(shaders,'basic.strokeMaterial.wgsl'),`struct Uniforms { color: vec4f }; fn vertShader(position: vec2f, uv: vec2f, normal: vec2f, side: f32, arcLength: f32, normalizedArc: f32, miterFactor: f32, uniforms: Uniforms) -> vec2f { return position; } fn fragShader(uv: vec2f, normal: vec2f, side: f32, arcLength: f32, normalizedArc: f32, miterFactor: f32, uniforms: Uniforms) -> vec4f { return uniforms.color; }`);
  await writeFile(resolve(shaders,'step.compute.wgsl'),'@group(0) @binding(0) var<storage, read_write> values: array<f32>; @compute @workgroup_size(1) fn main(@builtin(global_invocation_id) id: vec3u) { values[id.x] = 1.0; }');
  await writeFile(resolve(shaders,'plain.wgsl'),'// embedded source');
  await writeFile(resolve(shaders,'wgsl.d.ts'),'declare module "*.wgsl" { const source: string; export default source; }');
  await writeFile(resolve(shaders,'a.ts'),'import source from "./plain.wgsl"; export function draw(){return source}');
  await buildProject(p,quiet);
  for(const name of ['dot.material','waves.frag','basic.strokeMaterial','step.compute'])assert.match(await readFile(resolve(p.generatedDir,'sketches',name+'.raw.generated.ts'),'utf8'),/Auto-generated/);
  const good=await bundle(p);
  await writeFile(resolve(shaders,'waves.fragFunc.wgsl'),'this is invalid wgsl');
  await assert.rejects(buildProject(p,quiet));assert.equal(await bundle(p),good);
  await rm(resolve(shaders,'waves.fragFunc.wgsl'));await buildProject(p,quiet);
  await assert.rejects(stat(resolve(p.generatedDir,'sketches/waves.frag.raw.generated.ts')),/ENOENT/);
});

test('watcher sees atomic saves, helper edits and recovery without restarting',async t=>{
  const p=await fixture(t);let events=[];
  const watcher=await watchProject(p.configPath,{...quiet,onBuild:(error,result)=>events.push({error,result})});
  t.after(()=>watcher.close());
  async function waitFor(predicate){const start=Date.now();while(!events.some(predicate)){if(Date.now()-start>15000)throw Error('Watcher did not report expected build');await new Promise(r=>setTimeout(r,50));}return events.find(predicate);}
  events=[];
  // atomicWrite is the same save pattern used by editors, not an in-place write.
  const {atomicWrite}=await import('../runner.mjs');
  await atomicWrite(resolve(p.root,'sketches/shared.ts'),'export const value=31;');
  await waitFor(e=>e.result?.changed.length===2);
  const good=await bundle(p);events=[];
  await atomicWrite(resolve(p.root,'sketches/a.ts'),'export const draw: number="bad"');
  await waitFor(e=>e.error);assert.equal(await bundle(p),good);events=[];
  await atomicWrite(resolve(p.root,'sketches/a.ts'),'export function draw(p:any){p.background(93)}');
  const recovery=await waitFor(e=>e.result?.changed.includes('a'));
  assert.deepEqual(recovery.result.changed,['a']);
  events=[];
  const artifact=resolve(repoRoot,'packages/native-webgpu/artifacts',`watch-ignore-${process.pid}.json`);
  await mkdir(resolve(artifact,'..'),{recursive:true});
  t.after(()=>rm(artifact,{force:true}));
  await writeFile(artifact,'{"benchmark":true}');
  await new Promise(r=>setTimeout(r,600));
  assert.equal(events.length,0,'Benchmark artifacts must not trigger a build');
  await watcher.close();
});

test('CHOP entries expose typed state callbacks, validate names, and retain last good bundle',async t=>{
  const original=await fixture(t);
  const config=resolve(original.root,'td-sketches.config.ts');
  await writeFile(config,`export default {sketches:{a:{entry:'sketches/a.ts',target:'chop',outputs:['out']},b:'sketches/b.ts'},shaderDirs:[]}`);
  await writeFile(resolve(original.root,'sketches/a.ts'),`import type {Setup,OnCook,OnPulse} from '@avtools/native-webgpu/td-chop'; export const setup:Setup=h=>{h.outputs.set('out',1)}; export const onCook:OnCook=h=>{h.outputs.set('out',h.inputs.get('value'))}; export const onPulse:OnPulse=(name,h)=>{h.outputs.set('out',name==='Trigger'?9:0)};`);
  const p=await loadProject(config);await buildProject(p,quiet);
  const first=await bundle(p);const callbacks=new Function(first+';return {setup,onCook,onPulse}')();let value=0;
  const host={inputs:{get:()=>23},outputs:{set:(_,v)=>value=v}};
  callbacks.setup(host);assert.equal(value,1);callbacks.onCook(host,{});assert.equal(value,23);callbacks.onPulse('Trigger',host);assert.equal(value,9);
  await writeFile(resolve(p.root,'sketches/a.ts'),`import type {OnCook} from '@avtools/native-webgpu/td-chop'; export const onCook:OnCook=h=>h.outputs.set('out','wrong');`);
  await assert.rejects(buildProject(p,quiet),/not assignable/);assert.equal(await bundle(p),first);
  await writeFile(resolve(p.root,'sketches/a.ts'),'export function draw(){}');
  await assert.rejects(buildProject(p,quiet),/must export setup or onCook/);assert.equal(await bundle(p),first);
  await writeFile(config,`export default {sketches:{a:{entry:'sketches/a.ts',target:'chop',outputs:['out','out']}}}`);
  await assert.rejects(loadProject(config),/unique channel identifiers/);
});
