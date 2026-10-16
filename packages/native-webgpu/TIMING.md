# TimeContext inside the Sketch TOP

Open [TimeContext.toe](native/td/example/TimeContext.toe) after building the plugin.
It is an ordinary saved TD project with two independent sketches, an embedded
JavaScript DAT, pulse controls, and a preview. No Python bootstrap commands are
needed. [TimeContext.js](native/td/example/TimeContext.js) is its readable source;
[TimeContext.tox](native/td/example/TimeContext.tox) is the reusable component.

## Use

`setup(p, host)` receives `host.timing`, the canonical `packages/core-timing` API.
`launch`, `launchBrowser`, and `createAndLaunchContext` track ownership without
changing their cancelable return handles. Other core exports, including
`OfflineRunner`, tempo maps, and barriers, are available too.

```js
let clock, timing, phase = 0;
function setup(p, host) {
  timing = host.timing;
  clock = timing.launch(async ctx => {
    while (true) {
      await ctx.waitSec(1 / 60);
      phase += 0.02 + host.chop('speed') / 100;
    }
  }, {seed: 'my sketch', bpm: 120});
  // Return from setup. Awaiting an endless root would prevent setup completing.
}
function onPulse(name) {
  if (name === 'stop') clock.cancel();
}
function draw(p) {
  p.background(20); p.fill(255);
  p.circle(p.width / 2 + Math.sin(phase) * 100, p.height / 2, 40);
}
```

Realtime execution starts when TD first initializes/cooks the operator. Thereafter,
`setTimeout` and real-time TimeContext waits run on that instance's owner thread
without TD cooks, including when playback is paused. They update state; `draw`
remains synchronous and publishes an image only when requested by TD.

`host.chop(name, sampleIndex = 0)` reads the latest completed CHOP input snapshot;
missing channels/indexes return zero. `host.latestControls()` returns fresh records
and copied samples with `sampleRate`, `startIndex`, and `channels`. Mutating the
returned typed arrays cannot change host state. These values stay stale while TD
is not cooking; timers cannot request new TD data from their worker thread.

`launchBrowser` supplies `waitFrame()`: each **accepted render request** delivers
one frame event after input capture and before pulses/draw. A busy/skipped
submission delivers none. Repeated cooks of the same TD timeline frame may deliver
multiple events. Callbacks registered during a frame wait for the next accepted
request. Pause without cooks stops frame waits, while real-time waits continue.
This is not timeline scheduling: TD seeks and loops do not rewind TimeContext.

## Lifetime and errors

Each TOP has its own isolate and timer queues. Work started at sketch top level,
in setup, callbacks, or promise continuations belongs to that sketch generation.
A failed candidate is cleaned up and the previous sketch stays active. During
async candidate setup the old sketch may continue running. Successful commit
cancels old managed roots, drains cancellation microtasks at a task boundary,
invalidates timers/immediates/frame subscriptions, then disposes old renderer
resources. Reset/deletion also cancels owned work. `host.timing.cancelAllContexts()`
is scoped to that sketch's managed roots.

Ordinary promises cannot be canceled. An old unresolved promise may still settle;
its old-generation timers are rejected, and retained renderer/device/resource
access throws after disposal. Cleanup that awaits unrelated external promises
cannot hold reload open indefinitely. Arbitrary mutations of shared JS globals
cannot be rolled back. These lifecycle guards are for trusted sketches, not a
security boundary.

Uncaught background callback errors and unhandled rejections stop the owning
sketch. The next cook reports the error; edit/reset to recover. Expected managed
cancellation is not an operator error. An execution watchdog covers a callback
and its full microtask drain; termination poisons that isolate and requires reset.
The synchronous callback budget is one second. Long pending timer waits do not
arm the watchdog. Synchronous JS, file reads, and native driver calls can delay
other work in the same isolate: these timers are independent, not hard realtime.

## Embedded host profile

