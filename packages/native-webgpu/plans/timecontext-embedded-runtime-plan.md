# TimeContext in the embedded V8 runtime

Design and implementation handoff, researched 2026-10-11. **Proposed work, not implemented.**

This is the next priority after the [original Dawn/Node/TouchDesigner port](avtools-dawn-syphon-touchdesigner-port-plan.md). The original plan is historical context; the implementation and current package documentation are authoritative about what already works.

## Objective and agreed scope

Make the existing TimeContext library in `packages/core-timing` work reliably and efficiently inside the custom TouchDesigner TOP. Preserve its semantics across embedded V8, ordinary Node, Deno, and browsers. Keep one timing implementation; adapt the embedding host around it.

The owner explicitly requires **real time**, including when TD playback is paused. Timeline-driven time is a possible future mode, not a prerequisite: backward seeks and timeline loops currently have no defined TimeContext semantics. Do not simulate timeline support by feeding discontinuous TD frame time into the real-time clock.

The owner also authorizes expanding the timing tests into an executable specification useful for future ports to other languages. Treat that as a deliverable, not merely an embedded-runtime smoke test.

This plan does not implement a CHOP, embed Node, add a general module loader, change GPU transport, or build a new livecoding editor. TypeScript and dependencies continue to be bundled ahead of time. Native integration remains macOS-first; keep the timing host portable without attempting a Windows TD/GPU port here.

## Findings from the current source

Paths in code spans below are repository-relative.

| Area | Current behavior | Consequence |
| --- | --- | --- |
| `native/embedded/Runtime.cpp` | Persistent V8 isolate/context, explicit microtask checkpoints, Dawn's `napi_v8` compatibility layer | There is no Node event loop or standard host API layer to supply timers automatically |
| `native/embedded/Bridge.cpp` | One persistent owner worker per TOP; condition variable wakes for TD jobs only | JavaScript currently makes progress when TD calls into it, not autonomously between cooks |
| `native/embedded/polyfills.js` | `setImmediate` appends to a JS array; `__pump` runs up to 64 callbacks in one evaluation | Several macrotasks run before the next microtask checkpoint; handles are array lengths and lack cancellation |
| `Runtime::evaluate` | Compiles a snippet, runs it, checkpoints, creates/joins a watchdog thread | Reusing this path for every timer would add unnecessary compilation and thread overhead |
| `Bridge::wait` | Repeatedly pumps and sleeps 1 ms while awaiting initialization/readback | Polling is a bridge workaround, not a complete event loop |
| `src/td-runtime.ts` | Async GPU initialization/setup; synchronous draw and pulse callbacks; persistent sketch state | TimeContext can update state between frames, while rendering remains synchronous |
| Input bridge | Copies CHOP/TOP input into owned snapshots during a cook | A timer can read the most recent snapshot, but cannot fetch fresh TD data from its worker thread |
| Reload/disposal | Candidate setup can run before replacing the old sketch; no timer/root ownership model | Long-lived asynchronous work needs explicit generation ownership and teardown |

`packages/core-timing/offline_time_context.ts` already provides the important semantics:

- A shared scheduler drives real-time and offline execution. Logical time is distinct from wall time, waits use target deadlines, and tempo changes retime beat waits.
- Due work advances by logical timeslices. After resolving a slice, the scheduler deliberately yields to a **macrotask** before advancing another already-due slice. Promise continuations must finish first.
- Branches, joins, barriers, cancellation, seeded branch randomness, and deterministic ties are deliberate behavior with existing tests.
- Delayed work replays overdue logical events as a burst. Silently dropping or coalescing events would change the library.
- `wait(0)` is useful; a zero-advance guard bounds runaway scheduler loops. This does not protect against every possible infinite JavaScript or microtask loop.
- `launch` accepts timer overrides already, but the module clock and its macrotask/frame scheduling are not a complete injectable host interface.
- `performance.now()` is used during module initialization. Install host globals **before** evaluating a bundle that imports the library.
- `crypto.randomUUID()` is required even with an explicit random seed: tempo maps and schedulers use UUIDs too. Do not substitute the seeded musical RNG for host identity generation.
- `launchBrowser`/`waitFrame` require a real frame source. The current RAF loop requeues itself, and source inspection found no matching stop/cancel path; add lifecycle coverage before relying on it.

