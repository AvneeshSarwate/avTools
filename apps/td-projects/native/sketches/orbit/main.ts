import type { Draw } from '@avtools/native-webgpu/td-sketch';
import { shade } from '../background/palette.ts';
export const draw: Draw = (p, frame) => {
  p.background(shade(frame.frame));
  p.fill(60, 160, 255);
  p.circle(
    400 + 150 * Math.cos(frame.frame / 60),
    300 + 150 * Math.sin(frame.frame / 60),
    100,
  );
};
