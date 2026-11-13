---
name: core-timing
description: User-facing API contract and usage patterns for @avtools/core-timing, a drift-free logical-time engine for music and animation (ChucK/SuperCollider-style granular musical time in TypeScript). Use when writing code that schedules events, waits in seconds/beats/frames, modulates tempo, runs parallel synchronized voices, or renders offline with this library.
metadata:
  author: avtools
  version: "0.1.0"
compatibility: Deno-native and browser environments via import maps or bundler aliases.
---

# @avtools/core-timing — user API contract

This documents the **end-user contract**: what the API guarantees, the rules
your code must follow to keep those guarantees, and the proven usage patterns.
Engine internals (scheduler, priority queues, timeslice semantics) are
documented in the header comment of `packages/core-timing/offline_time_context.ts`
and are NOT needed to use the library.

**Import**: `@avtools/core-timing` (package at `packages/core-timing/`, entry `mod.ts`)

## Mental model

Code runs in **logical time**. `ctx.time` (seconds) advances only when an
engine wait resolves, and always lands on the *exact* intended value — never
`0.1003` because setTimeout fired late. Individual callbacks may fire with
wall-clock jitter, but jitter never accumulates: waits are scheduled against
absolute logical deadlines, so **there is no drift**, and parallel voices that
follow the rules stay exactly synchronized (two voices waiting to the same
logical instant resolve in the same scheduler slice, in deterministic order).

The same code runs in two modes with identical event ordering and timing:

- **realtime** — `launch()` / `launchBrowser()`, driven by the wall clock
- **offline** — `OfflineRunner`, driven by explicit stepping (faster than
  realtime; use for deterministic tests and rendering)

## The rules (your code's side of the contract)

1. **Only await engine primitives for timing/control flow**: `waitSec`,
   `wait`, `waitFrame`, barriers, and `branchWait` proxies. Awaiting a fetch,
   timer, or DOM event resumes your coroutine outside logical time; when you
   then schedule the next wait, it re-bases onto the tree's current global
   time (you "skip ahead" — no corruption, but your local phrasing is gone).
2. **Use `ctx.random()`, not `Math.random()`**, if you want offline/realtime
   and re-run determinism. Seed via launch options.
3. **Use `handle.handleCancel(fn)` for cancel-time cleanup, not
   `.finally()`**. A canceled task's promise rejects; `.finally()` creates a
   new rejecting promise that Deno/Node treat as a fatal unhandled rejection.
4. **Expect `Error("aborted")`** from any wait inside a canceled context;
   catch it (or use `handleCancel`) in fire-and-forget branches.
5. **Don't spin on `wait(0)`**. Occasional `wait(0)` is a legal sync point
   (e.g. after `Promise.all` of branchWait proxies); an unbounded `wait(0)`
   loop is "infinite work at one logical instant" and gets rejected by the
   engine's stall guard after 10k iterations.

## Starting a session

```typescript
import { launch, launchBrowser, OfflineRunner } from "@avtools/core-timing";

// Works everywhere (Deno, Node, browser). No waitFrame().
const handle = launch(async (ctx) => {
  await ctx.waitSec(1);
}, { bpm: 120, seed: "my-seed" });
// LaunchOptions: bpm (default 60), rate (time dilation, default 1),
//                debugName, seed, setTimeout/clearTimeout injection

// Browser: adds ctx.waitFrame() (requestAnimationFrame-driven).
const h2 = launchBrowser(async (ctx) => { /* ... */ }, { bpm: 120 });

// Offline: same code, explicitly stepped, no wall-clock delays.
const runner = new OfflineRunner(async (ctx) => { /* ... */ }, {
  bpm: 120,
  fps: 60, // frame rate for stepFrame()
  seed: "render-1",
});
await runner.stepSec(4);      // advance 4 logical seconds (time+beat waits)
await runner.stepFrame();     // advance 1/fps AND resolve waitFrame() waiters
await runner.stepFrames(120); // convenience: N frames
await runner.promise;         // the root block's completion
```

`handle` / `runner.promise` is a `CancelablePromiseProxy<T>`: awaitable, plus
`cancel()`, `cancelSafe(value)`, `handleCancel(fn)`, and `.timeContext` (the
root context). `cancelAllContexts()` tears down every live root (cleanup in
tests / livecode reload).

