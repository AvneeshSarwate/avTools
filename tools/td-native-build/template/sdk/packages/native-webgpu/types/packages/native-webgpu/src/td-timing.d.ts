import * as timing from '../../core-timing/mod.ts';
/** Ownership is propagated by V8 through promises; host callbacks capture it too. */
export declare class SketchLifetime {
    readonly id: number;
    active: boolean;
    error: string;
    private roots;
    constructor();
    run<T>(fn: () => T): T;
    private track;
    readonly timing: Readonly<{
        launch: typeof timing.launch;
        launchBrowser: typeof timing.launchBrowser;
        createAndLaunchContext: typeof timing.createAndLaunchContext;
        cancelAllContexts: () => void;
        PriorityQueue: typeof timing.PriorityQueue;
        startBarrier(key: string, ctx: timing.TimeContext): void;
        resolveBarrier(key: string, ctx: timing.TimeContext): void;
        awaitBarrier(key: string, ctx: timing.TimeContext): Promise<void>;
        MAX_ZERO_ADVANCE_SLICES: 10000;
        wallNow: () => number;
        CancelablePromiseProxy: typeof timing.CancelablePromiseProxy;
        TempoMap: typeof timing.TempoMap;
        TimeScheduler: typeof timing.TimeScheduler;
        TimeContext: typeof timing.TimeContext;
        DateTimeContext: typeof timing.DateTimeContext;
        BrowserTimeContext: typeof timing.BrowserTimeContext;
        OfflineTimeContext: typeof timing.OfflineTimeContext;
        OfflineRunner: typeof timing.OfflineRunner;
    }>;
    cancelRoots(): void;
    fail(error: unknown): void;
    dispose(): Promise<void>;
    private wrapped;
    private raw;
    /** Retained renderer/host functions fail before entering disposed native resources. */
    guard<T extends object>(value: T): T;
}
