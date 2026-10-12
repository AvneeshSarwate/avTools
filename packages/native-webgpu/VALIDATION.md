# Native port validation

Validation machine: Apple M1 Max (32 GPU cores), macOS 15.7.7 (24G720),
arm64, Node 22.20.0, TouchDesigner Commercial 2025.31550. Revision/toolchain
pins are in `native-manifest.json`. Results below are hardware checks on this
machine, not claims about other Node majors, platforms, or driver versions.

## Confirmed

- Official npm `webgpu@0.6.1` and unmodified pinned source addon: offscreen
  triangle and exact selected pixels passed (`artifacts/baseline-*.json`).
- Patched binding: 10 forced-GC device lifetimes passed. The original binding
  crashed in ProcessEvents after its JS GPU owner was collected; the explicit
  instance/flags ownership patch fixes that observed failure.
- Portable P5 renderer: all 15 existing Deno scenes compared byte-for-byte equal
  through Node/Dawn, including geometry, stencil paths, text and frame persistence.
  Rust shaping, variable-font metrics, 64-bit glyph keys, and disposal checked.
- Image drawing: selected pixels passed for transform/rotation, tint and alpha,
  nearest/linear filtering, vertical flip, canvas-boundary clipping, and ordering
  with geometry/text. Input textures are borrowed through submission; arbitrary
  clip masks and HDR formats are not part of the added API.
- Renderer/text lifetime: 20 atlas-growth/disposal cycles, 1,880 glyph uploads,
  second-half RSS increase approximately 9 MiB (short test, not a leak proof).
- Native windows: three cycles with two windows, resize, hide/show,
  minimize/restore, cached acquisition and close/recreate passed. One initial run
  acquired no visible frames; rerun passed. Physical movement between displays
  with different Retina scales has not been tested.
- Minimal Node livecode host: launch, replace, stop, panic, pixel output, and
  idempotent close passed. This does not migrate the full Deno editor/server.
- Npm archive: installed in an empty temporary project and rendered real text
  with PATH excluding build tools. This is an equivalent clean environment on
  this Mac, not a second clean machine. The final rebuilt archive and optional TD
  declaration imports passed strict TypeScript compilation in another fresh directory.
- Syphon native receiver processes: three independent channels checked color,
  alpha, orientation, frame ordering, crop, resize, invalid resource ownership,
  and invalid texture lifetime. Normal publication uses Dawn's Metal queue and
  performs no CPU readback; receiver readback is test instrumentation.
- TouchDesigner editor: all three receivers produced expected dimensions
  (320x240, 400x280, 480x320) and corner RGBA values. The additive component was
  saved as `artifacts/td/syphon-receivers.tox`; existing user operators untouched.
- TouchEngine: two simultaneous independent engine instances, then a new
  connection, each produced 179 validated frames on all three outputs. Tests
  use the saved .tox without an editor window. Paid TD/TouchPlayer licensing is
  required. SDK local build copies are ad-hoc signed as required by its loader.

## Additional confirmed checks

- Combined previews + Syphon: three two-window lifecycle cycles, then all windows
  closed, while the native receiver continued receiving (357 frames, final ID 360).
- Syphon reconnect, graceful client teardown, and 12 rapid channel/source disposal
  cycles passed. The server can answer late client discovery while publishing.
- Representative old/new comparison: three 1920×1080 channels for 60 seconds each.
  New Node/Dawn publication delivered 57.33 fps versus 11.22 fps for the retained
  Deno CPU-transfer route. Process CPU time was 3.08 versus 19.56 ms/frame.
  Observed receiver latency averaged 4.19 versus 91.98 ms (p95 7.44 versus 102.81).
  The receiver measurement includes its own GPU readback; this compares whole
  runtime/transport paths, not an isolated transport microbenchmark. This was an
  interactive development machine, not an isolated lab run. New publication had
  no failed/dropped submissions. Second-half RSS growth was 17.75 MiB new and
  12.77 MiB old; short runs and the sketch's changing text cache are not leak proof.
- Plain V8: two independent GPU/P5/Rust-text instances through three disposal
  cycles, GPU promises, forced GC, exception reporting, infinite-loop termination,
  and subsequent evaluation passed. No Node or Deno runtime is linked.
- C ABI worker bridge: three cycles, two instances each, 100 ordinary cooks,
  multi-sample CHOP snapshots, asymmetric TOP input, padded rows, text, reload,
  resize, reset, JS errors, pulse delivery, and sync/async timeout disposal passed.
