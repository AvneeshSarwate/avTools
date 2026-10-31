# Native MIDI for the embedded V8 TOP and CHOP

Status: implemented and validated on macOS, 2026-10-31. See
[API and examples](../MIDI.md) and [test results](../test/midi/README.md). See
[Windows portability findings](windows-portability-investigation.md) for future
constraints; do not expand the macOS work into a Windows port.

## Goal and agreed behavior

Expose native MIDI input and output to scripts in both operators, using the
existing MIDI library and TimeContext lifetime model. Several operators must be
able to listen to the same controller independently. MIDI callbacks operate
between cooks, including while the TD timeline is paused, and update script state
that subsequent cooks consume. They do not preempt currently executing JavaScript.

Preserve batching and coalescing: controllers can generate approximately 1,000
messages per second, and waking V8 for every message is unnecessary. Hot reload
does not promise lossless delivery: discard the restarting instance's pending
events and resubscribe when the new script is ready. Other instances continue.
Do not implement event replay or controller-state restoration across reloads.

## Existing code and evidence

- `apps/deno-notebooks/native/midi_bridge`: Rust `midir` 0.10.3 backend, C ABI,
  enumeration, input batching/coalescing, and immediate output sending.
- `packages/midi/api.ts`: reusable typed input events and output helpers.
- `packages/midi/native.ts`: Deno-only transport adapter; currently opens inputs
  at 250 Hz with `rawCC: true`. It cannot run unchanged inside embedded V8.
- `packages/native-webgpu/native/embedded/{Runtime,HostLoop,IO,Bridge}.*`:
  worker wakeups, generation ownership, and native-to-JS delivery patterns.
- `packages/native-webgpu/src/td-timing.ts` and `td-io.ts`: sketch lifetime,
  TimeContext callback ownership, and automatic disposal patterns.

An isolated macOS native probe opened four connections to one virtual CoreMIDI
source, using two independently loaded copies of the existing MIDI bridge.
It sent 5,000 sequenced CC messages at 1 kHz with 250 Hz batching and raw CC:

| Connection | Condition | Received |
| --- | --- | --- |
| 1 | Closed/reopened 30 times | 4,681; reconnect gaps accepted |
| 2 | Continuous, same bridge image | 5,000 |
| 3 | Continuous, second bridge image | 5,000 |
| 4 | Second image; delivery callback repeatedly slept 20 ms | 5,000 |

All received sequences were ordered; continuous connections had no losses or
reported queue drops. This validates native fan-out and independent connections,
not V8 integration, physical hardware, safe destruction of callback state, or
Windows behavior. Callback state and libraries remained alive during the probe.
The scratch harness is `/private/tmp/avtools-midi-multi-probe/probe.cpp`; promote
an equivalent reproducible fixture into the repo during implementation rather
than relying on that temporary file.

Loading the actual TOP and CHOP binaries confirmed separate runtime images.
A runtime-local singleton does not span both plugins. CoreMIDI distributes a
source to multiple input connections, so that sharing is not required on macOS.

## Architecture

Start with independent native input connections per operator subscription. Keep
device ownership behind the transport boundary so a future backend can multiplex
subscriptions internally without changing scripts. Do not add a cross-plugin
broker or separate service for the initial macOS version.

Statically link MIDI and text-engine through one combined Rust static library
(`native/rust`) into each bundled native runtime. This avoids duplicate Rust
standard-library/panic symbols when linking independent Rust static libraries. Add `staticlib` while preserving the existing Deno
`cdylib` build and API. Include required system frameworks and license notices.
No separately installed MIDI bridge, Node, or Deno runtime is required by users.

Add a versioned/extended C ABI with callback context or equivalent routing token;
the existing callback only receives bytes and length. Preserve existing Deno
callers. Native callbacks copy owned batches into a bounded per-instance queue
and wake the owning worker. Never call V8, TD, Python, or user code from the MIDI
callback thread. Do not retain a pointer to the Rust callback's temporary buffer.

The worker drains batches under the active script generation, through the same
TimeContext/lifetime machinery as timers and UDP. Keep MIDI device operations and
message handling outside TD's cook thread. Sending uses the current immediate
send semantics; scheduled native output is not part of this version.

## Batching, coalescing, and timestamps

Keep 250 Hz (approximately 4 ms) as the initial delivery rate. Expose validated
per-input rate and raw/coalesced CC options in the embedded adapter, without
changing the existing shared adapter's defaults implicitly. Preserve raw CC by
default for compatibility; demonstrate coalesced absolute controls in examples.

- Notes remain individual ordered events, subject to explicitly reported bounds.
- Raw CC preserves individual events; coalesced CC keeps the latest value for each
  channel/controller in a batch.
- Preserve existing latest-value behavior for pitch bend, poly/channel pressure,
  and program changes, and document it explicitly.
- Relative encoder deltas require raw delivery (or a future explicit accumulator),
  not latest-value coalescing. Stateful multi-message protocols also need suitable
  raw delivery; do not claim every MIDI protocol works through coalescing.
- Batch transfer reduces worker wakeups; coalescing reduces JS handler calls.
  Do not describe these as the same optimization.

Make dispatch demand-driven while retaining the configured rate cap: the first
pending message arms a batching deadline; more messages join the batch without
waking V8; dispatch wakes V8 once; an empty input does not poll periodically.
Avoid a backlog of scheduled deadlines and preserve ordering at batch boundaries.
Keep the existing two-stage native processing initially if useful; consolidate
threads only when measurements justify it. Measure idle wakeups as well as load.

Retain source timestamps and document their origin. Map to the runtime monotonic
clock where needed for TimeContext; never assume backend timestamps have the same
epoch across devices or reloads. Batch delay is separate from TD frame latency.

