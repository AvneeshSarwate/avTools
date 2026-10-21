# Selectable blocking and buffered execution for V8 operators

Status: implemented (2026-10-20). See [execution modes](../EXECUTION_MODES.md),
[the standalone example](../native/td/execution-mode-example/README.md), and
[validation](../native/td/execution-mode-example/VALIDATION.md).

The design below records the intended contract. Implementation uses a three-slot
publication exchange, one replaceable input request, a bounded ordered control
queue, and a separate bounded pulse FIFO. TOP preserves its GPU pipeline.
Date: 2026-10-20.

## Goal

Provide one per-operator toggle, **Wait for Current Result**, without requiring
different JavaScript APIs or different scripts. A dedicated worker owns V8 in
both modes. The toggle determines whether a TouchDesigner cook waits for its
submitted work or returns the latest completed output.

| Toggle | Cook behavior | Tradeoff |
| --- | --- | --- |
| On | Submit current inputs and wait for that request's completed result | Current-cook inputs; slow JavaScript extends cook time |
| Off | Offer current inputs and collect an available completed result without waiting | Cook does not wait for JavaScript; output can reflect older inputs |

Default on for CHOP to preserve its existing same-cook behavior. Preserve TOP's
existing asynchronous default and saved-project parameter compatibility. Reuse
its `Samecook` parameter where appropriate instead of adding a competing toggle.
Its pretrigger mode already constrains blocking behavior; retain and document
that interaction.

This is an execution-policy feature, separate from the
[native TypeScript build tool](native-typescript-build-tool-plan.md). Compilation
must not run on the sketch's timing worker. Neither feature requires the other.

## Current implementation and scope

At inspection, [`Bridge.cpp`](../native/embedded/Bridge.cpp) already owns a worker
per `AVSketch`, but `avChopCook` uses `sync()` and waits on a future.
[`SketchCHOP.cpp`](../native/td/SketchCHOP.cpp) passes borrowed TD input pointers
and a temporary output buffer into that synchronous call. They cannot simply be
retained by an asynchronous job.

[`SketchTOP.cpp`](../native/td/SketchTOP.cpp) already has asynchronous dispatch,
completed-result collection, and a blocking option. Use its behavior as a
reference; do not rewrite its GPU transfer pipeline just to unify naming.
Reinspect current code before implementation because the CHOP is evolving.

Implement CHOP first, then align shared scheduling contracts and TOP diagnostics
where useful. Keep macOS as the target. Process isolation, hard realtime
guarantees, and new GPU interop are outside this plan.

## One JavaScript contract

Preserve the existing declarations and callback signatures, including
`host.inputs.get/samples/names`, `host.outputs.set/get/names`, timing functions,
`onCook`, and `onPulse`.

- Input reads observe the most recently accepted worker-side input snapshot.
  They never reach into TD from the worker. A synchronous JS callback observes
  stable inputs; an async continuation may observe a newer accepted snapshot.
- Output writes update persistent worker-owned JS state. Reading outputs returns
  that state, including writes TD has not consumed yet.
- Publish complete native output snapshots at defined safe boundaries; do not
  expose individual JS writes to the cook thread. Multiple writes in one
  synchronous callback must not produce a partially updated published result.
- `onCook` runs once for each accepted cook request. Buffered mode may coalesce
  requests while busy, so it does not promise one callback per TD frame.
- Independent timers remain independent of TD cooking/playback. Slow JavaScript
  delays other callbacks on that isolate, but buffered cooking does not wait for
  those callbacks to finish.
- Frame waits resume on accepted frame ticks, not on a replay of every skipped
  cook. Preserve existing registration/order rules. Define elapsed TD time from
  accepted timestamps so coalescing does not silently slow animations; keep host
  frame metadata distinct from timing-clock advancement where needed. Test
  pause, seek, and timeline loops against the existing TimeContext contract.

Both modes use these meanings. The observable difference is when inputs are
accepted and when outputs become visible. Scripts that require every intermediate
input sample or exact same-cook feedback must use blocking mode. This toggle
cannot preserve those timing properties while also guaranteeing no JS wait.

## Native exchange and scheduling

1. Capture TD inputs, channel names, sample counts, parameters, and frame metadata
   into owned native data on a TD-authorized callback thread. Never retain
   `OP_Inputs`, TD buffers, or pointers into temporary request storage.
2. Assign monotonically increasing request IDs and runtime/schema generations.
   Keep at most one running and one replaceable pending buffered cook request.
   Newer inputs replace pending inputs instead of creating an unbounded backlog.
3. Wake the existing worker using notifications and timer deadlines. No periodic
   polling, sleep loops, or new worker per cook.
4. The worker accepts the snapshot, executes callbacks under existing timeout
   rules, and copies completed values into an owned native publication buffer.
5. The cook attempts to acquire a completed publication once, then copies either
   that result or its retained compatible output into TD. It does not wait for
   the just-submitted request in buffered mode. A result ready by collection time
   may be used immediately; there is no mandatory one-frame delay.
6. Blocking mode waits for its own request ID or a terminal failure/cancellation.
   A coalesced request must never strand a waiter: requests with waiters are
   nonreplaceable, or explicitly cancelled with a completed status.

Use a small, bounded publication pool with explicit ownership, such as a proven
single-producer/single-consumer exchange. Do not overwrite a buffer being read.
Alternatively, try-lock a short exchange and retain the previous result if busy.
Do not hold an exchange lock while executing JS, copying large payloads, waiting,
or destroying an isolate. Do not assume atomic shared-pointer operations are
lock-free. Keep expensive buffer reclamation off the cook path where practical.

