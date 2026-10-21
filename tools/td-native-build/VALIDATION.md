# Native build validation

Tested 2026-10-20 on Apple M1 Max / 32 GB, macOS 15.7.7,
TouchDesigner 2025.31550. Release Rust build, ordinary pointers, one serialized
compiler service, two Rayon and two Tokio workers. The checked-in `.toe` uses four
1920×1080 TOPs and four scalar CHOPs, sharing two project entries while retaining
independent V8/TimeContext state.

## Functional checks

- Five native CLI behavior tests pass with `PATH=/usr/bin:/bin`: copied template,
  relative aliases/transitive imports, relocation, unchanged output mtime,
  syntax/type locations, last-good retention, missing-import recovery, atomic
  saves, idle watcher stability, host compatibility guards, and stale-build rejection.
- The stale-build test edits a helper after the private compilation snapshot has
  been captured; the stale result cannot replace the previous bundle.
- QuickJS runs the existing material, stroke material, fragment, and compute WGSL
  generators. Generated declarations typecheck. Plain WGSL imports, malformed
  shader errors, and deleted generated wrappers are covered.
- Native V8/Dawn checks pass for both template targets and the converted existing
  starter's power2d particles / shader-fx background. These exercise real rendering,
  pulses, resets, reloads, and resource cleanup. Stroke/compute generation is checked;
  dedicated GPU execution coverage for every generated shader variant is not claimed.
- C ABI hosts pass shared TOP/CHOP subscription ownership, copied-result survival
  after service destruction, and atomic bundle-file replacement/deletion/recreation.
- Loading two independently built compiler dylibs in one process passes. This test
  originally exposed upstream compressed pointers reserving the same fixed address
  range and aborting. The shipped build enables upstream `plain-ptrs` instead.
- In actual TD: open/reopen the standalone project; automatic edits and intentional
  type errors; error recovery; compile while playback is paused; manual build pulse;
  delete/recreate all eight operators; Source File atomic reload, deletion retaining
  output plus a warning, and recreation clearing that warning. No terminal watcher
  is involved. Builds are shared; runtime values and independent timing ticks are
  checked. Automatic Builds controls now apply even when a TOP worker is busy.
- Plugin bundles, CLI and shared library pass `codesign --verify --strict` (bundles
  also use `--deep`). They are ad-hoc signed, not notarized. `otool -L` on the native
  build executable lists only system libraries/frameworks.

A fixture-development error used a stale TD pane object and crashed TD's UI thread.
The saved startup script caches the pane enum before replacing panes and opens
successfully. Delete/recreate testing moves editor panes to the parent first.

## Compilation and memory

Ten standalone process builds of the copied template took 94–117 ms internally
(median about 95.5 ms; OS file caches warm). These are fresh compiler sessions,
not retained incremental programs. The first checker-only session took about
51 ms; subsequent successful checks were about 18 ms.

The final release ran 1,000 alternating successful/syntax-error checker sessions.
Measured physical footprint rose from 5.5 MB to about 6.8 MB, then stayed near that
range. Earlier runs also exercised 1,000 alternating successful/type-error sessions
and 1,000 successful sessions. The final `service-soak.cpp` run exercised **200
complete builds**, including QuickJS, checking, Rolldown, publication, and worker
teardown. Its final 100 samples ranged from about 6.6 to 6.72 MB. Median request-to-ready
was about 220 ms, including the 90 ms request debounce.

These memory values are the small native test process's macOS `phys_footprint`,
measured after sessions are released. They are not TD's total memory or a direct
count of all live allocations; file-backed pages and retained allocator capacity
have different accounting. They show bounded behavior in these runs, not a proof
against every possible compiler leak. Session ownership/reset constraints are in
[vendor/UPSTREAM.md](vendor/UPSTREAM.md).

## TouchDesigner timing

The adjacent [measurement summary](tests/results/macos-arm64.json) records the
final 900-frame run and per-operator cook costs. The first 60 frames are warmup.
At frames 180/360/540/720 the fixture edits a helper, introduces a type error,
corrects it, and restores the original source. The error stage must retain the
previous numeric outputs; the others must acknowledge the expected new values
and ready revision. All stages must acknowledge, and runtime error counts are zero.


| Stage | Combined cook median / p95 / max (ms) | Frame interval median / p95 / max (ms) |
| --- | --- | --- |
| baseline | 1.00 / 1.22 / 1.50 | 16.67 / 16.78 / 16.87 |
| edit | 0.95 / 1.20 / 5.73 | 16.67 / 16.80 / 17.92 |
| error | 0.88 / 1.11 / 3.58 | 16.67 / 16.79 / 17.17 |
| recover | 0.84 / 1.02 / 2.40 | 16.67 / 16.77 / 17.10 |
| restore | 0.92 / 1.36 / 12.54 | 16.66 / 17.63 / 27.93 |

Successful edit/reload acknowledgment took 250–300 ms; the intentional type
error was reported in 250 ms and preserved the previous outputs. Caching the
plugin resource path removed a repeated `dladdr` lookup from cooks. A 12.54 ms
reload outlier and a 27.93 ms frame interval occurred in the restore stage.

TD `cpuCookTime` includes work attributed to the operator's cook, including the
CPU-side output upload call. The separately measured frame interval includes the
whole running project/UI. Neither measure is a GPU completion-time trace. The
fixture draws simple geometry; these timings do not predict complex sketch costs.
Occasional edit/reload and desktop scheduling spikes remain acceptable for this
initial internal tool; it makes no hard realtime guarantee.

