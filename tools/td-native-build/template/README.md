# TypeScript sketches for TouchDesigner

This is the complete TouchDesigner-facing script guide for this generated
project, including instructions for coding agents. It is usable offline and
is created alongside `tsconfig.json` and `sketches/` by **Create Template Project**.
The SDK declarations are the exact API contracts; this guide explains how to
use them. It does not attempt to document the full p5 drawing API.

Start with the setup and example catalog below, then use these reference sections:

- [Agent workflow and runtime boundaries](#agent-workflow-and-runtime-boundaries)
- [CHOP API](#chop-api)
- [TOP API](#top-api)
- [WebGPU lifecycle in this host](#webgpu-lifecycle-in-this-host)
- [Declared parameter reference](#declared-parameter-reference)
- [Pulses and callback ordering](#pulses-and-callback-ordering)
- [TimeContext and independent tasks](#timecontext-and-independent-tasks)
- [Execution modes and latency](#execution-modes-and-latency)
- [File API](#file-api)
- [UDP and OSC API](#udp-and-osc-api)
- [Build, activation and cleanup](#build-activation-and-cleanup)
- [Logging, diagnostics and verification](#logging-diagnostics-and-verification)

## Quick start

Open this folder in VS Code. The local SDK and tsconfig provide TypeScript types
without installing Node or an editor extension.

In an avTools TOP's **Build** page, select `sketches/background/main.ts` as
**TypeScript File**. In an avTools CHOP, select `sketches/channels/main.ts` and set
**Output Channels** to `value ticks`, **Output Samples** to `1`. A wired input
channel named `value` is doubled; `ticks` advances independently with TimeContext.
The default TOP exposes Size, Color and Speed on its **Controls** page. The
default CHOP exposes Gain, Offset and Tick Interval; its initial value behavior
is still twice the input. Adjust these controls without editing code.

The Create Template Project button configures the operator that created this folder.
For a TOP it sets **Sketch → Width = 1280, Height = 720** (720p). Change those
parameters for another resolution; use `frame.width`/`frame.height` in the sketch.

Add more .ts entries anywhere under this tsconfig and select them on other
operators. Share helpers using ordinary imports. No manifest or bundle paths are
needed. Each operator checks its entry and dependencies; unrelated sketches can
have errors without blocking it. All operators use their own runtime state.

Automatic Builds reloads changed bundles after saving. Build Script requests a
manual build. Type errors preserve that entry's last working bundle. Runtime
caches live in `.avtools/entries/`; these are disposable and not source files.

Import TimeContext functions normally from `@avtools/core-timing`. Automatic Builds compiles; Automatic Reload controls activation. Reload adopts the latest successful bundle; Reset restarts the active bundle. Each activation starts fresh module/global state. Installed
npm packages and linked/shared source work, but dependencies must use APIs supported
by embedded V8/TD. Node and browser APIs are not supplied. Package installation is
separate from the native builder. This mixed starter includes TOP GPU types; use
`sdk/packages/native-webgpu/td-runtime.d.ts` instead of `td-top-runtime.d.ts` in
`tsconfig.json` for a CHOP-only environment.

Local WGSL files can be imported as strings. Shader conventions `.material.wgsl`,
`.strokeMaterial.wgsl`, `.fragFunc.wgsl` and `.compute.wgsl` generate typed wrappers
under `generated/`, retaining the shader's project-relative directories. Only
wrappers used by the selected entry affect its build.

Optional CLI: `avtools-build build-file sketches/background/main.ts top` or
`avtools-build watch-file sketches/channels/main.ts chop`. No terminal watcher is
required when using the plugin's Automatic Builds toggle.

## Script-declared controls

Try `sketches/parameters/picture.ts` on a TOP or `sketches/parameters/channels.ts`
on a CHOP (Output Channels: `value`). Their exported `parameters` object creates
native controls on a **Controls** page, including named pulse buttons. Read
`host.params` in setup/timing/CHOP callbacks or `frame.params` in TOP draw/pulses.
Use `ChopHost<typeof parameters>` / `Draw<typeof parameters>` for typed values.

Declarations must be literal data exported directly by the entry file; helper
functions, imported declarations and spreads are not supported. Normal sketch
code/imports remain unrestricted by this rule. Names start with an uppercase
letter followed by lowercase letters/digits. Compatible names and types retain
TD values, expressions, exports and bindings across schema edits. Add/remove or
change defaults/ranges to update controls. Use a new name to change a type.

A schema edit recreates the native instance and restarts the sketch, so it can
cause a brief interruption. Ordinary code edits use the normal JS reload path.
Automatic Reload off retains the active code **and** controls; Reload adopts
both, while Reset restarts the active version. Compile/schema errors preserve
last-working code/controls. Runtime errors after activation require fixing the
script or Reset; they do not roll back a successfully installed schema.

## Example catalog

Select one entry per operator using **Build → TypeScript File**. All examples
share this project's SDK; you do not need to generate another template per OP.

| Entry under `sketches/` | Operator and configuration | Demonstrates |
| --- | --- | --- |
| `background/main.ts` | TOP | p5 draw callback and shared helper import |
| `channels/main.ts` | CHOP, outputs `value ticks`, 1 sample | Current inputs, same-cook math, independent timing |
| `parameters/picture.ts` | TOP | Color, menu, toggle, size, Shuffle pulse |
| `parameters/channels.ts` | CHOP, output `value`, 1 sample | Animate pulse, replaceable TimeContext ramp, latest parameter/input reads |
| `parameters/all-controls.ts` | CHOP, outputs `value count x y z red alpha textlength pulses`, 1 sample | Every control type, custom page, typed snapshots and named pulses |
| `buffers/interpolate.ts` | CHOP, outputs `x y`, 10000 samples | Blend two XY input buffers, missing samples, reusable output arrays |
| `inputs/picture.ts` | TOP, optional wired TOP and Controls CHOP | Image input, named CHOP reads, missing-input fallback |
| `timing/picture.ts` | TOP | Independent TimeContext loop updates state; draw presents it, cleanup on reload |
| `osc/channels.ts` | CHOP, outputs `value target messages port`, 1 sample | Async JSON file read, incoming OSC, TimeContext easing, OSC reply |
| `osc/picture.ts` | TOP | Async JSON file read, OSC position control |
| `osc/udp.ts` | CHOP, outputs `port bytes messages`, 1 sample | Raw UDP reception and echo |

For the buffer example, wire two CHOPs with `x` and `y` channels and matching
sample counts. Enable **Wait for Current Result** when same-cook data is required.
The Blend slider interpolates each point. For the input TOP example, a CHOP
channel named `size` controls the circle; an optional TOP supplies its background.

## API notes

- TOP `setup(p, host)` initializes state/resources; `draw(p, frame)` presents it.
  Use `frame.top(index)` for image inputs and `frame.chop(name)` for Controls CHOP
  samples. `host.chop(name)` reads the latest accepted snapshot from a timer.
- CHOP `setup(host)` initializes persistent outputs; synchronous `onCook(host,
  frame)` transforms current inputs. `inputs.get(name, input, sample)` reads one
  sample; `inputs.samples(name, input)` returns an owned Float32Array copy.
  `outputs.set` changes one sample; `outputs.setSamples` copies a whole channel
  whose length must match Output Samples. Outputs retain their last values.
- `onPulse` receives the exact declared parameter name (or Send Pulse event name).
  Read current input/parameter state in the handler. Pulses carry no arguments.
- `host.params` exposes a fresh accepted snapshot; a local reference keeps its
  old values across `await`. Buffered modes retain their existing input/output
  latency. Parameter sampling adds no extra frame delay.
- `host.onDispose` registers short synchronous cleanup. Reload/reset tears down
  the old runtime and timing tasks. Local state is recreated on each activation.

## Git and SDK restoration

The plugin creates this `avtools-project/` directory inside the selected **Template
Parent Folder**. Open this directory itself in VS Code. The button refuses to
merge with an existing directory; other operators should select its existing
entry files instead of pressing Create Template Project again.

The included `.gitignore` excludes `/sdk/`, `/node_modules/`, build caches,
generated shader wrappers and TD backups. Commit your sketches, tsconfig and
README. Record the plugin distribution version used by your project. On another
computer, create a temporary template with that same plugin version, copy its
`sdk/` here, then open this folder in VS Code. Avoid overwriting deliberately
modified SDK files. You can choose to vendor the SDK instead by removing the
`/sdk/` ignore rule and committing it.

## Files and OSC / UDP

Both hosts include `files`, `udp` and `osc`; no npm dependency is necessary.
Select `sketches/osc/channels.ts` on a CHOP with Output Channels
`value target messages port` for TimeContext easing driven by `/target` OSC
messages. Select `sketches/osc/picture.ts` on a TOP for `/x` position control.
`sketches/osc/udp.ts` is a raw UDP echo example (channels `port bytes messages`).
These entries load `config.json` asynchronously during setup. Relative file
paths resolve beside the entrypoint. Use `await host.files.readText(path)` or
`readBytes(path)`; missing/unreadable files reject. Regular files up to 64 MiB
are supported, with four simultaneous reads. Reset rereads assets.

`const osc = await host.osc.open({port: 9000})` listens on localhost. Use an
available port for each instance, or `port: 0` to select one automatically;
`osc.localAddress` tells you the chosen port. LAN reception requires an explicit
`address: '0.0.0.0'`. Numeric IPv4/IPv6 and `localhost` are supported.
`osc.onMessage((message, remote) => ...)` receives typed `message.args` and an
OSC address. Send with `osc.send({address: '/reply', args: [0.5]}, remote)`.
Plain numbers send float32; `{type: 'i', value: 42}` sends int32. Catch send
promise rejections and use `osc.onError()` for malformed incoming packets.
Bundles deliver immediately and expose their raw bigint timetag to the handler.

Callbacks run independently of TD cooking, on the same JS worker as timing
callbacks. They can read current host state and update state/output immediately.
A TD cook presents the latest output. Reload/Reset closes sockets automatically;
changing a setup Port parameter needs Reset. Raw `host.udp.open()` has the same
lifecycle, but receives/sends Uint8Array datagrams. Monitor
`host.udp.droppedDatagrams` for overflow of the 256 packet / 4 MiB receive queue.
See the SDK's `td-io.d.ts` for method/type descriptions and limits.

## Agent workflow and runtime boundaries

1. Open this project root, containing `tsconfig.json`, in your IDE. Preserve the
   SDK and its TypeScript environment; do not add `DOM` or Node ambient types to
   silence errors for APIs that do not exist in the plugin.
2. Decide whether the entry produces channels (CHOP) or an image (TOP). Import
   the matching callback/host types with `import type`. These are declarations,
   not runtime modules to instantiate.
3. Write an entry under `sketches/`; helpers may use normal relative imports,
   TypeScript aliases, linked source and installed npm packages. Select that
   entry in the operator's **Build → TypeScript File**. No manifest is needed.
4. For a CHOP, tell the user the exact **Output Channels** and **Output Samples**
   needed. JavaScript cannot add output channels dynamically. For a TOP, choose
   Width/Height on its Sketch page; the initialized default is 1280×720.
5. Save and check the operator's build diagnostics. A successful typecheck is
   not a runtime test: verify actual outputs, pulses and reload behavior in TD.

Each instance has its own V8 isolate and dedicated JavaScript worker. Module
variables are persistent within that activation, independent of other instances,
including instances using the same entry file. There is no shared JS global
state between operators. Connect CHOP/TOP inputs or use explicit communication
such as OSC to exchange data.

The worker does **not** expose TD's Python API: there is no `op()`, `parent()`,
`me`, parameter setter, arbitrary DAT access or network-creation API in a sketch.
Use the host inputs, declared controls, pulse handlers and outputs described here.
Python snippets in the pre-trigger section belong in an Execute DAT, not a `.ts`
entry. The native builder bundles modules before execution; it is not a Node
runtime or a general runtime module loader.

Supported global host facilities, in addition to standard ECMAScript objects:

| Facility | Contract |
| --- | --- |
| `console.log/info/warn/error/debug` | Per-operator bounded logs; see diagnostics below |
| `performance.now()` | Monotonic milliseconds relative to runtime creation |
| `setTimeout(fn, ms, ...args)`, `clearTimeout(id)` | Independent wall-clock timers; numeric handles |
| `setImmediate(fn, ...args)`, `clearImmediate(id)` | Deferred worker tasks; no promised ordering relative to timeouts |
| `queueMicrotask(fn)` | Microtask after the current synchronous work |
| `requestAnimationFrame(fn)`, `cancelAnimationFrame(id)` | One-shot callback on an accepted TD request, not a display clock |
| `Event`, `EventTarget` | Basic listeners, `once`, dispatch and cancellation; no DOM tree |
| `AbortController`, `AbortSignal` | Abort reason, listeners and `throwIfAborted`; no static signal helpers |
| `DOMException`, global event listeners | Includes cancelable `unhandledrejection` events |
| `crypto.randomUUID()` | OS-backed UUID generation |
| TOP WebGPU globals | Dawn types/constants; use the supplied `host.device` |

There is no `window`, `document`, browser canvas, `navigator.gpu`, `fetch`,
`WebSocket`, `process`, Node `fs`/`dgram`, Node `Buffer`, `setInterval`, or global
`TextEncoder`/`TextDecoder` API. Use `host.files`, `host.udp`, and `host.osc` for the
supported I/O. npm packages are usable when their executed code fits this host;
installing packages requires your own package manager. A successful bundle does
not make unavailable platform APIs work. CHOPs have no GPU device, even though
this mixed project's editor profile includes TOP types.

Timeout delays below 1 ms, above 2,147,483,647 ms, or NaN become 1 ms; fractional
milliseconds truncate. Timers are independent of TD cooks but share the instance's
JS thread, so synchronous work can delay them. They are not hard realtime.

Exact declarations are in `sdk/packages/native-webgpu/`:
`td-chop.d.ts`, `td-sketch.d.ts`, `td-parameters.d.ts`, `td-io.d.ts`,
`td-runtime.d.ts`, `td-top-runtime.d.ts`, and `td-types/p5.d.ts`.
Portable TimeContext source is in `sdk/packages/core-timing/`.

## CHOP API

Import from `@avtools/native-webgpu/td-chop`:
`ChopHost<P>`, `ChopFrame`, `Setup<P>`, `OnCook<P>`, `OnPulse<P>`.
`P` is `typeof parameters` when the entry declares controls.

| Export | Signature | Purpose |
| --- | --- | --- |
| `setup` | `(host) => void \| Promise<void>` | Optional one-time initialization; file/socket setup may be awaited |
| `onCook` | `(host, frame) => void` | Optional synchronous transform per accepted TD request |
| `onPulse` | `(name, host) => void` | Optional synchronous event handler |

Define at least `setup` or `onCook`. Do not make `onCook`/`onPulse` async. Launch
background tasks from them when necessary and return immediately. A task may
change persistent state/outputs later; it cannot extend the current synchronous
cook across an `await`.

### Input channels

Up to four wired CHOP inputs are addressed by zero-based connector index.

| Method | Behavior |
| --- | --- |
| `host.inputs.get(name, input = 0, sample?)` | One number; omitted sample means the **last sample** of the channel |
| `host.inputs.samples(name, input = 0)` | Owned `Float32Array` copy of the whole channel |
| `host.inputs.names(input = 0)` | Array of channel names |

Missing channels/inputs/sample indexes read as `0`; missing whole channels return
an empty array. Changing a returned array does not modify TD or the host snapshot.
Each synchronous callback sees a stable accepted snapshot. After `await`, a fresh
read may observe a later accepted request. No worker-side read pulls a new TD
cook: inputs remain at the last accepted values while upstream cooking is stopped.

### Output channels

Configure **Script → Output Channels** as space-separated unique identifiers,
for example `value velocity`, and **Output Samples**, normally `1`. Channel names
start with a letter or underscore and contain letters, digits or underscores.
Limits are 128 characters per name, 1024 channels, and 1,048,576 total samples
(channel count × sample count). Output sample rate follows TD's frame rate and
start index is zero; this is a fixed-size output buffer, not CHOP time slicing.

| Member | Behavior |
| --- | --- |
| `host.outputs.sampleCount` | Configured samples per channel for this activation |
| `host.outputs.set(name, value, sample = 0)` | Write one sample of a configured channel |
| `host.outputs.get(name, sample = 0)` | Read persistent worker state immediately; missing data gives `0` |
| `host.outputs.setSamples(name, values)` | Copy exactly `sampleCount` finite numbers from an array-like object |
| `host.outputs.samples(name)` | Owned copy of persistent output state; missing channel gives an empty array |
| `host.outputs.names()` | Configured output channel names |

Writes to unknown channels, invalid indexes, wrong buffer lengths, or values that
are not finite float32 numbers throw. Outputs start at zero and retain their last
values until changed. Changing an array returned by `samples()` does not write
output; call `setSamples()`. Input/output copies have real CPU cost: read each
whole input once per callback, reuse your working arrays, and publish once per
channel instead of copying in an inner loop.

The host publishes complete callback-turn snapshots. TD never sees a half-written
array from a synchronous callback. Different continuations of an async function
can publish separately. Independent timers/OSC callbacks can update outputs
without `onCook`; TD presents the latest publication when it next cooks.

A complete same-cook transform (Output Channels `value`, Output Samples `1`):

```ts
// Target: chop
import type { ChopHost } from '@avtools/native-webgpu/td-chop';
import type { ParameterDefinitions } from '@avtools/native-webgpu/td-parameters';

export const parameters = {
  Gain: { type: 'float', default: 2, min: 0, max: 4 },
  Clear: { type: 'pulse' },
} as const satisfies ParameterDefinitions;

type Host = ChopHost<typeof parameters>;
let held = 0;

export function onCook(host: Host) {
  held = host.inputs.get('value') * host.params.Gain;
  host.outputs.set('value', held);
}

export function onPulse(name: string, host: Host) {
  if (name === 'Clear') {
    held = 0;
    host.outputs.set('value', held);
  }
  // onCook follows this pulse and may overwrite the value in this same request.
}
```

`ChopFrame` fields: `frame` (TD timeline frame), `absFrame` (TD absolute frame),
`rate` (frames/second), `time` (`(frame - 1) / rate`, seconds), and `deltaSeconds`.
In buffered mode `deltaSeconds` accumulates elapsed absolute TD time across
coalesced requests; backwards absolute time resets its anchor. Timeline seeks
and loops do not rewind the independent TimeContext clock.

See `sketches/buffers/interpolate.ts` for interpolation between two 10,000-point
XY buffers. Configure its output as `x y`, 10000 samples.

## TOP API

Import from `@avtools/native-webgpu/td-sketch`:
`SketchHost<P>`, `SketchFrame<P>`, `SketchControls`, `Setup<P>`, `Draw<P>`,
`OnPulse<P>`. The p5 instance type is available from
`@avtools/native-webgpu/td-p5` as `P5GPU`.

| Export | Signature | Purpose |
| --- | --- | --- |
| `setup` | `(p, host) => void \| Promise<void>` | Optional one-time initialization |
| `draw` | `(p, frame) => void` | Required synchronous image drawing |
| `onPulse` | `(name, p, frame) => void` | Optional synchronous event handling before draw |

TD supplies `p` and owns the image/render lifecycle. Do not create a browser
canvas, instantiate a second renderer, call `beginFrame`/`endFrame`, or implement
your own draw scheduling. Keep drawing in `draw` (or a synchronous TOP pulse
handler); timers should update state for a later draw. Set resolution with
**Sketch → Width/Height**, not by resizing `p`. A resolution change restarts the
active script and its GPU resources.

```ts
// Target: top
import type { Draw, OnPulse } from '@avtools/native-webgpu/td-sketch';
import type { ParameterDefinitions } from '@avtools/native-webgpu/td-parameters';

export const parameters = {
  Radius: { type: 'float', default: 40, min: 1, max: 200 },
  Center: { type: 'pulse', label: 'Center Circle' },
} as const satisfies ParameterDefinitions;

let x = 0.5;

export const onPulse: OnPulse<typeof parameters> = (name) => {
  if (name === 'Center') x = 0.5;
};

export const draw: Draw<typeof parameters> = (p, frame) => {
  p.background(24);
  const image = frame.top(0);
  if (image) p.image(image, 0, 0, frame.width, frame.height);

  p.fill(80, 180, 255);
  p.circle(x * frame.width, frame.height / 2, 2 * frame.params.Radius);
};
```

### Host and frame members

| Member | Meaning |
| --- | --- |
| `host.params` | Latest accepted declared-parameter snapshot |
| `host.device` | This activation's Dawn `GPUDevice`, for raw WebGPU/Power2D/shader-fx |
| `host.chop(name, sampleIndex = 0)` | Latest accepted Controls CHOP sample; missing data gives `0` |
| `host.latestControls()` | Fresh records and sample copies of the latest Controls CHOP snapshot |
| `host.files`, `host.udp`, `host.osc` | Shared I/O APIs below |
| `host.onDispose(fn)` | Register synchronous cleanup |
| `host.timing` | Compatibility TimeContext namespace; prefer ordinary imports |
| `host.readFile(path)` | Legacy synchronous byte read; prefer async `host.files` |
| `frame.width`, `frame.height` | Current output dimensions |
| `frame.frame`, `frame.absFrame`, `frame.rate`, `frame.time`, `frame.deltaSeconds` | TD request timing; `time = (frame - 1) / rate` |
| `frame.params` | Snapshot belonging to this draw/pulse request |
| `frame.chop(name, sampleIndex = 0)` | Controls CHOP sample belonging to this request |
| `frame.controls` | `sampleRate`, `startIndex`, `channels: {name, samples: Float32Array}[]` |
| `frame.top(index)` | Wired input image (`P5GPUImage`), or `undefined` if absent |

Select a CHOP on **Sketch → Controls CHOP** to provide named controls; wire TOPs
to image input connectors. TOP `chop()` defaults to sample **0**, unlike CHOP
`inputs.get()`, which defaults to the last sample. Treat frame data as read-only.
For retained/mutable controls use `host.latestControls()`; it returns copies.
Do not retain input image handles across renders or destroy their textures.

`host.device` is also the device used by the supplied renderer. Prepare your own
GPU resources in setup, use the same device, and present through `p` in draw.
Buffers/textures created through the guarded device are tracked for teardown;
register additional resource cleanup with `onDispose`. A CHOP has no equivalent
GPU API. Bundled fonts initialize the renderer automatically; this guide leaves
p5 drawing/font methods to the SDK's p5 declarations.

### WebGPU lifecycle in this host

You can use raw WebGPU, `@avtools/power2d/raw` and `@avtools/shader-fx/raw` for
your rendering or compute work. The TD integration differences from a browser are:

- **Device:** use `host.device` in TOP setup. The host already selected Dawn's
  Metal adapter and created the device. There is no `navigator.gpu`, adapter
  negotiation or browser canvas to configure. Check the supplied device's
  `features`/`limits` if your code needs an optional capability; an adapter's
  possible feature is not necessarily enabled on this device.
- **Output:** render into your own same-device texture, then pass it to
  `p.image({texture}, 0, 0, frame.width, frame.height)` in draw. This is the current
  presentation bridge even if you use no other p5 drawing functions. There is
  no exported `render(device)` callback, canvas swapchain, or return-a-texture
  output API. A `draw` export is still required.
- **Texture contract:** use a sampleable 2D color texture (the simple path is
  single-sample `rgba8unorm` with `TEXTURE_BINDING`, plus the usage your renderer
  needs). Resolve multisampling and visualize depth/integer/storage data into
  such a color texture first. Presentation expects straight alpha and top-left
  UVs; `p.image({texture, flipY: true}, ...)` handles an opposite image origin.
- **Submission:** submit your own passes on `host.device.queue` before calling
  `p.image`. Queue ordering handles their dependency on the host's later image
  submission. Do not wait for `queue.onSubmittedWorkDone()` or map a readback just
  to present an image. Keep the texture alive and unchanged through the end of
  draw; `p.image` queues its use, it does not take an immediate pixel copy.
- **Frames:** TD invokes synchronous draw on accepted cook requests. RAF is a
  TD request event, not a screen refresh loop. Timers may update CPU state
  independently; render/present it in draw. The host begins/ends the renderer
  frame and handles output readback/TD upload or Syphon after draw returns.
- **Lifetime:** allocate long-lived resources in setup using `p.width`/`p.height`.
  Reload, Reset, resize and operator deletion retire this activation and its
  device. Setup runs again with a new device after restart; no pipeline, texture
  or buffer from the old device is reusable. Do not destroy `host.device`
  yourself. Use `host.onDispose` for your library's synchronous cleanup; host
  tracking also destroys buffers/textures created through the guarded device.
- **Inputs and isolation:** `frame.top(i)` is an owned-by-host uploaded input,
  not a borrowed TD-native GPU texture. Do not destroy it. Each TOP has its own
  device/isolate, so GPU objects cannot be shared across TOP instances. GPU
  validation/device-loss errors surface through operator diagnostics; Reset
  creates a fresh runtime rather than browser-style canvas recovery.

Minimal lifecycle example: the raw pass creates the image; p5 is used only to
present its texture. Save as a TOP entry. It needs no external shader or input.

```ts
// Target: top
// Example: raw-webgpu-lifecycle
import type { Setup, Draw } from '@avtools/native-webgpu/td-sketch';

let device: GPUDevice;
let image: GPUTexture;

export const setup: Setup = (p, host) => {
  device = host.device;
  image = device.createTexture({
    size: [p.width, p.height],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });

  host.onDispose(() => image.destroy());
  // Library renderers can register renderer.dispose() here instead.
};

export const draw: Draw = (p, frame) => {
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: image.createView(),
      clearValue: { r: 0.1, g: 0.3, b: 0.8, a: 1 },
      loadOp: 'clear',
      storeOp: 'store',
    }],
  });
  // Your normal WebGPU render/compute workflow produces the image here.
  pass.end();
  device.queue.submit([encoder.finish()]);

  p.image({ texture: image }, 0, 0, frame.width, frame.height);
};
```

Power2D/ShaderFX follow this same pattern: initialize with `host.device`, render
in draw, present the library's output texture with `p.image`, and dispose the
library's resources on teardown. Prefer their `/raw` entrypoints over browser- or
Babylon-specific hosts. WGSL imports and generated wrappers work through the
native builder described below; no browser canvas setup is involved.

## Declared parameter reference

Use `export const parameters = { ... } as const satisfies ParameterDefinitions`
directly in the TypeScript entrypoint. Every definition has `type` and optional
`label` and `page`. Default page is **Controls**. `as const` preserves literal menu
options and tuple types for `ChopHost<typeof parameters>` / `Draw<typeof parameters>`.

| `type` | JavaScript value | Default and additional fields |
| --- | --- | --- |
| `float`, `int` | `number` | Default `0`; optional `min`, `max`, `clamp` |
| `toggle` | `boolean` | Default `false` |
| `string` | `string` | Default `''` |
| `menu` | Union of option strings | Required `options`; optional matching `labels`; default first option |
| `xy` | Readonly pair | Default zeros; optional `min`, `max`, `clamp` |
| `xyz`, `rgb` | Readonly triple | Default zeros; optional `min`, `max`, `clamp` |
| `rgba` | Readonly quadruple | Default zeros; optional `min`, `max`, `clamp` |
| `pulse` | No value; event only | Delivered by exact name to `onPulse` |

`default` sets a new control's initial value. Numeric slider bounds default to
0–1; use `clamp: true` to enforce bounds on values, not just the slider. Bounds
apply to all tuple components. Integer defaults must fit int32. RGB/RGBA values
come from TD's working color space. Nonfinite numeric expressions sample as zero.

Names must be an uppercase letter followed by lowercase letters/digits:
`Speed`, `Bpm`, `Offset2` are valid; `mySpeed` and `MySpeed` are not. Avoid built-in
control names and tuple-component collisions. Use your own page names rather
than built-in Build, Sketch, Script, Output, Diagnostics or Legacy Build pages.
Maximum: 64 declarations and 32 KiB metadata per entry.

Metadata must be literal data in that export. No imported schema, re-export,
spread, computed key, function, variable reference or generated default expression
is supported. This restriction applies only to UI metadata, not ordinary code.
Raw JavaScript/DAT scripts do not get builder-extracted parameter declarations.

Reads are immutable snapshots, sampled with other accepted inputs without an
extra frame of latency. Read `host.params` again after an `await` to observe new
accepted values; `const saved = host.params` intentionally keeps the old snapshot.
Undeclared properties are `undefined` at runtime and rejected by generic types.
You cannot set TD controls by assigning to `host.params`.

Compatible names/types retain TD values, expressions, exports and bindings.
Changing a default does not overwrite a user's current value. Added controls get
defaults; removed controls disappear. Changing type under the same name is
rejected: use a new name and reconnect bindings as necessary. A schema edit
recreates the native instance, so expect a brief restart. An ordinary code edit
restarts only the JavaScript runtime. Saved `.toe`/`.tox` files retain the declared
control schema/values, not live JS variables or timing tasks.

## Pulses and callback ordering

For an ad hoc event, set **Event Name** and press **Send Pulse** on Sketch (TOP)
or Script (CHOP). For a dedicated button, declare a `pulse` parameter. Both call
`onPulse` with the captured name. There is no event payload; read input channels
and declared parameters in the handler. Missing input channels return zero as
specified above; pulse parameters are absent from `host.params`.

Accepted requests install inputs/parameters, complete setup if needed, resume
existing frame waiters, dispatch queued pulse names FIFO, and then invoke
`draw`/`onCook`. Thus onCook can overwrite a pulse's output in the same request.
A pulse is not an independent realtime callback: it waits for an accepted TD
request, even while wall-clock timers/OSC are running. Queue capacity is 256;
overflow is reported. Buffered CHOP input replacement does not discard separately
queued pulse names. The handler sees the snapshot accepted for delivery, not a
historical snapshot captured at the button press.

## TimeContext and independent tasks

Use ordinary imports from `@avtools/core-timing`. `launch` supplies a realtime
context with `waitSec(seconds)` and tempo-aware `wait(beats)`; options include
`bpm`, `rate`, `seed`, `debugName` and timer overrides. Its cancelable handle has
`cancel()` and promise-like completion/error methods. `launchBrowser` additionally
supplies `waitFrame()`: despite the name, it works with TD's provided RAF adapter.
Other portable timing APIs remain available from the bundled source.

A persistent CHOP animation (Output Channels `value`, Output Samples `1`):

```ts
// Target: chop
import { launch } from '@avtools/core-timing';
import type { ChopHost } from '@avtools/native-webgpu/td-chop';

export function setup(host: ChopHost) {
  const task = launch(async (ctx) => {
    while (true) {
      const target = host.inputs.get('target');
      const current = host.outputs.get('value');
      host.outputs.set('value', current + (target - current) * 0.1);
      await ctx.waitSec(1 / 120);
    }
  });

  // Error policy here is explicit: report a failed task and leave its last value.
  task.catch((error) => console.error('Animation stopped:', error));
  host.onDispose(() => task.cancel());
  // Return now. Awaiting this endless task would prevent setup from completing.
}
```

Keep animation state in ordinary variables or persistent CHOP outputs. An
independent loop reads the latest accepted host state, updates its own state,
and lets TD's cook/render path present it. No extra "next frame" object is needed.
For elapsed real time, measure `performance.now()` or use the timing library;
do not assume each callback arrives exactly at its requested interval.

`waitSec` and `setTimeout` continue without TD cooks, including paused playback.
`waitFrame`/RAF advance only on **accepted requests**, after input capture and
before pulses/draw/onCook. A busy TOP or coalesced CHOP does not replay skipped
requests. Repeated cooks in the same TD frame can deliver multiple frame events.
Frame waits neither pull TD input data nor synchronize to a display refresh.
While paused, host inputs/parameters remain at their last accepted values.

Launch independent tasks from setup or pulses, not once per draw/cook unless
that is deliberate. Cancel or supersede an older animation when retriggering;
otherwise several tasks may write the same state. For full reload, the isolate
boundary stops all old tasks even if application cancellation cleanup cannot run.

## Execution modes and latency

| Operator | Default | Wait for Current Result on | Toggle off |
| --- | --- | --- | --- |
| CHOP | On | TD waits for the accepted current inputs and onCook result | Offers inputs and collects latest complete publication |
| TOP | Off | TD waits for earlier work and renders current inputs | Submits when idle and collects a finished image |

Blocking CHOPs have no intentional extra frame delay for simple input/output
math; they do consume TD's frame budget. A chain of buffered CHOPs can accumulate
latency because each reads the latest completed upstream output. Use blocking
mode where a same-cook dependency matters. Changing this toggle preserves state.

Buffered output is not guaranteed to be exactly one frame late. Completion may
be ready in the same cook or later; busy workers and long tasks can increase age.
A CHOP coalesces pending inputs, so intermediate snapshots may be skipped. A TOP
skips new input captures while busy. Independent instances can work concurrently,
but they still share CPU/GPU/memory bandwidth and TD must collect their output.

TOP CPU output uses RGBA8 readback from Dawn and a TD upload. Wired image inputs
also require TD download and Dawn upload; they are not zero-copy textures shared
with the script. Buffering moves waits off the ordinary TD cook path, not all
transfer or submission costs. Named CHOP controls use CPU snapshots instead.

### Optional TOP pre-trigger mode

Enable **Output → Pre-trigger Mode** on participating TOPs and use one Execute
DAT with Frame Start enabled. Early submission gives workers time before later
collection. **Wait for Current Result** is ignored in this mode. Ordinary cooks
only collect; without a coordinator the TOP cannot submit new renders.

This minimal coordinator belongs in an Execute DAT in the enclosing component:

```python
# TouchDesigner Execute DAT: enable Frame Start.
def onFrameStart(frame):
    nodes = sorted(
        (n for n in parent().findChildren(type=TOP, parName='Pretrigger')
         if n.valid and not n.bypass
         and hasattr(n.par, 'Pretriggerpulse') and n.par.Pretrigger.eval()),
        key=lambda n: n.path,
    )
    try:
        for n in nodes:
            n.par.Pretriggerpulse.pulse()
            n.cook(force=True)
        # Optional: cook independent work here, before collecting these TOPs.
        # Do not sleep or poll; avoid branches depending on these same TOPs.
    finally:
        for n in nodes:
            if n.valid and not n.bypass:
                n.cook(force=True)
    return
```

A ready current-frame image is collected; otherwise the previous image remains.
There is no guarantee of same-frame completion. Inputs are captured on submission,
so anything updated afterwards belongs to a later accepted request. Input image
transfers still have TD/GPU synchronization costs. Forced collection is necessary
because TD can cache a prior cook within the same frame.

### Optional Syphon output

On Output, enable **Enable Syphon** and choose **Syphon Name** for the instance.
A Syphon receiver can consume that image. With **Syphon Only (1px TOP)** enabled,
the plugin skips normal full-size CPU output readback and publishes through
Syphon; the wired TOP becomes a 1×1 placeholder. Use a Syphon receiver in TD for
the full image. Enabling Syphon without Syphon Only keeps normal CPU TOP output
as well. Wired image inputs still use CPU transfer. Use unique names for instances.

## File API

Both hosts provide:

| Member | Result |
| --- | --- |
| `host.files.baseDirectory` | Base path for this active script |
| `await host.files.readText(path)` | UTF-8 string; invalid encoding rejects |
| `await host.files.readBytes(path)` | Owned `Uint8Array` |

Relative paths resolve beside the selected TypeScript/source entry, not beside
its emitted `.avtools` bundle or necessarily the `.toe`. DAT scripts use TD's
`project.folder`; legacy manifest entries use their Project Directory. Absolute
paths, `../` and symlinks are supported with TD's macOS permissions. Only regular
files up to 64 MiB are accepted, with at most four pending reads per instance.
Missing files, permission errors, directories and oversized files reject.

Use `async setup` for initialization and validate parsed JSON before use. Asset
file changes alone do not rebuild TypeScript; Reset rereads setup assets, or your
code can explicitly reread them. There are no file-write/directory APIs. See
`sketches/osc/config.json` and the matching TOP/CHOP entries for complete examples.

```ts
// Target: chop
import type { ChopHost } from '@avtools/native-webgpu/td-chop';

export async function setup(host: ChopHost) {
  // Create config.json beside this entry, for example: {"initialValue": 0.25}.
  const config: unknown = JSON.parse(await host.files.readText('./config.json'));
  if (typeof config !== 'object' || config === null ||
      !('initialValue' in config) || typeof config.initialValue !== 'number' ||
      !Number.isFinite(config.initialValue)) {
    throw new Error('config.json needs a finite initialValue');
  }
  host.outputs.set('value', config.initialValue);
}
```

## UDP and OSC API

Import types from `@avtools/native-webgpu/td-io`. Both hosts expose
`await host.udp.open(options?)` and `await host.osc.open(options?)`.
Options are `{address?: string, port?: number}`; defaults are `127.0.0.1` and
port `0` (choose an available port). A sender also uses an opened socket.

| Socket member | UDP | OSC |
| --- | --- | --- |
| `localAddress` | `{address, port}` | Same |
| `send(payload, remote)` | `Uint8Array` → `Promise<void>` | `OscMessage` or `OscBundle` → `Promise<void>` |
| `onMessage(fn)` | `(bytes, remote) => void` | `(message, remote) => void` |
| `onError(fn)` | `(error: Error) => void` | Includes malformed OSC errors |
| `close()` | Idempotent | Idempotent |

`remote` is `{address: string, port: number}`. Each listener registration returns
an unsubscribe function. Numeric IPv4/IPv6 and `localhost` are supported; DNS,
multicast and broadcast options are not. Bind `0.0.0.0` or `::` explicitly for LAN
reception. A port is exclusive, so duplicate binds reject. For several instances,
use different ports or let `0` choose one and inspect `localAddress.port`.

Open/send errors reject their promises. Send resolves on OS acceptance, not
remote receipt. UDP may lose or reorder datagrams. Native receive failure calls
`onError` and closes the socket. Reload, Reset, failed-generation invalidation
and destruction close sockets and suppress stale callbacks automatically. If a
Port control is read only during setup, press Reset after changing it.

Callbacks run on the same JS owner as timing, independently of TD cooking. They
may update ordinary state or CHOP output; TD still needs a cook to show it. Keep
callbacks short. Do not assume an async listener is awaited: explicitly handle
promises it launches. Exceptions follow the sketch's normal error policy.

Limits per instance: 16 sockets, 64 in-flight native sends, 128 pending native
operations, 65,507 bytes per UDP datagram, and a receive queue of 256 packets /
4 MiB. `host.udp.droppedDatagrams` counts native queue overflow, not all network
loss. Outgoing bytes are copied. Listeners on one UDP socket receive the same
owned packet object; copy it before independent mutation.

### OSC payloads and typed arguments

Send a message as `{address: '/gain', args: [0.5]}`. `args` is optional. Send a
bundle as `{timetag: 1n, packets: [messageOrBundle, ...]}`. Incoming messages have
`address`, typed `args`, and a raw bigint `timetag`. Incoming args are **objects**,
not bare numbers: narrow `arg.type` before using `arg.value`.

| Outgoing value | OSC tag |
| --- | --- |
| `number` | `f` (float32) |
| `string` | `s` |
| `boolean` | `T` / `F` |
| `null` | `N` |
| `bigint` | `h` (int64) |
| `Uint8Array` | `b` (blob) |

Explicit arguments support these shapes:

- `{type: 'i' | 'f' | 'd' | 'c' | 'r', value: number}`
- `{type: 'h' | 't', value: bigint}`
- `{type: 's' | 'S', value: string}`
- `{type: 'b' | 'm', value: Uint8Array}` (`m` is four-byte MIDI data)
- `{type: 'T' | 'F' | 'N' | 'I'}` (no value field)
- `{type: 'array', value: OscArgument[]}` (nested typed arguments)

Example receiving `/gain` and replying to its sender; Output Channels `value`:

```ts
// Target: chop
import type { ChopHost } from '@avtools/native-webgpu/td-chop';

export async function setup(host: ChopHost) {
  const osc = await host.osc.open({ port: 9000 });
  osc.onError((error) => console.warn('OSC:', error.message));

  osc.onMessage((message, sender) => {
    const arg = message.args[0];
    if (message.address !== '/gain' || !arg ||
        (arg.type !== 'f' && arg.type !== 'i' && arg.type !== 'd')) return;
    if (!Number.isFinite(arg.value)) return;

    host.outputs.set('value', arg.value);
    osc.send({ address: '/received', args: [arg] }, sender).catch(console.warn);
  });

  // Sending needs no inbound message; this sends to another known receiver.
  await osc.send({ address: '/ready', args: [true] }, {
    address: '127.0.0.1', port: 9001,
  });
}
```

Bundles deliver immediately in wire order, including future timetags. Each
message reports its innermost bundle's raw 64-bit NTP timetag; a standalone
message uses `1n`. Timetags do not schedule future callbacks. There is no automatic
address-pattern matching: route addresses in your handler. Malformed packets,
unsupported tags and nesting deeper than 16 are discarded as a whole and reported
to `onError`. These APIs are available on TOP hosts too; update state for draw
instead of using the CHOP-only outputs API.

## Build, activation and cleanup

| Operator control | Behavior |
| --- | --- |
| TypeScript File | Selects one entry in a normal TS project |
| Automatic Builds | Watches/compiles that entry and its dependency graph |
| Build Script | Requests a build; does not override Automatic Reload |
| Automatic Reload | Activates successful changed code and its declared controls; default on |
| Reload | Adopts latest successfully available code, even if unchanged |
| Reset | Restarts currently active code; does not adopt a pending newer build |

First initialization loads available code even with Automatic Reload off.
Identical rebuilds do not restart; enabling Automatic Reload adopts a pending
change. Each operator controls activation independently, even with a shared entry.
A failed build preserves the active running sketch. A runtime activation failure
stops the old environment and does not roll back; edit/reload/reset to recover.
A previously completed output may remain visible, which does not mean the old
script is still running. Pending actions need a normal TD cook to take effect.

Every activation creates a fresh isolate: module variables, globals, timers,
promises, listeners and sockets start over. TOP resize and CHOP output-schema
changes also restart the active source. A TOP recreates its device and renderer.
There is no state-preserving hot module replacement or serialization of live JS
state into the `.toe`. Source/config/assets must travel with the saved project.

`host.onDispose(() => { ... })` registers short synchronous cleanup, called in
reverse registration order while resources are still valid. Do not depend on
an awaited cleanup, `finally`, or cancellation continuation completing during
full reload. The host releases resources even if cleanup fails. Application-level
task cancellation can be used normally while the generation remains alive.

An uncaught callback exception/unhandled rejection stops the owning sketch and
appears in diagnostics; `console.error` alone does not stop it. User code owns its
error policy for promises it catches. A synchronous callback and microtask drain
have a watchdog (1 second); async initialization has a 3-second wait limit. Keep
callbacks much shorter for interactive work. Async I/O prevents ordinary read
waits from occupying JS, but does not make JSON parsing or other CPU work async.
Teardown joins workers and pending native file operations; slow filesystem/native
driver calls can still delay it. These limits are not hard realtime guarantees.

### Project and build files

Keep `tsconfig.json` at this project's root and extend `./sdk/tsconfig.json`.
It supplies local aliases and the host type profile. The mixed template includes
`td-top-runtime.d.ts`; replace that include with `td-runtime.d.ts` for a CHOP-only
project. Additional tsconfig `paths` replaces inherited paths, so preserve required
SDK aliases when customizing it. Avoid hardcoding paths into the avTools source
repository: the generated SDK is local to this project.

Local `.wgsl` imports yield strings. Recognized material/compute shader suffixes
produce generated wrappers under `generated/`. Files under `.avtools/` are caches;
do not select or edit them as your source. The native builder compiles each entry
with its dependencies, so unrelated entry errors need not block it. Imports may
point outside the project or through symlinks, but those dependencies must also
be available when sharing. npm installation is separate; the builder neither
installs packages nor supplies missing Node/browser runtime APIs.

Source selection precedence is TypeScript File, legacy Project Directory, Sketch
DAT, then Source File. For new work use TypeScript File. Legacy DAT/source JS
uses ordinary top-level callback functions and has no native TypeScript metadata
extraction. `host.timing` supports compatibility scripts; new TS code should
import `@avtools/core-timing` directly.

## Logging, diagnostics and verification

Create an **Info DAT** targeting the operator. On its **Diagnostics** page choose
**Info DAT View → Diagnostics** for build/reload state or **Logs** for console
messages. This view setting is shared by all Info DATs targeting that operator.
Log columns are `sequence`, `time_ms`, `generation`, `level`, `message`.
Timestamps are monotonic since logger creation, not timeline time.

Log Level defaults to Info (`log` and `info`); choose Debug for debug messages.
It filters future messages only. History retains 256 entries, up to 4096 UTF-8
bytes each. Large/deep values are previewed with limits; formatting does not run
getters or custom inspection code. No browser-style `%s`/`%o` substitution is
performed. `console.error` is logging, not throwing. There is no automatic Textport
or terminal mirroring.

**Clear Logs** clears history/counters, preserving script state and sequence
numbering. **Refresh Logs (No Script)** updates TD's cached metadata while paused
without running JS, consuming a worker result, or activating queued resets/reloads.
It takes effect through a metadata-only source cook. Force-cooking only the Info
DAT may not refresh the source's cached table. Use Passive on observers when you
do not want them to pull ordinary source cooks. Logs survive script reload/reset,
but not deleting the operator or closing the project.

Useful Info DAT fields: `build_state`, `build_diagnostics`, `reload_state`,
`source_identity`, `log_retained`, `log_evicted`, `log_dropped`, `log_truncated`.
Use an **Info CHOP** for numeric runtime measurements:

| Operator | Useful channels |
| --- | --- |
| TOP | `output_age_frames`, `skipped_frames`, `worker_busy`, `cook_ms`, `worker_ms`, `input_download_ms`, `input_upload_ms`, `draw_submit_ms`, `readback_wait_ms`, `upload_enqueue_ms`, `blocking_wait_ms` |
| CHOP | `submitted_request`, `accepted_request`, `completed_request`, `source_request`, `published_sequence`, `consumed_sequence`, `input_age_ms`, `publication_age_ms`, `reused_cooks`, `repeated_percent_120`, `coalesced_inputs`, `cook_ms`, `script_ms`, `worker_ms`, `blocking_wait_ms` |

For TOPs, `output_age_frames == 0` means output was submitted in the current TD
absolute frame; positive values indicate older output, and `-1` means unavailable
or an invalid age after a seek. Sample it over running frames to count same-frame
versus delayed results. For CHOPs, publication identity/age tells you about retained
output; timers may publish multiple times from one accepted input request.
`repeated_percent_120` measures reuse, not an exact fixed number of latency frames.

TD's `cpuCookTime` does not include all concurrent worker CPU. TOP
`upload_enqueue_ms` measures the TD upload call, not separate GPU completion.
Sum submission and collection costs for pre-trigger mode. Readbacks and copies
remain costs even on unified-memory Macs. Return Info DAT View to Diagnostics
after inspecting logs to avoid repeatedly copying full log tables.

Before calling a sketch finished, check the following in TD:

1. Build state is Ready and runtime warnings/errors are clear.
2. The required input wiring and output channel/sample configuration are explicit.
3. Representative input/parameter changes produce the expected output, including
   missing-input fallbacks. Pulses affect state as intended relative to onCook/draw.
4. Saving code and pressing Reset give the intended fresh state. A build error
   preserves the previous working code. Setup resources (files/ports) reopen.
5. If timing/OSC matters, verify state updates while playback is paused, then
   resumes presentation on the next cook; inputs remain the last accepted snapshot.
6. Measure at the intended resolution/buffer size and instance count. Do not infer
   same-frame latency from low TD CPU cook time alone.

For a coding agent without TD access, build/typecheck and inspect the examples,
then clearly state which runtime behavior still needs TD verification. Optional
`avtools-build check-file ENTRY.ts top|chop` checks types; `build-file` also bundles.
The CLI is a maintainer tool and is not required or shipped beside the plugins.
The generated README and SDK are embedded in each plugin at build time; updating
a plugin does not overwrite an existing generated project's files.
