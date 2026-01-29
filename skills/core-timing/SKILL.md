---
name: core-timing
description: Deterministic drift-free timing engine for JavaScript/TypeScript. Provides logical-time scheduling with structured concurrency, variable tempo support, and dual execution modes (realtime and offline). Use when writing code that uses @avtools/core-timing for scheduling, timing, tempo, beat-based waits, or offline rendering.
metadata:
  author: avtools
  version: "0.0.0"
compatibility: Designed for Deno-native and browser environments via import maps or bundler aliases.
---

# @avtools/core-timing

## Summary

`@avtools/core-timing` is a deterministic, drift-free timing engine for JavaScript/TypeScript. It provides logical-time scheduling with structured concurrency (parent/child context trees with cancellation cascades), variable tempo support with automatic beat-time retiming under BPM changes, and dual execution modes: realtime (driven by `setTimeout`/`requestAnimationFrame`) and offline (driven by explicit stepping for faster-than-realtime or deterministic rendering).

The key principle: user code never sleeps "for N ms." Instead, it sleeps until an **absolute logical deadline**. Logical time advances in discrete timeslices determined by the earliest pending deadline. This eliminates setTimeout drift and guarantees that `ctx.time` always reflects exact intended values.

**Package location**: `packages/core-timing/`
**Entry point**: `mod.ts` (re-exports from `offline_time_context.ts` and `priority_queue.ts`)
**Import**: `@avtools/core-timing`
**Runtime**: Deno-native package, also works in browsers via import maps / bundler aliases.
**Dependency**: `seedrandom` (npm:seedrandom@^3.0.5)

---

## Core Concepts and Mental Model

### Logical Time

Each `TimeContext` has a `ctx.time` property measured in logical seconds. This is **not** wall-clock time. It only advances when waits resolve. All scheduling decisions are based on logical time, not `Date.now()` or `performance.now()`.

### Context Tree (Structured Concurrency)

Every timing session has a **root context**. Child contexts are created via `branch()` or `branchWait()`. The root tracks `mostRecentDescendentTime` -- the maximum logical time reached by any descendant in the tree. This is used to compute drift-free base times for all subsequent waits:

```
BaseTime = max(root.mostRecentDescendentTime, ctx.time)
TargetTime = BaseTime + delta
```

### Scheduler

One `TimeScheduler` per root context. It owns:
- `timePQ`: min-heap for time-based waits keyed by absolute target time (seconds)
- `beatPQs`: map of `tempoId -> min-heap` for beat waits keyed by absolute target beat
- `tempoHeadPQ`: min-heap of derived due-times for the head waiter of each tempo
- `frameWaiters`: set of pending `waitFrame()` waiters

The scheduler repeatedly picks the next logical deadline, processes one timeslice (resolves all waiters at that exact deadline), then yields to a macrotask boundary so promise continuations run before the next timeslice.

### Dual Execution Modes

- **Realtime**: `setTimeout` (or `requestAnimationFrame` for `waitFrame()`) drives wakeups. Wall-clock jitter does not accumulate because logical deadlines are absolute.
- **Offline**: `OfflineRunner.stepSec(dt)` / `stepFrame()` drive the clock forward. The same scheduling algorithm runs. Between timeslices, the offline driver yields to macrotasks to emulate realtime microtask-checkpoint semantics. This guarantees identical event ordering between realtime and offline modes.

### Tempo and Beat Timing

A `TempoMap` tracks piecewise-linear BPM over time. `ctx.wait(beats)` schedules in beat-space. When `setBpm()` is called, only the head waiter per tempo needs its due-time recomputed -- the engine does not reschedule every pending beat waiter.

### Deterministic RNG

Each context carries a seeded PRNG (`seedrandom`). By default, child contexts get a **forked** seed derived deterministically from the parent seed and a fork counter. This ensures `ctx.random()` produces the same sequence in offline and realtime modes given the same initial seed.

---

## API Reference

### Launch Functions

#### `launch<T>(block, opts?): CancelablePromiseProxy<T>`

Creates a realtime root `DateTimeContext` driven by `setTimeout`. Works everywhere (browser, Deno, Node).

```typescript
function launch<T>(
  block: (ctx: DateTimeContext) => Promise<T>,
  opts?: LaunchOptions,
): CancelablePromiseProxy<T>
```

