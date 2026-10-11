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
The plugin exports only its required entry points; its runtime exports three C
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
