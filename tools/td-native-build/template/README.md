# TypeScript sketches for TouchDesigner

Open this folder in VS Code. The local SDK and tsconfig provide TypeScript types
without installing Node or an editor extension.

In an avTools TOP's **Build** page, select `sketches/background/main.ts` as
**TypeScript File**. In an avTools CHOP, select `sketches/channels/main.ts` and set
**Output Channels** to `value ticks`, **Output Samples** to `1`. A wired input
channel named `value` is doubled; `ticks` advances independently with TimeContext.
The Create Template Project button configures the operator that created this folder.

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
