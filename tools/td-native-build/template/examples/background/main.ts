import type { Draw } from '@avtools/native-webgpu/td-sketch';
import type { ParameterDefinitions } from '@avtools/native-webgpu/td-parameters';
import { shade } from './palette.ts';

// These controls appear on the TOP's Controls page after the first build.
export const parameters = {
  Size: { type: 'float', default: 70, min: 1, max: 300, clamp: true },
  Color: { type: 'rgb', default: [1, 0.47, 0.235] },
  Speed: { type: 'float', default: 1, min: 0, max: 4 },
} as const satisfies ParameterDefinitions;

export const draw: Draw<typeof parameters> = (p, frame) => {
  const { Size, Color, Speed } = frame.params;

  p.background(shade(frame.frame * Speed));
  p.noStroke();
  p.fill(Color[0] * 255, Color[1] * 255, Color[2] * 255);
  p.circle(frame.width / 2, frame.height / 2, Size);
};
