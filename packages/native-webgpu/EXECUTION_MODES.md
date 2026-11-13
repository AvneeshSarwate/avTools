# Blocking and buffered execution

Current lifecycle: [Build, Reload, and Reset](RELOAD.md). Automatic Reload is per operator; Reload adopts available source, Reset restarts active source. Each activation creates a fresh isolate. SDK 3 supports ordinary TimeContext imports.


**Wait for Current Result** (`Samecook`) uses the same script API in both modes.

| Operator | Default | Toggle on | Toggle off |
| --- | --- | --- | --- |
| CHOP | On | Wait for current owned input snapshot's result | Offer inputs, collect latest complete channel snapshot |
| TOP | Off | Wait for earlier work, then render current inputs | Submit when idle, collect completed image |

TOP Pre-trigger Mode ignores this toggle and remains nonblocking. Its Execute DAT
can submit early and collect later. CHOP has a replaceable pending request; TOP
continues its existing policy of skipping input captures while rendering. Neither
buffered mode promises exact feedback or processing every intermediate sample.

Open [ExecutionModes.toe](native/td/execution-mode-example/ExecutionModes.toe).
Four CHOPs use the same embedded script: the first blocks and the other three are
buffered. Increase `controls/work_ms` to 10 or 50 to compare. Change a toggle while
running to preserve state. [Measurements](native/td/execution-mode-example/VALIDATION.md)
include real TD cook costs and 1080p TOP uploads.

## Ownership and ordering

Each instance's existing dedicated worker owns V8. CHOP captures source, channel
names, samples, schema, events and timestamps into native memory before returning.
No TD pointer survives the call. One request runs, one pending buffered request
can be replaced, and up to 16 ordered control/waiter requests form reload/reset
barriers. Capacity errors reject the new request explicitly. Blocking callers are
never coalesced. The C ABI is serialized per instance, as TD cooks are; destruction
must not race a host API call.

On acceptance: inputs become current, setup/reload completes, existing frame waits
resume, FIFO pulses run, then `onCook` runs. Pulses are captured by name at press
and queued separately from replaceable frame data (256 maximum; overflow reported).
A pending old-generation request is preserved ahead of a reload barrier so its
accepted events execute before replacement. Stale generations cannot publish after
replacement is requested. A failed compatible replacement can continue the old
working script, matching the previous reload behavior.

Synchronous callbacks see stable inputs. Output getters see live worker state,
including unconsumed writes. Publications contain complete arrays, never partial
writes from a callback. Between cook requests, dirty outputs also publish after a
bounded event-loop turn and its microtask checkpoints. Async functions are not
atomic across awaits. Unchanged timer state does not copy/publish arrays.

Three owned native publication slots swap under a short lock. Buffered collection
tries once and retains its previous result if the exchange is busy. Allocation,
large sample copies, JS execution and isolate destruction occur outside that lock.
Submission uses a short ownership mutex; it never waits for JS. Replaced input
storage is reclaimed on the submitting thread, so allocation/copy/free and CPU
contention remain costs. Normal cook results still copy the full declared output.

Frame waits run once per accepted tick, without replaying skipped ticks. CHOP
`deltaSeconds` accumulates absolute TD elapsed time across coalescing; backwards
absolute-time changes establish a new anchor with zero elapsed time. Timeline
`frame`/`time` remain separate and may loop/seek. TimeContext realtime clocks use
monotonic wall time. Independent timers continue while TD playback is paused;
frame waiters require accepted cooks.

## Errors and teardown

Buffered initialization/reload happens on the worker. Initial output is zero;
compatible reloads retain a completed output. Schema changes start from zero and
old arrays cannot resize/overrun the TD buffer. Exceptions/timeouts retain buffered
output and expose warnings; blocking execution preserves its failure return/error
behavior. Reset remains available. Toggle changes neither dispose nor recreate V8.

The worker wakes on notifications and timer deadlines, without periodic polling.
Its event-loop round yields between callbacks after a 2 ms soft budget (at most
64 rounds); a single callback/microtask checkpoint is still subject to the existing
1 s watchdog. Async initialization has a 3 s wait limit; disposal drains for up to
250 ms. Destruction joins live workers, and can therefore block. A native binding
that does not return cannot safely be interrupted by killing a C++ thread; these
limits are not hard realtime or an unconditional teardown deadline.

## Diagnostics

CHOP Info CHOP adds these to the existing cook/script channels:

| Channels | Meaning |
| --- | --- |
| `wait_for_current`, `worker_busy`, `ready` | Requested policy, active worker turn, compatible result available |
| `submitted_request`, `accepted_request`, `completed_request` | Monotonic request IDs; completed includes failures |
| `published_sequence`, `consumed_sequence`, `source_request` | Publication identity and its input request; timers can publish repeatedly for one request |
| `output_abs_frame`, `input_age_ms`, `publication_age_ms` | Source TD absolute frame and monotonic ages (no negative latency after seeks) |
| `reused_cooks`, `repeated_percent_120` | Reused publication count and percentage over last min(120, cooks) observations |
| `same_request_results` | Buffered results consumed from the request submitted in that same call |
| `coalesced_inputs`, `pulse_queue_depth`, `pulse_overflows` | Replaced pending requests, queued events, rejected event batches/local pulses |
| `runtime_generation`, `schema_generation` | Requested replacement/schema epochs, not number of V8 isolates |
| `cook_ms`, `input_copy_ms`, `output_copy_ms`, `script_ms`, `worker_ms`, `blocking_wait_ms` | Native execute, capture/worker acceptance, collection, last cook JS, latest cook/timer turn, blocking wait durations |

TD stores Info CHOP values as float32; very large counters lose integer precision.
Snapshot diagnostics can lag by one observation if the exchange lock is busy.
Input copy's worker portion includes first-time initialization. A timer publication
has no cook script duration. `cpuCookTime` also includes TD overhead/upstream work;
worker CPU is additional and can occur between TD cooks.

TOP retains its existing diagnostics and adds requested/effective wait, busy,
blocking wait time and monotonic publication age. Upload time includes TD's CPU
upload enqueue call, not a separate GPU completion measurement. Pretrigger
submission and collection are separate cooks; sum both for its CPU cost.
