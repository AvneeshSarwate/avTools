# Execution policy validation — 2026-10-20

Apple M1 Max, 32 GiB RAM; macOS arm64; TouchDesigner 2025.31550. The native worker
and TD fixture passed. [TD measurements](../../../test/chop/results/2026-10-20-execution-td.json)
and [native measurements](../../../test/chop/results/2026-10-20-execution-native.json)
include all one/four-instance scalar/10k XY scenarios, percentile distributions,
CPU usage, output age and coalescing. These are short controlled runs, not a hard
realtime guarantee or a prediction for arbitrary user sketches.

## Four CHOPs in TouchDesigner

The math workload copies both 10k-point XY channels, computes `sample * .75 + 1`,
and writes both channels. The driver checks coherent opposite-channel results.
Artificial work is a JS busy loop, so it consumes CPU rather than simulating an
idle transfer wait. Each scenario runs 100 TD frames, discarding the first 20.
Times below sum all four operators' `cpuCookTime` per frame, including TD overhead.

| Work per callback | Mode | Median total cook | p95 | p99 / max | Median input age | Reused output |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| XY math | Buffered | 0.255 ms | 0.326 ms | 0.367 ms | 16.67 ms | 0% |
| XY math | Blocking | 1.456 ms | 1.700 ms | 1.891 ms | 0.29 ms | 0% |
| XY math + 10 ms | Buffered | 0.296 ms | 0.396 ms | 0.419 ms | 16.66 ms | 0% |
| XY math + 10 ms | Blocking | 41.676 ms | 41.835 ms | 42.376 ms | 10.30 ms | 0% |
| XY math + 50 ms | Buffered | 0.221 ms | 0.300 ms | 0.433 ms | 83.53 ms | 67.1% |
| XY math + 50 ms | Blocking | 201.828 ms | 201.976 ms | 206.262 ms | 50.33 ms | 0% |

Buffered TD frame intervals stayed near 16.7 ms. Blocking 10/50 ms work increased
median frame intervals to 46.5/206.7 ms. Buffered mode removes the main-thread JS
wait, not the work: process CPU was 55% for basic XY, 287% with four 10 ms loops,
and 436% with four 50 ms loops, where 100% means one logical core. The no-driven-
operator TD baseline was 46%. CPU includes the UI, upstreams and worker threads;
small baseline differences are noisy and should not be treated as precise worker
CPU attribution. Blocking artificial loads used roughly one core because their
callbacks ran serially in TD's dependency order.

At 50 ms load, about 67% of offered buffered inputs were coalesced. The latest
result's input age ranged up to 108 ms in the observed XY run. There is no mandatory
one-frame delay and no target same-frame hit rate; readiness at collection decides.
A native test confirms eventual newest-input processing after overload. Publication
reuse and source request ID are separate from TD frame numbers.

## Four 1080p TOPs

Each draws an animated circle on a solid background. No input textures or Syphon
are used. Pretrigger submits in `onFrameStart` and collects in `onFrameEnd`.

| Mode | Median total cook | p95 | Maximum | Median total upload enqueue |
| --- | ---: | ---: | ---: | ---: |
| Buffered | 0.530 ms | 0.640 ms | 0.755 ms | 0.278 ms |
| Blocking | 5.322 ms | 7.748 ms | 8.621 ms | 0.316 ms |
| Pretrigger | 0.618 ms | 0.761 ms | 0.799 ms | 0.267 ms |

Pretrigger totals include both submission and collection cooks. Upload enqueue
is already included in the cook totals; this is CPU-side TD upload cost, not a
GPU completion trace. All modes held approximately 16.7 ms TD frame intervals in
this simple output-only workload. Input-texture transfer performance was not
remeasured; that GPU download/upload pipeline was left intact.

A separate live test switches a busy 50 ms buffered TOP to blocking: it waits
about 103 ms for the earlier render plus its fresh render and returns source frame
age zero. Pretrigger overrides the requested wait toggle. Actual downloaded pixels
verify two queued pulse names were captured before Event Name was edited again.

## Correctness, timing and memory

- Native synchronous regression: 4,000 chained same-cook checks; four instances
  with 10k and 100k XY buffers; reloads, independent timers, input copies, cleanup,
  stale hosts, nonfinite values, exceptions and 100 resets.
- Native execution-policy checks: buffered first setup; preserved state across
  toggles; own-request blocking; coalescing with FIFO pulses; reload barriers;
  stable/coherent timer publications without a cook; no publication for unchanged
  timer state; schema zeros, failed schema changes, source errors, callback and
  independent-timer watchdogs, overflow and recovery. Seeks/loops preserve frame
  metadata while accumulated TD elapsed time remains correct.
- Native TimeContext: both 21-case suites plus invariant checks passed after the
  bounded event-loop-turn change. No polling loop or per-cook thread was added.
- ThreadSanitizer: 20,000 concurrent 10k XY publication exchanges passed with no
  race reports. This instruments the standalone exchange, not third-party V8,
  Dawn or TouchDesigner. The actual V8 bridge was exercised separately.
- Native soak: 24,000 buffered 10k XY requests; 23,064 coalesced in that run. Whole
  process physical footprint briefly reached 43.1 MiB during warmup, then stayed
  around 11.9–12.4 MiB in the final nine batches, ending at 11.9 MiB. Queues drained
  to the newest request each batch. This is a short overload soak, not a multi-day
  leak proof.
- Live TD: pulse names captured without intervening cooks, state-preserving
  toggle, paused independent timers, slow buffered cooks, fresh blocking inputs,
  multichannel coherence, and TOP pretrigger/mode/pixel checks passed. Zero
  errors or coherence failures occurred in all 28 benchmark scenarios.

The JSON records measured and shipping bundle identities. The final rebuild adds
Python GIL acquisition for UI-originated pulses and corrects the control-queue
capacity check; neither changes the measured ordinary cook/transfer workload.
Final packaged plugins are covered by native policy and live TD functional checks.
The standalone `ExecutionModes.toe` was reopened with the shipping CHOP bundle:
all six functional assertions passed, including a maximum 0.353 ms buffered cook
during the 50 ms callback test. All four instances returned value 14 with no
errors or warnings. Clicking the actual UI Send Pulse button changed the pulse
output from 0 to 1. The final packaged project was reopened again after improving
its opening layout; it frames the network and shows the first CHOP's Script controls.
SDK declarations and CLI-embedded project templates match, and a fresh CLI init
contains the updated contracts.

The remaining costs are native capture/allocation, output copies, TD operator and
upstream work, and CPU scheduling contention. Destruction still joins workers;
watchdogs cannot guarantee interruption inside an unresponsive native binding.

## Fixture cleanup caveat

After the tests completed, deleting the benchmark helper operators caused TD's
UI thread to enter its crash handler. The sampled stack was in TD `libUT/libUI`
queued callbacks; V8 workers continued running timers. An earlier TD crash before
this feature showed the same `libUT` callback chain beneath `libC_DAT`. This
supports a queued DAT/UI cleanup issue, but is not a full root-cause proof.
The benchmark now reuses helper operators and restoration keeps them inactive.
The standalone example is generated in a fresh project, without those helpers.
