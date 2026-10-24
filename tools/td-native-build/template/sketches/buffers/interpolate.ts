import type { OnCook } from '@avtools/native-webgpu/td-chop';
import type { ParameterDefinitions } from '@avtools/native-webgpu/td-parameters';

// CHOP: Output Channels = x y; Output Samples = 10000 (or your buffer length).
// Wire two CHOPs, each with x/y channels. Enable Wait for Current Result for
// same-cook inputs/outputs. Missing channels or short inputs contribute zero.
export const parameters = {
  Blend: { type: 'float', default: 0.5, min: 0, max: 1, clamp: true },
} as const satisfies ParameterDefinitions;

let x = new Float32Array(0);
let y = new Float32Array(0);

export const onCook: OnCook<typeof parameters> = (host) => {
  const count = host.outputs.sampleCount;

  if (x.length !== count) {
    x = new Float32Array(count);
    y = new Float32Array(count);
  }

  // samples() returns an owned copy, not a borrowed buffer. Reuse our output
  // buffers, but don't cache inputs between cooks if you need current values.
  const ax = host.inputs.samples('x', 0);
  const ay = host.inputs.samples('y', 0);
  const bx = host.inputs.samples('x', 1);
  const by = host.inputs.samples('y', 1);
  const t = host.params.Blend;

  for (let i = 0; i < count; ++i) {
    const a = ax[i] ?? 0;
    const b = ay[i] ?? 0;
    x[i] = a + ((bx[i] ?? 0) - a) * t;
    y[i] = b + ((by[i] ?? 0) - b) * t;
  }

  host.outputs.setSamples('x', x);
  host.outputs.setSamples('y', y);
};