- Monotonic `performance.now()` in milliseconds, relative to runtime creation.
- `setTimeout`, `clearTimeout`, `setImmediate`, `clearImmediate`, `queueMicrotask`.
  Timeout callbacks must be callable; extra arguments are supported. Numeric
  delays below 1 ms, above 2,147,483,647 ms, or NaN become 1 ms; fractions truncate.
  Handles are numeric, stable, and cancelable, not Node timer objects.
- A full V8 microtask checkpoint follows each task. Newly queued immediates run
  on a later service turn. No universal timeout-versus-immediate ordering is promised.
- Focused Event/EventTarget and AbortController/AbortSignal support: reason,
  throwIfAborted, add/remove listeners, once, onabort, listener mutation, and
  exception reporting. No DOM tree/event propagation or static AbortSignal helpers.
- `crypto.randomUUID()` uses OS entropy. Musical RNG uses pinned seedrandom 3.0.5
  and is independent of UUID generation.
- Cancelable global `unhandledrejection` observation is supported; this is not
  Node's process-event API. No `process.nextTick`, timer ref/unref, setInterval,
  network API, module loader, or complete browser environment is supplied.

The owner sleeps on a condition variable until a command, timer deadline, or V8
foreground post. A persistent watchdog sleeps separately. Blocking TD input
preparation runs on a separate preparation worker so it cannot stop user timers.
Dawn waits for actual GPU events, bounded by the next known host task deadline
and a 100 ms maximum. It does not continuously pump idle device-loss subscriptions.
An off-thread command/foreground post cannot interrupt an already-entered Dawn
WaitAny; that path has the 100 ms bound. Known timer deadlines shorten that wait.
System suspend/resume accounting has not been characterized.

The small native loop is retained for now. libuv could replace native sleep,
wakeup and timer plumbing, but would not replace V8 ownership, microtask/error
handling, watchdogs or Dawn completion integration. Revisit it if asynchronous
file/network/process I/O becomes part of this host.

## Build and verify

From `packages/native-webgpu`, after the prerequisites in [TOUCHDESIGNER.md](TOUCHDESIGNER.md):

```sh
node scripts/embedding.mjs
node scripts/build-td-plugin.mjs
node scripts/build-bridge-probe.mjs
npm run typecheck
node test/timing/run.mjs node
node test/timing/run.mjs deno  # DENO=/path/to/deno if it is not on PATH
node test/timing/run.mjs native
```

`node test/timing/run.mjs bundle` creates `artifacts/timing/index.html`; serve that
directory and open the page in an actual browser. A complete result includes
`"suite":"timecontext"` and `"pass":true`, after portable and frame checks.
CLI runners fail on missing/incomplete results and save logs plus source revision
and bundle hash. Native pure timing tests do not initialize a GPU or open TD.

`node test/timing/core-benchmark.mjs` and `node test/timing/core-benchmark.mjs native`
compare the same TimeContext rate, branch, root, and tempo workloads on two realms
per host. These are performance measurements, not portable wall-time assertions.

The native probe also accepts `test/timing/host.js`, `idle.js` (requires Metal),
and `benchmark.js`. `build/timing-bridge` takes the built plugin's
`Contents/MacOS/libavtools_runtime.dylib` and `Contents/Resources` paths and verifies
no-cook timers, frames, CHOP snapshots, pulses, ownership, errors/reset, GPU assets,
Syphon, 100 reloads, and sleeping teardown. GPU/headless TD tests require ordinary
Metal and TouchEngine license access; sandbox denial is not a rendering failure.

`python3 test/timing/td_benchmark.py` compares four 1080p CPU-output instances with
the recorded pre-TimeContext plugin, including TD upload/ownership fences and
240/1000 Hz requested TimeContext workloads. It writes raw samples and summary
JSON under `artifacts/timing`; set `AVTOOLS_TIMING_BASELINE` to compare another
baseline bundle. `python3 scripts/build-td-timing-example.py` regenerates the saved
example from `TimeContext.js` and the existing Sketch fixture.

See [TIMING_VALIDATION.md](TIMING_VALIDATION.md) for measured results and limitations,
and the [portable specification](../core-timing/spec/README.md) for future ports.