- TouchDesigner editor: two actual custom TOPs rendered Rust text (142 selected
  white text pixels each), CPU TOP inputs, CHOP control changes, isolated state,
  exactly-once pulse events, syntax and draw errors, resize, reset, and recovery
  from a runaway draw. The runaway check stopped in approximately 1.01 seconds.
- Custom TOP through TouchEngine: two simultaneous processes, each with two
  operator instances, then another load/unload, produced 90 checked frames per
  output per process. CHOP input changes were driven through TouchEngine itself.

The first native plugin load exposed Chromium allocator interception affecting
TouchDesigner's pre-existing allocations and crashed the host. Disabling
`use_allocator_shim` and `use_partition_alloc_as_malloc` fixed that observed
conflict. The corrected plugin passed the editor and TouchEngine checks above.
The plugin exports only its required entry points; its runtime exports five C
functions, uses a private libc++, and prefixes embedded Syphon symbols/classes.

## Bugs exposed by real receivers

The repository's older Syphon framework crashed during client disconnect
(confirmed Objective-C use-after-free). The package builds current pinned
upstream source instead. A crop fixture exposed an upstream Metal region bug;
`syphon-0001-metal-region.patch` corrects its viewport and texture coordinates.
The native framework's exact upstream shader is compiled through MTLDevice so
full Xcode's offline Metal compiler is unnecessary.

Late TouchEngine connection initially produced blank textures: Node's libuv loop
was not processing Cocoa Syphon discovery notifications. Publication and client
state polling now pump Cocoa without waiting, including no-client frames. The
late-connect/reconnect TouchEngine test protects this behavior.

## Embedded output performance

A 1920×1080 sketch with moving geometry, Rust text and frame-ID markers ran for
600 frames per mode on the machine above. Both held the 60 fps schedule. The
TouchEngine probe checks texture-origin metadata, format, upright orientation,
and matching top/bottom frame IDs after a 30-frame warm-up.

| Output | Mean TD cook | p95 TD cook | Observed fps | Maximum observed frame lag |
| --- | ---: | ---: | ---: | ---: |
| CPU TOP (default) | 6.98 ms | 12.18 ms | 60.04 | 0 |
| Syphon-only plus built-in receiver | 5.91 ms | 6.34 ms | 60.05 | 0 |

The separate C ABI runtime benchmark averaged 4.51 ms CPU mode (1.58 ms readback
wait) versus 1.05 ms Syphon-only (0 ms readback). The external receiver checked
604 Syphon frames. These figures measure different boundaries: TD cook includes
host/receiver work; C ABI runtime excludes TD. Probe pixel readback is test-only
and happens outside the measured TD cook. The extra fixture Out TOP starts the
CPlusPlus publisher; CPU mode exposes a duplicate output to the test harness.
There were no wired TOP inputs in the performance sketch; input CPU transfers add
cost. This is a short run on an interactive machine, not a guarantee for arbitrary
sketches or sustained workloads. Earlier exploratory runs had higher jitter.

The final editor Syphon check received 191×79 pixels with upright text, red top,
green bottom, and reported 1,523 publications with zero drops. CPU output remains
the default; Syphon is optional and its name is a parameter. Receiver timing is
asynchronous even though this test observed no lag after warm-up.

A discarded diagnostic fixture that forced a receiver cook from an onFrameStart
callback triggered TD's crash recovery once. Its stack sample did not establish
a cause. The final fixture uses ordinary downstream cooking and passed both the
editor checks and repeated headless tests; it contains no such callback.

## Multi-instance readback investigation (2026-10-12)

Historical baseline, before the buffered implementation below. The following
code descriptions and measurements refer to that synchronous revision.

On the M1 Max, macOS 15.7.7, TD 2025.31550, a private copy of the existing plugin
was instrumented at `SketchTOP::execute()` entry/exit, recording monotonic times,
thread IDs, input dimensions/values, and existing runtime stage metrics. Production
source/binaries and the example project were not changed. Fixtures were constructed
using TD's `toeexpand`/`toecollapse`; no editor automation was needed.

Each case ran 180 frames with the first 30 excluded. All outputs were 1920×1080
RGBA8, with text, a moving circle, and a pixel-coded current frame identifier.
Input cases used a changing 1920×1080 Constant TOP, sampled with `p.image()`.
Every output's dimensions and current frame identifier were checked, and trace
records verified that the input really had 1080p dimensions and changing pixels.

Mean summed TOP `execute()` milliseconds per frame:

