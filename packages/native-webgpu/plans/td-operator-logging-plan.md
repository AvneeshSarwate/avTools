# TD-native logging for embedded V8 TOPs and CHOPs

Status: implemented, 2026-10-21. Console mirroring explicitly deferred by the
user on 2026-10-21; no mirror UI/output service is included. See `../LOGGING.md`
and `../test/logging/README.md` for the delivered contract and verification.

Measured TD limitation: this build caches native Info DAT data until the source
cooks. Added a **Refresh Logs (No Script)** pulse that performs a metadata-only
native cook, holds the last output, and never submits/collects a runtime frame.
Passive Info DAT reads alone cannot refresh that source cache while paused.

## Goal and public contract

Use ordinary JavaScript `console.log`, `console.info`, `console.warn`,
`console.error`, and `console.debug` inside sketches and imported libraries.
Expose recent messages per operator through a TD Info DAT, with optional
mirroring to TD's native Console. No public `host.log` API or Python helper DAT
is required for the initial version.

Logging must work for TOPs and CHOPs, including timers firing independently of
TD cooks, blocking and buffered execution, and TOP pre-trigger execution.
Observing logs must not run a sketch, submit a frame, consume an output, or change
its scheduling. JavaScript console calls remain synchronous formatting/capture
operations, but do not wait for terminal I/O or TD/Python execution.

`console.error()` is a message, not a thrown exception or an instruction to stop
the sketch. Keep uncaught exceptions and build failures in the existing operator
error/warning and build-diagnostic paths. Logging must not clear or replace those
diagnostics. Error DAT integration is not required for ordinary console messages.

## Current implementation and integration points

Reinspect these files when implementing; the main thread is changing related
runtime and reload behavior concurrently:

- `native/embedded/Runtime.cpp`: `hostLog` currently joins arguments using V8
  string conversion and calls `fprintf(stderr, ...)` synchronously.
- `native/embedded/polyfills.js`: log/error/warn/debug currently share that
  function; severity is lost and `console.info` is absent.
- `native/embedded/Runtime.h` and the embedded bridge: runtime ownership,
  worker access, and lifetime-safe data export.
- `native/td/SketchTOP.cpp` and `native/td/SketchCHOP.cpp`: parameters, operator
  identity, Info DAT callbacks, and existing error/warning reporting.
- Runtime SDK declarations and their generation: accurately declare supported
  console methods without adding the DOM or Node ambient environment.

Both operators already provide Info DAT diagnostics, including build and reload
state. Preserve their existing diagnostic keys and behavior.

Follow the companion `portable-javascript-restart-and-reload-plan.md`: restarting
the script clears script state. Retaining host-owned diagnostic history does not
constitute state-preserving hot reload.

## Operator UI and Info DAT

Add matching controls to both operators on a diagnostics/logging parameter page:

| Control | Proposed default | Meaning |
| --- | --- | --- |
| Info DAT View | Diagnostics | Select Diagnostics or Logs for this operator's Info DAT output. |
| Log Level | Info | Minimum captured severity: Debug, Info, Warning, Error, Off. |
| Mirror to Console | Off | Also emit new captured messages to native stderr through a separate bounded output path. |
| Clear Logs | Pulse | Clear retained history and its overflow counters without restarting the sketch. |

Map `log` and `info` to Info severity. Filtering applies to future messages;
changing the level does not discard retained history. Mirroring starts with new
messages and does not replay the existing ring. Use stable internal parameter
names consistent with the current plugin conventions.

Logs view is a table with a header and these columns:

`sequence | time_ms | generation | level | message`

- Sequence increases for the operator lifetime, including across Clear Logs.
- Time is monotonic elapsed milliseconds from operator creation, not TD timeline
  time. Timers may run while the timeline is paused.
- Generation identifies the script execution that emitted the message.
- Preserve oldest-to-newest order within an operator. Cross-operator ordering is
  best effort, not a global execution order.
