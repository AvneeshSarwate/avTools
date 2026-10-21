# Logging verification — 2026-10-21

The delivered implementation is documented in [LOGGING.md](../../LOGGING.md).
Open [Logging.toe](../../native/td/logging-example/Logging.toe) to try it.
Console mirroring was explicitly deferred by the user and is not implemented.

## Reproduction

From the repository:

```sh
node packages/native-webgpu/test/logging/run.mjs
AVTOOLS_BUILD_BINARY="$PWD/tools/td-native-build/target/release/avtools-build" \
  node --test tools/td-native-build/tests/environment.mjs
python3 packages/native-webgpu/test/logging/summarize.py
```

In a freshly opened Logging.toe, execute `verify_td.py` in Textport using its
absolute path. It installs an isolated staged verifier inside the example. The
stages use TD's `run(..., wallTime=True, delayRef=op.TDResources)` so verification
continues while playback is paused. It writes `td-result.json`.

`verify_and_benchmark.py` runs correctness first and starts `benchmark.py` only
on success. The benchmark creates a separate `logging_benchmark` component,
including four buffered 1920×1080 TOPs and a blocking CHOP that interpolates two
10,000-point XY buffers every frame. Close Textport to expose the network during
the visible-Info-DAT cases. Reopen Logging.toe afterward to discard test networks.

The old baseline comparison uses the pre-logging `fb99bddcf431` TOP and
`ab5e3d6d5fef` CHOP if available in `build/logging-baseline` or `prebuilt/macos-arm64`.
Those superseded development artifacts are not shipped. A fresh checkout skips
that historical comparison and runs the current cases; archived result files
record the original comparison. Rebuilding those historical binaries requires
the matching prior sources, not just changing a marker file.

## Correctness

Native `native.cpp` passes filtering, multiple arguments, cycles, accessor/proxy
and conversion-hook safety, primitive/Error/typed-array previews, Unicode and
embedded NULs, deep concatenated strings, truncation, mutation snapshots, startup and failed setup, real
exception diagnostics, reload generations, Off, eviction, concurrent snapshot/
clear/capture races, timer-only capture, frame progress under flooding, and sink
handle destruction with pending timers. The overflow probe evicted 746 old
entries while retaining exactly 256. Deliberate snapshot/clear contention caused
new-message drops (583 maximum between clears in this run), confirming that the
producer does not block behind the snapshot reader. `log_dropped` exposes these
separately from history eviction.

Live TD 2025.31550 verification passes both operator families, two observers,
instance isolation, pulse/error messages, actual setup failures, preserved build
and reload diagnostics, Clear/Reset/Reload, blocking/buffered/pre-trigger modes,
renaming, and deletion with timers pending. A real Dawn mapped buffer is unmapped
before logging its typed view; the formatter safely reports it as detached.
The standalone `.toe` was reopened with plugin paths resolved from the repo.

Paused verification demonstrates the important cache behavior: a passive Info DAT
read remains stale; **Refresh Logs (No Script)** advances the retained log
sequence while runtime cook counts and CHOP script frame state remain unchanged.
TD counts one native metadata-only cook. Ordinary Info DAT reads add zero source
cooks. See `td-result.json` for before/after values.

Four runtime-environment tests pass using the packaged release builder, including
IntelliSense completion of all five console methods with no DOM/Node globals.

## Native formatting/capture cost

`native-result.json` includes 1,000 ordinary CHOP calls per scenario, plus batches
of 1,000 console calls timed inside JavaScript (180 measured batches after warmup).
Batch results separate formatting/capture from TD and worker-dispatch overhead:

| Call | Median per call | p95 |
| --- | ---: | ---: |
| Logging Off | 0.007 µs | 0.008 µs |
| Filtered Debug | 0.007 µs | 0.007 µs |
| Short Info message | 0.472 µs | 0.513 µs |
| 20,000-value Float32Array preview | 0.693 µs | 0.739 µs |