**LaunchOptions**:
```typescript
interface LaunchOptions {
  bpm?: number;          // initial tempo (default: 60)
  rate?: number;         // time dilation rate (default: 1)
  debugName?: string;    // label for debugging
  seed?: RandomSeed;     // string | number for deterministic RNG
  setTimeout?: SetTimeoutFn;
  clearTimeout?: ClearTimeoutFn;
}
```

#### `launchBrowser<T>(block, opts?): CancelablePromiseProxy<T>`

Creates a realtime root `BrowserTimeContext` with `waitFrame()` support. Requires `requestAnimationFrame` (browser only).

```typescript
function launchBrowser<T>(
  block: (ctx: BrowserTimeContext) => Promise<T>,
  opts?: LaunchOptions,
): CancelablePromiseProxy<T>
```

#### `OfflineRunner<T>` (class)

Creates an offline root `OfflineTimeContext` with explicit stepping methods for deterministic, faster-than-realtime execution.

```typescript
class OfflineRunner<T> {
  readonly scheduler: TimeScheduler;
  readonly ctx: OfflineTimeContext;
  readonly promise: CancelablePromiseProxy<T>;

  constructor(
    block: (ctx: OfflineTimeContext) => Promise<T>,
    opts?: {
      bpm?: number;        // default: 60
      fps?: number;        // default: 60
      debugName?: string;
      seed?: RandomSeed;
      setTimeout?: SetTimeoutFn;
      clearTimeout?: ClearTimeoutFn;
    },
  );

  /** Advance simulation by dt seconds. Processes all time+beat waits due. */
  stepSec(dt: number): Promise<void>;

  /** Advance by 1/fps seconds, process waits, then resolve waitFrame() waiters. */
  stepFrame(): Promise<void>;

  /** Convenience: render N frames. */
  stepFrames(n: number): Promise<void>;
}
```

---

### TimeContext (Abstract Base)

All context types extend `TimeContext`. This is the primary interface user code interacts with.

#### Properties

| Property | Type | Description |
|---|---|---|
| `time` | `number` | Current logical time in seconds (monotonically increasing) |
| `startTime` | `number` | Logical time when this context was created |
| `progTime` | `number` (getter) | `time - startTime` -- elapsed logical time since context creation |
| `beats` | `number` (getter) | Beat position under the current tempo map at `ctx.time` |
| `progBeats` | `number` (getter) | Beats elapsed since context creation |
| `bpm` | `number` (getter) | Current BPM at `ctx.time` |
| `isCanceled` | `boolean` | Whether this context has been canceled |
| `id` | `number` | Unique numeric ID for this context |
| `debugName` | `string` | Optional label for debugging |
| `rootContext` | `TimeContext \| undefined` | Reference to the root of this context tree |
| `childContexts` | `Set<TimeContext>` | Active child contexts |
| `cancelPromise` | `CancelablePromiseProxy<any>` | The promise proxy wrapping this context's block |

#### Wait Methods

##### `waitSec(sec: number): Promise<void>`

Drift-free wait in seconds. Computes absolute logical deadline from `max(root.mostRecentDescendentTime, ctx.time) + sec`. Available on all context types.

```typescript
await ctx.waitSec(0.5); // wait 500ms of logical time
```

Negative or NaN values are clamped to 0. A `waitSec(0)` acts as a scheduler-visible yield point.

##### `wait(beats: number): Promise<void>`

Wait in beats under the current tempo map. Schedules in beat-space, so the actual wall-time duration depends on the current and future BPM. Automatically retimes if `setBpm()` is called while the wait is pending.

```typescript
ctx.setBpm(120); // 2 beats per second
await ctx.wait(4); // waits 2 seconds of logical time
```

A `wait(0)` acts as a scheduler-visible yield/sync point (schedules a time-wait at the current base time).

##### `waitFrame(): Promise<void>`

*Available on `BrowserTimeContext` and `OfflineTimeContext` only.*

Waits for the next animation frame. In realtime mode, resolved by `requestAnimationFrame`. In offline mode, resolved by `OfflineRunner.stepFrame()`.

