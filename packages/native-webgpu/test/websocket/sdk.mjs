import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
const repo=resolve(import.meta.dirname,'../../../..');
const binary=resolve(repo,'tools/td-native-build/target/release/avtools-build');
test('generated SDK documents WebSocket APIs, builds TOP/CHOP examples and rejects invalid use',t=>{
  const root=mkdtempSync('/private/tmp/avtools-websocket-sdk-');
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  execFileSync(binary,['init',root]);
  assert.match(readFileSync(resolve(root,'README.md'),'utf8'),/WebSocket client API/);
  assert.match(readFileSync(resolve(root,'README.md'),'utf8'),/Canvas editor example/);
  assert.equal(existsSync(resolve(root,'sketches')),false, 'supplied sketches stay under examples');
  assert.ok(JSON.parse(readFileSync(resolve(root,'tsconfig.json'))).include.includes('sketches/**/*.ts'));

  function build(entry,kind='chop'){
    try{return JSON.parse(execFileSync(binary,['build-file',entry,kind],{encoding:'utf8',stdio:'pipe'}));}
    catch(error){return JSON.parse(error.stdout);}
  }
  for(const folder of ['websocket','canvas']) {
    for(const [entry,kind] of [['picture','top'],['channels','chop']]) {
      const result=build(resolve(root,`examples/${folder}/${entry}.ts`),kind);
      assert.equal(result.state,'ready',JSON.stringify(result));
    }
  }
  const entry=resolve(root,'examples/websocket/invalid.ts');
  writeFileSync(entry,`import type {ChopHost} from '@avtools/native-webgpu/td-chop';export function setup(h:ChopHost){h.webSocket.connect('ws://localhost:8080').send(123)}`);
  assert.equal(build(entry).state,'error');
});
