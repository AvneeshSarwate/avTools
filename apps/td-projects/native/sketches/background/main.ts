import type {Draw} from '@avtools/native-webgpu/td-sketch';
import {shade} from './palette.ts';

export const draw: Draw = (p, frame) => {
  p.background(shade(frame.frame));
  p.fill(255, 120, 60);
  const radius = Math.min(frame.width, frame.height) * 0.3;
  p.circle(frame.width * 0.5 + Math.sin(frame.time) * radius,
           frame.height * 0.5, radius);
};