```typescript
// Only on BrowserTimeContext or OfflineTimeContext
await ctx.waitFrame();
```

#### Tempo Methods

##### `setBpm(bpm: number): void`

Set BPM immediately. The tempo change is stamped at `root.mostRecentDescendentTime` (the latest processed logical time), ensuring consistent behavior in both realtime and offline modes. Only affects contexts sharing the same `TempoMap` (see `BranchOptions.tempo`).

##### `rampBpmTo(bpm: number, durSec: number): void`

Smoothly ramp BPM from the current value to `bpm` over `durSec` seconds (piecewise-linear interpolation). Also stamped at `root.mostRecentDescendentTime`.

#### Concurrency Methods

##### `branch<T>(block, debugName?, opts?): { cancel, finally, handleCancel }`

Spawn a child task that runs concurrently. The child's initial time is `root.mostRecentDescendentTime`. Completing the branch does **not** advance the parent's `ctx.time`.

```typescript
const handle = ctx.branch(async (child) => {
  await child.waitSec(1.0);
  console.log("done in background");
}, "myBranch");

// handle.cancel()       -- cancel the branch and its subtree
// handle.finally(fn)    -- run fn when the branch completes or is canceled
// handle.handleCancel(fn) -- run fn only on cancellation (returns unsubscribe fn)
```

**BranchOptions**:
```typescript
type BranchOptions = {
  tempo?: "shared" | "cloned";  // default: "shared"
  rng?: "forked" | "shared";    // default: "forked"
};
```

- `tempo: "shared"` -- child shares the parent's `TempoMap`; `setBpm()` in either affects both.
- `tempo: "cloned"` -- child gets an independent copy of the tempo map.
- `rng: "forked"` -- child gets a deterministically derived seed (default; ensures independence).
- `rng: "shared"` -- child shares the parent's PRNG stream (draws consume from the same sequence).

##### `branchWait<T>(block, debugName?, opts?): CancelablePromiseProxy<T>`

Like `branch()`, but:
1. Child's initial time is `parentCtx.time` (not `root.mostRecentDescendentTime`).
2. On completion, `parentCtx.time` is updated to `max(parentCtx.time, childCtx.time)`.

This is the "structured join" primitive. Use with `Promise.all` to run parallel tasks and synchronize:

```typescript
const a = ctx.branchWait(async (c) => { await c.waitSec(0.5); });
const b = ctx.branchWait(async (c) => { await c.waitSec(0.3); });
await Promise.all([a, b]);
// ctx.time is now advanced to whichever child ran longer
```

Returns a full `CancelablePromiseProxy` (can be awaited, canceled, etc.).

#### Other Methods

##### `cancel(): void`

Cancel this context and recursively cancel all child contexts. Pending waits reject with `Error("aborted")`.

##### `random(): number`

Returns a deterministic random number in [0, 1) from the context's seeded PRNG. Use this instead of `Math.random()` for reproducible behavior across realtime and offline modes.

---

### CancelablePromiseProxy<T>

A `Promise`-compatible wrapper with cancellation support. Returned by `launch`, `launchBrowser`, `branchWait`, and `OfflineRunner.promise`.

```typescript
class CancelablePromiseProxy<T> implements Promise<T> {
  cancel(): void;
  handleCancel(onCancel: () => void): () => void;  // returns unsubscribe fn
  then(...): Promise<...>;
  catch(...): Promise<...>;
  finally(...): Promise<T>;
}
```

**Important**: Prefer `handleCancel()` over `.finally()` for cancel-only cleanup. In server runtimes (Deno, Node), `.finally()` on a canceled promise creates a new promise that rejects, which may be treated as an unhandled rejection. `handleCancel()` avoids this by listening on the `AbortController` signal directly.

---

### TempoMap

Piecewise-linear BPM tracking. Created internally by launch functions; accessed via `ctx.tempo`.

```typescript
class TempoMap {
  readonly id: string;
  version: number;

  bpmAtTime(t: number): number;
  beatsAtTime(t: number): number;
  timeAtBeats(targetBeats: number): number;
  clone(): TempoMap;

  // Internal -- called by ctx.setBpm() / ctx.rampBpmTo()
  _setBpmAtTime(bpm: number, t: number): void;
  _rampToBpmAtTime(targetBpm: number, durSec: number, t: number): void;
}
```