### Research checks actually performed

1. Executed the current `polyfills.js` queue in Node's isolated VM with microtasks drained after evaluation. Two immediates, where the first queues a promise continuation, produced `A, B, microtask`. Native Node 22.20.0 produced `A, microtask, B`. This checks the current **queue model**, not the compiled TD plugin, and demonstrates a concrete ordering mismatch.
2. Bundled the existing timing tests entirely in memory and ran six cases on Node 22.20.0 in both real-time and offline modes. All passed: `parallel_branchWait_ordering`, `deterministic_tie_break_same_deadline_is_stable`, `microtask_yield_intermediate_scheduling`, `wait0_is_valid_sync_point`, `seeded_rng_forked_branches_repeatable`, and `seeded_rng_shared_stream_deterministic_under_tie_break`.
3. Inspected the pinned V8 headers, including explicit microtask queues, promise rejection callbacks, and continuation-preserved embedder data. API presence is not proof that a proposed integration works; use the native harness below to validate it.

No new runtime behavior, TD session, browser parity run, or performance benchmark was executed for this design. The Node probe suppressed the test file's automatic runner in memory only; tracked source was unchanged.

## Compatibility contract

There is no single identical Node/browser timer implementation to reproduce. Preserve **TimeContext's logical behavior**, and specify the small embedded host profile separately.

| Capability | Embedded contract |
| --- | --- |
| Clock | Monotonic `performance.now()` in milliseconds relative to runtime creation; TimeContext uses its existing seconds conversion. Separate from TD timeline and system calendar time |
| Promises / `async` / `await` | Native V8 implementation; finish a microtask checkpoint after each host callback/task before dispatching another task |
| `queueMicrotask(fn)` | Enqueue into V8's microtask queue; validate callback; report thrown exceptions as callback errors, not artificial rejected promises |
| `setTimeout` / `clearTimeout` | Callable callbacks, extra arguments, stable opaque numeric handles, idempotent cancellation; Node 22 delay normalization profile for the supported numeric delay inputs |
| `setImmediate` / `clearImmediate` | FIFO ready work; callbacks scheduled from an immediate belong to a subsequent turn; checkpoint between callbacks |
| Abort primitives | `AbortController`, `AbortSignal.aborted`, `reason`, `throwIfAborted`, listener add/remove, `onabort`, and once-only listeners with defined dispatch behavior |
| UUIDs | Standards-shaped random UUID v4 using OS entropy, independent of TimeContext's deterministic RNG |
| Errors | Capture uncaught task errors and genuinely unhandled promise rejections with sketch attribution; stop/report the offending sketch, never exit TD |
| Frame waits | Optional explicit TD-cook frame source, described below; not a synthetic 60 Hz timer |

Node normalizes timer delays below 1 ms, above 2,147,483,647 ms, or NaN to 1 ms and truncates nonintegers. Its immediates are FIFO and newly scheduled immediates wait for another loop iteration. Node does not promise exact callback timing. We adopt that limited profile, not Node's whole I/O phase model or timer-handle objects. [Node 22 timer documentation](https://nodejs.org/download/release/v22.20.0/docs/api/timers.html)

