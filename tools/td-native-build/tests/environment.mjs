import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,mkdirSync,cpSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import ts from '../../../packages/native-webgpu/node_modules/typescript/lib/typescript.js';
const repo=resolve(import.meta.dirname,'../../..');
const binary=process.env.AVTOOLS_BUILD_BINARY??resolve(repo,'tools/td-native-build/target/debug/avtools-build');
function fixture(t){const dir=mkdtempSync('/private/tmp/avtools-environment-');t.after(()=>rmSync(dir,{recursive:true,force:true}));execFileSync(binary,['init',dir]);writeFileSync(resolve(dir,'avtools.json'),readFileSync(resolve(repo,'tools/td-native-build/tests/legacy-project.json')));return dir;}
function native(dir,command='check'){try{return JSON.parse(execFileSync(binary,[command,dir],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));}catch(e){return JSON.parse(e.stdout);}}
function program(dir){const c=ts.readConfigFile(resolve(dir,'tsconfig.json'),ts.sys.readFile);const parsed=ts.parseJsonConfigFileContent(c.config,ts.sys,dir);return ts.createProgram(parsed.fileNames,parsed.options);}
function diagnostics(p){return ts.getPreEmitDiagnostics(p);}
function put(dir,source){writeFileSync(resolve(dir,'sketches/probe.ts'),source);}
const valid=`import type {ChopHost} from '@avtools/native-webgpu/td-chop';
import type {Draw,SketchHost} from '@avtools/native-webgpu/td-sketch';
import type {TimeContext} from '@avtools/core-timing';
import {StyledShape} from '@avtools/power2d/raw';
import * as FX from '@avtools/shader-fx/raw';
const task:number=setTimeout((a:number,b:string)=>console.debug(a,b),1,3,'x');clearTimeout(task);
const immediate:number=setImmediate((x:number)=>console.log(x),3);clearImmediate(immediate);
queueMicrotask(()=>{});cancelAnimationFrame(requestAnimationFrame(time=>console.warn(time)));
const elapsed:number=performance.now();const id:string=crypto.randomUUID();
const controller=new AbortController();controller.signal.onabort=e=>console.log(e.type);controller.abort('reason');controller.signal.throwIfAborted();
const target=new EventTarget();target.addEventListener('ping',e=>e.preventDefault(),{once:true});target.dispatchEvent(new Event('ping',{cancelable:true}));
addEventListener('unhandledrejection',e=>{console.error(e.reason);e.preventDefault();});
function timing(host:ChopHost){const task=host.timing.launch(async ctx=>{await ctx.waitSec(.01);host.outputs.set('value',host.inputs.get('value'));return 42;});task.cancel();}
const draw:Draw=(p,frame)=>{p.background(0);p.circle(1,2,3);p.loadFont('font.ttf');const image=frame.top(0);if(image)p.image(image,0,0);};
function gpu(host:SketchHost){const b=host.device.createBuffer({size:4,usage:GPUBufferUsage.COPY_DST});host.device.queue.writeBuffer(b,0,new Float32Array([1]));b.destroy();}
`;
test('ES-only TD declarations, raw libraries and timing declarations agree in tsc and native checker',t=>{
 const dir=fixture(t),config=JSON.parse(readFileSync(resolve(dir,'tsconfig.json')));config.compilerOptions.skipLibCheck=false;writeFileSync(resolve(dir,'tsconfig.json'),JSON.stringify(config));put(dir,valid);
 const p=program(dir);assert.deepEqual(diagnostics(p).map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')),[]);
 assert.equal(native(dir).state,'ready');assert.equal(native(dir,'build').state,'ready');
 const files=p.getSourceFiles().map(f=>f.fileName);
 assert.ok(files.some(f=>f.endsWith('/core-timing/offline_time_context.ts')));
 assert.ok(!files.some(f=>/lib\.dom|@types\/node/.test(f)));
 assert.ok(readFileSync(resolve(dir,'dist/channels.js'),'utf8').includes('TimeScheduler'));
 // The same TS language service used by editors sees only the provided console members.
 const entry=resolve(dir,'sketches/probe.ts');put(dir,'console.');const c=program(dir);
 const host={getScriptFileNames:()=>c.getRootFileNames(),getScriptVersion:()=> '1',getScriptSnapshot:f=>{const s=ts.sys.readFile(f);return s===undefined?undefined:ts.ScriptSnapshot.fromString(s);},getCurrentDirectory:()=>dir,getCompilationSettings:()=>c.getCompilerOptions(),getDefaultLibFileName:o=>ts.getDefaultLibFilePath(o),fileExists:ts.sys.fileExists,readFile:ts.sys.readFile,readDirectory:ts.sys.readDirectory};
 const service=ts.createLanguageService(host);const names=service.getCompletionsAtPosition(entry,8,{})?.entries.map(e=>e.name)??[];assert.ok(['log','info','warn','error','debug'].every(name=>names.includes(name)));assert.ok(!names.includes('table'));service.dispose();
});
test('unsupported TD APIs produce source diagnostics in both checkers',t=>{
 const dir=fixture(t);
 const invalid=[
  'window.location','document.title','fetch("x")','new WebSocket("x")','process.version','Buffer.from("x")',
  'console.table([])','performance.mark("x")','crypto.getRandomValues(new Uint8Array(1))','crypto.subtle',
  'AbortSignal.timeout(3)','new AbortSignal()','setTimeout(()=>{},1).unref()','setTimeout("bad",1)',
  'new MessageChannel()','new URL("x")','new GPUBuffer()',
  `import type {Draw} from '@avtools/native-webgpu/td-sketch';const draw:Draw=p=>p.loadFont({href:'x'});`,
  `import {NodeTextEngine} from '@avtools/native-webgpu/td-p5';`,
 ];
 for(const code of invalid){put(dir,code);const d=diagnostics(program(dir));assert.ok(d.some(d=>d.file?.fileName.endsWith('probe.ts')),code);const result=native(dir);assert.equal(result.state,'error',code);assert.ok(result.diagnostics.some(d=>d.file?.endsWith('probe.ts')&&d.line>=1),JSON.stringify(result));}
 put(dir,`import {launch} from '@avtools/core-timing';export const start=launch;`);assert.equal(native(dir).state,'ready');
 writeFileSync(resolve(dir,'sketches/background/main.ts'),`import {launch} from '@avtools/core-timing';export function draw(){return launch;}`);assert.equal(native(dir,'build').state,'ready');
});
test('Node types are opt-in, explicit dependency ambient leakage is documented, built-ins never become globals',t=>{
 const dir=fixture(t);mkdirSync(resolve(dir,'node_modules/@types'),{recursive:true});
 cpSync(resolve(repo,'packages/native-webgpu/node_modules/@types/node'),resolve(dir,'node_modules/@types/node'),{recursive:true});
 put(dir,'process.version;');assert.ok(diagnostics(program(dir)).length);assert.equal(native(dir).state,'error');
 put(dir,'/// <reference types="node" />\nprocess.version;');assert.deepEqual(diagnostics(program(dir)).map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')),[]);assert.equal(native(dir).state,'ready');
 put(dir,'/// <reference lib="dom" />\ndocument.title;');assert.deepEqual(diagnostics(program(dir)).map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')),[]);assert.equal(native(dir).state,'ready');
 put(dir,'');writeFileSync(resolve(dir,'sketches/background/main.ts'),'/// <reference types="node" />\nimport {readFileSync} from "node:fs";export function draw(){return readFileSync("x");}');assert.equal(native(dir).state,'ready');const result=native(dir,'build');assert.equal(result.state,'error');assert.match(JSON.stringify(result.diagnostics),/node:fs/);
});
test('strict CHOP-only profile does not advertise GPU globals',t=>{
 const dir=fixture(t),config=JSON.parse(readFileSync(resolve(dir,'tsconfig.json')));config.include=['sketches/channels/**/*.ts','sketches/probe.ts'];writeFileSync(resolve(dir,'tsconfig.json'),JSON.stringify(config));put(dir,'GPUBufferUsage.COPY_DST;');assert.ok(diagnostics(program(dir)).length);assert.equal(native(dir).state,'error');put(dir,'performance.now();');assert.equal(native(dir).state,'ready');
});