## Waiting

```typescript
await ctx.waitSec(0.5);   // exactly 0.5 logical seconds from the current base time
await ctx.wait(4);        // 4 BEATS under the tempo map — retimes live if tempo changes
await ctx.waitFrame();    // next animation frame (BrowserTimeContext / OfflineTimeContext only)
await ctx.wait(0);        // scheduler-visible yield: re-syncs to global time, advances nothing
```

- Garbage durations are safe: negative/NaN clamp to 0 (no-op yield).
- `waitFrame()` in offline mode resolves **only** via `stepFrame()` — plain
  `stepSec()` will never wake it.
- Reading state: `ctx.time` (logical sec), `ctx.progTime` (since this context
  started), `ctx.beats` / `ctx.progBeats` (beat position under tempo),
  `ctx.bpm` (current tempo), `ctx.isCanceled`.

## Parallel voices: `branch` vs `branchWait`

```typescript
// Fire-and-forget. Child starts at the tree's CURRENT global time.
// Completion does NOT move the parent's clock.
const bg = ctx.branch(async (c) => { /* ... */ }, "bg");
// bg = { cancel(), finally(fn), handleCancel(fn) }  — no direct ctx access

// Structured join. Child starts at THE PARENT'S time; awaiting it advances
// parent.time to max(parent, child). Returns a full CancelablePromiseProxy.
const a = ctx.branchWait(async (c) => { await c.waitSec(0.5); }, "A");
const b = ctx.branchWait(async (c) => { await c.waitSec(0.3); }, "B");
await Promise.all([a, b]);
await ctx.wait(0); // recommended sync point after joining non-engine combinators
// ctx.time is now 0.5 (the longer child)
```

`BranchOptions` (third argument): `{ tempo: "shared" | "cloned", rng: "forked" | "shared" }`
— defaults `shared` tempo (setBpm anywhere affects everyone) and `forked` rng
(independent deterministic stream per branch).

**Gotcha — branch launch latency**: a `branch()` created between scheduler
ticks doesn't run until the tree's next wait resolves. If your root loop ticks
at `waitSec(1)`, a branch spawned mid-interval starts with up to 1s of
`progTime` already elapsed. For frame-accurate launches keep a root loop
ticking at `waitSec(1/60)`, and initialize any render state to its start value
before handing it to the render loop.

## Tempo

```typescript
ctx.setBpm(240);            // step change, takes effect "now" (tree's current logical time)
ctx.rampBpmTo(240, 2.0);    // linear ramp from current bpm over 2 seconds
```

- `wait(beats)` that is already in flight **retimes automatically** on any
  tempo change — you never reschedule notes by hand.
- Tempo edits affect only contexts sharing that `TempoMap` (`tempo: "cloned"`
  branches are isolated).
- Nonsense bpm values clamp to a positive value; don't rely on `setBpm(0)` to
  pause — cancel or gate the voice instead.
- Beat math is exact under modulation: chained `wait(0.25)` advances the beat
  integral by exactly 0.25 per note no matter how violently tempo moves
  (pinned by the `tempo_modulation_*` tests).

### Programmatic rubato (validated pattern)

One thread modulates tempo at animation rate; melody threads just `wait(beats)`:

```typescript
launch(async (ctx) => {
  // modulator: 60fps "chase" — each tick, ramp toward where the curve will be
  // one tick from now. Tracks the continuous curve to ~0.1ms (a plain
  // setBpm(curve(t)) staircase at 60fps deviates ~8ms). See improvements.md.
  ctx.branch(async (mod) => {
    const dt = 1 / 60;
    while (!mod.isCanceled) {
      mod.rampBpmTo(120 + 60 * Math.sin(Math.PI * (mod.time + dt)), dt);
      await mod.waitSec(dt);
    }
  }, "rubato");

  // melody: schedules in beat-space, follows the rubato automatically
  await ctx.branchWait(async (c) => {
    for (const note of melody) {
      midiOut.noteOn(note);
      await c.wait(note.beats);
      midiOut.noteOff(note);
    }
  }, "melody");
});
```

