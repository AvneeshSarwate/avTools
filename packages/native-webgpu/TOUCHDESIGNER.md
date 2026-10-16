# avTools Sketch TOP (macOS Apple Silicon)

This plugin embeds V8, the pinned upstream Dawn WebGPU bindings, the shared P5GPU
renderer, and the existing Rust text engine. It does not require Node, Deno, or a
compiler on the consuming Mac. It currently targets TouchDesigner 2025.31550,
TOP API 12, macOS 15+, arm64. Windows transport is not implemented. The C API in
`native/embedded/Bridge.h` separates the sketch runtime from the TD-specific
adapter; there is no speculative cross-platform framework.

## Loading

The [prebuilt macOS Apple Silicon plugin](prebuilt/README.md) is checked into this
repository. Fresh clones can open `native/td/example/Sketch.toe` directly with TD
installed; no native build is required. `prebuilt/macos-arm64/current.txt` names
the versioned bundle. The `.toe` examples resolve it automatically.

The reusable repository fixture is [native/td/example/Sketch.tox](native/td/example/Sketch.tox).
See its [quick-start README](native/td/example/README.md) for the checkout loader,
pulse example, and interactive checks. The release ZIP packages this same fixture.

The local release ZIP contains `Plugins/`, a ready-to-load `Sketch.tox`, an example
`sketch.js`, type declarations, licenses, and these instructions. Extract it, then set a **CPlusPlus TOP → Plugin** parameter to
the complete `.plugin` bundle under `Plugins/` (builders can use the path in
`build/td-plugin-path.txt`). The entire bundle must
stay together. Two operators can use the same bundle. To register it in the OP
Create dialog, copy the whole bundle into your project's `Plugins` directory and
restart TD. Registration uses the operator type `Avtoolssketch`; verification here
used CPlusPlus TOP loading. See [Derivative's custom operator installation guide](https://docs.derivative.ca/Custom_Operators).

For the supplied `Sketch.tox`, put `Plugins/` beside your saved `.toe` and drag in
the component. Its component-level **Plugin Path** defaults to
`Plugins/AvToolsSketch.plugin` relative to the project; both CPlusPlus TOPs use it.
The embedded sketch demonstrates Event Name / Send Pulse; `sketch.js` is a readable
copy of that DAT. The two-instance fixture also demonstrates CHOP and TOP inputs.

A Sketch DAT takes priority over Source File. Sketches are plain JavaScript, not
ES modules: define `setup`, `draw`, and optionally `onPulse` in the DAT. There is
no TypeScript transpiler, package resolution, `require`, Node, or Deno in V8.

```js
let radius = 40;

async function setup(p, host) {
  p.textSize(28);
  // Asset preparation may await promises. host.device is this operator's GPUDevice.
}

function onPulse(name, p, frame) {
  if (name === 'Trigger') radius = frame.chop('radius') || 40;
}

function draw(p, frame) {
  p.background(15, 20, 40);
  if (frame.top(0)) p.image(frame.top(0), 0, 0, p.width, p.height);
  p.noStroke(); p.fill(255);
  p.circle(p.width / 2, p.height / 2, radius * 2);
  p.text('Dawn + Rust', 16, 40);
}
```

## TimeContext

`setup(p, host)` exposes `host.timing`: the shared TimeContext library, with
autonomous realtime timers even while TD playback is paused. Open
[TimeContext.toe](native/td/example/TimeContext.toe) to try managed roots, frame waits,
and pulse cancellation. See [TIMING.md](TIMING.md) for API, lifecycle, and tests.

## Controls and events

- **Sketch DAT / Source File:** edits compile before replacing the active sketch.
  Successful replacement reruns setup and resets renderer state. Syntax errors
  keep the last valid sketch running and report the compile error.
- **Controls CHOP:** `frame.chop(name, sampleIndex = 0)` returns the sample or `0`
  for a missing channel/index. `frame.controls` exposes `sampleRate`, `startIndex`,
  and `channels: [{name, samples: Float32Array}]`. Samples are copied for each accepted frame;
  retaining an old snapshot cannot retain a TD-owned pointer.
- **Event Name / Send Pulse:** each pulse queues one event. On the next accepted frame,
  `onPulse(name, p, frame)` runs before `draw`, using that frame's event-name field
  and CHOP snapshot. There is no event payload. Several pulses before a cook
  each run once; they use the values when the worker accepts its next frame. Pulses remain queued while it is busy. Up to 256 can be queued.
  Handlers are synchronous; unknown names can simply be ignored by the script.
- **Width / Height:** 1–4096 physical pixels; changing either resets the sketch.
- **Reset / Reload:** rerun setup. Reset also recreates an isolate stopped by a
  timeout. Ordinary source edits do not recreate the GPU device.

`frame.frame`, `rate`, `absFrame`, and `deltaSeconds` come from TD's cook time.
`frame.time = (frame.frame - 1) / frame.rate`. These fields follow TD time; `host.timing` supplies an independent realtime
clock. Repeated cooks still call draw with TD's current time; a backward seek
preserves sketch state and can produce a negative delta. Pause does not prohibit
parameter-triggered cooks. Draw and pulse exceptions stop that sketch until a
source edit or reset; the last successfully uploaded TOP remains available.

JavaScript execution is bounded to one second per JavaScript callback and microtask drain. Pending GPU
initialization has a five-second deadline; setup/readback pumping has a
three-second deadline. Native driver calls cannot be preempted by V8 termination.
These are reliability limits for trusted creative scripts, not a security
sandbox or protection against deliberately exhausting process memory.

## Transport and performance

**Buffered CPU TOP output is the default**, normally one frame behind TD.
Each instance owns an independent worker. A cook uploads its latest completed
RGBA8 buffer and submits a fresh snapshot if that worker is available. The worker
renders, copies the texture to padded staging memory, waits for map completion,
and copies rows directly into a TD-owned output buffer. No JS pixel-object array
is created. GPU initialization also happens on the worker.

There is at most one active job and one completed result per instance, with no
pending frame backlog. If the worker is late, TD retains the last output and
skips new submissions until the next opportunity. Pulses and Reset stay queued;
controls, source, dimensions, and time are captured when the next job is accepted.
Consequently overloaded sketches may repeat/skip frames or exceed one frame of
latency. First load and shader compilation can also take multiple frames. The
**Wait for Same Cook (Blocking)** toggle opts into the old immediate-result
semantics; independent TOPs then serialize their waits on TD's cook thread.

Output completion uses Dawn's **`WaitAny`**, not a 1 ms polling sleep. A pinned,
opt-in binding patch tracks GPU futures and waits on the isolate's owner thread,
where it safely resolves JS promises. Normal completion wakes immediately; a
100 ms timeout only bounds a stalled native wait so host deadlines can be checked.
Unresolved promises with no queued work sleep until their deadline or teardown.
This changes the embedded host only; normal Node bindings retain their event loop.

Wired TOP inputs request TD's RGBA8 download during the cook, then wait for
`getData()` on the worker. The worker owns the download references, makes an owned
V8 snapshot, and uploads into reusable Dawn textures. `frame.top(i)` works with
`p.image`; retaining it observes that reusable texture's later contents. Inputs
and controls belong to the same accepted frame snapshot. This keeps download
completion waits off TD's cook thread, but initiating a download, copying bytes,
and uploading still have costs. Resize/reload/disposal can invalidate old handles.

Apple Silicon shared memory does not eliminate GPU synchronization or these
copies. The worker still waits for its own output readback before finishing, but
four instances can perform that work concurrently while TD continues cooking.
TD's `uploadBuffer()` call schedules work; its duration alone is **not** total GPU
upload time. The end-to-end benchmark waits for every exported Metal texture's
ownership fence, including TD's uploads, before recording GPU readiness. See the
[buffered measurements](VALIDATION.md#buffered-transfers-and-end-to-end-timing-2026-10-12).
RGBA8 is the supported format; use explicit TD color-space conversions as needed.

**Enable Syphon** publishes the rendered GPU texture under **Syphon Name**.
It is off by default. **Syphon Only (1px TOP)** additionally bypasses output
readback and returns a transparent 1×1 placeholder TOP. Receive the full image
through a Syphon In TOP using `avTools Embedded:<Syphon Name>`. The publisher
cooks every frame while enabled once it has started. A registered Custom OP uses
`cookOnStart`; the generic CPlusPlus TOP does not honor that flag. When loading via
CPlusPlus TOP, view/request its output once (or request an extra Out TOP in TouchEngine)
to start a disconnected Syphon-only publisher. Receivers also need to be viewed or
used downstream to cook. Give instances distinct names. Wired input TOPs still cross the CPU boundary.

Syphon publication uses the same Dawn Metal queue, with at most three outstanding
publications. Full queues drop new publications instead of waiting. Syphon may
perform GPU copies; this is **no CPU frame readback**, not a zero-copy claim.
Receiver consumption is asynchronous and may see a previous frame; do not assume
same-cook feedback semantics from a disconnected Syphon receiver.

An Info CHOP reports input download, input upload/snapshot, draw/submission,
readback wait, total runtime milliseconds, cook count, readiness, and Syphon
client/publication/drop counters. It also exposes `cook_ms`, `upload_enqueue_ms`,
`worker_ms`, `output_age_frames` (-1 before the first result), and cumulative
`skipped_frames`. Worker timings describe the last completed job. GPU execution
overlaps submission; draw/submission time is not a GPU timestamp measurement.
Info DAT reports transport and error details. See `VALIDATION.md` for measured
results, machine details, and remaining limitations.

### Optional pre-trigger mode

Enable **Pre-trigger Mode** on each participating TOP. Put the contents of
[`pretrigger.py`](native/td/example/pretrigger.py) in **one Execute DAT** with
**Frame Start** enabled. Place it in the component containing the sketches; it
automatically discovers enabled TOPs recursively under its parent. Change its
`scope()` function to `return op('/project1')` for project-wide discovery. Disabled
and bypassed TOPs are left alone. The saved `Sketch.toe` / `Sketch.tox` already
contain this DAT, with both TOP toggles off by default.

The DAT sends **Submit Early (Coordinator)** to each enabled TOP and forces a
submission-only cook. After its optional `between_passes(nodes)` hook, it forces
a collection-only cook on each. Collection uploads a ready current result or
retains the latest previous result, without waiting. `before_submit(nodes)` is a
place to update controls or send event pulses before snapshots. No artificial
delay is supplied: put useful independent project work in `between_passes` if
appropriate, such as explicitly cooking a branch that does not depend on these
sketches. All submission and collection ordering lives in this one DAT.

**Wait for Same Cook** is disabled and ignored while pre-trigger mode is enabled.
Normal cooks do not submit in this mode; if the DAT is missing/inactive, output
eventually holds and the TOP reports a warning. Turning the toggle off resumes
ordinary behavior. Repeated submit pulses/coordinators cannot submit a second job
for the same absolute TD frame. Busy workers skip that frame's submission and
keep Reset/events pending. Info CHOP additionally exposes `pretrigger_enabled`
and `submitted_frame`; use `output_age_frames` to measure actual output latency.

The collection deadline matters: work completing after collection cannot update
already-cooked downstream consumers. A generic frame-end collection is therefore
insufficient. Same-frame readiness depends on the interval and workload; without
intervening work, previous-frame output is normal. Variable 0/1-frame latency can
repeat/skip animation frames. See
[measurements and limits](VALIDATION.md#early-submission-and-same-frame-collection-investigation).

## Build and runtime ownership

This section is for rebuilding the plugin from source. Sketch authors can use
the [checked-in binary](prebuilt/README.md) and skip these steps. `td:build` writes
new versioned bundles under `prebuilt/macos-arm64/` and updates `current.txt`;
commit the selected bundle together with matching source changes.

Installed TD headers were found at
`/Applications/TouchDesigner.app/Contents/Resources/tfs/Samples/CPlusPlus/CPUMemoryTOP/`.
The headless harness uses the pinned official TouchEngine macOS SDK recorded in
`native-manifest.json` and the installed commercial TD engine.

After the Node/native dependencies and Rust text library have been built:

```sh
node scripts/embedding.mjs fetch
node scripts/syphon.mjs --embedded
node scripts/embedding.mjs
node scripts/build-td-plugin.mjs
node scripts/build-bridge-probe.mjs
# Packages the checked-in native/td/example/Sketch.tox:
node scripts/package-td.mjs
```

The pinned Chromium Clang archive is checksum verified. Apple CLT supplies the
SDK and the two symbol inspection tools omitted from that archive. The standalone
V8 build has no ICU, Wasm, external startup blob, Node runtime, or non-Metal
backends. Chromium allocator interception is explicitly disabled: enabling it
caused a real TouchDesigner host-allocation crash during the first load test.

Each operator owns a worker thread, isolate, device, renderer and Rust text state.
All V8 operations and destruction occur on that worker. Only a narrow C ABI crosses
between Chromium's bundled libc++ and the TD adapter's system libc++. The runtime
exports five C functions (including deferred creation and worker dispatch); the rest of its symbols are hidden. Embedded Syphon
classes and C identifiers are prefixed to avoid TD's own Syphon library.

The shared V8 platform and its library remain loaded for the process lifetime.
Deleting an operator joins its worker and disposes its isolate/resources without
shutting down other operators. Replacing native runtime binaries requires a TD
restart; script hot reload does not. Build directories are content-versioned to
avoid overwriting a binary mapped by an active TD process. Local bundles are
ad-hoc signed; release distribution/notarization is not configured.

Maintained extra embedding patches: `embedding-clt-sdk.patch`,
`0003-napi-v8-callback-lifetime.patch` (callback metadata reclamation after V8 GC),
and `0004-embedded-event-driven-wait.patch` (opt-in GPU future waits). `TextCompat.cpp` fills the limited generic N-API gaps in the pinned V8 shim;
it does not implement a separate WebGPU binding.

## TypeScript projects and IDE development

The [TD starter project](../../apps/td-projects/starter/README.md) provides two
file-backed sketches, TimeContext, raw Power2D/shader-fx, local WGSL generation,
IDE types, and a save → rebuild → restart loop. Open its `project.toe` after setup.
Use `host.onDispose(callback)` for synchronous cleanup on reload; buffers/textures
created through `host.device` are also tracked and destroyed automatically.
The [build-tool guide](../../tools/td-sketch-build/README.md) owns this workflow.
