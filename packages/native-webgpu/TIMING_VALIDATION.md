# TimeContext validation — 2026-10-15

Apple M1 Max (32 GPU cores), macOS 15.7.7 (24G720), TouchDesigner 2025.31550.
Pinned Node 22.20.0 and Deno 2.8.3; V8/Dawn revisions are in native-manifest.json.
Release native builds, AC-powered desktop session; thermal/power frequency and
other desktop activity were not controlled. These are soft realtime measurements,
not a latency guarantee. Raw logs live under ignored `artifacts/timing` and
`artifacts/td`; [checked-in TD summaries](test/timing/results/2026-10-15-td.json)
retain sample counts and all percentile fields.

Final functional build: `AvToolsSketch-0ffee9f35c10.plugin`. The open TD example
was switched to this build and resumed successfully after final headless checks.
The release ZIP includes the standalone .toe/.tox, source, timing guides, declarations,
and seedrandom notices; code signing and archive contents were verified.

## Correctness and lifecycle

- Nine portable JSON cases, exact root/fork/shared RNG vectors, controlled frame
  subscription checks, 21 realtime/offline cases, and 19 invariants pass on Node,
  Deno, embedded V8 (two isolates), and the in-app Chromium browser.
- Native host checks cover callback/microtask ordering, timer normalization,
  cancellation before selection, stable handles, UUIDs, Abort mutation, same-turn
  rejection handling, callback versus rejection attribution, and ownership across
  promises, async/await, queueMicrotask, and timers. 10,000 generation cycles leave
  no active generations or host tasks. Foreground posting wakes a sleeping owner.
- The probe terminates both an infinite synchronous loop and an infinite
  microtask chain, and rejects reuse of the poisoned isolate. Repeated timer
  cancellation and full GC verify that retained heap stays bounded.
- The bridge verifies independent instances, timers through no-cook intervals,
  frozen frame waits, latest CHOP values, pulse cancellation, failed/successful
  reload, stale promise settlement, retained GPU resource guards, background
  errors, reset, Syphon-only/CPU output, 100 source reloads, and sleeping deletion.
  A synthetic 200 ms input-preparation block does not stop owner-thread timers.
- An idle GPU with device-loss subscription and one 1.5-second timer executes no
  extra GPU-driver immediates and exactly one user timer during the interval.
  This checks host wake/task behavior, not whole TouchDesigner process CPU usage.
- In the TD GUI, TimeContext.toe loaded with two error-free 640×360 TOPs. Across
  a pause/resume interval, realtime ticks advanced by 1,418 while accepted-frame
  ticks advanced by 18 around the UI transitions. Stop froze realtime ticks at
  4,518 while frame ticks continued from 3,463 to 13,054; Start resumed the root.
  Event Name was restored to Trigger. The saved project remains self-contained.

## Pure TimeContext scheduling

`node test/timing/core-benchmark.mjs` and the same command with `native` run two
independent realms serviced on one owner thread in each host. This matches the
pure probe; the production TOP instead has one owner thread per instance.
Each rate runs for two logical seconds per realm. Sixty-four-branch and
64-root bursts emit 1,280 events per realm; tempo alternates 60/240 BPM for
60 events. [Complete percentiles/counts](test/timing/results/2026-10-15-core.json)
are checked in; raw samples are in `artifacts/timing/core-benchmark-*.log`.

| Workload | Node p50 / p95 lateness range across realms, ms | Native p50 / p95 range, ms |
| --- | --- | --- |
| 60 Hz | 0.74–1.08 / 1.56–2.12 | 2.53–4.27 / 4.60–6.34 |
| 240 Hz | 0.72–0.81 / 3.99–5.53 | 0.76–0.77 / 3.93–4.08 |
| 1,000 Hz | 0.72–0.75 / 4.57–4.80 | 0.60–0.65 / 1.54–1.94 |
| 64 branches | 0.66–1.16 / 2.03–2.65 | 0.66–0.80 / 1.30–1.54 |
| 64 roots | 0.63–0.74 / 1.48–1.52 | 0.60–0.61 / 1.10–1.37 |
| Tempo changes | 0.69–0.97 / 2.08–3.48 | 1.21–2.99 / 5.39–7.78 |

