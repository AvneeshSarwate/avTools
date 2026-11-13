import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {resolve} from 'node:path';
import {repoRoot} from '../runner.mjs';

test('generation cleanup is ordered, releases resources, survives errors and rejects stale access',async()=>{
  let id=0,current=0;const invalidated=[];
  Object.assign(globalThis,{__hostRegister:()=>++id,__hostGeneration:next=>{const old=current;current=next;return old;},__avNativeImmediate:setImmediate,__hostInvalidate:id=>invalidated.push(id),__hostCancelFrames:()=>{}});
  const result=await build({entryPoints:[resolve(repoRoot,'packages/native-webgpu/src/td-timing.ts')],bundle:true,platform:'node',format:'esm',write:false,nodePaths:[resolve(repoRoot,'packages/native-webgpu/node_modules')],logLevel:'silent'});
  const {SketchLifetime}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].contents).toString('base64'));
  const life=new SketchLifetime(),order=[],destroyed=[];
  const device=life.guard({createBuffer(){return {destroy(){destroyed.push('buffer')}};},createTexture(){return {width:1,destroy(){destroyed.push('texture')}};}});
  const buffer=device.createBuffer(),texture=device.createTexture();buffer.destroy();
  life.onDispose(()=>{assert.equal(texture.width,1);order.push('first');});
  life.onDispose(()=>{order.push('second');throw Error('expected cleanup error');});
  const original=console.error;const errors=[];console.error=(...args)=>errors.push(args.join(' '));
  try{await life.dispose();await life.dispose();}finally{console.error=original;}
  assert.deepEqual(order,['second','first']);assert.deepEqual(destroyed,['buffer','texture']);assert.equal(errors.length,1);
  assert.deepEqual(invalidated,[life.id]);assert.throws(()=>texture.width,/disposed/);assert.throws(()=>life.onDispose(()=>{}),/disposed/);
});