| Instances | Output only | One shared input wired to each | Separate input per instance | Output-only map wait, summed |
| --- | ---: | ---: | ---: | ---: |
| 1 | 5.65 | 10.91 | 10.81 | 1.57 |
| 2 | 10.15 | 17.20 | 19.47 | 3.00 |
| 4 | 19.37 | 32.85 | 31.00 | 5.92 |
| 8 | 35.28 | 60.39 | 59.92 | 11.56 |

All 12 cases used a single TD cook thread with **zero overlapping execute
intervals**. The no-input execute p95 values were 9.40, 13.00, 25.32, and 40.85 ms.
With separate inputs, summed input download/getData time averaged 1.63, 2.87,
4.88, and 9.33 ms; the bridge's input preparation/snapshot/upload phase averaged
4.23, 7.53, 10.62, and 20.59 ms. That phase includes bridge setup/pumping, not just
the upload itself. Adding inputs also adds image drawing, so differences between
columns are not isolated readback costs. Sharing an upstream source did not remove
each plugin instance's download/snapshot/upload path.

These are short interactive-machine measurements, not isolated hardware limits
or sustainable FPS claims. The host sleeps between frames and performs its own
pixel-verification readbacks after the measured cooks. Timing excludes those host
readbacks, per-cook trace-file writes, other TD cooks, and any GPU work completing
after `execute()` returns. Instrumentation and host pacing may affect scheduling
and load. Do not infer achieved FPS by inverting these values. Nevertheless, four
output-only instances already exceeded the 16.67 ms frame budget in mean summed
execute time in this run.

The code explains the serialization:

- Output: `SketchTOP.cpp` calls `avCook()`, whose `AVSketch::sync()` waits on a
  future. The worker calls `copyTextureToBuffer()`, awaits `mapAsync()`, copies
  mapped rows into the TD-owned output, and only then releases the calling cook.
  The next TOP has not submitted its render/readback while this one waits.
- Input: `SketchTOP.cpp` immediately calls `OP_TOPDownloadResult::getData()`
  after requesting each input download. The SDK explicitly documents that this
  stalls for completion and is safe to call on another thread. The worker then
  makes an owned ArrayBuffer copy and uses `queue.writeTexture()`.
- Dawn's pinned Metal backend allocates mappable buffers with Shared storage,
  but map completion is tied to the buffer's last GPU-use serial. Unified memory
  does not remove synchronization. The runtime's 1 ms polling sleep also occurs
  after a pump that has completed the operation; this is avoidable overhead in
  our implementation, not an intrinsic Metal readback requirement.

### Feasible nonblocking designs

A separate native bridge experiment submitted eight independent, existing
`AVSketch` instances serially and then concurrently, using the same 1080p no-input
sketch and 150 measured frames after 30 warm-up frames per mode. Each mode checked
every instance's output frame identifier. Serial wall time averaged **39.96 ms**
(p95 54.85); concurrent wall time averaged **5.39 ms** (p95 5.91), including caller
thread-launch/join overhead. In concurrent mode the sum of worker runtime was
36.91 ms and the sum of map waits was 15.86 ms, both greater than elapsed wall
time: worker processing and waits overlapped. This uses the existing runtime;
there is no asynchronous production TOP implementation hidden in the test.

This is a capability experiment, not a TD FPS forecast: it excludes TD input
downloads/output uploads, runs unpaced, and does not measure an asynchronous
TOP's queue policy or end-to-end latency. It establishes that the current runtime
does not impose a global serial lock across instances. Evidence is
`concurrency.jsonl` in the same artifact directory. Build with
`node scripts/build-bridge-probe.mjs`, then run `build/bridge-concurrency` with
the bundle's `Contents/MacOS/libavtools_runtime.dylib` and `Contents/Resources`
paths, optionally followed by instance count and measured frame count.

The installed SDK provides concrete support, not merely a hypothetical approach:
`CPUMemoryTOP.cpp` has a threaded producer/consumer output example and an input
download example that retains the preceding download. `TOP_Context::createOutputBuffer()`
is documented as thread-safe; upload occurs during the main-thread `execute()`.
`OP_TOPDownloadResult::getData()` may wait on a worker while the main cook returns.

A buffered plugin would snapshot controls and retain owned download results on
the cook thread, enqueue work, and upload only an already-completed output. Each
instance's worker could wait independently, allowing work/waits to overlap. It
needs bounded queues, coherent frame/control/pulse snapshots, stale-result rejection
after resize/reset/reload, and an explicit repeat/drop policy when work is late.
Simply moving work to a thread while keeping the future wait does not help.
Delaying by one frame alone cannot guarantee no stall if that frame is still busy.
Buffering generally adds one or more frames of latency; throughput remains limited
by GPU work, copies, bandwidth, and CPU submission/upload overhead.

