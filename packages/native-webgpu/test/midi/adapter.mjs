import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';
const built=await build({entryPoints:[new URL('../../src/td-midi.ts',import.meta.url).pathname],bundle:true,write:false,format:'iife',globalName:'adapter',platform:'neutral'});
function fixture(){
 const inputs=new Map(),outputs=new Set(),sent=[],cleanups=[];
 let active=true;
 const context=vm.createContext({console:{warn(){}},Uint8Array,DataView,ArrayBuffer,TextDecoder,
  __avMIDI(op,id,port,rate,raw,bytes){
   if(op==='inputs'||op==='outputs')return JSON.stringify([{id:'a',name:'Controller A'},{id:'b',name:'Controller B'}]);
   if(op==='input')inputs.set(id,{port,rate,raw});
   if(op==='output')outputs.add(id);
   if(op==='close'){inputs.delete(id);outputs.delete(id);}
   if(op==='send'){assert.ok(outputs.has(id));sent.push([...bytes]);}
   if(op==='stats')return JSON.stringify({inputs:inputs.size,outputs:outputs.size,droppedMessages:0,batches:0,queuedBatches:0});
  }});
 vm.runInContext(built.outputFiles[0].text,context);
 const life={run(fn){assert.ok(active,'disposed');return fn();},onDispose(fn){cleanups.push(fn);}};
 const host=context.adapter.createMIDI(life);
 const select=value=>{context.__avMIDISelectionsJSON=JSON.stringify({Controller:value});context.__avMIDISelections();};
 const emit=(id,value)=>{const bytes=new Uint8Array(48),v=new DataView(bytes.buffer);v.setUint32(0,0x4d494452,true);v.setUint16(4,1,true);v.setUint32(24,1,true);v.setBigUint64(32,123000n,true);bytes.set([1,2,74,value],40);context.__avMIDIEvent(id,bytes);};
 return {host,inputs,outputs,sent,select,emit,dispose(){for(const fn of cleanups.reverse())fn();active=false;}};
}
test('managed selector retains listeners, ignores stale deliveries, None/missing/reconnect and cleanup',()=>{
 const f=fixture();f.select('a');const h=f.host.bindInput('Controller');const received=[];let statuses=0;
 h.onStatus(()=>statuses++);const off=h.on('cc',e=>received.push([e.channel,e.controller,e.value,e.timeMs]));
 const old=[...f.inputs.keys()][0];f.emit(old,10);f.select('b');const current=[...f.inputs.keys()][0];
 f.emit(old,99);f.emit(current,20);assert.deepEqual(received,[[2,74,10,123],[2,74,20,123]]);assert.equal(h.port.id,'b');assert.equal(f.inputs.size,1);
 f.select('missing');assert.equal(h.connected,false);assert.match(h.error,/unavailable/);f.select('');assert.equal(h.error,'');assert.equal(f.inputs.size,0);
 f.select('a');h.reconnect();assert.equal(f.inputs.size,1);assert.equal(statuses,5);
 off();f.emit([...f.inputs.keys()][0],30);assert.equal(received.length,2);f.dispose();assert.equal(h.closed,true);assert.equal(f.inputs.size,0);
});
test('explicit connections and output use shared encoders, validate options, close on disposal',async()=>{
 const f=fixture();assert.throws(()=>f.host.bindInput('Missing'),/declared/);
 await assert.rejects(f.host.openInput('missing'),/unavailable/);
 await assert.rejects(f.host.openInput(''),/device id/);
 for(const rateHz of [0,1001,1.5,NaN])await assert.rejects(f.host.openInput('a',{rateHz}),/options/);
 const a=await f.host.openInput('a',{rateHz:500,rawCC:false});const b=await f.host.openInput('a');assert.equal(f.inputs.size,2);
 const out=await f.host.openOutput('b');out.noteOn(0,60,100);out.cc(2,74,64);out.pitchBend(0,0);out.noteOff(0,60);
 assert.deepEqual(f.sent,[[0x90,60,100],[0xb2,74,64],[0xe0,0,64],[0x80,60,0]]);
 a.close();a.close();assert.equal(b.closed,false);f.dispose();assert.equal(f.inputs.size,0);assert.equal(f.outputs.size,0);assert.equal(out.closed,true);
});
