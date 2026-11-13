# core-timing — improvement notes

Findings from the 2026-07 tempo-modulation analysis (empirical probes of the
"programmatic rubato" use case: a 30–120fps control thread modulating the
tempo of melody threads doing beat-space waits). The mechanism itself was
verified correct — event times match the analytic tempo integral to float
precision, with exact realtime/offline parity — so these notes are about
API ergonomics and accuracy patterns, not bugs.

## 1. `rampBpmTo` chase beats `setBpm` for smooth modulation — consider first-class API

A modulator loop calling `setBpm(curve(t))` every tick produces a
piecewise-CONSTANT tempo staircase. The engine schedules exactly on that
staircase, but the staircase itself deviates from the continuous curve the
user intends. Measured max deviation of melody event times vs. the continuous
ideal (sinusoidal rubato, 120 ± 60 bpm, 2s period, `wait(0.25)` melody):

| modulator pattern                  | tick rate | max deviation |
| ---------------------------------- | --------- | ------------- |
| `setBpm(curve(t))`                 | 30 fps    | 15.2 ms       |
| `setBpm(curve(t))`                 | 60 fps    | 7.8 ms        |
| `setBpm(curve(t))`                 | 120 fps   | 3.9 ms        |
| `rampBpmTo(curve(t + dt), dt)`     | 60 fps    | **0.094 ms**  |

i.e. a first-order "chase" — each tick, ramp linearly toward where the curve
will be one tick from now — tracks the continuous curve ~80x more closely
than the staircase at the same tick rate, because the tempo map becomes a
piecewise-linear interpolant of the curve instead of a sample-and-hold:

```typescript
ctx.branch(async (mod) => {
  const dt = 1 / 60;
  while (!mod.isCanceled) {
    mod.rampBpmTo(bpmCurve(mod.time + dt), dt);
    await mod.waitSec(dt);
  }
}, "tempoModulator");
```

Possible future API to incorporate this directly, so users don't have to know
the chase idiom (sketch, not committed to):

```typescript
// engine-side: runs the chase loop on a branch, returns a cancel handle
ctx.followBpm((t) => 120 + 60 * Math.sin(Math.PI * t), { fps: 60 });
```

Both patterns are pinned by tests: `rampBpmTo_chase_tracks_continuous_curve`
and the `tempo_modulation_*` cases in `timing_tests.ts`.

## 2. No handle for modulating another thread's cloned tempo

Per-voice rubato wants `{ tempo: "cloned" }` melody branches whose tempo a
separate modulator thread drives. That works today (verified: cross-context
`melodyCtx.setBpm()` retimes correctly and leaves other tempo maps untouched),
but there is no clean way to GET the child's context/tempo from outside:

- `branch()` returns only `{ cancel, finally, handleCancel }` — no context.
- The working idioms are capturing the ctx inside the block
  (`let melodyCtx; ctx.branch(async (c) => { melodyCtx = c; ... })`) or using
  `branchWait(...)`'s `.timeContext` property.

If per-voice modulation becomes a common pattern, consider one of:

- expose `timeContext` (or just `tempo`) on the `branch()` handle, or
- let `BranchOptions.tempo` accept a caller-owned `TempoMap` instance, so a
  modulator can own one map shared by several voices that follow the same
  rubato line while staying independent of the root map.
