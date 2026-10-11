import type {P5GPU, P5GPUImage} from '@avtools/native-webgpu';
export interface SketchHost {
  readonly device: GPUDevice;
  readFile(path: string): Uint8Array;
}
export interface SketchFrame {
  width: number;
  height: number;
  frame: number;
  rate: number;
  absFrame: number;
  time: number;
  deltaSeconds: number;
  controls: {
    sampleRate: number;
    startIndex: number;
    channels: Array<{name: string; samples: Float32Array}>;
  };
  chop(name: string, sampleIndex?: number): number;
  top(index: number): P5GPUImage | undefined;
}
export type Setup = (p: P5GPU, host: SketchHost) => void | Promise<void>;
export type Draw = (p: P5GPU, frame: SketchFrame) => void;
export type OnPulse = (name: string, p: P5GPU, frame: SketchFrame) => void;
