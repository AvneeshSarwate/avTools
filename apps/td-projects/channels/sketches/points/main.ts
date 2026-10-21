import * as timing from '@avtools/core-timing';
import type {Setup, OnCook} from '@avtools/native-webgpu/td-chop';
let phase = 0;
let x: Float32Array, y: Float32Array;
export const setup: Setup = host => {
  x = new Float32Array(host.outputs.sampleCount);
  y = new Float32Array(host.outputs.sampleCount);
  timing.launch(async ctx => {
    while (true) { await ctx.waitSec(1 / 120); phase += 0.005; }
  });
};
// A current TD input can transform the generated points without waiting a frame.
export const onCook: OnCook = host => {
  const scale = host.inputs.get('value') || 1;
  for (let i = 0; i < x.length; i++) {
    const angle = i / x.length * Math.PI * 2;
    x[i] = Math.cos(angle + phase) * scale;
    y[i] = Math.sin(angle * 3 + phase) * scale;
  }
  host.outputs.setSamples('x', x);
  host.outputs.setSamples('y', y);
};
