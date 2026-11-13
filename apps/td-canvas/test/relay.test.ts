import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WebSocket} from 'ws';
import {attachRelay} from '../relay.ts';
import {createEmptyDrawingDocument} from '../shared/protocol.ts';

async function connect(url: string) {
  const socket=new WebSocket(url);
  const queue: any[]=[];
  let receive: ((message:any)=>void)|undefined;
  socket.on('message',data=>{const message=JSON.parse(data.toString());if(receive){const done=receive;receive=undefined;done(message);}else queue.push(message);});
  const next=()=>new Promise<any>((resolve,reject)=>{
    if(queue.length){resolve(queue.shift());return;}
    const timer=setTimeout(()=>reject(Error('Message timeout')),3000);
    receive=message=>{clearTimeout(timer);resolve(message);};
  });
  await new Promise<void>((resolve,reject)=>{socket.on('open',resolve);socket.on('error',reject);});
  return {socket,next,send:(message:any)=>socket.send(JSON.stringify(message))};
}

test('relay snapshots, previews, slow-consumer recovery, multiple subscribers, reload and persistence',{timeout:10000},async t=>{
  const directory=await mkdtemp(join(tmpdir(),'td-canvas-'));
  const server=createServer();
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=(server.address() as any).port;
  const stop=await attachRelay(server,directory,port);
  t.after(async()=>{await stop();server.close();await rm(directory,{recursive:true,force:true});});
  const url=`ws://127.0.0.1:${port}/canvas?drawing=test`;
  const a=await connect(url),b=await connect(url),editor=await connect(url+'&role=editor');
  assert.equal((await a.next()).revision,0);assert.equal((await b.next()).revision,0);await editor.next();
  a.send({type:'ack',revision:0}); // b deliberately stalls.
  const document=createEmptyDrawingDocument();
  document.circle.nodes.push({id:'circle',type:'circle',radius:75,creationTime:0,transform:{x:320,y:240}});
  editor.send({type:'commit',document});await editor.next();
  const committed=await a.next();assert.equal(committed.document.circle.nodes[0].radius,75);
  a.send({type:'ack',revision:committed.revision});
  editor.send({type:'preview',preview:{upserts:[{layer:'circle',node:{...document.circle.nodes[0],radius:150}}],deletes:[]}});await editor.next();
  const preview=await a.next();assert.equal(preview.type,'preview');assert.equal(preview.base,committed.revision);
  b.send({type:'ack',revision:0});const caughtUp=await b.next();assert.equal(caughtUp.type,'snapshot');assert.equal(caughtUp.document.circle.nodes[0].radius,150);
  const reloaded=await connect(url);assert.equal((await reloaded.next()).document.circle.nodes[0].radius,150);
  const second=await connect(url+'&role=editor');
  assert.equal(await new Promise(resolve=>second.socket.on('close',resolve)),4009);
  editor.send({type:'commit',document:{...document,circle:{nodes:[{...document.circle.nodes[0],radius:200}]}}});await editor.next();
  await new Promise(resolve=>setTimeout(resolve,250));
  assert.equal(JSON.parse(await readFile(join(directory,'test.json'),'utf8')).circle.nodes[0].radius,200);
  editor.send({type:'preview',preview:{upserts:[{layer:'circle',node:{id:'invalid',type:'circle',radius:-1}}],deletes:[]}});
  assert.equal((await editor.next()).type,'error');
  const large=createEmptyDrawingDocument();
  large.freehand.nodes.push({type:'stroke',id:'large',creationTime:0,isFreehand:true,
    points:Array.from({length:20000},(_,i)=>i%1280),timestamps:Array.from({length:10000},(_,i)=>i)});
  editor.send({type:'commit',document:large});await editor.next();
  a.send({type:'resync'});
  const largeSnapshot=await a.next();
  assert.equal(largeSnapshot.document.freehand.nodes[0].points.length,20000);
  for(const client of [a,b,editor,reloaded])client.socket.close();
});
