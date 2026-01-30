/// <reference lib="dom" />

import { encodePNG } from '@img/png';

export async function requestWebGpuDevice(): Promise<GPUDevice> {
  console.log('Requesting WebGPU adapter...');
  const adapter = await Promise.race([
    navigator.gpu?.requestAdapter(),
    new Promise<null>((_, reject) => setTimeout(() => reject(new Error('requestAdapter timed out')), 5000)),
  ]);
  if (!adapter) {
    throw new Error('No WebGPU adapter available');
  }

  console.log('Requesting WebGPU device...');
  const device = await Promise.race([
    adapter.requestDevice(),
    new Promise<GPUDevice>((_, reject) => setTimeout(() => reject(new Error('requestDevice timed out')), 5000)),
  ]);

  device.addEventListener('uncapturederror', (event) => {
    console.error('WebGPU uncaptured error:', event);
  });

  return device;
}

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function halfToFloat(bits: number): number {
  const sign = (bits & 0x8000) ? -1 : 1;
  const exp = (bits >> 10) & 0x1f;
  const frac = bits & 0x03ff;
  if (exp === 0) {
    return sign * Math.pow(2, -14) * (frac / 1024);
  }
  if (exp === 31) {
    return frac === 0 ? sign * Infinity : NaN;
  }
  return sign * Math.pow(2, exp - 15) * (1 + frac / 1024);
}

export interface ReadbackResult {
  floatPixels: Float32Array;
  rgba8: Uint8Array;
  bytesPerRow: number;
}

export async function readTextureToFloatRGBA(
  device: GPUDevice,
  texture: GPUTexture,
  width: number,
  height: number,
  format: GPUTextureFormat,
): Promise<ReadbackResult> {
  const bytesPerPixel = format === 'rgba16float' ? 8 : format === 'rgba32float' ? 16 : 4;
  const bytesPerRow = align(width * bytesPerPixel, 256);
  const bufferSize = bytesPerRow * height;
  const readBuffer = device.createBuffer({
    size: bufferSize,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  device.pushErrorScope('validation');
  device.pushErrorScope('out-of-memory');

  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer(
    { texture },
    { buffer: readBuffer, bytesPerRow, rowsPerImage: height },
    { width, height, depthOrArrayLayers: 1 },
  );
  device.queue.submit([encoder.finish()]);
  const oomError = await device.popErrorScope();
  const validationError = await device.popErrorScope();
  if (oomError) {
    console.error('GPU out-of-memory error:', oomError);
  }
  if (validationError) {
    console.error('GPU validation error:', validationError);
  }

  console.log('Mapping readback buffer...');
  await Promise.race([
    readBuffer.mapAsync(GPUMapMode.READ),
    new Promise<void>((_, reject) => setTimeout(() => reject(new Error('mapAsync timed out')), 10000)),
  ]);
  const mapped = readBuffer.getMappedRange();

  const floatPixels = new Float32Array(width * height * 4);
  const rgba8 = new Uint8Array(width * height * 4);

  if (format === 'rgba16float') {
    const src16 = new Uint16Array(mapped);
    const rowStride = bytesPerRow / 2;
    for (let y = 0; y < height; y += 1) {
      const rowStart = y * rowStride;
      for (let x = 0; x < width; x += 1) {
        const srcIndex = rowStart + x * 4;
        const dstIndex = (y * width + x) * 4;
        const r = halfToFloat(src16[srcIndex]);
        const g = halfToFloat(src16[srcIndex + 1]);
        const b = halfToFloat(src16[srcIndex + 2]);
        const a = halfToFloat(src16[srcIndex + 3]);
        floatPixels[dstIndex] = r;
        floatPixels[dstIndex + 1] = g;
        floatPixels[dstIndex + 2] = b;
        floatPixels[dstIndex + 3] = a;
        rgba8[dstIndex] = Math.max(0, Math.min(255, Math.round(r * 255)));
        rgba8[dstIndex + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
        rgba8[dstIndex + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
        rgba8[dstIndex + 3] = Math.max(0, Math.min(255, Math.round(a * 255)));
      }
    }
  } else if (format === 'rgba32float') {
    const src32 = new Float32Array(mapped);
    const rowStride = bytesPerRow / 4;
    for (let y = 0; y < height; y += 1) {
      const rowStart = y * rowStride;
      for (let x = 0; x < width; x += 1) {
        const srcIndex = rowStart + x * 4;
        const dstIndex = (y * width + x) * 4;
        const r = src32[srcIndex];
        const g = src32[srcIndex + 1];
        const b = src32[srcIndex + 2];
        const a = src32[srcIndex + 3];
        floatPixels[dstIndex] = r;
        floatPixels[dstIndex + 1] = g;
        floatPixels[dstIndex + 2] = b;
        floatPixels[dstIndex + 3] = a;
        rgba8[dstIndex] = Math.max(0, Math.min(255, Math.round(r * 255)));
        rgba8[dstIndex + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
        rgba8[dstIndex + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
        rgba8[dstIndex + 3] = Math.max(0, Math.min(255, Math.round(a * 255)));
      }
    }
  } else {
    const src8 = new Uint8Array(mapped);
    const rowStride = bytesPerRow;
    for (let y = 0; y < height; y += 1) {
      const rowStart = y * rowStride;
      for (let x = 0; x < width; x += 1) {
        const srcIndex = rowStart + x * 4;
        const dstIndex = (y * width + x) * 4;
        floatPixels[dstIndex] = src8[srcIndex] / 255;
        floatPixels[dstIndex + 1] = src8[srcIndex + 1] / 255;
        floatPixels[dstIndex + 2] = src8[srcIndex + 2] / 255;
        floatPixels[dstIndex + 3] = src8[srcIndex + 3] / 255;
        rgba8[dstIndex] = src8[srcIndex];
        rgba8[dstIndex + 1] = src8[srcIndex + 1];
        rgba8[dstIndex + 2] = src8[srcIndex + 2];
        rgba8[dstIndex + 3] = src8[srcIndex + 3];
      }
    }
  }

  readBuffer.unmap();
  readBuffer.destroy();

  return { floatPixels, rgba8, bytesPerRow };
}

export async function writeTextureToPng(
  device: GPUDevice,
  texture: GPUTexture,
  width: number,
  height: number,
  format: GPUTextureFormat,
  outPath: string,
): Promise<Float32Array> {
  const { floatPixels, rgba8 } = await readTextureToFloatRGBA(device, texture, width, height, format);

  await Deno.mkdir('.output', { recursive: true });
  const png = await encodePNG(rgba8, {
    width,
    height,
    compression: 0,
    filter: 0,
    interlace: 0,
  });
  await Deno.writeFile(outPath, png);

  return floatPixels;
}
