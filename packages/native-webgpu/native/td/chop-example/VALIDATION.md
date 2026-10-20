# CHOP validation — 2026-10-20

Apple M1 Max, 32 GiB RAM; TouchDesigner 2025.31550; macOS Apple Silicon.
Plugin: `AvToolsChannels-dd2ceb1eeb2e.plugin`. Results are development-machine
measurements, with other desktop work present, not a dedicated real-time system.
The warm steady-state statistics below exclude the first 50 frames of each TD
case and exclude startup/reload. Timings can spike under OS or application load.

## Simple state and scalar channels

The final TD run checked 4,200 pass-through results across four chained CHOPs,
with **zero stale/mismatched results**. There were 1,000 measured frames.
The second through fourth pass-through CHOPs had median `cpuCookTime` of
0.159–0.184 ms and p95 of 0.259–0.305 ms. The first node measured 0.317 ms median.
The two TimeContext animation instances measured 0.160 and 0.194 ms median;
p95 was 0.263 and 0.301 ms. The sum of the six reported cook times measured
1.238 ms median and 1.649 ms p95. These are TD's cook-duration measurements,
including host waits, not a measurement of CPU cycles or total process CPU usage.

The direct native harness measured 0.024 ms median and 0.058 ms p95 for simple
channel calls, excluding TD. This difference is why the TD measurements are the
useful frame-budget numbers. There is no deliberate one-frame output delay:
current inputs and `onCook` writes propagate in the same cook.

The live TD assertions also covered current inputs changed within the same TD
frame, timers advancing during a 160 ms interval with no TD cooks, eased ramps,
instance isolation, named pulses, parent component pulse routing, failed-setup
warnings preserving active state, nonfinite output errors, reset recovery, and
multiple wired inputs with identical channel names.

[Raw scalar results](../../../test/chop/results/2026-10-20-chop-td.json).

## XY buffers and actual math

Four separate CHOP instances were cooked sequentially each TD frame. The test
used two channels (`x`, `y`), with the indicated number of points **per instance**.
For input tests, every frame changes the values of the full input buffer. The
interpolation case reads **two XY buffers** plus a changing scalar mix input and
computes `a + (b - a) * mix` for every X and Y sample. The outputs were compared
sample-for-sample against a float32 reference for all four operators, every frame.

Each case ran 550 frames, including 50 warmup frames: **8,800 complete output
buffers checked, zero failures**. A buffer here contains both X and Y channels.

| Work per instance | Four cooks, median | Four cooks, p95 | Maximum observed |
| --- | ---: | ---: | ---: |
| Generate 10k XY points (no input connections) | 1.401 ms | 1.990 ms | 4.439 ms |
| Read 10k XY points, multiply by 2 and add 1, write output | 1.595 ms | 2.016 ms | 8.697 ms |
| Interpolate two 10k XY buffers, write output | **1.735 ms** | **2.125 ms** | 5.517 ms |
| Interpolate two 100k XY buffers, write output | **8.611 ms** | **10.142 ms** | 15.830 ms |

These are elapsed times around the four TD `.cook(force=True)` calls. They
include the C++ operator, owner-thread handoff/wait, TD-to-V8 input copies, JS
array reads and arithmetic, validation/state writes, and V8-to-TD output copies.
They exclude the Python reference comparison and upstream test-buffer generation,
which happen outside the measured region. They do include the completed TD output
buffers; there is no GPU upload/readback in this CHOP path.

The 10k interpolation case's per-operator TD cook medians were 0.402–0.435 ms,
with p95 0.515–0.577 ms. Upstream NumPy/Script CHOP buffer generation measured
0.223 ms median and 0.318 ms p95 combined for both inputs and mix. At 100k it was
0.624 ms median and 0.759 ms p95. The fixture uses bulk `Channel.copyNumpyArray`
([TD API](https://docs.derivative.ca/Channel_Class)), avoiding per-sample Python
assignments that would dominate the result.

At 60 Hz, four 10k-point interpolators used about 13% of the 16.67 ms frame budget
at p95, before upstream generation and other TD content. The 100k case used about
61%, with occasional near-frame-budget spikes. A [repeat through the saved Stress.toe](../../../test/chop/results/2026-10-20-saved-stress.json) also had zero sample failures; its 100k
case reached a 26.84 ms worst-case spike. These figures are not guarantees
of whole-project FPS. Independent timing tasks add work outside the cook timings.
The test performs copies rather than transferring ownership of TD's memory.

[Raw XY results](../../../test/chop/results/2026-10-20-chop-stress-td.json).

## Native/runtime and tooling checks

- Native harness: 4,000 scalar same-cook checks; four instances × 250 frames at
  both 10k and 100k XY points, checking every sample after affine math. 10k median
  0.136 ms / p95 0.192 ms per call; 100k median 1.118 ms / p95 1.743 ms.
- Timers without cooks; frame waits only on cooks; owned input/output copies;
  pulse delivery; reset/reload; failed-candidate cleanup; stale-host rejection;
  async cook rejection; background errors; finite/buffer-length checks;
  100 reset cycles and clean destruction.
- Existing TOP TimeContext/graphics regression passed using the new shared
  runtime and existing TOP resources, including input preparation and Syphon.
- Five builder/lifecycle/watcher tests passed, including mixed TOP/CHOP entries,
  CHOP callback types, output-layout validation, unchanged outputs, last-good
  builds, and filesystem save/recovery.
- IDE project native checker passed scalar and 10k-point bundles with resets
  and pulses. Live TD watcher test observed the four-node chain's output offset
  change from 0 to 28 after adding 7 to each instance's TypeScript source, then
  back to 0 on restoring it, without manual reload.

## Reproduce

From `packages/native-webgpu`, run `npm run test:chop`. In the channels IDE
project, run `npm run check`. Watcher tests run from `tools/td-sketch-build` with
`npm test`; restricted macOS sandboxes may prevent filesystem events.

Open `Channels.toe`, then run `verify.py` through TD Textport using
`runpy.run_path('/absolute/path/to/verify.py')`. It adds a temporary verification
DAT and writes an ignored report under `packages/native-webgpu/artifacts/`.

Open `Stress.toe` and pulse its parent component's **Restart** parameter. This
runs the four XY cases and writes `stress-results.json` beside the `.toe`.
The benchmark has an Execute DAT solely to demand cooks, compare samples, and
record timings. Ordinary CHOP use needs no Execute DAT or pre-trigger arrangement.
The saved stress network defaults to two 10k XY inputs and interpolation.
