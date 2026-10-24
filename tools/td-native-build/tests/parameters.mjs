import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
const binary=resolve(process.env.AVTOOLS_BUILD_BINARY??'tools/td-native-build/target/release/avtools-build');
function fixture(t){const root=mkdtempSync('/private/tmp/avtools-parameters-');t.after(()=>rmSync(root,{recursive:true,force:true}));execFileSync(binary,['init',root]);return root;}
function build(entry,target='chop'){try{return JSON.parse(execFileSync(binary,['build-file',entry,target],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));}catch(e){return JSON.parse(e.stdout);}}
test('literal metadata, typed snapshots, source maps, generated examples and side effects',t=>{
 const root=fixture(t),entry=resolve(root,'entry.ts');
 const source=`import type {ParameterDefinitions} from '@avtools/native-webgpu/td-parameters';
import type {ChopHost} from '@avtools/native-webgpu/td-chop';
export const parameters={Speed:{type:'float',default:-2},Enabled:{type:'toggle'},Mode:{type:'menu',options:['a','b']},Point:{type:'xy',default:[1,2]},Trigger:{type:'pulse'}} as const satisfies ParameterDefinitions;
// This must never run during extraction/build.
throw Error('module was evaluated');
export function onCook(h:ChopHost<typeof parameters>){const n:number=h.params.Speed; const b:boolean=h.params.Enabled;const m:'a'|'b'=h.params.Mode;const xy:readonly [number,number]=h.params.Point;h.outputs.set('value',n);}
`;
 writeFileSync(entry,source);let r=build(entry);assert.equal(r.state,'ready',JSON.stringify(r));
 const code=readFileSync(r.changed.find(p=>p.endsWith('/sketch.js')),'utf8');const first=code.split('\n')[0];assert.ok(first.startsWith('// avtools-parameters-v1:'));
 assert.equal(JSON.parse(first.slice('// avtools-parameters-v1:'.length)).Speed.default,-2);
 const map=JSON.parse(readFileSync(r.changed.find(p=>p.endsWith('.map')),'utf8'));assert.ok(map.mappings.startsWith(';'));
 for(const extra of ['const bad:string=h.params.Speed;', 'h.params.Speed=2;', 'const bad=h.params.Missing;', 'const bad=h.params.Trigger;', 'h.params.Point[0]=5;']){
  writeFileSync(entry,source.replace("const n:number=h.params.Speed;",extra+'const n:number=h.params.Speed;'));assert.equal(build(entry).state,'error',extra);
 }
 writeFileSync(entry,"function create(){return {Speed:{type:'float',default:1}}} export const parameters=create(); export function onCook(){}");assert.equal(build(entry).state,'error');
 for(const [name,target] of [['picture.ts','top'],['channels.ts','chop']]){const example=build(resolve(root,'sketches/parameters',name),target);assert.equal(example.state,'ready',JSON.stringify(example));}
});

test('all generated API examples build and SDK is git-ignored',t=>{
 const root=fixture(t);
 assert.ok(readFileSync(resolve(root,'.gitignore'),'utf8').split('\n').includes('/sdk/'));
 for(const [entry,target] of [['buffers/interpolate.ts','chop'],['parameters/all-controls.ts','chop'],['inputs/picture.ts','top'],['timing/picture.ts','top']]){
  const result=build(resolve(root,'sketches',entry),target);assert.equal(result.state,'ready',JSON.stringify(result));
 }
});
test('generated XY interpolation runs over 10k samples and handles short inputs',t=>{
 const root=fixture(t),result=build(resolve(root,'sketches/buffers/interpolate.ts'));
 assert.equal(result.state,'ready');
 const code=readFileSync(result.changed.find(p=>p.endsWith('/sketch.js')),'utf8');
 const cook=new Function(code+';return onCook')();
 const count=10000, inputs=[{x:Float32Array.from({length:count},(_,i)=>i),y:new Float32Array(count).fill(-4)},{x:new Float32Array(count).fill(12),y:new Float32Array(count).fill(20)}];
 const values={},host={params:{Blend:.25},inputs:{samples:(name,input)=>inputs[input][name]},outputs:{sampleCount:count,setSamples:(name,data)=>{assert.equal(data.length,count);values[name]=Float32Array.from(data);}}};
 cook(host);for(let i=0;i<count;i++){assert.equal(values.x[i],i*.75+3);assert.equal(values.y[i],2);}
 host.params.Blend=1;cook(host);assert.equal(values.x[9999],12);assert.equal(values.y[9999],20);
 inputs[1].x=new Float32Array([8]);inputs[1].y=new Float32Array();cook(host);assert.equal(values.x[0],8);assert.equal(values.x[9999],0);assert.equal(values.y[0],0);
});
test('default entries expose working TOP and CHOP controls',t=>{
 const root=fixture(t);
 const top=build(resolve(root,'sketches/background/main.ts'),'top');
 const chop=build(resolve(root,'sketches/channels/main.ts'),'chop');
 assert.equal(top.state,'ready',JSON.stringify(top));assert.equal(chop.state,'ready',JSON.stringify(chop));
 const source=r=>readFileSync(r.changed.find(p=>p.endsWith('/sketch.js')),'utf8');
 const metadata=r=>JSON.parse(source(r).split('\n')[0].slice('// avtools-parameters-v1:'.length));
 assert.equal(metadata(top).Size.default,70);assert.equal(metadata(chop).Gain.default,1);
 const draw=new Function(source(top)+';return draw')();let circle,fill;
 draw({background(){},noStroke(){},fill(...v){fill=v;},circle(...v){circle=v;}},{params:{Size:125,Color:[0,1,0],Speed:2},width:800,height:600,frame:30});
 assert.deepEqual(circle,[400,300,125]);assert.deepEqual(fill,[0,255,0]);
 const cook=new Function(source(chop)+';return onCook')();let value;
 cook({params:{Gain:3,Offset:2},inputs:{get:()=>7},outputs:{set:(_name,v)=>{value=v;}}});
 assert.equal(value,44);
});