The native host is not uniformly faster: its 60 Hz and tempo-change lateness
was worse here. This is a Node-versus-embedding comparison, not an isolated
libuv-versus-condition-variable experiment, so it does not establish the cause.
The separate `benchmark.js` direct-setTimeout workload cannot catch up at 1,000 Hz
with a 1 ms minimum delay and callback/scheduling overhead: lateness accumulates
to over one second on both hosts. TimeContext's logical catch-up policy avoids
that accumulated drift; neither test promises hard realtime precision.

## Four 1080p TOPs, including TD upload

`python3 test/timing/td_benchmark.py`, 240 frames/run, discard 30 warmup frames.
No input images; CPU output; one frame buffering. The comparison uses the old
`ff53beb1bfa2` plugin and TimeContext build `3aef62711bca`. Subsequent lifecycle
hardening only rejects stale RAF registration; it does not change this workload.

| Workload | TD GPU-ready ms p50 / p95 / p99 / max | Timer lateness ms p50 / p95 / p99 / max |
| --- | --- | --- |
| Current, no timer roots | 3.92 / 6.29 / 7.39 / 8.00 | — |
| 240 Hz root per TOP | 4.00 / 7.59 / 8.42 / 12.51 | 0.36 / 1.12 / 2.44 / 8.61 (2,880 events) |
| 1,000 Hz root per TOP | 6.16 / 7.50 / 8.06 / 11.03 | 0.26 / 0.96 / 1.07 / 6.43 (12,000 events) |

Every run above has 210 measured TD frames / 840 outputs. No repeated outputs or
missed 60 Hz deadlines occurred in these three runs. Requested timing frequency
is not callback precision: overdue logical events catch up in bursts, which is
why the 1,000 Hz lateness percentile can be lower than the 240 Hz percentile.
Timer samples include the first three complete one-second reporting blocks,
including startup; the final partial block is omitted.
This workload renders a circle, text, and diagnostic shapes; it is not a claim
about arbitrary complex sketches.

A longer timer-disabled ABBA comparison (`AVTOOLS_TIMING_COMPARE_ONLY=1
AVTOOLS_TIMING_FRAMES=600`) discarded 30 warmup frames per run:

| Run | TD GPU-ready p50 / p95 / p99 / max ms | Per-worker p50 / p95 ms | Missed deadlines / 570 |
| --- | --- | --- | --- |
| Baseline | 4.43 / 7.53 / 9.74 / 11.73 | 1.69 / 3.01 | 2 |
| Current | 4.91 / 11.70 / 14.30 / 16.06 | 1.47 / 3.88 | 20 |
| Current repeat | 6.50 / 8.73 / 11.47 / 12.52 | 2.11 / 4.28 | 0 |
| Baseline repeat | 5.19 / 7.65 / 8.75 / 10.59 | 1.93 / 3.38 | 1 |

**The strict 10% end-to-end median overhead target is not established.** The long
comparison includes slower current medians and worse tails. Source-level CPU draw
medians stayed around 0.254–0.265 ms, while readback medians ranged 0.624–1.157 ms;
GPU/TD fence time and host scheduling also varied. Summed plugin cook medians were
0.535/0.562/0.571/0.540 ms in ABBA order. This narrows the observed variation to
GPU completion/TD scheduling more than JS draw work, but does not prove a single
cause. Do not discard the slower current runs or claim a scheduler speedup.

The typical frame budget is useful for four sketches on this machine, with
substantial room below 16.67 ms in median runs. Tail latency can consume that
room. “Missed” includes host start scheduling slip plus GPU-ready wall time;
GPU-ready alone excludes that slip and excludes the harness's subsequent pixel
validation readback. Image latency includes the deliberately buffered frame.

## Remaining limits

System suspend/resume accounting, other GPUs/OS versions, strict power controls,
and extended multi-hour memory/thermal soaks are uncharacterized. Syphon lifecycle
and rendering are tested, but this timing study does not include a comparable
four-instance Syphon end-to-end latency distribution. Input transfer is covered
by existing rendering regressions and the blocking-preparation independence test;
this study prioritizes CPU output. The 100 ms Dawn wait interruptibility bound
and synchronous-JS limitations are described in TIMING.md.