- Empty history still produces the table header. Preserve line breaks and Unicode
  in message cells; truncate at valid character boundaries.
- Expose retained count, overwritten/dropped count, truncation count, and mirror
  drops in Diagnostics view. Distinguish ordinary history eviction from dropped
  new messages caused by contention or output backpressure.

The view selector is on the source operator: all Info DATs targeting it see the
same selected view. Supporting simultaneous independent diagnostic/log views
would require a separate interface and is outside this initial version.

Take an immutable bounded snapshot for an Info DAT read so size and entry calls
refer to consistent rows even when a timer logs concurrently. Inspect the SDK's
callback contract before choosing where that snapshot is held; never hold a
worker lock across TD callback calls. Reading history is nondestructive, so two
observers cannot steal each other's messages.

Verify how Info DAT updates are requested in practice. Do not assume changing a
native ring automatically dirties the DAT. A read must see current retained logs
without requiring a new sketch frame; document any refresh requirement when TD
is paused or the operator is not cooking. Do not force sketch cooks to refresh
logs. Automatic live refresh while paused is a measured capability, not a
prerequisite for capture correctness.

## Capture, formatting, and memory bounds

Implement a shared native logging facility used by both operator families, with
operator-scoped storage whose lifetime is independent of a particular V8 context.
Install the sink before initial script evaluation so startup and setup messages
are captured. Standalone embedded-runtime callers should retain a documented
fallback logging behavior; do not silently remove their output.

Start with fixed bounds rather than extra UI: 256 retained entries, at most
4 KiB of formatted message data per entry, and a bounded mirror queue. Account
for metadata and queued copies in the documented memory bound. Overflow must
evict/drop predictably and increment counters rather than block or grow memory.

Formatting happens on the owning V8 thread and produces owned UTF-8 strings.
Support multiple arguments, primitives, Error name/message/stack where available,
and useful shallow previews of objects, arrays, and typed arrays. Bound depth,
visited entries, argument processing, and total output size; show omitted counts
for large buffers. Handle cycles and detached buffers safely. Avoid calling
arbitrary getters, `toJSON`, or user inspection hooks for previews. Inspect proxy
and accessor edge cases explicitly; use opaque markers where safe introspection
is unavailable. Logging must not replace an existing exception with a formatter
exception. Full browser/Node console formatting compatibility is not required;
document supported formatting and unsupported substitution tokens.

Check level filtering before expensive argument inspection. Do not retain V8
handles, live JS objects, GPU buffers, or TD/Python objects in log entries. Snapshot
values at call time so later mutations do not alter history. Cap any temporary
formatting work as well as the final stored string.

Use a short, bounded synchronization path for capture and snapshot export.
Do not claim lock-free or zero overhead without evidence. Avoid locking the
runtime execution mutex just to read logs. If a nonblocking enqueue can fail,
count and expose drops. Never hold a storage lock during formatting, output I/O,
or calls into TD.

## Native Console mirroring

Mirror with a prefix such as:

`[avTools /project1/sketch1][generation 3][warn] message`

Capture/update the operator path on TD's safe thread; the worker must not query
TD objects. An operator rename should update subsequent prefixes. A stable
instance identifier can disambiguate old messages after deletion/recreation.

Use a bounded shared output service or equivalent existing infrastructure to
perform stderr writes outside sketch and TD cook threads. Avoid a thread per
operator. Batch sensibly, prevent interleaved partial records, and rate-limit
overflow notices. Slow or blocked stderr must not stall frame processing or
unboundedly delay plugin teardown. Explicitly design and test shutdown behavior
before adopting a potentially blocking writer; do not detach code that may run
after its dynamic library has unloaded. Native Console mirroring remains optional.

Verify actual visibility in Dialogs > Console on the installed macOS TD build.
Do not describe that destination as the Textport. Textport forwarding through a
Python callback is deferred: it adds TD-thread dispatch, helper configuration,
and paused-cook delivery concerns without improving the basic per-op log view.

