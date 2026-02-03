/// <reference lib="dom" />

import { requestWebGpuDevice } from './raw-webgpu-helpers.ts';
import { createPower2DScene, selectPower2DFormat, StyledShape } from '@avtools/power2d/raw';
import { CirclePts } from '@avtools/power2d/core';
import { FlatColorMaterial } from '@avtools/power2d/generated-raw/shaders/flatColor.material.raw.generated.ts';
import { createBlitPipeline, createGpuWindow, startRenderLoop, type WindowEvent } from '../window/mod.ts';

const device = await requestWebGpuDevice();
const format = await selectPower2DFormat(device, ['rgba16float', 'rgba32float', 'rgba8unorm']);

const win = await createGpuWindow(device, { width: 512, height: 512, title: 'moving circle' });
const blitPipeline = createBlitPipeline(device, win.format);

const scene = createPower2DScene({
  device,
  width: win.width,
  height: win.height,
  format,
  clearColor: { r: 0, g: 0, b: 0, a: 1 },
});

const circlePoints = CirclePts({ cx: 0, cy: 0, radius: 24, segments: 40 });
const circle = new StyledShape({
  scene,
  points: circlePoints,
  bodyMaterial: FlatColorMaterial,
});

circle.body.setUniforms({ color: [1, 0.2, 0.2, 1] });

const onEvent = (event: WindowEvent) => {
  if (event.type === 'resize') {
    scene.resize(event.width, event.height);
    circle.setCanvasSize(event.width, event.height);
  }
};

startRenderLoop({
  window: win,
  blitPipeline,
  onEvent,
  onFrame: (frame) => {
    const t = frame * 0.02;
    const cx = win.width * 0.5 + Math.cos(t) * (win.width * 0.3);
    const cy = win.height * 0.5 + Math.sin(t * 1.3) * (win.height * 0.2);
    circle.x = cx;
    circle.y = cy;
    scene.render();
    return scene.outputView;
  },
});
