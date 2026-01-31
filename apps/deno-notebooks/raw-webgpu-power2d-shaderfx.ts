/// <reference lib="dom" />

import { requestWebGpuDevice, writeTextureToPng } from './raw-webgpu-helpers.ts';
import { createPower2DScene, selectPower2DFormat, BatchedStyledShape } from '@avtools/power2d/raw';
import { InstancedSolidMaterial } from '@avtools/power2d/generated-raw/shaders/instancedSolid.material.raw.generated.ts';
import * as instancedSquaresCompute from '@avtools/compute-shader/generated-raw/shaders/instancedSquares.raw.generated.ts';
import { BloomEffect } from '@avtools/shader-fx/generated-raw/shaders/bloom.frag.raw.generated.ts';

const width = 256;
const height = 256;

console.log('Starting raw webgpu batched instancing test...');
const device = await requestWebGpuDevice();

const format = await selectPower2DFormat(device, ['rgba16float', 'rgba32float', 'rgba8unorm']);
console.log(`Using render format: ${format}`);

console.log('Creating power2d scene...');
const clearColor: GPUColor = { r: 1, g: 1, b: 1, a: 1 };

const squarePoints: Array<[number, number]> = [
  [-0.5, -0.5],
  [0.5, -0.5],
  [0.5, 0.5],
  [-0.5, 0.5],
];

const gridWidth = 2;
const instanceCount = gridWidth * gridWidth;
const squareSize = 20;
const baseX = 40;
const baseY = 40;
const spacing = 40;

const instancePositions: Array<[number, number]> = [];
for (let row = 0; row < gridWidth; row += 1) {
  for (let col = 0; col < gridWidth; col += 1) {
    instancePositions.push([baseX + col * spacing, baseY + row * spacing]);
  }
}

const epsilon = 0.02;
const insideExpected: [number, number, number, number] = [1, 0, 0, 1];
const outsideExpected: [number, number, number, number] = [1, 1, 1, 1];

function sampleFloat(pixels: Float32Array, x: number, y: number): [number, number, number, number] {
  const idx = (y * width + x) * 4;
  return [
    pixels[idx],
    pixels[idx + 1],
    pixels[idx + 2],
    pixels[idx + 3],
  ];
}

function closeEnough(actual: number[], expected: number[]): boolean {
  return actual.every((value, idx) => Math.abs(value - expected[idx]) <= epsilon);
}

function maxRgb(sample: [number, number, number, number]): number {
  return Math.max(sample[0], sample[1], sample[2]);
}

function reportSamples(label: string, pixels: Float32Array): void {
  console.log(`Float readback check (${label}):`);
  const outsideSample = sampleFloat(pixels, 10, 10);
  console.log(`  outside @ 10,10 =`, outsideSample, 'expected', outsideExpected, closeEnough(outsideSample, outsideExpected) ? 'OK' : 'FAIL');

  for (const [x, y] of instancePositions) {
    const sample = sampleFloat(pixels, Math.round(x), Math.round(y));
    const ok = closeEnough(sample, insideExpected);
    console.log(`  inside @ ${Math.round(x)},${Math.round(y)} =`, sample, 'expected', insideExpected, ok ? 'OK' : 'FAIL');
  }
}

function reportBloomSamples(label: string, pixels: Float32Array, centerX: number, centerY: number, haloOffset: number): void {
  console.log(`Bloom readback check (${label}):`);
  const inside = sampleFloat(pixels, centerX, centerY);
  const halo = sampleFloat(pixels, centerX + haloOffset, centerY);
  const outside = sampleFloat(pixels, 10, 10);

  const insideOk = maxRgb(inside) > 0.6;
  const haloOk = maxRgb(halo) > 0.02;
  const outsideOk = maxRgb(outside) < 0.05;

  console.log(`  center @ ${centerX},${centerY} =`, inside, insideOk ? 'OK' : 'FAIL');
  console.log(`  halo @ ${centerX + haloOffset},${centerY} =`, halo, haloOk ? 'OK' : 'FAIL');
  console.log(`  far @ 10,10 =`, outside, outsideOk ? 'OK' : 'FAIL');
}

async function renderCpuInstances(): Promise<Float32Array> {
  const scene = createPower2DScene({
    device,
    width,
    height,
    format,
    clearColor,
  });

  const batch = new BatchedStyledShape({
    scene,
    points: squarePoints,
    material: InstancedSolidMaterial,
    instanceCount,
    canvasWidth: width,
    canvasHeight: height,
  });

  batch.setUniforms({ color: [1, 0, 0, 1] });

  instancePositions.forEach((pos, index) => {
    batch.writeInstanceAttr(index, {
      offset: pos,
      scale: squareSize,
      rotation: 0,
    });
  });
  batch.beforeRender();

  console.log('CPU: rendering...');
  scene.render();
  console.log('Rendered CPU-instanced batched shape');

  console.log('CPU: reading back...');
  return writeTextureToPng(device, scene.outputTexture, width, height, format, '.output/raw-webgpu-batched-cpu.png');
}

