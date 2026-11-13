# Native MIDI verification

Tested on Apple Silicon / macOS, TouchDesigner **2025.33230**. All MIDI traffic
uses isolated virtual CoreMIDI endpoints; no physical controller was driven.
Openable user example: [MIDI.toe](../../native/td/midi-example/MIDI.toe).

## Automated checks

From the repository root:

```sh
node --test packages/native-webgpu/test/midi/adapter.mjs packages/native-webgpu/test/midi/sdk.mjs
python3 packages/native-webgpu/test/declared-parameters/schema_test.py
node packages/native-webgpu/test/midi/run.mjs
node packages/native-webgpu/test/midi/barrier.mjs
```

The native runner needs the normal built embedded runtime (`scripts/embedding.mjs`),
Node dependencies and Apple Command Line Tools. Run with CoreMIDI access; the
macOS tool sandbox can deny MIDI client creation. It compiles small C++ probes,
creates/destroys isolated sources and a destination, and writes `results/*.json`.

- Adapter: stable managed handles, existing listeners after switching, stale
  packet rejection, None/missing/reconnect, explicit independent opens, typed
  event decoding, shared output encoders, option validation and cleanup.
- Native close barrier: a callback deliberately remains in flight while another
  thread closes the input. Close waits until it returns; subsequent MIDI traffic
  never touches that callback/context. This probe also builds the Rust bridge
  standalone and therefore needs Cargo.
- Actual V8/native runtime: four workers, 5,000 ordered raw CC messages at 1 kHz,
  30 reloads of one worker, and deliberate 20 ms JS stalls in another. The three
  continuously connected workers each received all 5,000 with no order errors
  or reported drops. Reloaded state starts over; gaps are allowed.
- Changing the control mailbox without cooks switches existing listeners.
  None/missing-device transitions release connections. Reload leaves one live
  input per active instance. Destruction joins embedded input threads.
- Explicit output sends seven messages into a virtual destination; all arrive.
  Coalescing a burst of 128 CC values emits one final-value event in that run.
- Existing shared MIDI tests: 7 passed. Native file/UDP/OSC regression also passed,
  including paused-cook callbacks, rebinds, failed setup and destroy cleanup.

## Real TouchDesigner

`source.cpp` provides two virtual devices emitting values 25 and 100 at 1 kHz.
Compile it with CoreMIDI/CoreFoundation and run with `build/midi-test` as its
argument. It writes `devices.json`; create `build/midi-test/stop` to stop it.
The helper exits after one hour even if cleanup is interrupted. Remove a stale
stop file before a new run.

Run `td_setup.py`, then `td_verify.py` through TD's Textport. These scripts create
an isolated component, poll native build readiness, and assert two TOP images
and two CHOP outputs while sharing/switching sources. They also test one reset,
None, a missing saved device, and reselection. `results/td.json` records the
numeric values and image centroids. `td_save.py` saves only the test component;
it never saves over the user's open project. Helpers use this checkout's local
absolute path; change ROOT when running elsewhere.

The visible dynamic device menu was also tested manually through computer use.
While playback was paused and viewers disabled, choosing source B caused **zero
additional cooks**. The next forced CHOP cook returned `0.78740156` (100/127),
showing that its MIDI callback and TimeContext smoothing had already run. This
manual observation is recorded in `results/td-gui.json`, separately from the
scripted assertions. Device
selection is a control update; image publication still requires a TOP cook.

## Timing methodology

`benchmark.cpp` tests 1 and 4 independent native workers at the default 250 Hz
batching rate, with raw and coalesced CC. It measures three seconds idle and
three seconds of 1 kHz traffic, without timers, rendering or TD uploads. CPU is
whole-process CPU divided by wall time; **100% means one fully occupied core**.
The source sender and bridge plumbing are included. Counts are verified; raw
workers must each receive all 3,000 events.

Latency is measured for 50 isolated messages, from CoreMIDI send until *all*
workers have published their updated state. The probe polls publication every
100 microseconds solely for measurement. It is an upper bound that includes
probe scheduling, not an assertion that the production runtime polls.
`results/timing.json` records the latest measurements. No hard real-time delivery
or physical-hardware latency guarantee is implied. The slow-consumer stress
probe's CPU includes intentional busy loops and is not a performance benchmark.

Hardware unplug/replug, physical-device output and rendering-loaded latency
are not covered by these results. Actual TOP rendering and separate plugin
images are covered by the real-TD functional fixture.

Final isolated run (2026-10-31):

| Instances | CC mode | Idle CPU | 1 kHz CPU | Median / p95 latency to all instances |
|---|---|---:|---:|---:|
| 1 | raw | 0.002% | 5.93% | 4.85 / 5.32 ms |
| 4 | raw | 0.003% | 16.35% | 5.19 / 5.28 ms |
| 1 | coalesced | 0.002% | 6.07% | 5.07 / 5.41 ms |
| 4 | coalesced | 0.002% | 14.23% | 5.21 / 5.29 ms |

These are short local runs, so small differences are noise. Coalescing reduces
JS event count, not all native reception work. Default batching deliberately adds
latency; increase `rateHz` for lower latency at the cost of more dispatches.
The native TimeContext conformance regression passed both 21-case suites and
its lifecycle/stall invariants after the MIDI integration.

The live four-operator component passed and was saved as `MIDI.tox`; the standalone
`MIDI.toe` was assembled from it. Standalone reopen also passed after the user
dismissed a macOS startup notification: both CHOPs and both TOPs loaded the current
plugins, compiled their adjacent TypeScript entrypoints, and reported no errors
or warnings. All four selectors started at None; the TOP viewers rendered the
expected centered circles. See [results/reopen.json](results/reopen.json).
