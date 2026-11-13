import {build} from 'esbuild';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const bundled=await build({entryPoints:[new URL('../../src/osc.ts',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'neutral'});
const {encodeOsc:encode,decodeOsc:decode,utf8Encode,utf8Decode}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].contents).toString('base64'));
test('OSC spec wire vectors, Unicode, blob ownership and all supported types',()=>{
 assert.equal(Buffer.from(encode({address:'/oscillator/4/frequency',args:[440]})).toString('hex'),'2f6f7363696c6c61746f722f342f6672657175656e6379002c66000043dc0000');
 const args=[{type:'i',value:-2147483648},{type:'f',value:1.5},{type:'d',value:Math.PI},{type:'h',value:-9999999999n},{type:'t',value:0xffffffffffffffffn},{type:'c',value:65},{type:'r',value:0xff00ffff},{type:'s',value:'日本語 🎛️'},{type:'S',value:'symbol'},{type:'b',value:new Uint8Array([1,2,3])},{type:'m',value:new Uint8Array([0,0x90,60,127])},{type:'T'},{type:'F'},{type:'N'},{type:'I'},{type:'array',value:[{type:'i',value:42}]}];
 const encoded=encode({address:'/types',args});const [msg]=decode(encoded);assert.deepEqual(msg,{address:'/types',args,timetag:1n});encoded.fill(0);assert.deepEqual(msg.args[9].value,new Uint8Array([1,2,3]));
});
test('nested bundles preserve order and immediate-delivery timetag metadata',()=>{
 assert.deepEqual(decode(encode({timetag:0xf000000012345678n,packets:[{address:'/one',args:[1]},{timetag:1n,packets:[{address:'/two'}]}]})).map(m=>[m.address,m.timetag]),[['/one',0xf000000012345678n],['/two',1n]]);
});
test('truncation, unknown types, invalid padding, oversized/deep packets',()=>{
 const bytes=encode({address:'/x',args:['hello',{type:'b',value:new Uint8Array([1,2,3])}]});
 for(let i=0;i<bytes.length;i++)assert.throws(()=>decode(bytes.slice(0,i)));
 assert.throws(()=>decode(new Uint8Array([47,120,0,0,44,122,0,0])));
 assert.throws(()=>decode(new Uint8Array([47,0,1,0,44,0,0,0])));
 assert.throws(()=>encode({address:'/x',args:[new Uint8Array(65507)]}));
 let packet={address:'/x'};for(let i=0;i<18;i++)packet={timetag:1n,packets:[packet]};assert.throws(()=>encode(packet));
 let state=42;for(let n=0;n<10000;n++){const data=new Uint8Array(n%256);for(let i=0;i<data.length;i++){state=(Math.imul(state,1664525)+1013904223)>>>0;data[i]=state>>>24;}try{decode(data);}catch{}}
});
test('UTF-8 file decoding validates invalid input',()=>{
 for(const text of ['','hello','a\0b','é 日本語 🎛️'])assert.equal(utf8Decode(utf8Encode(text)),text);
 for(const data of [[0xc0,0x80],[0xed,0xa0,0x80],[0xf4,0x90,0x80,0x80],[0xc2]])assert.throws(()=>utf8Decode(new Uint8Array(data)));
});
