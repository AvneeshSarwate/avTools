import { type PRNG as SeedrandomPRNG } from "./seedrandom_shim.ts";
/**
 * Zero-advance stall guard: the maximum number of CONSECUTIVE timeslices the
 * scheduler will process at an unchanged logical time before rejecting the
 * waiters at that instant. A `wait(0)`/`waitSec(0)` hot loop schedules
 * infinite work at a single logical instant; under logical-time semantics
 * that legitimately starves all later-scheduled work (offline advanceTo has
 * the analogous MAX_TIMESLICES bound and throws). Instead of reordering
 * slices (which would break realtime/offline determinism parity and
 * realtime re-run order-determinism), the offending waits are rejected with
 * an error — the stalled branch tears down like any module error and every
 * other context's timing is untouched. Applies in BOTH realtime and offline
 * modes (shared slice-processing path), so the failure itself is
 * deterministic across modes.
 */
export declare const MAX_ZERO_ADVANCE_SLICES = 10000;
export type RandomSeed = string | number;
export type SetTimeoutFn = (callback: () => void, ms: number) => number;
export type ClearTimeoutFn = (id: number) => void;
export declare const wallNow: () => number;
export declare class CancelablePromiseProxy<T> implements Promise<T> {
    abortController: AbortController;
    timeContext?: TimeContext;
    private settledResolve;
    private settledReject;
    private settled;
    private blockPromise?;
    constructor(ab: AbortController);
    /** The raw block promise. Assigning it wires the deferred consumers await. */
    get promise(): Promise<T> | undefined;
    set promise(blockPromise: Promise<T> | undefined);
    cancel(): void;
    /**
     * Graceful cancel: settle the awaited join with `value`, then cancel the
     * context subtree. A parent awaiting a branchWait proxy receives `value`
     * instead of a cancellation rejection ("yield with an arg"). For
     * CancelablePromiseProxy<void>, call with no argument. Plain cancel()
     * remains the hard path that rejects the awaiting parent.
     */
    cancelSafe(value: T): void;
    /**
     * Register a handler that runs when this task is canceled (AbortController aborts).
     * Returns an unsubscribe function. If already canceled, the handler fires immediately.
     */
    handleCancel(onCancel?: (() => void) | undefined | null): () => void;
    [Symbol.toStringTag]: string;
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | undefined | null): Promise<TResult1 | TResult2>;
    catch<TResult = never>(onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | undefined | null): Promise<T | TResult>;
    finally(onfinally?: (() => void) | undefined | null): Promise<T>;
}
export declare class TempoMap {
    private static readonly MAX_HISTORICAL_SEGMENTS;
    id: string;
    version: number;
    private segs;
    constructor(initialBpm?: number);
    clone(): TempoMap;
    bpmAtTime(t: number): number;
    beatsAtTime(t: number): number;
    timeAtBeats(targetBeats: number): number;
    /** Public API: set BPM "now" (time argument intentionally not exposed). */
    _setBpmAtTime(bpm: number, t: number): void;
    /** Optional: smooth-ish ramp. (Not required by your current constraints, but useful.) */
    _rampToBpmAtTime(targetBpm: number, durSec: number, t: number): void;
    private segmentAtTime;
    /** Split the active segment at time t (conceptually), returning bpm/beats at t and segment index. */
    private splitAt;
    /**
     * Bounds unbounded tempo-segment growth by merging all segments before a boundary
     * into a single averaged constant-bpm segment. This preserves beatsAtTime exactly
     * at t=0 and at t>=boundaryTime, but for times STRICTLY INSIDE the merged region
     * beatsAtTime returns a linear approximation of the true (piecewise) beat count.
     *
     * Engine-internal queries never observe this approximation: contexts cache their
     * startBeats at creation (see TimeContext.startBeats / createAndLaunchContext) and
     * scheduler paths only ever query current/future times. Only direct user calls to
     * tempo.beatsAtTime(historicT) may see approximated values, and only after more
     * than MAX_HISTORICAL_SEGMENTS (16) tempo edits have accumulated.
     */
    private compactHistoryBefore;
    private segmentIndexAtTime;
}
type SchedulerMode = "realtime" | "offline";
export declare class TimeScheduler {
    readonly id: `${string}-${string}-${string}-${string}-${string}`;
    readonly mode: SchedulerMode;
    private lastProcessedTime;
    private zeroAdvanceSliceCount;
    private zeroAdvanceGuardTripped;
    private seqCounter;
    private timePQ;
    private beatPQs;
    private tempoHeadPQ;
    private frameWaiters;
    private timeoutId;
    private pumpQueued;
    private rate;
    private wallAnchor;
    private logicalAnchor;
    private offlineNow;
    private rafRunning;
    private rafHandle;
    private pumpMacroQueued;
    private readonly setTimeoutFn;
    private readonly clearTimeoutFn;
    private readonly yieldToMacrotask;
    private readonly scheduleMacrotask;
    constructor(mode: SchedulerMode, opts?: {
        rate?: number;
        setTimeout?: SetTimeoutFn;
        clearTimeout?: ClearTimeoutFn;
    });
    /** Allocates a deterministic increasing sequence number. */
    allocSeq(): number;
    now(): number;
    setRate(rate: number): void;
    sleepUntilTime(ctx: TimeContext, targetTime: number): Promise<void>;
    sleepUntilBeats(ctx: TimeContext, tempo: TempoMap, targetBeat: number): Promise<void>;
    awaitNextFrame(ctx: TimeContext): Promise<void>;
    /** Offline: advance "now" and process all due waits (time + beat). */
    advanceTo(t: number): Promise<void>;
    /** Offline: resolve all waitFrame() calls once per frame tick at the current offline time. */
    resolveFrameTick(): Promise<void>;
    private requestPumpOrWake;
    private queuePump;
    private pumpDue;
    private queuePumpMacrotask;
    private scheduleNext;
    private clearTimeoutWake;
    private peekNextEventTime;
    private refreshTempoHead;
    /** Call after tempo changes to retime beat waits efficiently. */
    onTempoChanged(tempo: TempoMap): void;
    private processOneTimeslice;
    private processTimeWaitersAt;
    private processBeatWaitersForTempoHead;
    private deleteBeatQueueIfEmpty;
    private stopRafIfIdle;
    private ensureRafLoop;
    private resolveAllFrameWaitersAt;
}
export declare function startBarrier(key: string, ctx: TimeContext): void;
export declare function resolveBarrier(key: string, ctx: TimeContext): void;
export declare function awaitBarrier(key: string, ctx: TimeContext): Promise<void>;
export declare function cancelAllContexts(): void;
export type BranchOptions = {
    tempo?: "shared" | "cloned";
    rng?: "forked" | "shared";
};
type Constructor<T> = new (time: number, ab: AbortController, id: number, cancelPromise: CancelablePromiseProxy<unknown>) => T;
export declare abstract class TimeContext {
    rootContext: TimeContext | undefined;
    mostRecentDescendentTime: number;
    debugName: string;
    abortController: AbortController;
    time: number;
    startTime: number;
    startBeats: number;
    isCanceled: boolean;
    id: number;
    cancelPromise: CancelablePromiseProxy<unknown>;
    childContexts: Set<TimeContext>;
    scheduler: TimeScheduler;
    tempo: TempoMap;
    rng: SeedrandomPRNG;
    rngSeed: string;
    private rngForkCounter;
    constructor(time: number, ab: AbortController, id: number, cancelPromise: CancelablePromiseProxy<unknown>);
    get progTime(): number;
    /** Beat position under variable tempo. */
    get beats(): number;
    get progBeats(): number;
    /** Deterministic random in [0,1). Use this instead of Math.random(). */
    random(): number;
    /** Read-only BPM at the context's current logical time. */
    get bpm(): number;
    /** Tempo write: always stamped at the latest processed logical time of this root tree. */
    setBpm(bpm: number): void;
    /** Optional: small ramp helper (also stamped at latest processed logical time). */
    rampBpmTo(bpm: number, durSec: number): void;
    connectChildContext(childContext: TimeContext, opts?: BranchOptions): void;
    cancel(): void;
    branch<T>(block: (ctx: TimeContext) => Promise<T>, debugName?: string, opts?: BranchOptions): {
        cancel: () => void;
        finally: (f: () => void) => Promise<T>;
        handleCancel: (f: () => void) => () => void;
    };
    branchWait<T>(block: (ctx: TimeContext) => Promise<T>, debugName?: string, opts?: BranchOptions): CancelablePromiseProxy<T>;
    abstract waitSec(sec: number): Promise<void>;
    wait(beats: number): Promise<void>;
}
/** Works everywhere: schedules via setTimeout through the scheduler. No waitFrame(). */
export declare class DateTimeContext extends TimeContext {
    waitSec(sec: number): Promise<void>;
}
/** Browser-only: adds waitFrame() using a single RAF-driven frame barrier. */
export declare class BrowserTimeContext extends DateTimeContext {
    waitFrame(): Promise<void>;
}
/** Offline context: same semantics as BrowserTimeContext, but driven by OfflineRunner (60fps frame ticks). */
export declare class OfflineTimeContext extends DateTimeContext {
    waitFrame(): Promise<void>;
}
export declare function createAndLaunchContext<T, C extends TimeContext>(block: (ctx: C) => Promise<T>, rootTime: number, ctor: Constructor<C>, updateParent: boolean, parentContext?: C, debugName?: string, opts?: BranchOptions, rootScheduler?: TimeScheduler, rootTempo?: TempoMap, rootSeed?: RandomSeed): CancelablePromiseProxy<T>;
/** Default launch: setTimeout-only DateTimeContext (works everywhere). */
export interface LaunchOptions {
    bpm?: number;
    rate?: number;
    debugName?: string;
    seed?: RandomSeed;
    setTimeout?: SetTimeoutFn;
    clearTimeout?: ClearTimeoutFn;
}
export declare function launch<T>(block: (ctx: DateTimeContext) => Promise<T>, opts?: LaunchOptions): CancelablePromiseProxy<T>;
/** Browser launch: BrowserTimeContext with waitFrame(). */
export declare function launchBrowser<T>(block: (ctx: BrowserTimeContext) => Promise<T>, opts?: LaunchOptions): CancelablePromiseProxy<T>;
export declare class OfflineRunner<T> {
    readonly scheduler: TimeScheduler;
    readonly ctx: OfflineTimeContext;
    readonly promise: CancelablePromiseProxy<T>;
    private fps;
    constructor(block: (ctx: OfflineTimeContext) => Promise<T>, opts?: {
        bpm?: number;
        fps?: number;
        debugName?: string;
        seed?: RandomSeed;
        setTimeout?: SetTimeoutFn;
        clearTimeout?: ClearTimeoutFn;
    });
    /** Advance simulation by dt seconds (processes all time+beat waits due). */
    stepSec(dt: number): Promise<void>;
    /** Advance simulation by 1 frame (default 60fps): pumps due waits, resolves waitFrame(), pumps again. */
    stepFrame(): Promise<void>;
    /** Convenience: render N frames. */
    stepFrames(n: number): Promise<void>;
}
export {};
