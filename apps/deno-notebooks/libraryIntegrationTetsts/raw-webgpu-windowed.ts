/// <reference lib="dom" />

import { requestWebGpuDevice } from './raw-webgpu-helpers.ts';
import { createPower2DScene, selectPower2DFormat, BatchedStyledShape } from '@avtools/power2d/raw';
import { InstancedSolidMaterial } from '@avtools/power2d/generated-raw/shaders/instancedSolid.material.raw.generated.ts';
import { createBlitPipeline, createGpuWindow, startRenderLoop, type WindowEvent } from '../window/mod.ts';

const device = await requestWebGpuDevice();
const format = await selectPower2DFormat(device, ['rgba16float', 'rgba32float', 'rgba8unorm']);

const win = await createGpuWindow(device, { width: 512, height: 512, title: 'power2d windowed' });
const blitPipeline = createBlitPipeline(device, win.format);

const scene = createPower2DScene({
  device,
  width: win.width,
  height: win.height,
  format,
  clearColor: { r: 0, g: 0, b: 0, a: 1 },
});

const squarePoints: Array<[number, number]> = [
  [-0.5, -0.5],
  [0.5, -0.5],
  [0.5, 0.5],
  [-0.5, 0.5],
];

const batch = new BatchedStyledShape({
  scene,
  points: squarePoints,
  material: InstancedSolidMaterial,
  instanceCount: 1,
  canvasWidth: win.width,
  canvasHeight: win.height,
});

batch.setUniforms({ color: [0.2, 0.8, 1.0, 1] });

const onEvent = (event: WindowEvent) => {
  if (event.type === 'resize') {
    scene.resize(event.width, event.height);
    batch.setCanvasSize(event.width, event.height);
  }
};

startRenderLoop({
  window: win,
  blitPipeline,
  onEvent,
  onFrame: (frame) => {
    const t = frame * 0.03;
    const cx = win.width * 0.5 + Math.cos(t) * (win.width * 0.25);
    const cy = win.height * 0.5 + Math.sin(t) * (win.height * 0.25);
    const size = 48 + Math.sin(t * 0.7) * 12;

    batch.writeInstanceAttr(0, {
      offset: [cx, cy],
      scale: size,
      rotation: t * 0.5,
    });

    scene.render();
    return scene.outputView;
  },
});
