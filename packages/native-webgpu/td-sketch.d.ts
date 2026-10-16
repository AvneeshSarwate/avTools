import type {P5GPU, P5GPUImage} from '@avtools/native-webgpu';
import type * as Timing from './dist/types/packages/core-timing/mod.d.ts';
export interface SketchControls {
  readonly sampleRate: number;
  readonly startIndex: number;
  readonly channels: ReadonlyArray<{readonly name: string; readonly samples: Float32Array}>;
}
export interface SketchHost {
  readonly device: GPUDevice;
  /** Canonical core-timing API; launches are owned by this sketch generation. */
  readonly timing: typeof Timing;
  /** Synchronous cleanup on replacement, failed setup, resize, reset, or shutdown.
   * Runs in reverse registration order while this generation's resources are valid.
   * Buffers/textures created through host.device are also destroyed automatically.
   */
  onDispose(callback: () => void): void;
  /** Latest completed input snapshot; absent channels/indexes return zero. */
  chop(name: string, sampleIndex?: number): number;
  /** Fresh records/sample copies: modifying them cannot change the host snapshot. */
  latestControls(): SketchControls;
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