Browsers instead specify timer nesting behavior, including a 4 ms minimum for sufficiently nested timers. Browser load/throttling and Node scheduling therefore need not yield identical wall-clock observations. Tests must not assume the ordering of an unrelated timeout and immediate is universally portable. [HTML timers](https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#timers)

A microtask checkpoint drains newly enqueued microtasks as well as those initially pending. A fixed number of `await Promise.resolve()` calls or a checkpoint after a batch of callbacks is not equivalent. [HTML event loop and checkpoints](https://html.spec.whatwg.org/multipage/webappapis.html#perform-a-microtask-checkpoint)

Abort state/reason are set before synchronous abort notification, and repeated aborts do not dispatch again. Expected cancellation must remain compatible with the library's cancellation handling. [DOM abort specification](https://dom.spec.whatwg.org/#interface-abortcontroller)

Out of scope for the first host profile: `process.nextTick`, Node timer `.ref()`/`.unref()`, `MessageChannel`, string-valued timer callbacks, full Web Crypto, network APIs, and a browser DOM. `setInterval` is not needed by the inspected core scheduler; add it only if a concrete supported timing workflow requires it, with explicit interval drift/cancellation tests. Do not advertise complete Node or browser compatibility.

Keep existing Node/browser globals untouched. Cross-platform support means running the same library against host adapters and documenting unavoidable timing differences; it does not mean replacing every host's native event loop.

## Proposed architecture

```text
TD thread: capture inputs / submit cook / obtain output
                      |
               C ABI command queue
                      |
TOP owner worker: deadline-driven host loop
    commands | timer heap | immediate turns | V8 foreground tasks | GPU progress
                      |
              invoke one JS callback
                      |
        drain V8 microtasks + classify failures
                      |
           choose next task or sleep

JS: unchanged TimeContext scheduler -> sketch state -> synchronous draw
```

### 1. Extend the existing worker into a real host loop

Use an owned command queue, a timer min-heap ordered by `(deadline, insertionSequence)`, cancelable handle records, and immediate queues partitioned by turn. A condition variable wakes for commands, earlier deadlines, shutdown, or relevant native completion work. Sleep until the next deadline; if nothing is pending, sleep indefinitely.

All JS, V8 handles, NAPI work, and scheduler state remain on the same owner thread. Do not create timer threads or enter one isolate concurrently. Keep the existing C ABI boundary between TD's toolchain and the embedded runtime.

Dispatch a single callback using a persistent V8 function handle and arguments, then perform a full microtask checkpoint. Do not compile JS strings for timer callbacks or call `Runtime::evaluate` repeatedly to service a queue. Cache bridge entry functions too where doing so removes work from this same path.

Define bounded service rounds across commands, due timers, ready immediates, and native tasks. Preserve FIFO/deadline ordering within each source. Never interrupt a microtask checkpoint to render or advance logical time; yield only at legal task boundaries. An endlessly replenishing immediate source must not starve timers or TD commands. Do not drop overdue TimeContext events to achieve fairness.

Replace `Bridge::wait`'s 1 ms sleeps with this loop's wait-until-complete operation. When `__avRender` yields on a promise, return to C++, service tasks, and resume through V8 microtasks. Do not recursively pump JS while a JS callback is on the stack. A second render command must wait until the first render/readback is complete; timers may advance state during that asynchronous wait, but drawing and disposal must respect active renderer resources.

Retain separate deadlines for asynchronous setup/readback and active JS execution. A legitimate long wait in TimeContext is not a runaway callback. Replace the per-evaluation watchdog thread with a persistent, armed watchdog mechanism; include microtask drains in the execution budget, disarm reliably, and tear it down before destroying the isolate. After V8 termination, poison/recreate that runtime rather than pretending interrupted JS state is valid.

### 2. Integrate V8 and Dawn progress without busy polling

The V8 platform can schedule foreground work independently of user timers. Ensure posting foreground and delayed foreground tasks wakes the owner worker, and dispatch them with correct isolate ownership. First investigate a delegating platform/task-runner adapter against the pinned V8 API, preserving the default platform's background services and non-nestable task rules. Do not assume a condition variable by itself observes default-platform queues.

Dawn's `AsyncRunner` currently uses global `setImmediate` and can requeue while requests remain pending. With an autonomous loop that can become continuous polling. Test idle devices, pending device-loss promises, initialization, mapAsync, and teardown explicitly.

Prefer a native completion wakeup if the pinned Dawn API provides a suitable safe path. Otherwise isolate GPU progress behind one deduplicated driver task with a bounded polling deadline **only while actual progress-requiring requests exist**. Measure the latency/CPU tradeoff and record the chosen interval. Distinguish long-lived notification subscriptions from work requiring continuous polling. Keep this adaptation small and reviewable in the existing Dawn patch surface. Do not throttle user `setImmediate` globally to hide a GPU polling problem.

### 3. Supply the missing host primitives

Implement clock, timers, microtask enqueue, and entropy as small native bindings. Keep scheduling data structures independent of Cocoa, TD, and Metal. Use `std::chrono::steady_clock`; isolate entropy behind a platform function (`SecRandomCopyBytes` on the current macOS build). Sleep/wakeup and entropy are the only intended OS seams for this timing layer. Resume-from-system-sleep behavior must be characterized per platform; monotonicity does not imply identical suspend accounting everywhere.

Implement the necessary Abort/Event behavior in a focused, tested JS module or reuse a small compatible implementation after dependency review. The current minimal EventTarget shim should not be presumed conformant. Check listener mutation, once behavior, exception reporting, and removal during dispatch. Unsupported static AbortSignal helpers should remain clearly unsupported rather than silently approximate them.

Use the V8 promise rejection hook to record rejection/handler-added notifications, then report at the selected end-of-turn boundary. Suppress rejections handled in the same checkpoint and distinguish later-handled notifications. Keep expected cancellation out of operator error output. Node's `queueMicrotask` uses V8's microtask queue; wrapping every callback in `Promise.resolve().then` would change its exception behavior. [Node globals](https://nodejs.org/download/release/v22.20.0/docs/api/globals.html#queuemicrotaskcallback)

### 4. Expose the library without adding a module system

Bundle the canonical `packages/core-timing/mod.ts` into the embedded JS distribution through the existing esbuild pipeline. Pin and resolve `seedrandom` explicitly in the native package's build/dependency graph; include its license and account for it in content hashes. Do not depend on another application's incidental `node_modules` installation.

Proposed sketch API: add `host.timing` to the existing second argument of `setup(p, host)`. Expose core library functions/types with their existing semantics. Wrap root launch entry points only to track lifecycle ownership, supervise errors, and preserve the returned cancelable handle. Do not add an unrelated timing DSL for sketch authors.

The standard example should start a managed root in `setup`, save its handle if needed, and return from setup. The root changes ordinary JS state after waits; `draw` renders that state. Do not await a never-ending root from setup, which would correctly prevent initialization from completing. Pulse handlers may synchronously launch/cancel managed roots; they still return synchronously.

Expose an explicitly read-only latest-controls accessor to asynchronous code if necessary, with the same missing-channel fallback as `frame.chop`. It reads the last completed input snapshot, never calls TD from the worker. The snapshot can be stale while TD is not cooking. Retained views must stay valid across subsequent cooks; do not retain borrowed TD pointers.

Real-time sketch execution starts after the operator has loaded the sketch through its first successful setup/cook. Thereafter, a lack of cooks does not pause managed roots. An operator that TD has never initialized cannot run a sketch; document this startup distinction. Capture background task errors immediately in worker-owned status and expose them safely on the next TD status/cook request.

### 5. Treat asynchronous lifetime as part of correctness

Assign sketch generations and distinguish sketch-owned tasks from runtime-owned GPU/platform tasks. Track managed roots, timers, immediates, and frame subscriptions. Associate async continuations with their originating generation, including continuations that schedule more timers after an `await`.

The pinned V8 headers expose `SetContinuationPreservedEmbedderDataV2` / `GetContinuationPreservedEmbedderDataV2`, which are promising for ownership propagation. Validate propagation through async/await, chained promises, queueMicrotask, and native promise resolution in a small native spike before choosing this mechanism. Explicitly capture/restore ownership at native callback boundaries. Generation bookkeeping is not permission to discard arbitrary promise continuations: cancellation cleanup must still run, and guarded host calls must reject stale resource use.

Reload is a transaction:

1. Evaluate a candidate in a candidate ownership scope; track work created at top level as well as in setup. A candidate that fails compilation/evaluation/setup is canceled and cleaned up. The previous valid sketch remains usable, matching current behavior.
2. While asynchronous candidate setup runs, define which old-generation tasks may run; recommended policy is to keep the old sketch active until commit and isolate candidate renderer resources. The candidate is not externally published yet. Arbitrary user mutations of shared globals cannot be rolled back; document that limitation.
3. At successful commit, cancel old roots while their resources are still valid, settle their cancellation continuations under a bounded cleanup budget, invalidate remaining old-generation tasks/host handles, then dispose old renderer resources and activate the candidate.
4. Reset, deletion, and initialization failure use the same ownership cleanup. Closing the operator must wake and join sleeping workers and watchdogs without callbacks touching freed state.

Tests must include a candidate that schedules a timer and then throws, cleanup that schedules more work, and an old unresolved promise that settles after commit. If reliable continuation ownership cannot be demonstrated, use runtime/context isolation for reload rather than shipping timer leakage; record the resource and reload-cost tradeoff before that larger change. Do not claim that clearing the timer heap alone cancels promises or user async state.

### 6. Frame waits and future clock modes

Required first acceptance: `launch` real-time operation, core scheduling semantics, and `OfflineRunner` parity in the headless host. These do not depend on TD frame playback.

Provide `launchBrowser`/`waitFrame` only with an explicit TD frame adapter: one frame event per accepted cook, at a documented point before draw after inputs are available, using the same monotonic timestamp domain. Snapshot the frame callbacks so callbacks requested during a frame run on the next one; honor cancellation and microtask boundaries. Repeated cooks and multiple viewers need an explicit frame identity policy. Fix/test the core RAF subscription cleanup so completed or canceled roots do not keep requesting frames forever.

When TD is paused or the operator is not cooking, frame waits remain pending; ordinary real-time waits still run. This is a frame source, **not TD timeline time**. Expose it as an explicit capability and do not fake browser display refresh with `setTimeout(16)`.

Future timeline time needs separately specified seek/loop policy, reset/replay behavior, randomness, tempo and barrier state restoration, and external side-effect handling. A future clock adapter can reuse `OfflineRunner` techniques, but those decisions must precede integration.

## Tests as an executable specification

Put library semantics in `packages/core-timing`, not exclusively in the native package. Keep host-runtime conformance tests in `packages/native-webgpu`. The native harness should run without TD, a window, or GPU initialization for pure timing tests, while using the **same runtime loop code** as the TOP.

### Shared test structure

- Separate reusable case definitions and throwing runners from automatic CLI/browser startup. `timing_tests.ts` currently starts tests on import and its guarded runner logs failures instead of propagating them; a successful process exit is not a trustworthy pass signal.
- Give each case a stable ID, requirement statement, initial state, explicit stimuli, expected trace/invariants, numerical tolerances, and a category: portable logical semantics, JS continuation semantics, host profile, or performance measurement.
- Add a small language-neutral fixture corpus for the portable cases, with JSON actions such as launch/fork, wait-seconds/beats, change-tempo, cancel, barrier operations, and emit. Keep the vocabulary limited to tests; do not build a general interpreter or public replacement API.
- A fixture contains reviewed expected events, not golden output silently regenerated from the implementation under test. When behavior is disputed, decide it explicitly and then update the expectation.
- Normalize events to `{case, sequence, contextPath, logicalSeconds, kind, payload}`. Exclude wall timestamps, UUIDs, and process-global counters. Use stable parent/branch paths; preserve exact event order. Specify time epsilon per assertion and exact RNG vectors where promised.
- Store seed encoding, the selected seeded-RNG algorithm/version, branch seed derivation, and sharing/forking vectors. A port that merely uses a different seeded PRNG is not deterministic-compatible.
- Use the current offline mode and hand-derived expectations for deterministic logical tests. If additional host clock injection is needed, make a small optional host-services interface shared by all modes; do not introduce TD-specific hooks into the scheduler or replace its algorithm for testing.
- Keep language-specific microtask/promise tests alongside the portable corpus. A future language port must implement equivalent logical suspension/continuation boundaries, but need not emulate every Node API.
- Harnesses must fail nonzero on assertions, unhandled errors, timeout, missing result, or incomplete suite. Record the host and source revision in machine-readable results.

### Required behavior matrix

| Group | Cases to preserve or add |
| --- | --- |
| Logical time | Sequential waits, negative/NaN waits, target-deadline/no accumulated drift, changing rate, long fractional schedules, overdue burst replay, external-await rebase rules |
| Ordering | Same-deadline ties; branches created in continuations; nested `.then`, `await`, `.finally`, and `Promise.all`; a continuation inserting an earlier next deadline; complete checkpoint before next timeslice |
| Branches/joins | Parent progress versus branchWait, deep trees, simultaneous completion and cancellation, values/errors propagated through joins |
| Cancellation | Parent/child cascade, synchronous handleCancel behavior, cancelSafe value, idempotence, registration after cancellation, listener removal, no unexpected unhandled rejection |
| Barriers | Root scope, start/await/resolve cycles, immediate restart, adopt-in-progress behavior, never-started key behavior, cancellation and rejection races |
| Tempo | Shared and cloned tempo maps, retiming pending beat waits, high-rate modulation, ramps checked against analytic expectations, bounded history, abandoned queue cleanup |
| Randomness | Known seed vectors, forked versus shared streams, stable branch order, cancellation effects on consumption, independence from host UUIDs |
| Fairness | Bounded wait(0), existing runaway zero-advance guard with a progressing sibling, overdue storms alongside TD-like commands, watchdog for a pure infinite JS/microtask loop |
| Host primitives | Immediate/microtask regression above; timeout arguments/normalization; stable handles and cancellation before/after due selection; queue ordering; no early delivery relative to normalized deadline; callback exceptions versus rejected promises |
| Frame waits | Next-frame registration, multiple waiters, cancellation, no subscription leak, pause without frame events while real-time waits progress |
| Lifecycle | Successful reload, failed candidate, reset, delete while asleep/awaiting GPU/timer, stale promise settlement, cleanup-created tasks, two independent TOPs |
| Resource bounds | Timer cancellation churn, retained callback handles, canceled scheduler queues, root cleanup, idle CPU/wakeup counts, repeated reloads |

Run the existing real-time/offline and invariant suites, not just the six research probes. Preserve intentional behaviors already named in the suite. Add rejection observation adapters: browser/Deno use the appropriate global event interface; Node uses its process events; embedded V8 uses the native rejection observer. Do not make the Node tests pass by quietly disabling rejection checks.

Differential runners should cover pinned Node, supported Deno, an actual browser, and the native embedded harness. Browser tests may legitimately take longer due to host throttling; compare logical results separately from measured lateness. Record unavailable hosts as untested rather than silently treating them as passing.

## Performance plan and acceptance

The expected advantage comes from persistent in-process JS, direct callback invocation, and sleeping until work is due. This is a design expectation, not a measured speedup. A single callback or checkpoint remains nonpreemptive; an overloaded sketch will delay both timers and rendering.

Measure warm steady state separately from initialization/JIT and reload. Use release builds, pinned versions, fixed seeds, and record machine/OS/power conditions. Report p50/p95/p99/max and sample counts rather than a single mean.

1. **Pure scheduling:** one root, many branches, many roots, same-deadline bursts, cancellation churn, tempo modulation, and 60/240/1000 Hz requested event rates. Measure actual task count, CPU, deadline lateness, allocation/GC, and retained handles. These rates are workloads, not hard-real-time promises.
2. **Idle:** no script timers, a long pending timer, idle GPU/device-loss subscription, and all roots canceled. Expect no periodic host timer wakeups without work; identify any required GPU/platform maintenance separately. No continuous spin.
3. **Shared workload:** fixed TD-like 60 Hz commands plus real-time scheduling; then the real TOP with CPU output and Syphon-only output separately. Report callback lateness, worker queue wait, draw/readback time, and cook time so GPU transfer cost is not mislabeled as scheduler cost.
4. **Baseline:** compare timer-disabled runtime to the current plugin, and identical pure timing cases to Node on the same machine. Initial review target: at most 10% median steady-state overhead in an otherwise identical timer-disabled workload, outside measurement noise; investigate any meaningful p95/p99 regression even if the median passes. Calibrate useful absolute latency targets from measured Node and device baselines, not invented guarantees.
5. **Soak:** enough timer/reset/cancellation/reload cycles to show bounded memory and handle counts after GC and cleanup. Include multiple instances and long inactivity. Store raw results and benchmark commands in validation documentation.

Optimizations within this work: persistent watchdogs, cached callback handles, bounded queues, timer heap cancellation/compaction, no string evaluation per callback, no per-timer native thread, no permanent 1 ms host polling. Unrelated CHOP buffer redesign or shared-worker consolidation can wait until evidence justifies them.

## Alternatives considered

- **Cook-only pumping:** smallest patch, but real-time tasks stop when TD stops cooking and timers inherit frame quantization. Fails the owner's real-time requirement.
- **More JS polyfills alone:** supplies names without fixing native wakeup, task/checkpoint boundaries, cleanup, or CPU spin. Insufficient.
- **Embed Node:** brings mature services but expands binary/lifecycle/process behavior and changes the validated embedding substantially. Not needed for this library.
- **Use libuv:** a reasonable replacement for the worker's native wake/timer mechanics if integration proves simpler, especially if future I/O grows. It does not by itself implement the JS APIs, V8 checkpoints, ownership, or the library's semantic contract. Start with the existing C++ worker and standard primitives; revisit based on a concrete integration problem. [libuv timer API](https://docs.libuv.org/en/v1.x/timer.html)
- **Drive OfflineRunner from TD time:** useful for a separately defined offline/timeline feature, not a substitute for autonomous real-time execution.

## Implementation sequence and completion gates

1. **Specification baseline:** separate test startup, run the full existing suite on Node/Deno/browser where available, add the ordering regression and first portable fixtures. Record existing failures separately before changing behavior.
2. **Native host spike:** use the pinned V8 build to prove callback/checkpoint ordering, autonomous timer wakeup, V8 foreground work notification, continuation ownership, and pending-GPU idle behavior. No TD UI required. Resolve the ownership/GPU integration choices before extending sketch APIs.
3. **Host implementation:** add the owner event loop and primitive bindings; replace the immediate shim, polling waits, and per-call watchdog. Pass host conformance and cleanup tests with the actual compiled runtime.
4. **Library integration:** bundle core-timing/seedrandom, expose managed timing in setup, implement generation cleanup and last-input access, run the full semantic matrix in the native harness. Add explicit frame support and its cleanup tests after real-time support passes.
5. **TD integration and performance:** two instances, timer advancement during no-cook intervals, late input snapshot semantics, pulse-launched/canceled roots, reload/error/reset/deletion, CPU/Syphon output. Measure rather than assume 60 fps. Save an independently openable `.toe` and supporting source next to the existing TD examples, with the Python fixture generator retained if used.
6. **Documentation and handoff:** document supported globals, timing API, real time versus frame/timeline time, lifetime rules, test commands, performance results, and platform validation. Update package/TD docs and link the executable specification from core-timing docs.

All logical tests must pass without altering their expectations merely to accommodate an embedded queue bug. No lifecycle callback may touch disposed state. Idle timing must not spin. Preserve existing TOP rendering, input, pulse, error, and Syphon checks. Native conformance is necessary before opening TD; GUI verification still needs the user's applicable permission in the implementing conversation. Side-chat approvals do not inherit parent-thread computer-use authorization.

## Source references

Repository sources inspected: `packages/core-timing/{offline_time_context.ts,timing_tests.ts,priority_queue.ts,seedrandom_shim.ts,mod.ts}`; `packages/native-webgpu/native/embedded/{Runtime.cpp,Runtime.h,Bridge.cpp,Bridge.h,polyfills.js,BUILD.gn}`; `packages/native-webgpu/src/{td-runtime.ts,embedded.ts}`; `packages/native-webgpu/native/td/SketchTOP.cpp`; build scripts and package/TD validation docs; `apps/node-livecode` bundling setup.

Pinned native interfaces inspected under `packages/native-webgpu/upstream/node-webgpu/third_party/dawn/`: Dawn Node `AsyncRunner`, V8 `v8-isolate.h`, `v8-microtask-queue.h`, `v8-context.h`, `v8-promise.h`, and `libplatform/libplatform.h`. These are fetched build dependencies, not new vendored sources.

The V8 embedding guide provides the engine/host boundary context; it does not promise Node's host APIs. [Official V8 embedding guide](https://v8.dev/docs/embed)