## Distribution and remaining limits

The standalone executable is about 28 MiB; the shared compiler library is about
26 MiB. The SDK, generators and standard declarations are embedded, with no Node,
npm, Deno, Rust, compiler, network download, or external watcher needed to use them.
The existing plugin runtime payload remains separate. Both TOP/CHOP bundles resolve
one shared versioned native build directory.

A physically separate clean Mac without development tools has **not** been tested.
PATH-restricted copied-project tests and signed package inspection are the available
substitute. VS Code aliases/declarations are supplied; this run did not automate a
VS Code UI acceptance test. Other macOS architectures, Windows, other TD versions,
arbitrary npm dependencies, full TypeScript 5 parity, and automatic source-map
application inside V8 remain outside the verified scope.

## SDK 2 and normal dependency resolution — 2026-10-20

[Recorded results](tests/results/environment.json) and the
[live TD stage details](tests/results/environment-td.json) cover the updated
compiler, SDK and versioned TOP/CHOP binaries. All 14 behavior/environment tests
passed against both debug and release compilers. Fixtures cover real installed
earcut plus separate @types, ESM exports/imports, CJS/JSON, external aliases and
relative imports, external tsconfig inheritance, workspace/pnpm symlinks, external
edits/deletion/recovery/missing installation, stale snapshots, idle watches and
all-entry last-good preservation after a bundler failure.

The same valid/invalid environment fixtures run through ordinary TypeScript 5.9.3
and the native checker. Strict declaration checking, loaded-file inspection and
TypeScript language-service completions pass without DOM or implicit Node globals.
Explicit dependency ambient leakage is tested and documented, not prevented.
Fresh init and relocated projects work with PATH restricted to `/usr/bin:/bin`.

Native ABI subscriptions, file notifications and two-library coexistence pass.
The shared service completed 200 builds: median request-to-ready was 183.7 ms,
and the final 100 macOS physical-footprint samples ranged from 5.97 to 6.06 MiB.
This measures the small compiler host process, not total TD memory.

The example's compiled TOP and CHOP each passed 36 cooks, six reloads/resets and
pulse checks. Two isolated embedded contexts passed runtime-global/timer/event/RAF/
Dawn probes and TimeContext conformance. Supported GPU constructors were exercised;
unsupported constructors are rejected by the type tests. A direct invalid Dawn
constructor call can still abort inside the existing native binding, so this is
not a runtime safety guarantee for code that bypasses types.

In TD 2025.31550, four TOPs and four CHOPs loaded the packaged compiler. The
[repeatable fixture](tests/td-environment.py) uses a temporary project copy. All
CHOP values changed 14 → 42 using the actual earcut package, remained 42 during a
`fetch` type error, then returned to 14 after repair and project restoration.
The three edit acknowledgements took 223.5, 210.0 and 217.8 ms. Every stage had
zero operator runtime errors. Per-stage CPU samples include reload cooks; they are
not a new sustained performance benchmark. The original example is left running.

## Direct TypeScript entries and template buttons — 2026-10-20

The native example and fresh CLI template now use direct TypeScript entry files,
without `avtools.json`. Legacy manifest behavior remains covered separately.
All 19 behavior/environment/entry tests pass in debug, and the five new entry
regressions pass against the final release. Coverage includes independent entry
errors, shared helpers, explicit tsconfig files lists, nearest configs, ambient
types, workspace links, relocation, requested WGSL wrappers, missing-file recovery,
and refusal to overwrite template paths. Unrelated TD media is not read as source.
The C ABI tests additionally exercise template creation, identical subscriptions,
independent errors/last-good outputs and repair.

[Final live TD results](tests/results/entry-setup-td.json) record the shipping
compiler and plugin versions. The [repeatable fixture](tests/td-entry-setup.py)
created TOP and CHOP templates using relative destination paths, preserved existing
`.toe` content, rejected a second creation without changing source, and selected
the correct starter entry and CHOP schema. Two CHOP entries shared a helper:
one retained its last-good 14 during an intentional error while the other updated
114 → 121; repair updated the first to 21, and restoration returned 14/114.

Deleting and restoring a relative entry also preserved its output and resumed
building automatically. This caught a macOS `/var` versus `/private/var` watcher
alias bug, now fixed by canonicalizing project roots and external watch directories.
A CLI `/tmp` alias regression covers it too. The saved example's eight operators
were ready and error-free: two different TOP entries and two CHOP entries, with
CHOP values 14/114/14/114. No example sources were left modified by the live tests.

The manifest-free TOP/CHOP bundles also passed the embedded runtime smoke harness
(36 cooks, six reloads/resets and pulse checks per target). This update changes
compilation/setup, not the rendering or channel execution policies. The template
button writes sources/SDK/config only; it does not copy plugins or generate a `.toe`.

## Portable timing and full restart (2026-10-20–21)

SDK 3 ships ordinary core-timing source; the native and Node builders accept value imports. Per-operator Automatic Reload separates compilation from activation. The plugin retires the old isolate before replacement; failed runtime setup never rolls back. See [restart validation](../../packages/native-webgpu/test/restart/README.md) for live TD controls, raw JS/DAT tests, callback retirement, native soaks, and four-1080p timing measurements. Final compiler marker: `9c2ef39d35ed`.