These are microbenchmarks, not guarantees for arbitrary objects or user argument
expressions. A short-message ordinary CHOP cook including dispatch measured
0.017 ms median / 0.031 ms p95; a burst of 100 messages measured 0.069 / 0.099 ms.
Native process footprint went from 17.26 to 17.67 MiB during the flood/race check.
The ring and retained Info DAT snapshot have a fixed combined allocation of
about 2.02 MiB per operator; snapshots and previews cannot grow with log volume.

## TD end-to-end CPU measurements

Same Mac, TD 2025.31550, 60 Hz, two repetitions of each case; 180 frames per case,
first 30 discarded (300 measured frames per case). Four buffered 1080p TOPs draw
an animated circle; the CHOP copies four 10k input arrays, performs 20k scalar
interpolations, and writes two output arrays. Inputs are locked test buffers;
all 18 stage-end output checks validate real interpolation and 10,000 samples.
No recompilation or restart is included in the measured frames.

| Case | Median CPU per TOP | Median CHOP CPU | Combined source CPU median / p95 |
| --- | ---: | ---: | ---: |
| Previous plugin, no logs | 0.115 ms | 0.614 ms | 1.167 / 1.698 ms |
| Current, no messages | 0.130 ms | 0.611 ms | 1.186 / 1.648 ms |
| Logging Off, one call/frame | 0.129 ms | 0.582 ms | 1.162 / 1.604 ms |
| Capture one short message/frame | 0.130 ms | 0.606 ms | 1.191 / 1.685 ms |
| Filtered Debug, one call/frame | 0.132 ms | 0.604 ms | 1.177 / 1.590 ms |
| Large-buffer preview/frame | 0.136 ms | 0.605 ms | 1.210 / 1.565 ms |
| 100-message burst/frame/operator | 0.120 ms | 0.728 ms | 1.300 / 1.630 ms |
| Visible Info DATs, short messages | 0.276 ms | 0.703 ms | 1.823 / 2.168 ms |
| Visible Info DATs, large previews | 0.289 ms | 0.691 ms | 1.875 / 2.359 ms |

TD charges construction of the source's selected Info DAT table to the source
cook. With five visible log tables, their additional Info DAT cook CPU was about
0.360 ms median combined. For short messages, the combined source + Info DAT CPU
was **2.195 ms median / 2.695 ms p95**. This is metadata/display work, not V8
formatting cost. Keep Info DAT View on Diagnostics when not inspecting messages;
capture still happens, but this avoids generating the full table each cook.

Logging Off matches baseline within normal scheduling variation. The first
implementation read view/level through Python in Info callbacks and cost about
0.13 ms extra per TOP even when Off. That bridge was removed from the cook path;
controls now come from OP_Inputs, and Diagnostics copies counters only. The
before-optimization summary is retained to explain the finding, but its hidden
Info DAT cases also had Logs view selected and are not identical configurations.

For short capture, per-TOP worker time was 1.324 ms median / 1.948 ms p95, and TD
upload enqueue was 0.058 / 0.144 ms. Worker work overlaps across TOPs; those times
must not be added to the TD cook sum. Upload enqueue CPU is included, not an
isolated GPU-completion measurement. The complete TD frame interval stayed near
16.67 ms median, with p95 below 17.2 ms across every final case. UI rendering,
GPU work, scheduling, and unrelated TD work remain part of that interval; it is
not all attributable to console logging.

TD peak RSS reached 1,995 MiB in the combined comparison process (both old and new
plugin groups, GPU surfaces, V8, fonts, and example operators remain loaded).
That high-water mark does not isolate logging allocation or prove a leak. Use
the native flood measurement and fixed storage dimensions for logging's bound.

Raw measurements: `native-result.json`, `td-result.json`, `td-performance.json`,
and `td-performance-summary.json`. New shipping tags for this run:
`AvToolsSketch-c03de3a82add.plugin`, `AvToolsChannels-b0db06eab073.plugin`;
native builder `731c1a28ce12`.
