# avTools Channels CHOP

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

A cook performs these steps synchronously:

1. Read the upstream CHOP inputs and publish an owned snapshot to the V8 owner.
2. Resume pending frame waits, deliver queued pulses, and call optional `onCook`.
3. Copy persistent output state to this cook's TD output buffers.

There is no previous-frame output queue. `onCook` sees this cook's input values;
its writes reach downstream nodes in the same cook. Chained instances cook in
TD dependency order. Their synchronous costs add; they do not run in parallel
merely because each has an owner thread.

Independent `host.timing.launch` tasks and `setTimeout` run between cooks, including
while TD playback is paused. They read the most recently published inputs and
write state for the next time TD samples it. They cannot see upstream changes
that TD has not cooked/published yet. A timer's scheduling phase can therefore
matter; use `onCook` when a transform must consume the current input immediately.
`launchBrowser` frame waits advance when this operator cooks, not independently.
The native owner uses event-driven waits, with no 1 ms polling loop.

JavaScript remains single-threaded within each instance. TD waits for the owner
to finish the synchronous cook; a long-running callback can delay it. Avoid
awaiting long-lived tasks in `setup`: launch them and return. Setup may return a
Promise; `onCook` and `onPulse` must be synchronous. A watchdog stops runaway
execution, but is not a substitute for short callbacks.

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
module state for other intermediate data. Cleanup cancels owned timing roots,
timers, frame waits, and stale host access. Import timing **types** if needed;
launch through `host.timing` so ownership remains correct.

## Buffers and XY point clouds

Set **Output Samples** to 10000 and **Output Channels** to `x y` for 10,000 XY
points. All samples are delivered during the same cook. Four wired input CHOPs
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

Project Directory takes priority over Sketch DAT and Source File. With it clear,
Sketch DAT takes priority over Source File. Source File uses background filesystem
notifications and changed-file reads; cooks adopt pending source without rereading
the file. Project builds support TypeScript and static imports. Event Name plus Send Pulse
queues a named event for the next cook. The handler reads that cook's inputs;
pulses carry no argument object. Reset and Reload restart the current script.

A replacement script that fails during compilation/setup leaves the working
generation active and reports a TD warning. It is retried after another edit or
Reset. Runtime errors stop producing valid output and appear as TD errors; fix
the script or Reset. Output layout changes also restart the script.

An Info CHOP exposes `cooks`, `cook_ms`, `input_copy_ms`, `script_ms`,
`output_abs_frame`, and `ready`. `cook_ms` covers the native execute call, including
waiting for the owner and copying results; TD's `cpuCookTime` includes its own
operator overhead. Background timing callbacks also use CPU between cooks.

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