Bound all queues and surface overflow counts per operator. Preserve existing drop
accounting and add accounting for any new worker queue. Document that overflowing
note queues can lose note-offs; no claim of guaranteed delivery under overload.

## Reload and destruction

1. Invalidate the old generation and prevent further delivery to its JS handlers.
2. Unsubscribe/close only this instance's input and output handles.
3. Discard old batches, release persistent JS references on the owning thread,
   and let the replacement script create new subscriptions.
4. Make repeated close/dispose calls safe; isolate failures to the owning instance.

The current Rust `InputHandle::close` detaches its worker threads. Replace this
with explicit shutdown/lifetime ownership so a callback already in flight cannot
use freed context and native code cannot outlive its library. Do not join while
holding registry locks or from the thread being joined. Generation checks alone
do not protect a dangling native callback context. A short bounded join/barrier
with no user JS on native dispatch threads is preferable to detached lifetime
assumptions. Verify deletion, script error, reset, and native unload paths.

No replay or state snapshot across reload. Physical unplug/replug is distinct
from script reload: report disconnected devices clearly; automatic hardware
reconnection is deferred unless needed for the basic close/reopen contract.

## MIDI parameter and managed handle

Add a literal parameter definition `{type: "midiInput", label: "MIDI Controller",
page: "MIDI"}`. TD supplies device choices through `appendDynamicStringMenu` /
`buildDynamicMenu`; store device IDs, show names, default to None, and preserve
missing selections. Device enumeration must not run user JavaScript or recreate
parameter schemas as devices appear/disappear.

Expose `host.midi.bindInput("Controller", options?)`: a stable logical handle
whose listeners survive selection changes. Switching closes the previous native
connection and drops its pending messages without restarting the sketch. Include
connection/error state and listener removal; explicit `openInput`/`openOutput`
remain available. Several named selectors are supported. Bind only parameters
declared as `midiInput`, with type checking as well as runtime validation.

Send selection snapshots through a separate, coalescing host control update to
the worker, not through submission of a render job. Verify TD's parameter callbacks
while paused; do not assume ordinary cook snapshots alone meet this requirement.
Generation cleanup removes bindings and explicit connections. Missing devices
remain disconnected, never silently falling back to another device. Reopening
requires a selection/reload/reconnect action; automatic hardware reconnect is not
part of the initial contract.

## Public API, templates, and scope

Reuse the shared `MidiAccess`, `MidiInput`, and `MidiOutput` shape. Add an explicit
embedded adapter/export or template resolution mapping that avoids bundling Deno
FFI or browser transports. Keep TD-specific lifetime binding in the embedded
adapter. Add accurate SDK types without Node/DOM ambient APIs.

Ship generated-template examples for listing ports, notes/CC driving TimeContext
state, coalesced absolute controls versus raw relative controls, and sending.
Document automatic cleanup, explicit close, channel numbering, timestamps,
batching delay, overflow, multi-instance use, and reload gaps in the generated
project README. Test that these examples build with the native TS builder.

Existing input supports channel-voice messages only. SysEx, MIDI clock, transport,
song position, MIDI 2.0/UMP, and scheduled native sends are outside initial scope.
Do not label the existing OSC MIDI argument support as native device support.

## Verification and delivery

1. Preserve existing MIDI unit tests; add meaningful adapter, lifetime, and batch
   scheduling tests, including close with a callback already in flight.
2. Commit a native virtual-source fixture: four listeners across independent
   library images, 1 kHz sustained traffic, ordered raw events, explicit coalescing
   expectations, bounded bursts, slow consumer, and repeated close/reopen.
3. Run real TD fixtures with at least two TOPs and two CHOPs sharing a source.
   Reload/delete/reset one while others receive; verify paused timeline delivery,
   TimeContext ownership, and no stale handlers or accumulated threads/handles.
4. Measure MIDI latency and CPU/wakeups separately from frame work. Compare 1 vs
   4 listeners, idle vs 1 kHz, raw vs coalesced CC, and loaded rendering. Report
   distributions and missed/deferred delivery, not only averages.
5. Test output with isolated loopback and, when available, a physical controller.
   Avoid sending arbitrary test data to unrelated physical devices.
6. Save openable `.toe`/`.tox` examples next to TD integration source, update the
   generated SDK/docs and relevant READMEs, then run the standard build/package
   process to refresh `apps/td-projects/Plugins`, version metadata, and ZIP.

Completion means packaged TOP/CHOP examples work together and teardown is proven,
not merely that the Rust library compiles. Windows support remains future work.

## Implementation notes

- `midiInput` becomes a native dynamic string menu, with device IDs as values.
  TD rejects an empty menu-entry ID, so None uses an internal sentinel that is
  converted to `""` in script parameter/control snapshots.
- The menu and parameter-enable callbacks send a coalesced control update to
  the JS worker independently of render requests. A real TD paused-GUI test
  switched devices with zero cooks and observed the already-settled new value
  on the next cook. Cook snapshots also synchronize scripted parameter changes.
- Native input connections remain instance-owned. CoreMIDI supplies fan-out
  across the separate TOP and CHOP runtime images; no cross-plugin broker.
- Embedded close joins both input threads after disconnecting CoreMIDI. The
  legacy Deno callback ABI keeps detached teardown to avoid its main-thread
  callback/close deadlock. The global handle-map lock is released before close.
- Raw input uses a blocking receive; dispatch uses a condition variable and a
  batching deadline only when messages arrive. Only the first pending event
  notifies dispatch, so messages inside that batch do not wake it repeatedly.
- Physical-device unplug/replug and Windows builds remain untested. Automatic
  reconnection, exact replay through reload, SysEx/clock input, and a broker are
  deliberately outside this version.
