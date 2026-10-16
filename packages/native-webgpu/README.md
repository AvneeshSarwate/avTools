# avTools native WebGPU

Ordinary Node.js 22.20.0 on macOS Apple Silicon, using pinned upstream Dawn,
retained Rust text shaping/rasterization, and the existing winit window library.
The Deno renderer wrapper remains available. This is a local development package;
it has not been published to npm. Other platforms and Node majors are unvalidated.

The embedded TOP also supports [TimeContext](TIMING.md), with autonomous timers,
managed sketch lifetimes, and a saved `TimeContext.toe` example.
The [TimeContext design](plans/timecontext-embedded-runtime-plan.md) and
[original port plan](plans/avtools-dawn-syphon-touchdesigner-port-plan.md) are retained
for implementation history.

```js
import { createGPU, P5GPU, GPUWindow, SyphonChannel } from '@avtools/native-webgpu';
const gpu = createGPU();
const adapter = await gpu.requestAdapter();
if (!adapter) throw new Error('No Metal adapter');
const device = await adapter.requestDevice();
const p = new P5GPU(device, { width: 640, height: 480 });
p.beginFrame();
p.background(20); p.fill(255); p.textSize(32); p.text('Hello Dawn', 20, 60);
p.endFrame();
// Optional, main-thread GUI preview:
const preview = new GPUWindow(device, { width: 640, height: 480 });
preview.show(p.outputTexture);
// Optional offscreen publication (works without any preview):
const channel = new SyphonChannel(device, 'avTools');
channel.publishTexture(p.outputTexture, { flipped: true }); // upright in TouchDesigner
// In a real sketch, repeat drawing/publishing before disposing:
await device.queue.onSubmittedWorkDone();
channel.dispose(); preview.dispose(); p.dispose(); device.destroy();
```

Native windows require the macOS main thread. Poll/show regularly to receive
input and close events. Acquisition returns null when a drawable is unavailable,
including hidden, minimized, or occluded windows; offscreen rendering stays usable.
Presentation samples the renderer's offscreen texture into the supported surface
format. Acquired textures are cached until present/discard and expire afterwards.

Syphon accepts live single-sample RGBA8/BGRA8 2D textures on the same Metal device,
with COPY_SRC and TEXTURE_BINDING usages. Channels must be created on the macOS main thread. Keep calling publication
when no clients are connected: it also pumps Cocoa's discovery notifications
without waiting, allowing receivers launched later to find the server.
Rendering, Syphon encoding, and later
writes share Dawn's Metal queue. Publication has no CPU pixel readback and no
steady-state completion wait. At most three publications per channel may be in
flight; `false` indicates a full queue or no clients. `stats` exposes these counts
and completion failures. Dispose releases the server after outstanding Metal
completion handlers release it. Optional region and vertical flip are explicit.
The default preserves Metal texture row order; use `flipped: true` for upright P5
output in TouchDesigner/Syphon image coordinates. The embedded TD plugin applies
this conversion automatically.

## Build

Use Node 22.20.0 (`node --version`); Rust, CMake, Ninja, Python, Git, and Apple
Command Line Tools are required only to build. Full Xcode is not required for the
validated build. Native dependencies and source checkouts live under ignored
`build/`, `upstream/`, and `dist/` directories.

```sh
npm ci
node scripts/dawn.mjs fetch
node scripts/dawn.mjs build
AVTOOLS_DAWN_ADDON=./build/dawn/dawn.node node --expose-gc test/offscreen.mjs
node scripts/dawn.mjs patch
node scripts/syphon.mjs fetch
node scripts/dawn.mjs build --extension
npm run build
npm pack
```

The first build is the unpatched baseline; save its binary/results before applying
patches. Re-running patch is idempotent. `native-manifest.json` pins revisions.
The CLT libc++ include workaround is explicit in the scripts. Dawn's pinned Go
toolchain is downloaded by gclient; initial Go dependencies may need network access.

The maintained Dawn patch surface is two patches: retain the native instance and
adapter flags across JS GC, and expose a device accessor plus an extension hook.
Platform extension code lives here, outside the upstream tree. The lifetime patch
fixes an observed ProcessEvents/AsyncRunner crash after collecting the JS GPU root.
Syphon is built from pinned official source; the older repository framework had a
confirmed disconnect use-after-free. Its exact upstream Metal shader is compiled
through MTLDevice at server creation so the build does not require `xcrun metal`.

`dist` includes both addons, Syphon.framework, fonts and their licenses, bundled
JavaScript (including earcut), declarations, and third-party notices. There is no
install hook or consumer compilation. Install the produced `.tgz` in a clean npm
project. `@webgpu/types` is the only package dependency. Native linkage uses system
frameworks plus the colocated Syphon.framework. Source maps include shared renderer
sources; the declaration tree includes its portable text types.

## Checks and scope

- `npm run test:baseline`: official npm WebGPU hardware triangle/readback; set
  AVTOOLS_DAWN_ADDON to check a source addon instead.
- `npm run test:lifetime`: collect JS instance/adapter owners before device use.
- `deno run -A --unstable-webgpu test/deno-reference.ts`, then `npm run test:p5`:
  15 existing P5 scenes, exact observed byte equality including Rust text,
  variable-font metrics, glyph keys, disposal, and persistent frames.
- `node --expose-gc test/soak.mjs`: atlas growth and repeated renderer disposal.
- `npm run test:window`: GUI test; opens/moves through lifecycle states of two
  windows over three cycles. Requires explicit operator permission in this task.
- `node scripts/build-receiver.mjs`, then `node test/syphon.mjs`: separate native
  Syphon receiver processes, with test-only pixel readback to inspect real IPC.

Hardware tests need access to Metal and WindowServer; the execution sandbox on the
validation machine hides the hardware adapter. Test readback is never the Syphon
publication transport. See `VALIDATION.md` for results and unfinished acceptance
checks. The complete Deno server/editor migration remains separate work.
The implemented embedded plugin, pulse events, CPU TOP transfers and optional
Syphon output are documented in [TOUCHDESIGNER.md](TOUCHDESIGNER.md).
