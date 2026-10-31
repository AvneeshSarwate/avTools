import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
const repo=resolve(import.meta.dirname,'../../../..');
const binary=process.env.AVTOOLS_BUILD_BINARY??resolve(repo,'tools/td-native-build/target/release/avtools-build');
test('generated SDK checks MIDI parameter names and event types, and builds every MIDI example',t=>{
  const root=mkdtempSync('/private/tmp/avtools-midi-sdk-');
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  execFileSync(binary,['init',root],{stdio:'pipe'});
  assert.match(readFileSync(resolve(root,'README.md'),'utf8'),/Native MIDI API/);
  function build(entry,kind='chop'){
    try{return JSON.parse(execFileSync(binary,['build-file',entry,kind],{encoding:'utf8',stdio:'pipe'}));}
    catch(error){return JSON.parse(error.stdout);}
  }
  for(const [name,kind] of [['channels','chop'],['picture','top'],['explicit','chop']]){
    const result=build(resolve(root,`sketches/midi/${name}.ts`),kind);
    assert.equal(result.state,'ready',JSON.stringify(result));
  }
  const entry=resolve(root,'sketches/midi/contract.ts');
  const source=`import type {ChopHost} from '@avtools/native-webgpu/td-chop';
export const parameters={Controller:{type:'midiInput'},Speed:{type:'float'}} as const;
export function setup(host:ChopHost<typeof parameters>){
  const input=host.midi.bindInput('Controller');
  input.on('cc',e=>host.outputs.set('v',e.controller));
}`;
  writeFileSync(entry,source);assert.equal(build(entry).state,'ready');
  for(const invalid of [source.replace("bindInput('Controller')","bindInput('Speed')"),source.replace('e.controller','e.note')]){
    writeFileSync(entry,invalid);
    const result=build(entry);assert.equal(result.state,'error',JSON.stringify(result));
    assert.ok(result.diagnostics.length);
  }
});
