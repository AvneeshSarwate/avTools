import type * as Timing from '../core-timing/mod.ts';
/** One worker-owned state/timing context per CHOP, in both execution modes.
 * Wait for Current Result on: TD waits for the current accepted inputs/output.
 * Off: pending inputs coalesce; TD consumes the latest complete publication.
 * Timers remain independent of TD cooking. A synchronous callback sees stable
 * inputs; a continuation after await can see a newer accepted snapshot.
 */
export interface ChopHost {
  readonly timing: typeof Timing;
  readonly inputs: {
    /** Latest worker-accepted input; default sample is the last sample. Missing data returns 0. */
    get(name: string, input?: number, sample?: number): number;
    /** Owned copy; changing it cannot mutate the host's input snapshot. */
    samples(name: string, input?: number): Float32Array;
    names(input?: number): string[];
  };
  readonly outputs: {
    /** Fixed Output Samples parameter for this generation (default 1). */
    readonly sampleCount: number;
    /** Worker state, visible to get() immediately; TD sees complete callback-turn snapshots. Name must be in the TD Output Channels parameter; finite float32 only. */
    set(name: string, value: number, sample?: number): void;
    get(name: string, sample?: number): number;
    /** Copy exactly sampleCount finite samples into persistent output state. */
    setSamples(name: string, values: ArrayLike<number>): void;
    /** Owned copy of persistent output state; missing channels return an empty array. */
    samples(name: string): Float32Array;
    names(): string[];
  };
  /** Bounded synchronous best-effort cleanup; async continuations are not guaranteed on teardown. */
  onDispose(callback: () => void): void;
}
/** Metadata of the accepted TD request. deltaSeconds accumulates elapsed
 * absolute TD time across coalesced requests; frame/time may seek or loop.
 * TimeContext's realtime clocks still advance from monotonic wall time.
 */
export interface ChopFrame { readonly frame: number; readonly absFrame: number; readonly rate: number; readonly time: number; readonly deltaSeconds: number; }
export type Setup = (host: ChopHost) => void | Promise<void>;
/** Runs once per accepted request, after frame-wait continuations and queued
 * pulses. Buffered mode may skip intermediate TD inputs. Must be synchronous.
 */
export type OnCook = (host: ChopHost, frame: ChopFrame) => void;
/** FIFO event name captured when Send Pulse is pressed; reads accepted inputs. */
export type OnPulse = (name: string, host: ChopHost) => void;
