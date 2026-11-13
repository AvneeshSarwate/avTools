import type {MidiHost} from './td-midi.d.ts';
import type {IOHost} from './td-io.d.ts';
import type {ParameterDefinitions, ParameterValues} from './td-parameters.d.ts';
import type {P5GPU, P5GPUImage} from './td-types/p5.d.ts';
import type * as Timing from '../core-timing/mod.ts';
export interface SketchControls {
  readonly sampleRate: number;
  readonly startIndex: number;
  readonly channels: ReadonlyArray<{readonly name: string; readonly samples: Float32Array}>;
}
export interface SketchHost<P extends ParameterDefinitions = ParameterDefinitions> extends IOHost {
  readonly midi: MidiHost<P>;
  readonly params: ParameterValues<P>;
  readonly device: GPUDevice;
  /** Compatibility timing API with supervised launches. Prefer ordinary @avtools/core-timing imports. */
  readonly timing: typeof Timing;
  /** Bounded synchronous best-effort cleanup on replacement, resize, reset or shutdown.
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
export interface SketchFrame<P extends ParameterDefinitions = ParameterDefinitions> {
  readonly params: ParameterValues<P>;
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
export type Setup<P extends ParameterDefinitions = ParameterDefinitions> = (p: P5GPU, host: SketchHost<P>) => void | Promise<void>;
/** Runs on this TOP's V8 worker. Wait for Current Result controls whether the
 * TD cook waits; Pre-trigger Mode always submits/collects without waiting.
 * Buffered TOPs skip input captures while busy; frame callbacks are not replayed.
 */
export type Draw<P extends ParameterDefinitions = ParameterDefinitions> = (p: P5GPU, frame: SketchFrame<P>) => void;
/** FIFO event name captured when Send Pulse is pressed; delivered on the next accepted render. */
export type OnPulse<P extends ParameterDefinitions = ParameterDefinitions> = (name: string, p: P5GPU, frame: SketchFrame<P>) => void;
