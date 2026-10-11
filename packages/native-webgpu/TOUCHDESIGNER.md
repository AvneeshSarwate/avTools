# avTools Sketch TOP (macOS Apple Silicon)

This plugin embeds V8, the pinned upstream Dawn WebGPU bindings, the shared P5GPU
renderer, and the existing Rust text engine. It does not require Node, Deno, or a
compiler on the consuming Mac. It currently targets TouchDesigner 2025.31550,
TOP API 12, macOS 15+, arm64. Windows transport is not implemented. The C API in
`native/embedded/Bridge.h` separates the sketch runtime from the TD-specific
adapter; there is no speculative cross-platform framework.

## Loading

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

## Controls and events

- **Sketch DAT / Source File:** edits compile before replacing the active sketch.
  Successful replacement reruns setup and resets renderer state. Syntax errors
  keep the last valid sketch running and report the compile error.
- **Controls CHOP:** `frame.chop(name, sampleIndex = 0)` returns the sample or `0`
  for a missing channel/index. `frame.controls` exposes `sampleRate`, `startIndex`,
  and `channels: [{name, samples: Float32Array}]`. Samples are copied each cook;
  retaining an old snapshot cannot retain a TD-owned pointer.
- **Event Name / Send Pulse:** each pulse queues one event. On the next cook,
  `onPulse(name, p, frame)` runs before `draw`, using that cook's event-name field
  and CHOP snapshot. There is no event payload. Several pulses before a cook
  each run once; they all use the values at that cook. Up to 256 can be queued.
  Handlers are synchronous; unknown names can simply be ignored by the script.
- **Width / Height:** 1–4096 physical pixels; changing either resets the sketch.
- **Reset / Reload:** rerun setup. Reset also recreates an isolate stopped by a
  timeout. Ordinary source edits do not recreate the GPU device.

`frame.frame`, `rate`, `absFrame`, and `deltaSeconds` come from TD's cook time.
`frame.time = (frame.frame - 1) / frame.rate`. There is no independent animation
clock. Repeated cooks still call draw with TD's current time; a backward seek
preserves sketch state and can produce a negative delta. Pause does not prohibit
parameter-triggered cooks. Draw and pulse exceptions stop that sketch until a
source edit or reset; the last successfully uploaded TOP remains available.

JavaScript execution is bounded to one second per render/pump call. Pending GPU
initialization has a five-second deadline; setup/readback pumping has a
three-second deadline. Native driver calls cannot be preempted by V8 termination.
These are reliability limits for trusted creative scripts, not a security
sandbox or protection against deliberately exhausting process memory.

## Transport and performance

**CPU TOP output is the default.** The renderer draws on Metal. Its result is
copied to a reusable padded staging buffer, mapped, and copied directly into a
TD-owned output buffer. No array of JS pixel objects is created. TD uploads that
buffer during the same cook; this path waits for readback rather than silently
adding a frame of latency. RGBA8 is the supported format; no HDR claim is made.

Wired TOP inputs use TD's supported RGBA8 download, an owned typed-array snapshot,
and upload into reusable Dawn textures. `frame.top(i)` returns an image usable by
`p.image`. It refers to that input's reusable texture, so retaining it observes
later cooks' content. Resize/reload/disposal can invalidate old texture handles.
RGBA bytes remain in the working color representation; there is no extra gamma
conversion in the renderer. Use explicit TD color-space conversions as needed.

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
client/publication/drop counters. GPU execution
overlaps submission; draw/submission time is not a GPU timestamp measurement.
Info DAT reports transport and error details. See `VALIDATION.md` for measured
results, machine details, and remaining limitations.

## Build and runtime ownership

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
exports three C functions; the rest of its symbols are hidden. Embedded Syphon
classes and C identifiers are prefixed to avoid TD's own Syphon library.

The shared V8 platform and its library remain loaded for the process lifetime.
Deleting an operator joins its worker and disposes its isolate/resources without
shutting down other operators. Replacing native runtime binaries requires a TD
restart; script hot reload does not. Build directories are content-versioned to
avoid overwriting a binary mapped by an active TD process. Local bundles are
ad-hoc signed; release distribution/notarization is not configured.

Maintained extra embedding patches: `embedding-clt-sdk.patch` and
`0003-napi-v8-callback-lifetime.patch`. The latter reclaims callback metadata after
V8 GC. `TextCompat.cpp` fills the limited generic N-API gaps in the pinned V8 shim;
it does not implement a separate WebGPU binding.
