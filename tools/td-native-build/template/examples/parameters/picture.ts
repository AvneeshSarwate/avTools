import type { ParameterDefinitions } from '@avtools/native-webgpu/td-parameters';
import type { Draw, OnPulse } from '@avtools/native-webgpu/td-sketch';

export const parameters = {
  Size: { type: 'float', default: 70, min: 1, max: 300, clamp: true },
  Color: { type: 'rgb', default: [1, 0.45, 0.2] },
  Visible: { type: 'toggle', default: true },
  Shape: { type: 'menu', options: ['circle', 'square'] },
  Shuffle: { type: 'pulse' },
} as const satisfies ParameterDefinitions;

let x = 0.5;

export const onPulse: OnPulse<typeof parameters> = (name) => {
  if (name === 'Shuffle') {
    x = 0.15 + Math.random() * 0.7;
  }
};

export const draw: Draw<typeof parameters> = (p, frame) => {
  const controls = frame.params;

  p.background(24);

  if (!controls.Visible) {
    return;
  }

  p.noStroke();
  p.fill(controls.Color[0] * 255, controls.Color[1] * 255, controls.Color[2] * 255);

  const size = controls.Size;

  if (controls.Shape === 'circle') {
    p.circle(frame.width * x, frame.height / 2, size);
  } else {
    p.rect(frame.width * x - size / 2, frame.height / 2 - size / 2, size, size);
  }
};