Users should call `ctx.setBpm()` / `ctx.rampBpmTo()` rather than calling `_setBpmAtTime` / `_rampToBpmAtTime` directly, since the context methods handle stamping at the correct logical time and notifying the scheduler.

---

### Barrier Primitives

Barriers provide cross-coroutine synchronization within the same root context tree. They are scoped by root context ID to prevent bleed between independent trees.

#### `startBarrier(key: string, ctx: TimeContext): void`

Begin a barrier cycle. If a previous cycle is still in-progress, it is auto-resolved first (prevents deadlocks).

#### `resolveBarrier(key: string, ctx: TimeContext): void`

End the current barrier cycle. All coroutines currently awaiting this barrier are resolved, and their `ctx.time` is updated to `ctx.time` of the resolver.

#### `awaitBarrier(key: string, ctx: TimeContext): Promise<void>`

Wait until the barrier is resolved. If the barrier was already resolved at or after the caller's current logical time, resolves immediately (does not wait for the next cycle).

```typescript
// Producer coroutine
ctx.branch(async (producer) => {
  for (let i = 0; i < 3; i++) {
    startBarrier("sync", producer);
    await producer.waitSec(0.5);  // do work
    resolveBarrier("sync", producer);
  }
}, "producer");

// Consumer coroutine
await ctx.branchWait(async (consumer) => {
  for (let i = 0; i < 3; i++) {
    await consumer.waitSec(0.3);       // do own work
    await awaitBarrier("sync", consumer);  // wait for producer
  }
}, "consumer");
```

---

### PriorityQueue<T>

Min-heap with string-ID-based lookup. Used internally by the scheduler. Also exported for general use.

```typescript
class PriorityQueue<T> {
  add(id: string, deadline: number, metadata: T): void;
  peek(): { id: string; deadline: number; metadata: T } | null;
  pop(): { id: string; deadline: number; metadata: T } | null;
  remove(id: string): boolean;
  adjustDeadline(id: string, newDeadline: number): boolean;
  getData(id: string): T | null;
  size(): number;
  isEmpty(): boolean;
}
```

---

### Utility Exports

#### `cancelAllContexts(): void`

Cancels all currently active root contexts. Useful for cleanup in tests or when tearing down an application.

#### `wallNow(): number`

Returns seconds since module load (based on `performance.now()`). This is the wall-clock reference used internally by realtime mode. Not typically needed by user code.

---

## Common Usage Patterns

### 1. Simple Sequential Timing

```typescript
import { launch } from "@avtools/core-timing";

const handle = launch(async (ctx) => {
  console.log("start", ctx.time);       // 0
  await ctx.waitSec(1.0);
  console.log("1 second", ctx.time);    // 1.0
  await ctx.waitSec(0.5);
  console.log("1.5 seconds", ctx.time); // 1.5
});

// To stop early:
// handle.cancel();
```

### 2. ADSR Animation Loop (Browser)

The most common pattern in `browser-projections`. Uses `launchBrowser` with a `while(!ctx.isCanceled)` loop and `waitSec(1/60)` for frame-rate timing.

```typescript
import { launchBrowser, type CancelablePromiseProxy } from "@avtools/core-timing";

function startAttackAnimation(state: AnimState): CancelablePromiseProxy<void> {
  // Cancel any existing animation
  if (state.animLoop) state.animLoop.cancel();

  const loop = launchBrowser(async (ctx) => {
    const startProgress = state.fillProgress;
    const attackStart = ctx.time;

    // Attack phase
    while (!ctx.isCanceled && state.fillProgress < 1) {
      const elapsed = ctx.time - attackStart;
      const t = elapsed / state.attackTime;
      state.fillProgress = Math.min(1, startProgress + (1 - startProgress) * t);
      await ctx.waitSec(1 / 60);
    }

    // Sustain phase
    while (!ctx.isCanceled) {
      // update render state for MPE modulation etc.
      await ctx.waitSec(1 / 60);
    }
  });

  state.animLoop = loop;

  // Suppress expected cancellation errors
  loop.catch?.((err: Error) => {
    if (err?.message !== "aborted") console.error("Unexpected error:", err);
  });

  return loop;
}
```

