# Fresh-environment restart verification

Run from the repository root on macOS Apple Silicon:

```sh
node packages/native-webgpu/test/restart/run.mjs
AVTOOLS_BUILD_BINARY=tools/td-native-build/target/release/avtools-build \
  node --test tools/td-native-build/tests/{behavior,environment,entry-files}.mjs
node tools/td-native-build/tests/native-hosts.mjs
node --test tools/td-sketch-build/test/*.test.mjs
```

The native test runs the identical imported animation module in Node and embedded
V8, checks independent timers without cooks, fresh globals/listeners/closures,
failed activation without retry/rollback, bounded stuck cleanup, 400 CHOP restart
cycles, and 160 TOP restarts (four concurrent 1080p instances). It also recovers a
TOP poisoned by an infinite setup loop while map, queue, compilation-info,
compute-pipeline, and error-scope futures are outstanding. A native-only policy
test covers per-instance freezing, Reset versus Reload, unchanged Reload,
missing selected sources, and a later build completing behind a queued Reload.

Open [the actual example](../../../../apps/td-projects/native/project.toe), then
execute these files through TD's Textport (`exec(open('/absolute/path').read())`):

- `verify_td.py`: creates a temporary TS project through the plugin's template
  button and tests 13 stages of independent activation, compilation, errors,
  manual controls, source selection, buffered output, and pre-trigger operation.
- `raw_sources.py`: tests file edits, deletion/recreation through macOS path
  aliases, source selection, raw syntax errors, DAT activation, and pixel recovery.
- `td_benchmark.py`: runs the existing four TOPs and four CHOPs for 240 frames,
  reloading all eight at frame 90. Records TD CPU cook time including the TOP
  upload enqueue call. Run after reloading the clean example for timing.

Helpers create isolated test components or an inactive benchmark DAT; they do not
save them into the example. Reload the saved `.toe` to discard test helpers.
The actual `.toe/.tox` beside the integration source and in `apps/td-projects/native`
have been regenerated; the startup script resolves the current prebuilt markers.

## Results, 2026-10-20–21

- 19 compiler/checker/watcher tests, 5 Node watcher/lifetime tests, native C ABI
  tests, and the live TS + raw-source controls passed.
- TimeContext: all 21 logical conformance cases in Node and twice in embedded V8.
- Existing TOP bridge suite: three cycles including text/input orientation,
  mixed async GPU futures, sync/async budgets, active-job teardown and recovery.
- Existing CHOP suite: same-cook input/state, independent timers, pulse behavior,
  error recovery, and four-instance 10k/100k XY transformations passed.
- Imported TimeContext ticks advanced with actual TD playback paused; frame waits
  retain accepted-request semantics, also covered by native execution tests.

Latest native measurements are in `native-result.json`. On this machine:

| Measurement | Median | p95 |
| --- | ---: | ---: |
| Scalar CHOP full restart | 4.53 ms | 6.86 ms |
| Scalar CHOP warm cook | 0.171 ms | — |
| Four concurrent 1080p TOP restarts, plus one follow-up frame each | 24.17 ms | 49.23 ms |
| Per-TOP warm native cook/readback | 1.10 ms | — |

These times exclude compilation. TOP restart recreates the GPU device and renderer.
CHOP process footprint was 24.20 MiB midway and 24.46 MiB at the end of the 400
restart cycles. Four-TOP footprint was 143.63 MiB after warm-up, 143.79 MiB at the
end, with 223.43 MiB peak. This finite soak found a plateau rather than monotonic
growth; it is not proof against every possible resource leak.

`td-performance.json` records actual TD CPU timings, including upload enqueue.
The final clean example measured 0.083 ms median / 0.246 ms p95 per 1080p TOP,
0.463 ms median / 0.637 ms p95 per CHOP, and 2.32 ms median combined CPU time for
all eight operators. Simultaneous reload of all eight took 25.94 ms on the TD
thread because the four CHOPs used blocking mode; the TOPs remained buffered.
See `td-performance-summary.json` for the exact values and plugin identities.
This is CPU submission time, not a measurement of when TD's GPU upload completes.
An explicit simultaneous reload can exceed one frame's budget in **blocking**
CHOP mode; buffered TOPs continue returning without waiting for their restarts.
`td-result.json` and `raw-result.json` record the control assertions and diagnostics.

The poisoned-GPU test exposed a native callback lifetime bug. Patch
`0006-embedded-environment-retirement.patch` adds an environment retirement token,
shared native promise state, early retirement checks before callbacks access JS,
and releases runner/instance retention cycles. Runtime teardown marks retirement
on the owner thread before NAPI finalization, even when JS cleanup cannot run.
The raw-file test also caught a physical-versus-logical macOS path mismatch;
the file watcher now canonicalizes its parent before filtering FSEvents.