Publish dirty CHOP output state after independent timer/callback turns as well as
cook turns, so timer-driven animation remains observable without an extra JS
cook round trip. Establish a bounded microtask checkpoint/publication policy;
an async function is not an atomic transaction across all its awaits. Include
source request ID and publication sequence separately: several timer publications
can share one input snapshot. Avoid copying large output arrays when unchanged.

First cook in buffered mode returns defined zero output until a compatible result
exists. Initialization and reload setup run on the worker too; replacing the
ordinary cook wait while still synchronously initializing V8 would leave a stall.
Keep source-file reads/build discovery out of the normal cook path where possible.

## Events, resets, schemas, and mode changes

- Pulse events use a separate bounded FIFO with event names captured at enqueue
  time. Coalescing input requests must not drop or duplicate accepted pulses.
  Report overflow explicitly. Events carry ordering/generation metadata, not JS
  arguments; handlers read the worker's accepted input snapshot. Define and test
  the input-acceptance/pulse order consistently in both modes.
- Reset/reload are ordered control messages, not replaceable frame data. Old
  generations cannot publish after replacement. Cancel obsolete timing tasks and
  pending requests using existing disposal rules. Retain the last compatible
  output during reload; a schema change instead starts with zeros.
- Output channel names and sample count stay TD-declared. Tag publications with
  their schema generation and validate lengths before copying. Never let an old
  result resize or overrun the current TD output buffer. Metadata callbacks must
  not synchronously query V8.
- Changing the toggle preserves JS state and timing tasks. Do not recreate the
  isolate. Finish already-running work normally; the first subsequent blocking
  cook waits for a fresh request after it. Reconcile pending requests and events
  without duplicates or lost waiter notifications.
- Exceptions/timeouts retain the last compatible output in buffered mode and
  expose an error/status; reset remains available. Preserve existing blocking
  error semantics unless intentionally documented otherwise.
- A worker thread does not make destruction automatically nonblocking. Audit
  callback timeouts, native binding waits, joins, and plugin unload separately.
  Reuse safe V8 termination facilities where already supported; never kill a C++
  thread or free its live isolate. Document teardown limits rather than claiming
  an unresponsive native binding can always be interrupted.

## Diagnostics

Expose lightweight Info CHOP/status values sufficient to distinguish latency
from cook cost:

- Requested mode, worker busy, ready, submitted/accepted/completed request IDs.
- Published and consumed sequence, source TD frame, publication age in monotonic
  milliseconds, and input age. Frame age is meaningful only with suitable frame
  ordering; timeline seeks must not yield misleading negative latency.
- Reused-output cooks, same-request results consumed without waiting, coalesced
  inputs, pulse queue depth/overflow, and runtime generation.
- Cook CPU duration, worker execution duration, input/output copy durations, and
  blocking wait duration. Report repeated-frame percentage over a defined window.

The guarantee is **buffered cook does not wait for JS completion**. CPU contention,
memory allocation/copying, TD upstream cooking, and TOP upload work can still
increase cook cost. No hard realtime or zero-cost claim.

## Implementation sequence

1. Record current synchronous CHOP behavior and TOP scheduling. Specify callback,
   pulse, frame-wait, timer publication, and mode-switch ordering in focused tests.
2. Add owned request/result types and bounded exchange behind the bridge. Retain
   synchronous compatibility entry points; do not leak V8 handles across threads.
3. Implement buffered CHOP scheduling and the toggle. Move initialization and
   reload onto the worker, add generation/schema checks and diagnostics, then
   validate state-preserving mode changes.
4. Verify existing TOP semantics against the contract, preserving saved parameters
   and pretrigger behavior. Share primitives only where this simplifies ownership.
5. Add a checked-in TD example beside the integration sources and document the
   toggle in the CHOP/TOP and project-template guides. The same sketch must run in
   both modes without source changes.

## Verification and acceptance

Use native/headless tests first, followed by a TD fixture with several independent
operators. Obtain any required computer-use permission for the actual test run.

- A controlled slow callback increases blocking cook time. In buffered mode its
  duration appears in worker/age metrics while cooks continue reusing output.
- Test short, 10 ms, 50 ms, and timeout-length work, including independent timer
  callbacks. Measure distributions and worst observed cook times, not only means.
- With one and four instances, compare baseline, blocking, and buffered modes;
  record hardware, TD version, channel/sample sizes, TD frame time, CPU usage,
  p50/p95/p99 cook time, publication age, and reuse/coalescing rates. Include large
  sample arrays to expose copy cost rather than extrapolating scalar results.
- Verify fresh same-request output when it happens to be ready, retained output
  when late, eventual newest-input processing after overload, and bounded queues
  and memory. Do not require a particular same-frame success rate.
- Verify coherent multichannel writes, output getters before publication, timer
  writes between cooks, independent timers while TD is paused, frame waits,
  timeline changes, and identical deterministic results when neither mode skips
  requests. Never require identical output histories under coalescing.
- Stress pulse ordering and overflow, toggles during slow work, reset/reload,
  source errors, schema changes, initial setup, destruction, and recreation.
  Exercise stale-generation rejection and waiter cancellation under race checks
  or sanitizers where supported.
- For TOP, include existing TD upload time and pretrigger scenarios in regression
  measurements. Buffered scheduling does not remove GPU readback/upload costs.

Deliver the implementation, example project, concise user documentation, and a
measurement report identifying the remaining cook costs and observed output age.