### 3. Parallel Tasks with Join

```typescript
import { launch } from "@avtools/core-timing";

launch(async (ctx) => {
  const a = ctx.branchWait(async (c) => {
    await c.waitSec(0.5);
    console.log("A done");
  }, "taskA");

  const b = ctx.branchWait(async (c) => {
    await c.waitSec(0.3);
    console.log("B done");
  }, "taskB");

  await Promise.all([a, b]);
  // ctx.time is now 0.5 (the longer of the two)
  console.log("both done at", ctx.time);
});
```

### 4. Offline Deterministic Testing

```typescript
import { OfflineRunner } from "@avtools/core-timing";

const events: string[] = [];

const runner = new OfflineRunner(async (ctx) => {
  events.push(`start@${ctx.time}`);
  await ctx.waitSec(0.1);
  events.push(`tick@${ctx.time}`);
  await ctx.waitSec(0.2);
  events.push(`done@${ctx.time}`);
}, { bpm: 120, seed: "test-seed" });

// Advance past all scheduled events
await runner.stepSec(0.5);
await runner.promise;

console.log(events);
// ["start@0", "tick@0.1", "done@0.30000000000000004"]
```

### 5. Beat-Aware Timing with Tempo Changes

```typescript
import { launch } from "@avtools/core-timing";

launch(async (ctx) => {
  ctx.setBpm(120); // 2 beats per second

  // Background task changes tempo after 1 second
  ctx.branch(async (ctl) => {
    await ctl.waitSec(1.0);
    ctx.setBpm(240); // double speed
  }, "tempoChange");

  // This wait automatically retimes when tempo changes
  await ctx.wait(4); // 4 beats
  console.log("4 beats completed at", ctx.time);
  // First 2 beats at 120bpm = 1s, next 2 beats at 240bpm = 0.5s
  // Total: ~1.5s
});
```

### 6. Cancellation with Cleanup

```typescript
import { launch } from "@avtools/core-timing";

launch(async (ctx) => {
  const noteHandle = ctx.branch(async (c) => {
    // This runs until canceled
    while (!c.isCanceled) {
      // ... do work ...
      await c.waitSec(0.01);
    }
  }, "note");

  // Register cleanup via handleCancel (preferred over .finally in Deno/Node)
  noteHandle.handleCancel(() => {
    console.log("note was canceled -- sending note-off");
  });

  await ctx.waitSec(2.0);
  noteHandle.cancel(); // triggers handleCancel callback
});
```

### 7. Cross-Coroutine Sync via Barriers

```typescript
import { launch, startBarrier, resolveBarrier, awaitBarrier } from "@avtools/core-timing";

launch(async (ctx) => {
  // Melody B produces barriers
  ctx.branch(async (b) => {
    for (let cycle = 0; cycle < 3; cycle++) {
      startBarrier("phrase", b);
      await b.waitSec(0.5); // play a phrase
      resolveBarrier("phrase", b);
    }
  }, "melodyB");

  // Melody A waits for each phrase to finish
  await ctx.branchWait(async (a) => {
    for (let cycle = 0; cycle < 3; cycle++) {
      await a.waitSec(0.3); // play own phrase (shorter)
      await awaitBarrier("phrase", a); // sync with B
    }
  }, "melodyA");
});
```

### 8. Deterministic RNG

```typescript
import { launch } from "@avtools/core-timing";

launch(async (ctx) => {
  // Forked RNG (default): each branch gets an independent, deterministic stream
  const a = ctx.branchWait(async (c) => {
    console.log(c.random()); // deterministic, independent of B
  }, "A");

  const b = ctx.branchWait(async (c) => {
    console.log(c.random()); // deterministic, independent of A
  }, "B");

  await Promise.all([a, b]);
}, { seed: "my-seed" });
```

### 9. Offline Frame Stepping (for Rendering)

```typescript
import { OfflineRunner } from "@avtools/core-timing";

const frames: number[] = [];

const runner = new OfflineRunner(async (ctx) => {
  for (let i = 0; i < 120; i++) {
    frames.push(ctx.time);
    await ctx.waitFrame();
  }
}, { fps: 60, seed: "render" });

// Step through 120 frames (2 seconds at 60fps)
await runner.stepFrames(120);
await runner.promise;

console.log(`Rendered ${frames.length} frames over ${frames[frames.length - 1]}s`);
```

