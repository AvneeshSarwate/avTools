import assert from 'node:assert/strict';
import {createGPU,P5GPU} from '../dist/index.js';
const gpu=createGPU(),device=await(await gpu.requestAdapter()).requestDevice();
const errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
const texture=device.createTexture({size:[2,2],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
device.queue.writeTexture({texture},new Uint8Array([255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,128]),{bytesPerRow:8},[2,2]);
const p=new P5GPU(device,{width:64,height:64,sampleCount:1});
const image={texture,filter:'nearest'};
const pixel=(x,y)=>Array.from(p.pixels.slice((y*64+x)*4,(y*64+x)*4+4));
try {
  p.beginFrame();p.background(0);p.image(image,0,0,32,32);p.noStroke();p.fill(255,255,0);p.rect(4,4,4,4);
  p.push();p.translate(32,0);p.tint(128,255,255,128);p.image(image,0,0,32,32);p.pop();
  p.image({...image,flipY:true},0,32,32,32);p.push();p.translate(64,64);p.rotate(Math.PI);p.imageMode(p.CENTER);p.image(image,16,16,32,32);p.pop();
  p.endFrame();await p.loadPixels();
  assert.deepEqual(pixel(2,2),[255,0,0,255]);assert.deepEqual(pixel(20,2),[0,255,0,255]);
  assert.deepEqual(pixel(2,20),[0,0,255,255]);assert.deepEqual(pixel(5,5),[255,255,0,255]);
  assert.deepEqual(pixel(34,2),[64,0,0,255]);assert.deepEqual(pixel(2,34),[0,0,255,255]);
  assert.deepEqual(pixel(60,60),[255,0,0,255]);
  // Alternating textures/text/geometry must retain order and bind groups.
  p.beginFrame();p.background(0);p.image(image,-16,-16,32,32);p.fill(255);p.textSize(16);p.text('A',20,20);p.image(image,32,32,32,32);p.endFrame();await p.loadPixels();
  assert.deepEqual(pixel(2,2),[128,128,128,255]);assert.deepEqual(pixel(34,34),[255,0,0,255]);
  p.beginFrame();p.background(0);p.image({...image,filter:'linear'},0,0,64,64);p.endFrame();await p.loadPixels();
  const middle=pixel(31,31);assert(middle[0]>50&&middle[1]>50&&middle[2]>50,'Linear interpolation must mix texels');
  assert.throws(()=>p.image({texture:p.outputTexture},0,0),/render target/);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,linearCenter:middle}));
} finally {p.dispose();texture.destroy();device.destroy();}
