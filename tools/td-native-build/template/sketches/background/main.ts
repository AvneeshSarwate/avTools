import type {Draw} from '@avtools/native-webgpu/td-sketch';
import {shade} from './palette.ts';
export const draw: Draw = (p, frame) => { p.background(shade(frame.frame)); p.fill(255, 120, 60); p.circle(100,100,70); };
