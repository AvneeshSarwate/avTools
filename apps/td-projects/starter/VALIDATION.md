# Starter validation — 2026-10-15

Tested on the local Apple M1 Max with TouchDesigner 2025.31550 and native plugin
`AvToolsSketch-3f115a37e2f9.plugin`. Both bundles render at 1920×1080, with no image
inputs, ordinary buffered output, and independent 60 Hz TimeContext loops.
Pre-trigger and blocking same-cook modes are disabled.

## Per-TOP CPU cook time

These are TD's `cpuCookTime` measurements in milliseconds, including the TD-side
operator boundary. They are not process-wide CPU percentages or worker GPU-wait
measurements. The first operator has a larger observed cost; duplicate instances
are listed separately rather than assuming equal attribution.

| Concurrent TOPs | Instance | Median | p95 | p99 |
| --- | --- | ---: | ---: | ---: |
| 2 | Power2D particles | 0.795 | 1.172 | 1.377 |
| 2 | ShaderFX background | 0.353 | 0.614 | 0.761 |
| 4 | Particles A | 0.674 | 0.796 | 0.840 |
| 4 | Background A | 0.287 | 0.416 | 0.483 |
| 4 | Particles B | 0.389 | 0.561 | 0.612 |
| 4 | Background B | 0.264 | 0.428 | 0.495 |

With four TOPs, their summed CPU cook time was **1.655 ms median, 2.005 ms p95,
2.142 ms p99**. The maximum was 9.575 ms. The earlier approximately 0.4 ms number
is still representative of some instances, but should not be treated as a fixed
cost for every TOP; the first particles instance was closer to 0.7–0.8 ms.

## Whole frame, including TD upload completion

| Concurrent TOPs | Median | p95 | p99 | Maximum | Missed 60 Hz deadlines |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2 | 3.814 ms | 5.628 ms | 6.761 ms | 9.065 ms | 1 / 899 |
| 4 | 4.969 ms | 6.146 ms | 6.660 ms | 12.104 ms | 0 / 899 |

`gpuReadyMs` starts at the host cook request and ends after all exported output
ownership fences signal. It includes TouchEngine scheduling, the TD network cook,
and TD's actual GPU uploads, not just enqueue calls. It excludes the probe's
subsequent validation readback. Deadline counts additionally include the host's
wake-up lateness relative to its intended 60 Hz schedule; that explains the
two-TOP deadline miss despite a sub-16.67 ms maximum cook-to-ready interval.

The four-TOP result leaves about **10.5 ms at p95** within a 16.67 ms frame for this
particular setup before accounting for host wake-up lateness and other content.
That is encouraging headroom, not a guarantee for an arbitrary TD project or a
long-running real-time session. This is a short controlled sample.

Worker elapsed time medians were 1.74–2.20 ms per instance in the four-TOP run.
Those intervals include rendering and asynchronous GPU readback waits; they
must not be added to CPU cook time or interpreted as CPU utilization. TD upload
enqueue medians were 0.043–0.132 ms; completion is covered by the whole-frame
measurement above. All measured outputs were one frame old, with none older.

## Method and reproduction

From the repository root, after building the plugin, `touchengine-probe`, and
starter bundles:

```sh
python3 tools/td-sketch-build/benchmark.py 960 2,4
```

Each case runs 960 frames paced at 60 Hz. Exclude 60 warmup frames and the last
frame, which exports measurements, leaving 899 samples. An Execute DAT reads an
Info CHOP and `cpuCookTime` for each TOP. A private tracing plugin is used, so small
instrumentation overhead remains; the installed plugin is not modified. The
editor preview was paused. The corrected watcher was running and idle, with no
source edits or concurrent build jobs. Independent timing callbacks in the
paused editor remain alive by design.

The final raw results and generated test components are in the ignored local
artifact directory:
`packages/native-webgpu/artifacts/td/buffered-scaling-1792121561838709000/`.
`starter-results.json` contains the full quantiles. The script prints the new
artifact directory on subsequent runs. Earlier exploratory runs are not used in
the tables: they exposed artifact-triggered watcher checks, now excluded and
covered by a regression test. Timing differences between two/four instances are
not evidence that adding instances makes any individual sketch faster.

## Functional verification

- Opened the starter `.toe` in the TD editor, rendered both TOPs at 1080p, and
  exercised their Trigger pulse parameters without runtime errors.
- With the watcher running, changed the shared palette, observed the changed
  particles output pixels in TD, restored the source, and verified restoration.
- Both bundled sketches passed embedded V8/Dawn checks: 36 cooks and six reloads
  each, with Trigger pulses. The final saved component also passed 90 TouchEngine
  cooks with both outputs at 1920×1080, verifying dimensions, opaque pixels, and
  both upload fences. The `.tox` test explicitly supplies the plugin path, as
  required when importing it outside the `.toe` startup bootstrap.
- Builder tests passed: atomic saves, transitive helpers, failed-build recovery,
  all four raw WGSL generators, unchanged outputs, unsupported runtime imports,
  and ignoring package build artifacts.
- Cleanup tests passed, including real native teardown, failed setup, reverse
  callback order, stale GPU guards, and the existing 100-reload timing regression.

The build/watch code and examples are macOS-tested; the TD integration remains
macOS Apple Silicon only. Bundles are portable within this embedded host contract,
not general browser or Node programs.
