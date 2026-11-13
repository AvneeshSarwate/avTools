# avTools Channels CHOP

Current lifecycle: [Build, Reload, and Reset](RELOAD.md). Automatic Reload is per operator; Reload adopts available source, Reset restarts active source. Each activation creates a fresh isolate. SDK 3 supports ordinary TimeContext imports.


A native TouchDesigner CHOP running JavaScript in V8 with the workspace's
TimeContext library. Each instance owns persistent output state, current input
snapshots, and independent timing tasks. It does not create a WebGPU device or
transfer textures.

Open [Channels.toe](native/td/chop-example/Channels.toe) to try the embedded example
without Node, Deno, or a native build. It resolves the checked-in Apple Silicon
plugin automatically. Select the parent component, change Target and Duration,
and pulse Trigger to animate gain. Value is multiplied by the current gain in
the same cook. Two independent instances and a four-CHOP pass-through chain are
included. See the [example guide](native/td/chop-example/README.md).

For TypeScript editing without a terminal watcher, open the
[native project](../../apps/td-projects/native/README.md). Its Build page selects
a project and entry; checking, bundling and watching happen inside the plugin.
The copied SDK works in VS Code. See the [native build guide](../../tools/td-native-build/README.md).

The existing Node workflow remains in [apps/td-projects/channels](../../apps/td-projects/channels/README.md).
Run `npm run setup`, open that directory in VS Code, run `npm run dev`, and open
its `project.toe`. Saving a valid change rebuilds the bundle and restarts the
corresponding instances on their next cook. No browser or server is required.

## State and timing

**Wait for Current Result** (`Samecook`) defaults to **On**. The worker accepts
this cook's owned input snapshot, resumes frame waits, delivers queued pulses,
and runs `onCook`. TD waits for that request and copies its complete result.
Chained blocking CHOP costs add in TD dependency order.

Turn it **Off** to return the latest completed output without waiting for JavaScript.
A result already ready at collection can be used immediately; there is no mandatory
one-frame delay. When overloaded, one replaceable pending input snapshot keeps
memory bounded. Intermediate requests may be skipped. Outputs initially are zero;
reload keeps the last compatible result, while channel/sample changes start at zero.
The same script works in either mode, and toggling preserves its state and timers.

Independent TimeContext tasks and `setTimeout` run between cooks, including while
playback is paused. Their writes publish complete snapshots after worker turns;
the next TD cook can collect them without waiting for its newly submitted work.
Reads use the latest **worker-accepted** inputs. A synchronous callback sees stable
inputs; an async continuation can see newer inputs after an `await`.

`launchBrowser`/`waitFrame` advances once per accepted request. Skipped cooks are
not replayed. `frame.deltaSeconds` accumulates elapsed absolute TD time across
coalescing; timeline `frame`/`time` can seek or loop. TimeContext realtime clocks
still use monotonic wall time. Nothing synthesizes frame ticks while paused.

JavaScript is single-threaded per instance. Slow callbacks delay that isolate;
blocking cooks also wait, buffered cooks do not. Setup may return a Promise;
`onCook` and `onPulse` must be synchronous. Launch long-lived tasks rather than
awaiting them in setup. The watchdog is a recovery mechanism, not a frame budget.

Open [ExecutionModes.toe](native/td/execution-mode-example/ExecutionModes.toe)
for a side-by-side example. See [execution details and measurements](EXECUTION_MODES.md).

## Script API

Raw DAT scripts define `setup(host)`, `onCook(host, frame)`, and/or
`onPulse(name, host)`. At least setup or onCook is required. TypeScript bundles
export these functions and import types from `@avtools/native-webgpu/td-chop`.
The complete contract is in [td-chop.d.ts](td-chop.d.ts).

```ts
import type {Setup, OnCook, OnPulse} from '@avtools/native-webgpu/td-chop';

export const setup: Setup = host => {
  host.outputs.set('gain', 1);
  host.timing.launch(async ctx => {
    while (true) {
      await ctx.waitSec(1 / 120);
      const target = host.inputs.get('target');
      const gain = host.outputs.get('gain');
      host.outputs.set('gain', gain + (target - gain) * 0.05);
    }
  });
};
export const onCook: OnCook = host => {
  host.outputs.set('value', host.inputs.get('value') * host.outputs.get('gain'));
};
export const onPulse: OnPulse = (name, host) => {
  if (name === 'ResetGain') host.outputs.set('gain', 0);
};
```

Set **Output Channels** to `value gain`. Channel names are fixed for a generation;
changing the names or sample count restarts it. Names must be unique identifiers.

