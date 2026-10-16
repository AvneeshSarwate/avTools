# Executable timing specification

`fixtures.json` is a language-neutral, versioned corpus for independent ports.
Expectations are explicit logical events, not output regenerated from this
implementation. `runner.ts` executes every action case in offline and realtime
modes and checks order, payload, context path, event count, and a 1e-9-second time
error bound. Wall time and generated IDs are excluded.

Every case starts at logical time zero, default 60 BPM and seed `spec`. Actions
are ordered arrays: `emit`, `waitSec`, `wait` (beats), `setBpm`, `fork`, `join`,
`cancel`, `startBarrier`, `resolveBarrier`, and `awaitBarrier`. Fork/join contain
child action arrays and assign stable path names. Cancel names a previously
forked child in the current path. This is a small test vocabulary, not a public
scripting API. Offline fixtures advance to 0.1 seconds; every expected event is
before that bound.

| Stable ID | Requirement |
| --- | --- |
| logical.sequential | Waits accumulate logical seconds |
| ordering.fork-ties | Equal deadlines retain branch insertion order |
| ordering.continuation-inserts-earlier | A continuation can insert a deadline before an already queued later one |
| join.advances-parent | Joining advances the parent to child completion |
| logical.zero-wait | Zero wait yields without advancing logical time |
| tempo.beats | Beats map to seconds at the configured BPM |
| tempo.change | Later beat waits use the tempo change at current logical time |
| cancel.child | Canceling a pending branch prevents its future event |
| barrier.release | Resolve advances and resumes a waiter at the resolver's logical time |

Normalized events are `{case, sequence, contextPath, logicalSeconds, kind,
payload}`. Comparisons preserve exact sequence and string payloads; only logical
seconds have an epsilon. `frames.ts` separately checks multiple frame waiters,
next-frame registration, cancellation, completion, and subscription cleanup using
a controlled frame source. It restores the original host globals after running.

RNG is seedrandom **3.0.5 default ARC4**, not an arbitrary seeded PRNG. Strings
are passed unchanged; numbers use JavaScript String(number). An omitted seed
uses host UUID entropy and is intentionally nondeterministic. Forked children
use `parentSeed + '::fork:' + index`, starting at zero per context. Shared children
consume the same stream and do not advance the fork counter. The fixture includes
the known `hello.` vector, independent derived-seed vectors, and a parent/shared
child consumption vector. These are checked exactly, not with a time epsilon.
UUID generation must not consume this musical RNG.

The JSON corpus is the portable starting set. The larger JavaScript specification
is `../timing_tests.ts`: 21 cases in both modes and 19 invariant cases cover
cancellation/error propagation, ties, continuation scheduling, deep joins,
barrier races, tempo cloning/modulation/compaction, RNG sharing, overdue bursts,
external-await rebasing, bounded zero waits and the zero-advance guard. Each case
has a stable name and description. The invariant suite is intentionally separate
from wall-clock performance measurements; failures throw and are aggregated.
Importing the file never starts tests automatically.

Run the same suite on Node, Deno, embedded V8 and a browser using
`packages/native-webgpu/test/timing/run.mjs` (see that package's `TIMING.md`).
The native host-specific tests cover timer normalization/cancellation, task versus
microtask ordering, generation propagation, exception/rejection attribution,
Abort listener mutation, UUIDs, native wakeups, and watchdog termination. Future
ports should preserve logical continuation boundaries without copying Node's I/O
phases or browser timer throttling rules.
