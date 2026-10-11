Object.assign(globalThis,nativeGPU.globals);
(async()=>{
  const gpu=nativeGPU.create(['backend=metal']); const adapter=await gpu.requestAdapter();
  if(!adapter)throw new Error('No hardware adapter'); const device=await adapter.requestDevice();
  device.addEventListener('uncapturederror',e=>{globalThis.failure=e.error.message;});
  const source=device.createBuffer({size:16,usage:GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});
  const dest=device.createBuffer({size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  device.queue.writeBuffer(source,0,new Uint32Array([42,99,123,256]));
  const encoder=device.createCommandEncoder();encoder.copyBufferToBuffer(source,0,dest,0,16);device.queue.submit([encoder.finish()]);
  await dest.mapAsync(GPUMapMode.READ);const pixels=new Uint32Array(dest.getMappedRange());
  if(pixels[0]!==42||pixels[3]!==256)throw new Error('Readback mismatch');
  dest.unmap();source.destroy();dest.destroy();await device.queue.onSubmittedWorkDone();device.destroy();
  globalThis.done=true;
})().catch(e=>{globalThis.failure=e.stack;globalThis.done=true;});