async function dispatchComputeInstanceFill(instanceBuffer: GPUBuffer): Promise<void> {
  console.log('Compute: creating uniforms...');
  const settingsState = instancedSquaresCompute.createUniformBuffer_settings(device, {
    baseX,
    baseY,
    spacing,
    scale: squareSize,
    gridWidth,
    instanceCount,
  });

  const shaderState = instancedSquaresCompute.createShader(device, {
    settings: settingsState,
    instanceData: instanceBuffer,
  });

  console.log('Compute: dispatching workgroups...');
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(shaderState.pipeline);
  shaderState.bindGroups.forEach((group, index) => {
    pass.setBindGroup(index, group);
  });
  const workgroups = Math.ceil(instanceCount / 64);
  pass.dispatchWorkgroups(workgroups);
  pass.end();
  device.pushErrorScope('validation');
  device.pushErrorScope('out-of-memory');
  device.queue.submit([encoder.finish()]);
  console.log('Compute: submitted workgroups');
  const oomError = await device.popErrorScope();
  const validationError = await device.popErrorScope();
  if (oomError) {
    console.error('Compute GPU out-of-memory error:', oomError);
  }
  if (validationError) {
    console.error('Compute GPU validation error:', validationError);
  }
  console.log('Compute: workgroups submitted');
}

async function renderComputeInstances(): Promise<Float32Array> {
  const scene = createPower2DScene({
    device,
    width,
    height,
    format,
    clearColor,
  });

  const batch = new BatchedStyledShape({
    scene,
    points: squarePoints,
    material: InstancedSolidMaterial,
    instanceCount,
    canvasWidth: width,
    canvasHeight: height,
  });
  batch.setUniforms({ color: [1, 0, 0, 1] });

  const instanceBufferState = instancedSquaresCompute.createStorageBuffer_instanceData(device, instanceCount, {
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  batch.setInstancingBuffer(instanceBufferState.buffer);
  batch.setExternalBufferMode(true);

  await dispatchComputeInstanceFill(instanceBufferState.buffer);

  console.log('Compute: rendering...');
  scene.render();
  console.log('Rendered compute-instanced batched shape');

  console.log('Compute: reading back...');
  return writeTextureToPng(device, scene.outputTexture, width, height, format, '.output/raw-webgpu-batched-compute.png');
}

async function renderBloomPingPong(): Promise<Float32Array> {
  const bloomClear: GPUColor = { r: 0, g: 0, b: 0, a: 1 };
  const scene = createPower2DScene({
    device,
    width,
    height,
    format,
    clearColor: bloomClear,
  });

  const centerX = Math.round(width / 2);
  const centerY = Math.round(height / 2);
  const bloomSquareSize = 32;

  const batch = new BatchedStyledShape({
    scene,
    points: squarePoints,
    material: InstancedSolidMaterial,
    instanceCount: 1,
    canvasWidth: width,
    canvasHeight: height,
  });
  batch.setUniforms({ color: [1, 1, 1, 1] });
  batch.writeInstanceAttr(0, {
    offset: [centerX, centerY],
    scale: bloomSquareSize,
    rotation: 0,
  });
  batch.beforeRender();

  console.log('Bloom: rendering input square...');
  scene.render();

  const bloomEffect = new BloomEffect(device, { src: scene.outputTexture }, width, height, format, bloomClear);
  bloomEffect.setUniforms({
    preBlackLevel: 0.0,
    preGamma: 1.0,
    preBrightness: 3.0,
    minBloomRadius: 0.2,
    maxBloomRadius: 0.7,
    bloomThreshold: 0.0,
    bloomSCurve: 0.4,
    bloomFill: 0.8,
    bloomIntensity: 1.6,
    outputMode: 0,
    inputImage: 1.0,
  });

  console.log('Bloom: rendering multipass effect...');
  bloomEffect.render();

  console.log('Bloom: reading back...');
  const pixels = await writeTextureToPng(
    device,
    bloomEffect.outputTexture,
    width,
    height,
    format,
    '.output/raw-webgpu-bloom-pingpong.png',
  );

  const haloOffset = Math.round(bloomSquareSize * 0.9);
  reportBloomSamples('Bloom', pixels, centerX, centerY, haloOffset);
  return pixels;
}

const cpuPixels = await renderCpuInstances();
reportSamples('CPU', cpuPixels);
console.log('Wrote .output/raw-webgpu-batched-cpu.png');

const computePixels = await renderComputeInstances();
reportSamples('Compute', computePixels);
console.log('Wrote .output/raw-webgpu-batched-compute.png');

await renderBloomPingPong();
console.log('Wrote .output/raw-webgpu-bloom-pingpong.png');
