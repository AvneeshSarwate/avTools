/// <reference lib="dom" />

import { requestWebGpuDevice, writeTextureToPng } from './raw-webgpu-helpers.ts';
import {
  createPower2DScene,
  selectPower2DFormat,
  StyledShape,
} from '@avtools/power2d/raw';
import { FlatColorMaterial } from '@avtools/power2d/generated-raw/shaders/flatColor.material.raw.generated.ts';
import { InvertEffect } from '@avtools/shader-fx/generated-raw/shaders/invert.frag.raw.generated.ts';

const width = 256;
const height = 256;

const device = await requestWebGpuDevice();

const format = await selectPower2DFormat(device, ['rgba16float', 'rgba32float', 'rgba8unorm']);
console.log(`Using render format: ${format}`);

console.log('Creating power2d scene...');
const scene = createPower2DScene({
  device,
  width,
  height,
  format,
  clearColor: { r: 0.1, g: 0.1, b: 0.1, a: 1 },
});

const rectW = width * 0.6;
const rectH = height * 0.4;
const rectPoints: Array<[number, number]> = [
  [0, 0],
  [rectW, 0],
  [rectW, rectH],
  [0, rectH],
];

const shape = new StyledShape({
  scene,
  points: rectPoints,
  bodyMaterial: FlatColorMaterial,
});
shape.x = width * 0.2;
shape.y = height * 0.3;
shape.body.setUniforms({ color: [0.1, 0.8, 0.2, 1] });

scene.render();
console.log('Rendered power2d scene');

const effect = new InvertEffect(device, { src: scene.outputTexture }, width, height, format);
effect.setUniforms({ strength: 1 });

effect.render();
console.log('Rendered shader-fx pass');

const floatPixels = await writeTextureToPng(device, effect.outputTexture, width, height, format, '.output/raw-webgpu-output.png');

const epsilon = 0.02;
const insideExpected: [number, number, number, number] = [0.9, 0.2, 0.8, 1.0];
const outsideExpected: [number, number, number, number] = [0.9, 0.9, 0.9, 1.0];

const insidePoint: [number, number] = [Math.floor(width * 0.5), Math.floor(height * 0.5)];
const outsidePoint: [number, number] = [Math.floor(width * 0.05), Math.floor(height * 0.05)];

function sampleFloat(x: number, y: number): [number, number, number, number] {
  const idx = (y * width + x) * 4;
  return [
    floatPixels[idx],
    floatPixels[idx + 1],
    floatPixels[idx + 2],
    floatPixels[idx + 3],
  ];
}

function closeEnough(actual: number[], expected: number[]): boolean {
  return actual.every((value, idx) => Math.abs(value - expected[idx]) <= epsilon);
}

const insideSample = sampleFloat(insidePoint[0], insidePoint[1]);
const outsideSample = sampleFloat(outsidePoint[0], outsidePoint[1]);

const insideOk = closeEnough(insideSample, insideExpected);
const outsideOk = closeEnough(outsideSample, outsideExpected);

console.log('Float readback check:');
console.log(`  inside @ ${insidePoint[0]},${insidePoint[1]} =`, insideSample, 'expected', insideExpected, insideOk ? 'OK' : 'FAIL');
console.log(`  outside @ ${outsidePoint[0]},${outsidePoint[1]} =`, outsideSample, 'expected', outsideExpected, outsideOk ? 'OK' : 'FAIL');

console.log('Wrote .output/raw-webgpu-output.png');