Per-voice rubato (independent tempo per melody): give the voice
`{ tempo: "cloned" }` and capture its ctx so the modulator can drive it:

```typescript
let voiceCtx: TimeContext | undefined;
ctx.branch(async (c) => { voiceCtx = c; /* melody loop */ }, "v1", { tempo: "cloned" });
ctx.branch(async (mod) => {
  while (!mod.isCanceled) {
    voiceCtx?.setBpm(myCurve(mod.time));
    await mod.waitSec(1 / 60);
  }
}, "v1-rubato");
```

Cross-map isolation is guaranteed: modulating a cloned map never perturbs
voices on other maps.

## Cancellation

```typescript
const note = ctx.branch(async (c) => {
  midiOut.noteOn(60);
  await c.waitSec(2);
  midiOut.noteOff(60);          // normal completion path
}, "note");
note.handleCancel(() => midiOut.noteOff(60)); // guaranteed on early cancel

note.cancel();                  // hard: subtree torn down, pending waits reject "aborted",
                                // an awaiting parent REJECTS

proxy.cancelSafe(42);           // graceful: an awaiting parent RESUMES with 42,
                                // then the subtree is cancelled
```

`ctx.cancel()` cascades to all children. `while (!ctx.isCanceled)` is the
idiomatic loop condition for long-running voices.

## Barriers (cross-voice phrase sync)

```typescript
import { startBarrier, resolveBarrier, awaitBarrier } from "@avtools/core-timing";

// producer
ctx.branch(async (p) => {
  while (!p.isCanceled) {
    startBarrier("phrase", p);
    await p.wait(4);                 // play the phrase
    resolveBarrier("phrase", p);     // releases everyone parked on "phrase"
  }
}, "lead");

// follower
ctx.branch(async (f) => {
  while (!f.isCanceled) {
    await f.wait(3);                 // shorter own phrase
    await awaitBarrier("phrase", f); // park until the lead resolves
  }
}, "follower");
```

Exact semantics (these are owner decisions — rely on them):

- `resolveBarrier` releases current waiters and syncs their `ctx.time` up to
  the resolver's time.
- `awaitBarrier` returns immediately if the barrier already resolved at/after
  your current time (you can't accidentally wait a whole extra cycle), and
  also resolves immediately for a key no one has started (missing producer
  imposes no constraint).
- `startBarrier` on a cycle already in progress **adopts** it — it does NOT
  release parked waiters. Only `resolveBarrier` releases. A relaunched
  producer that wants release-on-restart calls `resolveBarrier` first.
- Barriers are scoped per root tree; identical keys in different `launch`es
  don't interact.

## Offline rendering & deterministic tests

Same block, stepped explicitly — this is how the timing test suite verifies
realtime behavior without waiting in wall time:

```typescript
const events: Array<{ id: string; t: number }> = [];
const runner = new OfflineRunner(async (ctx) => {
  await ctx.wait(4);
  events.push({ id: "beat4", t: ctx.time });
}, { bpm: 120, seed: "test" });
await runner.stepSec(3);
await runner.promise;
// events[0].t === 2 — exactly (4 beats at 120bpm), every run
```

With the same seed and rule-following code, offline and realtime produce the
same events in the same order at the same logical times. `wait(0)` after
joining `Promise.all`s keeps offline stepping honest (see rule 5).

## Quick reference — common mistakes

| Symptom | Cause / fix |
| --- | --- |
| Deno process dies on module stop | `.finally()` on a canceled task → use `handleCancel` |
| Branch animation "starts halfway through" | root loop ticks too slowly → tick root at `waitSec(1/60)` |
| Offline test returns before events fire | non-engine awaits hid work from the scheduler → add `wait(0)` sync points, only await engine primitives |
| Voice ignores tempo changes | it was branched with `{ tempo: "cloned" }` — modulate that voice's own ctx |
| Random differs between offline/realtime | `Math.random()` used → use `ctx.random()` + a fixed seed |
| Events replay in a burst after a hitch | expected: logical time catches up drift-free after event-loop stalls |
| "Logical time stalled" error | unbounded `wait(0)` loop → make the loop advance time |