## Reload, deletion, and diagnostics

Retain history across manual Reload, automatic reload, and Reset for the same
operator, with generation attribution and a bounded lifecycle marker for each
activation. Clearing logs does not reset runtime state. Deleting the operator
releases history and makes late writes safe through explicit sink ownership.
History is session-only and is not serialized into the .toe file.

Define Clear Logs relative to concurrent producers: entries accepted after the
clear remain, and a previously captured Info DAT snapshot must not repopulate
storage. Tag pending mirror work so Clear Logs can discard work not yet emitted;
text already printed in the shared Console cannot be erased by this button.

Do not fabricate JS source locations from C++ or Python call sites. Error stacks
may contain available JS locations; source-map resolution is a separate feature.
Ordinary messages need no per-call stack capture in the initial version.

## Implementation sequence

1. Add bounded storage, generation attribution, snapshots, and an explicit sink
   ownership contract to the embedded runtime/bridge. Exercise it without TD.
2. Replace the console bindings with level-aware, bounded formatting; update SDK
   types and standard-library-only typechecking coverage.
3. Add matching TD parameters and Info DAT views. Preserve diagnostic keys and
   validate capture during setup, timers, cooking, reload, and runtime failure.
4. Add optional native Console output with bounded backpressure and safe teardown.
5. Add a small logging example next to the TD integration sources, with a saved
   .toe and reproducible fixture script. Document both UI destinations and limits.
6. Run correctness and performance verification, recording conditions and results.

## Verification and acceptance criteria

Native tests should cover level filtering; multiple arguments; cycles; objects
with accessors/proxies; throwing conversion hooks; Unicode; Error and typed-array
previews; overflow; clear/capture races; concurrent snapshots; initialization logs;
reload attribution; and destruction with pending messages. Test bounded memory
and continued timer/frame progress under a flood of logs. Check slow-output
backpressure and teardown without requiring a live terminal to drain normally.

In TD, verify both a TOP and a CHOP with Info DATs and optional Console mirroring:

- Setup, frame, pulse, and independent timer messages are attributed correctly.
- Two instances remain isolated; two observers of one instance see the same data.
- Switching Info DAT views preserves build/reload diagnostics.
- `console.error` does not stop execution; an actual throw still reports through
  existing operator errors. Failed setup retains its preceding console messages.
- Pause playback and stop downstream cooking: verify capture independently from
  display refresh, record refresh behavior, and test Clear Logs and Reload.
- Rename, reload repeatedly, and delete operators while messages are pending.
- Reopen the saved example and confirm it works without machine-specific paths.

Measure baseline versus logging disabled, Info-level capture, visible Info DAT,
and Console mirroring. Include four 1080p TOPs and a CHOP interpolating 10k XY
points, using existing fixtures where practical. Compare no messages, one short
message per frame per operator, filtered-out debug calls, large-buffer previews,
and a controlled burst/flood. Separate worker formatting/capture time, TD cook
time, Info DAT rendering/update cost, total frame time, memory, and drops. Report
median and tail measurements with fixture settings; do not attribute viewer cost
to V8 execution. Logging Off should not materially regress the existing baseline;
any observed regression needs explanation before completion.

## Official references

- [Info DAT](https://derivative.ca/UserGuide/Info_DAT): operator-provided string
  information and passive/update behavior.
- [Textport](https://derivative.ca/UserGuide/Textport): Python print/debug output;
  distinguishes the Textport from Dialogs > Console.
- [TD 2025.30770 release notes](https://derivative.ca/release/experimental-202530770/72562):
  improved native Console on Windows and macOS. Verify behavior on the target build.
- Installed C++ SDK: `OP_Context::callPythonCallback` and operator Info DAT/error
  callbacks. No direct Textport logger was found in the inspected common header.