---

## Important Caveats and Gotchas

### 1. Never Await Non-Engine Promises for Timing

Awaiting arbitrary promises (`fetch`, `setTimeout`, DOM events, etc.) can resume a coroutine outside the scheduler's control and break logical-time semantics. Only await engine waits (`waitSec`, `wait`, `waitFrame`) and barriers for timing/control flow.

### 2. `wait(0)` / `waitSec(0)` Semantics

These are scheduler-visible yield points. They schedule a real time-wait at the current base time. This is important in offline mode where `Promise.resolve()` is invisible to the scheduler and can cause `advanceTo()` to return before follow-up waits are enqueued.

### 3. `.finally()` vs `handleCancel()` on Cancellation

`Promise.finally()` creates a new promise that rejects when the parent is canceled. Browsers log these as warnings, but **Deno and Node treat unhandled rejections as fatal by default**. Use `handleCancel()` instead for cancel-only cleanup, or attach a `.catch()` to the `.finally()` promise.

### 4. `branch()` vs `branchWait()` Time Semantics

- `branch()` child starts at `root.mostRecentDescendentTime`. Completing does NOT update parent time.
- `branchWait()` child starts at `parentCtx.time`. Completing DOES update parent time to `max(parent.time, child.time)`.

Use `branchWait` + `Promise.all` for structured parallel work. Use `branch` for fire-and-forget background tasks.

### 5. Tempo Change Stamping

`setBpm()` and `rampBpmTo()` are stamped at `root.mostRecentDescendentTime`, not at `scheduler.now()`. This ensures consistent behavior across realtime and offline modes. Do not call `tempo._setBpmAtTime()` directly unless you know what you are doing.

### 6. Offline `stepSec` vs `stepFrame`

`stepSec(dt)` resolves only time/beat waits. It does **not** resolve `waitFrame()` waiters. To resolve frame waiters, call `stepFrame()` (which internally calls `stepSec(1/fps)` then `resolveFrameTick()`).

### 7. Cancellation Error Handling

When a context is canceled, all pending waits reject with `Error("aborted")`. If you use `branch()` for fire-and-forget tasks, catch or suppress these errors:

```typescript
const handle = ctx.branch(async (c) => { ... }, "bg");
// This prevents unhandled rejection warnings when the branch is canceled
handle.handleCancel(() => { /* cleanup */ });
```

### 8. Event Ordering Determinism

Events at the same logical deadline are resolved in scheduler sequence order (the order waits were scheduled). This is deterministic but arbitrary -- do not rely on a specific order beyond what the scheduling sequence guarantees. The same code will produce the same order in offline and realtime modes.

### 9. Offline MAX_TIMESLICES Safety Bound

`advanceTo()` has a safety limit of 200,000 timeslices per call. If user code creates an infinite scheduling loop (e.g., `wait(0)` in a tight loop), `advanceTo()` will throw. Design offline programs to have bounded scheduling per time step.

---

## Relationship to Other Packages

- **`@avtools/music-types`**: Defines `AbletonClip`, `AbletonNote`, `CurveValue`, and other music data structures. `core-timing` is tempo-aware but music-type-agnostic; `music-types` provides the data that timing-driven playback code interprets.

- **`browser-projections` app**: The primary browser consumer. Uses `launchBrowser` extensively for ADSR animation loops driven by MPE input, with `waitSec(1/60)` frame-rate timing. Animation state (fill progress, render states) is updated inside `while(!ctx.isCanceled)` loops. Cancellation (`handle.cancel()`) is used to interrupt attack/sustain phases and start release animations.

- **`deno-notebooks` app**: Uses `TimeContext` as a parameter type for MPE playback functions. The `mpePlayback.ts` module accepts a `TimeContext` and uses `ctx.waitSec()`, `ctx.branch()`, and `ctx.branchWait()` to schedule note-on/off events and MPE curve automation. `OfflineRunner` is used for deterministic playback testing.

- **`core-timing` is a leaf dependency**: It depends only on `seedrandom` and has no dependencies on other `@avtools` packages. It is imported by higher-level packages and apps but never imports them.