| API | Behavior |
| --- | --- |
| `inputs.get(name, input = 0, sample?)` | Latest input value; defaults to the last sample. Missing channel/input/sample returns 0. |
| `inputs.samples(name, input = 0)` | Owned Float32Array copy; missing channel returns an empty array. |
| `inputs.names(input = 0)` | Names on that input connector. |
| `outputs.set(name, value, sample = 0)` | Set one persistent output sample. |
| `outputs.get(name, sample = 0)` | Read persistent state; missing data returns 0. |
| `outputs.setSamples(name, values)` | Copy exactly `outputs.sampleCount` samples into a channel. |
| `outputs.samples(name)` | Owned copy of persistent channel state. |
| `outputs.names()` / `outputs.sampleCount` | Output layout for this generation. |
| `onDispose(callback)` | Register cleanup before the generation is invalidated. |

Outputs start at zero and remain until changed. Writes require a declared channel,
valid sample index, and finite float32 values. Array copies cannot mutate host
state accidentally or after a reset. Use TimeContext context-local variables or
module state for other intermediate data. Restart destroys the old isolate,
including timers, frame waits and retained closures. Import timing functions
normally from `@avtools/core-timing`; `host.timing` is a compatibility API.

## Buffers and XY point clouds

Set **Output Samples** to 10000 and **Output Channels** to `x y` for 10,000 XY
points. Blocking mode delivers all samples during the same cook; buffered mode
returns complete arrays from a finished request. Four wired input CHOPs
are supported, with each input's channel names kept separate. For interpolation,
connect XY buffer A to input 0, XY buffer B to input 1, and a `mix` channel to
input 2:

```ts
export const onCook: OnCook = host => {
  const mix = host.inputs.get('mix', 2);
  for (const name of ['x', 'y']) {
    const a = host.inputs.samples(name, 0);
    const b = host.inputs.samples(name, 1);
    if (a.length !== host.outputs.sampleCount || b.length !== a.length)
      throw new Error('Both XY inputs must match Output Samples');
    for (let i = 0; i < a.length; i++) a[i] += (b[i] - a[i]) * mix;
    host.outputs.setSamples(name, a);
  }
};
```

This is a full-buffer control/geometry CHOP, not a time-sliced audio processor.
Output starts at index 0 and uses TD's project rate as its sample rate. The
sample count defaults to 1. Limits are 1,048,576 total float samples separately
for input and output, 4 input connectors, and 1024 output channels. Data crosses
owned CPU buffers; this is not zero-copy. Bulk arrays avoid one host call per point.

## Parameters and errors

TypeScript File takes priority over Sketch DAT and Source File. Create Template
Project can scaffold the SDK and sources from the Build page. With TypeScript File clear,
Sketch DAT takes priority over Source File. Source File uses background filesystem
notifications and changed-file reads; cooks adopt pending source without rereading
the file. Project builds support TypeScript and static imports. Event Name plus Send Pulse
captures its name immediately and queues it FIFO for the next accepted request.
The handler reads that request's inputs;
pulses carry no argument object. Reset and Reload restart the current script.

A replacement script that fails during compilation/setup leaves the working
generation active and reports a TD warning. It is retried after another edit or
Reset. Runtime errors appear as TD errors in blocking mode. Buffered mode retains the
last compatible output and shows a warning; fix the script or Reset. Output layout changes also restart the script.

An Info CHOP exposes cook/worker/copy/wait costs, submitted/accepted/completed
request IDs, published/consumed sequences, source frame, monotonic input and
publication ages, coalesced inputs, pulse overflow, and repeated-publication
percentage over the last 120 cooks. `cook_ms` covers native execute;
TD's `cpuCookTime` includes operator overhead. Background callbacks also consume
CPU between cooks. See [the diagnostic reference](EXECUTION_MODES.md#diagnostics).

## Build and tests

Prebuilt support: macOS 15+, Apple Silicon, TD 2025.31550, CHOP API 10. The plugin
shares the TOP's embedded runtime/toolchain but initializes only its CPU channel
host. See [the prebuilt guide](prebuilt/README.md) and
[the native build guide](TOUCHDESIGNER.md#build-and-runtime-ownership).
After changing native runtime code, rebuild it with `node scripts/embedding.mjs`,
then run `npm run td:build:chop`. This publishes a versioned signed bundle and
`prebuilt/macos-arm64/current-chop.txt`. Ordinary script edits need neither step.

`npm run test:chop` checks same-cook values, independent timers, pulses, isolation,
reload cleanup, errors, and large XY buffers using the actual embedded runtime.
The example's `verify.py` and `stress.py` run inside TD; they include TD buffer
handling and operator cook overhead. See [validation](native/td/chop-example/VALIDATION.md)
for measured workloads, limitations, and reproduction steps.

`node test/chop/run.mjs --execution` runs policy/timeout tests and a 1/4-instance
scalar/10k XY benchmark. `--quick` skips the benchmark matrix.

Console messages are available per operator through the Diagnostics page and Info DAT. See [logging and paused refresh](LOGGING.md) and the [openable Logging.toe example](native/td/logging-example/Logging.toe).

## Script-declared controls

TypeScript entries can export a literal `parameters` object to create native sliders,
colors, menus, text fields, toggles and pulse buttons. See [PARAMETERS.md](PARAMETERS.md)
for typed reads, reload/persistence behavior and generated examples.