For current-frame semantics, the data dependency itself is unavoidable on this
CPU path. Coordinating all independent sketches to submit before waiting could
reduce serialization without intentionally delaying a frame, but would require
a batch/coordinator architecture; the existing per-TOP execute contract provides
no such split. Syphon Only removes the output CPU round trip now, while wired
inputs retain their CPU round trip. The installed API offers CPUMem/CUDA, not a
direct Metal input/output interchange for this plugin.

Sources: [Derivative C++ TOP guide](https://derivative.ca/UserGuide/Write_a_CPlusPlus_TOP),
[Derivative cooking/threading explanation](https://derivative.ca/UserGuide/Intel_Processors_and_TouchDesigner),
[Apple shared storage synchronization](https://developer.apple.com/documentation/metal/mtlstoragemode/shared),
and the installed `CPUMemoryTOP` SDK headers/sample (paths in TOUCHDESIGNER.md).

This historical probe (`python3 test/td/readback_scaling.py 180 1,2,4,8`) requires
the synchronous source/bundle from revision `063d02a`; use `buffered_scaling.py`
with the current implementation. Detailed results, per-frame pixel checks, instrumented
source/bundle and per-instance traces are in
`artifacts/td/readback-scaling-1791817391159623000/`.

## Packaged consumer verification

The Node archive installed offline with install scripts disabled in a fresh
temporary npm project. With `PATH=/nonexistent`, ordinary Node 22 rendered text
and checked pixels; strict TypeScript checked the renderer, images, Syphon API,
and `@avtools/native-webgpu/td-sketch` declarations.

The TD ZIP was extracted to a different temporary directory. Its signatures and
native dependency paths passed inspection. The relocated native bridge passed
its lifecycle checks, and the packaged `Sketch.tox` produced 60 valid frames from
each of its two TOPs through TouchEngine, including a driven CHOP value change.
Both native runs used `PATH=/nonexistent`; no Node/Deno/compiler is needed by the
plugin. This emulates a consumer environment on the same Mac; it is not a claim
that developer tools were physically uninstalled or that another Mac was tested.
Evidence: `artifacts/package-consumers.json` and `test/package-consumers.mjs`.

## Scope and remaining limitations

- Manual cross-display Retina changes remain untested.
- The embedded runtime uses pinned Dawn napi_v8. That revision does not include
  the standalone runner assumed by the original plan; the local fixture exercises
  the same upstream binding directly.
- TouchDesigner custom TOP: installed headers expose API 12 CPUMem/CUDA, with
  no direct Metal output API. CPU TOP mode uses explicit transfers; optional Syphon output is a separate
  component-level GPU transport, not a direct Metal C++ TOP output.
- Full livecode editor migration, Windows/CUDA, and direct GPU TOP input are
  separate unimplemented capabilities.

## Reproduction

Build commands are in README.md. All GPU checks need hardware Metal access.
The task sandbox hides Metal adapters, so verification ran with host permission.
GUI tests and TouchDesigner fixture creation additionally require explicit user
permission in this task; ordinary headless verification does not use UI control.

```sh
node scripts/build-receiver.mjs
node test/syphon.mjs
node test/image.mjs
node scripts/build-touchengine-probe.mjs
# Create the .tox once through TD Textport using test/td/create_syphon_fixture.py.
node test/touchengine.mjs
# TD fixture setup: test/td/verify_syphon_fixture.py and create_benchmark_fixture.py
node test/td/touchengine-sketch.mjs
node test/td/touchengine-benchmark.mjs 600
node test/td/benchmark.mjs 600
```

Detailed machine-local evidence is under ignored `artifacts/`. Do not treat
build-only completion or a blank TouchEngine cook as pixel validation.

## Buffered transfers and end-to-end timing (2026-10-12)

Buffered CPU output is now the default. TD uploads a completed result and dispatches
new work without waiting for that job. Each instance uses its existing isolate
worker; input `getData()` waits and output buffer creation also run there. There
is no backlog of frame requests. An occupied worker causes the submission to be
skipped; TD retains its last output, and pending pulses/reset are retained.
`Wait for Same Cook (Blocking)` explicitly restores synchronous behavior.

The embedded Dawn binding now opts into `TimedWaitAny`, tracks asynchronous GPU
futures, and waits for their completion on the isolate owner thread. The old 1 ms
polling sleep is gone. Normal completion wakes the wait immediately. A 100 ms
maximum wait permits deadline checks when work stalls; a promise with no queued
producer sleeps until its deadline or destruction. Normal Node usage does not opt
into this behavior. The patch is checked in as
`patches/0004-embedded-event-driven-wait.patch`.

### Method

Same M1 Max / macOS 15.7.7 / TD 2025.31550. Real headless TouchEngine, four separate
1920×1080 RGBA8 TOP instances, 60 Hz host pacing. Each output contains a frame ID;
pixels validate output dimensions, orientation, advancement, and age. Tests account
for TD's 600-frame looping timeline. The normal scene uses background, moving
circle, and Rust text; the input variant additionally draws an independently
changing 1080p Constant TOP. The heavier scene draws **1,000 circles and 20 extra
text strings per sketch per frame**.

The host waits on its frame callback using a condition variable (no 5 ms polling
in the timed benchmark). It obtains all four Metal textures and waits on their
TouchEngine ownership semaphores in one GPU command buffer, then records
**cook-to-GPU-ready** wall time. This includes TouchEngine IPC/cooking, plugin
submission, TD output uploads, texture export, and host fence overhead. It is not
an isolated GPU-upload measurement, and subtracting the callback time does not
isolate upload bandwidth. A separate command samples pixels **after** that timing
boundary; its cost is recorded separately (typically 0.3–0.4 ms). All four
ownership fences were explicitly checked in the heavier run.

Plugin trace instrumentation records main-thread execute/upload-enqueue time and
worker intervals. Worker overlap is measured directly; output age/repetition checks
prevent a fast cook that silently serves old frames from looking successful.
The first 30 frames are excluded. Startup includes plugin loading and shader
compilation, and is not representative of steady-state performance. These are
runs on an interactive machine, not isolated hardware limits.

### Results

| Four 1080p instances | Measured frames | Cook-to-GPU-ready mean / p95 | Sum of plugin cook time, mean | Per-worker mean | Output age / repeats |
| --- | ---: | ---: | ---: | ---: | --- |
| Buffered, normal scene | 600 | 4.75 / 6.46 ms | 0.59 ms | 1.87 ms | Exactly 1 frame; 0 / 2,400 repeated images |
| Same-cook, event-driven wait | 600 | 10.00 / 13.56 ms | 6.34 ms | 1.43 ms | Exactly 0 frames; 0 repeats |
| Buffered, four independent inputs | 600 | 5.11 / 5.60 ms | 0.75 ms | 6.30 ms | Mean 1.003 frames; max 3; 0 repeats |
| Buffered, heavier scene | 1,800 (30 seconds) | 3.34 / 3.60 ms | 0.49 ms | 3.51 ms | Mean 1.0003 frames; max 2; 1 / 7,200 repeated images |

The heavier scene's lower host-path timing is **not** evidence that more drawing
is faster. These were separate runs with different system conditions, and the host
path displays the preceding frame while current-frame drawing occurs concurrently.
Worker draw/submission increased from approximately 0.28 to 2.20 ms per instance.

The normal buffered run recorded 3,600 overlapping cross-instance worker pairs
(six pairs per measured frame); same-cook recorded zero. Its per-instance output
map wait averaged 0.69 ms, versus the historical roughly 1.5 ms with polling.
The input run averaged 2.06 ms of worker-side download waiting and 2.71 ms of
snapshot/input preparation/upload per instance. Those waits overlapped, rather
than adding to the main cook one instance at a time. Input initiation still costs
main-thread time, and its GPU/CPU copies still consume shared resources.

Relative to a 16.67 ms frame budget, the normal buffered mean/p95 leaves roughly
**11.9 / 10.2 ms** after this measured host path. That is useful headroom, not a
promise that arbitrary downstream TD work fits: the workers also consume CPU/GPU
resources. Including host scheduling lateness, 1/600 normal buffered frames and
1/1,800 heavier frames exceeded their scheduled 16.67 ms deadline; their measured
GPU-ready maxima were 13.90 and 15.64 ms. The input run missed no such deadlines.
The heavier frame loop completed at approximately 60 Hz with one repeated image.

### Actual image latency, including the buffered interval

A further 150-frame-per-case run correlated monotonic worker start timestamps in
TD with the host timestamp after **all four upload fences** completed. This
measures a produced image's path from worker render start to uploaded/exported
texture readiness, including the wait for the following TD cook. It excludes
snapshot preparation before worker dispatch and physical display scanout.

| Mode | Render-start-to-uploaded-image mean / p95 |
| --- | ---: |
| Buffered, no input | 19.19 / 24.71 ms |
| Same-cook, no input | 6.45 / 11.72 ms |
| Buffered, independent inputs | 20.61 / 24.20 ms |

The buffered no-input images were all exactly one TD frame behind in that run.
Its per-TD-frame host path was 4.21 ms mean / 5.71 ms p95. These are different
quantities: **buffering improves frame throughput and available cook time by
accepting greater image latency**. The 4–5 ms frame-budget figures above must not
be described as total current-sketch-frame latency. Wall-clock variation also
includes host pacing/scheduling jitter. Synchronizing against all four output
fences conservatively includes any slower sibling's export completion.

### Correctness and lifecycle checks

- C ABI regressions: three cycles of two isolates, 100 ordinary cooks each,
  padded rows/orientation, owned CHOP/TOP snapshots, Rust text, source replacement,
  last-good output, reset/resize, draw errors, runaway JS, async deadlines, disposal.
- New wait coverage: 100 simultaneous maps together with queue completion,
  shader compilation info, and asynchronous compute-pipeline creation. Future
  batches are bounded to Dawn's supported wait count. Deferred creation/dispatch
  and destruction during an unresolved setup passed. Reset also recovered from
  failed deferred initialization after missing resources were restored.
- Real TD buffered fixture: two outputs, 540 frames. Two pulses read updated CHOP
  values; ten pulses queued during deliberately slow 65 ms draws arrived exactly
  once; dimensions changed; invalid source retained last-good output; draw errors
  were reported and recovered. One instance then awaited a never-resolving setup
  while Reset and three pulses were queued; it recovered after timeout with all
  three pulses, while the second instance kept animating.
- Optional Syphon Only: final buffered plugin passed 180 real TD engine frames;
  150 post-warmup receiver images checked 1080p orientation/frame IDs, with at
  most one frame of lag. The custom TOP returned its 1×1 placeholder.
- TypeScript typecheck passed. The checked-in `.tox` and `.toe` contain the new
  blocking-option definition; default remains buffered. Startup helpers allow
  worker completion on subsequent cooks instead of expecting an immediate result.
  Both the saved `.tox` and the component extracted from the standalone `.toe`
  passed 90-frame headless dimension/pixel/CHOP-change checks with the new plugin.

Reproduce from `packages/native-webgpu` after building the plugin/probes:

```sh
python3 test/td/buffered_scaling.py 630 4
AVTOOLS_BENCH_MODE=no-input AVTOOLS_BENCH_COMPLEX=1 python3 test/td/buffered_scaling.py 1830 4
python3 test/td/buffered_behavior.py
python3 test/td/saved_example.py
```

Local raw results and per-frame traces:

- Normal/same-cook/input comparison: `artifacts/td/buffered-scaling-1791819184534659000/`.
- Heavier final-runtime run: `artifacts/td/buffered-scaling-1791819458737905000/`.
- Buffered behavior: `artifacts/td/buffered-scaling-1791819383058274000/`.
- Final input-pixel/fence checks: `artifacts/td/buffered-scaling-1791819595577208000/`.
- Saved examples: `artifacts/td/buffered-saved-example-1791819782487545000/`.
- Syphon regression: `artifacts/td/buffered-syphon-1791819845536648000/`.
- Full image-latency correlation: `artifacts/td/buffered-scaling-1791820011296520000/`.

The benchmark builds a private, instrumented bundle; it does not overwrite a
mapped plugin or operate the TD editor. CPU output still uses a copy boundary.
Optional Syphon Only remains available to bypass output readback entirely.

## Early submission and same-frame collection investigation

**Feasible, with explicit project coordination.** The initial investigation below
used a private prototype. Production now offers the optional **Pre-trigger Mode**
toggle and shared Execute DAT described in the next section; it remains off by
default. Tested on the same M1 Max and TD 2025.31550 with headless TouchEngine.

TD provides [Execute DAT frame callbacks](https://derivative.ca/UserGuide/Execute_DAT)
and [explicit OP cooking](https://derivative.ca/UserGuide/OP_Class). Its ordinary
[cooking mechanism](https://derivative.ca/UserGuide/Cook) pulls dependencies when
their output is requested. The installed API12 `TOP_CPlusPlusBase.h` has no
separate native early-frame callback or asynchronous continuation of `execute()`.
`TOP_Context::createOutputBuffer()` is thread-safe, but its contract requires
returning the buffer through `TOP_Output` during `execute()`. A completed worker
therefore cannot independently upload into an already-finished TOP cook.

### Working scheduling pattern

The experimental Execute DAT runs these steps in `onFrameStart`:

1. Set each sketch to a submission-only phase and call `cook(force=True)` on all
   four. Each captures current inputs and dispatches its independent worker.
2. Do other work. The probe uses explicitly synthetic Python arithmetic, with
   zero, 20,000, or 60,000 sine evaluations. There is no sleep or readiness loop.
3. Set collection-only phase and force-cook all four again. Each makes one check
   of its completion slot, uploads a ready result, or retains the latest previous
   result. It does not submit another job or wait for the worker.
4. Return from the callback. Normal downstream consumers use those outputs.

An initial variant only changed the collection parameter and relied on ordinary
downstream pulling to cause the second cook. That did **not** reliably recook in
this fixture/build and left stale images. Explicit second cooks fixed it. This
is why an early forced cook followed by a parameter change is not sufficient
project boilerplate. More elaborate separate producer/collector operators or
custom Python submission methods are possible design directions, not tested APIs
of the production plugin.

The initial probe generated a private wrapper with an experimental `Stage` string
parameter and a retained fallback buffer. That prototype is preserved in the raw
artifact directories below. `test/td/early_submit.py` now benchmarks production's
toggle and shipped coordinator instead, still using a private instrumented bundle
and one saved `.tox` per case. `Stage` is not a production parameter.

### Measurements

Four independent 1080p outputs, no TOP inputs, 60 Hz pacing, first 30 frames
excluded. Pixels encode the source frame ID. Tests validate dimensions,
orientation, all four export fences, and agreement between pixel age and native
traces. Traces verify exactly four submit cooks followed by four collect cooks in
each measured frame. Alignment uses monotonic timestamps to exclude additional
TD startup/shutdown cooks, which can share absolute frame numbers with host cooks.

The total path below includes the synthetic intervening CPU work, TD uploads,
export, and host ownership-fence completion. It excludes subsequent validation
readback and display scanout. Synthetic work is a way to measure available overlap,
**not a recommendation to burn CPU time to reduce latency**. Real projects need
useful work in that interval; GPU-heavy TD content can also contend with Dawn.

| Scene / intervening CPU work, mean | Measured TD frames | Same-frame images | All four current together | Total path mean / p95 | Buffered baseline mean / p95, same work count |
| --- | ---: | ---: | ---: | ---: | ---: |
| Normal / none | 180 | 0% | 0% | 4.52 / 6.92 ms | 4.54 / 6.26 ms |
| Normal / 1.58 ms | 180 | 91.53% | 83.89% | 5.36 / 6.19 ms | 5.12 / 5.63 ms |
| Normal / 4.22 ms | 180 | 100% | 100% | 7.57 / 8.26 ms | 7.64 / 8.01 ms |
| 1,000 circles + 20 extra text strings each / 4.11 ms | 600 | 100% | 100% | 7.44 / 7.97 ms | 7.22 / 7.57 ms |

The submit-to-collect interval per instance averaged 0.75, 2.13, 4.74, and 4.66 ms
respectively. For the heavier run all 2,400 images were current, none repeated,
and no measured scheduled frame deadline was missed. Render-start to uploaded
image readiness averaged 6.95 ms (p95 7.53), versus buffered 18.86 ms (p95 20.48).
The main-thread submit callback averaged 0.52 ms for all four; both native passes
together averaged 0.36 ms. These overlap as measurements and must not be added.
The heavier early path left approximately 9.22 ms mean / 8.69 ms at p95 out of
16.67 ms, with concurrent workers still consuming CPU/GPU resources. Maximum
measured total path was 10.12 ms. This is a measured opportunity, not a guarantee
of future deadlines or of the same rates with a different TD network.

### Practical limits

- Finishing before display refresh is insufficient: the result must be ready
  **before collection and before its downstream consumers cook**. A generic
  `onFrameEnd` upload cannot retroactively update consumers that already cooked;
  forcing those consumers again would add work and requires deliberate ordering.
- Scheduling a GPU-heavy branch between phases does not necessarily provide a
  similarly long CPU interval. TD may enqueue its GPU work quickly, while that
  GPU work competes with the sketch jobs. The tests above model CPU overlap.
- There is no readiness polling in the coordinator and no main-thread wait for
  the sketch's GPU completion. Main-thread Python, snapshotting, upstream cooking,
  and upload enqueueing still cost time. Connected TOP inputs would also pull
  their upstream network early; this experiment intentionally tests output only.
- Independent collection can mix frame ages across sketches. At the middle
  workload, 61/720 images fell back to age 1 and there were 57 repeated images
  across consecutive outputs, despite zero missed TD frame deadlines. Switching
  from age 0 to age 1 repeats a source frame; switching back skips one. Fixed
  one-frame buffering can therefore look smoother than opportunistic lower latency.
- All-four coherent collection would require a batch readiness decision and
  would fall back when any one worker is late. That policy was not implemented;
  the table reports how often it could have succeeded in the measured trace.
- Snapshot timing is now early in the frame. Other Execute DATs that update
  CHOP controls or send pulses should run before submission, ideally explicitly
  ordered in one coordinator. Do not rely on incidental viewer or DAT order.
- Cold initialization, shader compilation, overload, errors, and longer sketches
  can exceed one frame. The existing bounded worker/fallback policy remains needed.

Reproduce from `packages/native-webgpu` with built plugin and probes:

```sh
python3 test/td/early_submit.py 210 4
AVTOOLS_BENCH_COMPLEX=1 AVTOOLS_EARLY_WORK=60000 python3 test/td/early_submit.py 630 4
# Optional: wrap any generated case in a standalone project for the TD editor.
python3 test/td/make_early_project.py /absolute/path/to/early-4-work60000.tox
```

Raw normal matrix, `.tox` projects, coordinator scripts embedded in those projects,
private plugin, and per-frame traces:
`artifacts/td/buffered-scaling-1791821609479519000/`.
Heavier pair:
`artifacts/td/buffered-scaling-1791821692042722000/`.
The heavier directory also contains `early-4-work60000.toe`, a standalone project
with the tested component and its four sketch/output pairs arranged in columns.
Its `driver` Execute DAT contains the two passes and the clearly synthetic CPU
work between them. The standalone serialization was round-trip checked to preserve
all tested parameters and scripts; the component was pixel-tested headlessly, but
the standalone editor presentation was not verified with computer use.

These generated projects reference their local private bundle and sketch by
absolute path. They are test fixtures, not portable distribution examples. The
repository contains the generators for reproducing them; the normal standalone
`native/td/example/Sketch.toe` continues to use buffered production behavior.

## Production pre-trigger toggle and coordinator

Implemented in `native/td/SketchTOP.cpp` with **Pre-trigger Mode** (`Pretrigger`,
default off) and **Submit Early (Coordinator)** (`Pretriggerpulse`). The shared
`native/td/example/pretrigger.py` is embedded in both saved examples and shipped
as a separate Python file in the release. One Execute DAT discovers enabled,
non-bypassed TOPs recursively under its parent component on each frame, so mode
changes and newly added nodes need no registration. Its optional `before_submit`
and `between_passes` hooks provide explicit project ordering without extra DATs.

Submission retains any unpublished previous result, captures a fresh snapshot,
and dispatches asynchronously. Collection makes one readiness check and publishes
the current or previous result. Ordinary cooks in this mode never submit. A
per-absolute-frame guard prevents duplicate coordinators from submitting twice;
busy workers retain Reset/events for the next accepted snapshot. Same Cook is
ignored/disabled in this mode. Missing recent triggers produce a warning, and
disabling pre-trigger resumes normal behavior. Info CHOP adds
`pretrigger_enabled` and `submitted_frame` alongside `output_age_frames`.

The production four-1080p matrix measured 120 post-warmup TD frames per case.
Without intervening work, early mode used the previous result for all 480 images
(4.95 ms mean / 6.79 ms p95 through all TD upload/export fences). With 4.20 ms of
synthetic intervening CPU work, **all 480 images were current**, with no repetitions
or missed deadlines: total path **7.49 ms mean / 8.13 ms p95**, image latency
**6.96 / 7.55 ms**. The matching buffered baseline was 7.77 / 8.10 ms total path
and 19.12 / 21.19 ms image latency. These remain synthetic CPU-overlap measurements,
not promises for a different TD network.

A separate 420-frame, two-instance behavior test passed mixed pre-trigger/normal
operation, mode toggles, duplicate coordinators, Same Cook set while pre-trigger
is active, exactly-once queued pulses during a 65 ms worker stall, missing-DAT
warnings and resumption, syntax errors/last-good output, Reset recovery, resize,
and continued animation of the ordinary second instance.

Reproduction:

```sh
AVTOOLS_EARLY_WORK=0,60000 python3 test/td/early_submit.py 150 4
python3 test/td/pretrigger_behavior.py
python3 test/td/saved_example.py
```

Raw production timing: `artifacts/td/buffered-scaling-1791825258357201000/`.
Mixed-mode behavior: `artifacts/td/buffered-scaling-1791825335094400000/`.
Both saved `.tox` and standalone `.toe` components passed output-pixel and CHOP
change tests in normal and pre-trigger modes, including their wired TOP input and
exact embedded coordinator: `artifacts/td/buffered-saved-example-1791825367424116000/`.
