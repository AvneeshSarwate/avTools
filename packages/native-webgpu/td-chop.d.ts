import type * as Timing from '../core-timing/mod.ts';
/** One independent state/timing owner per CHOP instance. */
export interface ChopHost {
  readonly timing: typeof Timing;
  readonly inputs: {
    /** Latest published input; default sample is the last sample. Missing data returns 0. */
    get(name: string, input?: number, sample?: number): number;
    /** Owned copy; changing it cannot mutate the host's input snapshot. */
    samples(name: string, input?: number): Float32Array;
    names(input?: number): string[];
  };
  readonly outputs: {
    /** Fixed Output Samples parameter for this generation (default 1). */
    readonly sampleCount: number;
    /** Persistent state. Name must be in the TD Output Channels parameter; finite float32 only. */
    set(name: string, value: number, sample?: number): void;
    get(name: string, sample?: number): number;
    /** Copy exactly sampleCount finite samples into persistent output state. */
    setSamples(name: string, values: ArrayLike<number>): void;
    /** Owned copy of persistent output state; missing channels return an empty array. */
    samples(name: string): Float32Array;
    names(): string[];
  };
  /** Synchronous cleanup before generation invalidation; runs on reset/reload/shutdown. */
  onDispose(callback: () => void): void;
}
export interface ChopFrame { readonly frame: number; readonly absFrame: number; readonly rate: number; readonly time: number; readonly deltaSeconds: number; }
export type Setup = (host: ChopHost) => void | Promise<void>;
/** Optional same-cook evaluator; inputs are fresh. Must not return a Promise. */
export type OnCook = (host: ChopHost, frame: ChopFrame) => void;
export type OnPulse = (name: string, host: ChopHost) => void;
