# tracked-state

Small, original TypeScript write tracking for mutable JSON-shaped state. No runtime dependencies, subscriptions, computed values, read effects, timers, or framework imports. Runs on modern browser, Deno, and Node runtimes with Proxy, WeakRef, and structuredClone. For integration with livecode entities, start at the [engine recipe](../../docs/livecode/current/adding-an-entity-kind.md#3-implement-and-register-the-store). This document owns library semantics; the engine docs own lifecycle, transport, and UI binding.

```ts
import { createTracked, applyPatches } from "@avtools/tracked-state";

interface Params {
  cutoff: number;
  filter: { cutoff: number };
}
const tracker = createTracked<Params>({ cutoff: 0, filter: { cutoff: 0 } });
const p = tracker.state;
p.cutoff = 0.5;
const filter = p.filter;
filter.cutoff = 0.7;

let ui = tracker.snapshot();
// On the host's explicit tick:
const patches = tracker.drain();
ui = applyPatches(ui, patches);

// Incoming UI edits: actual tracked mutations, broadcast to other clients.
tracker.reconcile({ filter: { cutoff: 0.8 } }, { mode: "merge" });
// Incoming authoritative load: preserve matching object/array identities.
tracker.reconcile({ cutoff: 0.2, filter: { cutoff: 0.3 } });
tracker.dispose();
```

The host decides entity naming, lifecycle, revision ordering, echo/source handling, subscriptions, delivery, and initial snapshot timing. Drain once and fan out that batch. `snapshot()` does not drain. Delivery retry needs the host to retain the returned batch. Structural or dense root-array patches replace the root: always use the return value of `applyPatches`; Vue hosts can assign it to a ref. Ordinary object patch keys use receiver assignment so Vue's normal set traps run; deletes use ordinary deletion. The special `__proto__` key uses a safe own data descriptor and does not promise Vue notifications.

## API and transport

- `createTracked<T extends object>(defaults): Tracked<T>` validates and clones defaults once, preserving initial shared aliases. `state` retains interface types without an index signature. Reads return stable nested proxies, including reflected configurable data descriptors.
- `dirty` is a conservative work gate: it remains true while external objects are reachable, because raw writes cannot set a flag. It checks reachability but does not scan property values. An unchanged external subtree can therefore yield `dirty === true` followed by an empty `drain()`. Owned-only state retains its cheap pending-write gate. Detached writes may leave it true until drain discards them.
- `drain(): Patch[]` first scans reachable externally mutable subtrees, repairs their graph links, and combines discovered changes with tracked writes. It returns coalesced final values, copying mutable payloads. Same-value writes (`Object.is`) do nothing; write-and-revert may still emit. Parents subsume children. Existing-index and nested element writes emit indexed/leaf patches. Length changes and deletions replace that array; more than 64 distinct direct index writes between drains also collapse to replacement, bounding dense bookkeeping.
- `snapshot(): Snapshot<T>` returns a detached transport tree. Shared aliases expand into separate objects. Sparse array holes become null; `Snapshot<T>` therefore makes array elements nullable. Live sparse reads remain JavaScript `undefined`. Snapshots and patch payloads normalize `-0` to `0`, matching JSON transport; live assignments still retain JavaScript signed-zero semantics. This is a transport representation, not an alias-preserving clone.
- `reconcile(value, { mode: "replace" | "merge", silent?: boolean })` preserves the root and each matching object/array container. Replace is default and removes absent keys; merge retains them. Arrays always replace contents, preserving matching element containers by index. It is load/merge reconciliation, **not params redeclaration policy**. Default/replace calls require a full `T`; explicit merge accepts `DeepPartial<T>`. Use optional fields or records for dynamic shapes.
- `silent: true` scans external objects and requires no pending changes; a conservative `dirty === true` alone does not reject it. Drain and deliver pending engine writes first. Silent reconciliation refreshes external baselines without echoing hydration on the next drain. Silence is for hydration already reflected in the recipient's baseline; it is not source-based echo suppression. A UI edit other clients need must use ordinary tracked reconciliation.
- `dispose()` clears pending work and disables tracking. Repeated disposal is harmless. Retained references remain mutable; drain, snapshot and reconcile then throw. Release the tracker/state references when deleting an entity.
- `applyPatches(snapshot, patches)` applies trusted library batches and returns the possibly replaced root. It copies payloads, validates parent existence, and never traverses inherited parents. It is not an untrusted-network decoder or a transaction: validate inbound data at the host boundary.

```ts
type Patch =
  | { op: "set"; path: readonly string[]; value: JsonValue }
  | { op: "delete"; path: readonly string[] };
```

Paths are segments, not escaped dotted strings. Empty path is the root. Numeric keys are strings. Array index/leaf sets use ordinary paths; deletions and length changes use whole-array replacement, so no separate length protocol is necessary. JSON encode/decode preserves the wire values. Patches deliberately use a simple runtime transport type rather than recursively generating every possible TypeScript path. Typed state, reconciliation leaves, and snapshot shape remain checked.

## Correctness boundaries and compatibility decisions

Supported values are finite numbers, strings, booleans, null, mutable plain objects (including null prototypes), and plain arrays whose prototype is exactly `Array.prototype`. Array subclasses and arrays with custom or foreign-realm prototypes are rejected. Defaults and newly adopted subgraphs reject cycles, accessors, symbol fields, non-enumerable/non-writable properties, class instances, functions, undefined, bigint, and non-finite numbers. Array custom properties, prototype changes, freezing, and accessor definitions are unsupported. Fully writable/enumerable/configurable data descriptors are supported. Individual invalid assignments fail before changing that field; multi-step array methods and reconcile are not general rollback transactions. Registration/runtime validation is runtime-based, allowing normal interface types without pretending TypeScript proves finiteness or absence of cycles.

Writes through proxies reject invalid values eagerly. Raw external writes bypass that validation, so `drain()`, `snapshot()`, or `reconcile()` reports invalid reachable data explicitly by throwing. Repair the raw value and retry; failed validation does not acknowledge pending changes. Validation does not invoke raw accessors. Invalid detached data does not poison current state. The library does not implement the existing params store's `values: null`/unserializable reporting policy; that remains host policy.

**External assignments retain ordinary reference semantics.** Assignment adopts an external raw object without copying it and enables selective scanning:

```ts
const raw = { cutoff: 1 };
p.filter = raw;
tracker.drain();
raw.cutoff = 2; // found by the next drain, including dirty-gated consumers
tracker.drain(); // emits a patch for filter.cutoff
p.filter.cutoff = 3; // tracked; raw.cutoff also changes
```

At synchronization boundaries, the library validates reachable external data, compares shallow per-object baselines, repairs parent/child links, and combines discovered differences with ordinary tracked changes. Nested additions, deletions, replacements, shared aliases, and array edits are supported. Shared and overlapping subtrees are refreshed once per scan. Every externally exposed descendant stays eligible for scanning while reachable, even if removed from its original parent and retained elsewhere. Detached external objects are skipped and resume scanning if reattached.

There is no size cutoff: an externally assigned subtree that grows large keeps working and becomes slower. Large assignment is currently discouraged usage, not a reason to discard updates. Keep bulk replacement explicit; `reconcile()` copies its input, and specialized host setters can use that ownership boundary. Cloned defaults and new cloned reconciliation subtrees do not enable scanning. A reconciliation that preserves an already-external object's identity must keep scanning it, since outside references still exist. Storing an owned object inside an externally accessible raw object can expose that object too and conservatively enables scanning for it.

`snapshot()` scans external changes without draining them, so a later drain still delivers those changes. Cross-tracker proxies remain unsupported adoption inputs; transfer snapshots between trackers.

Shared aliases are registered eagerly even if never read. Writing one emits all live paths. Removing every parent disconnects a held subtree: it stays mutable, emits no current-tree patches, and can be reattached with its stable proxy. New entity instances are independent. Reconciliation into a shared target with divergent incoming subtrees throws **before mutation**; equal incoming subtrees preserve the alias. Merge conflicts are conservatively rejected too, including disjoint partial updates through two aliases. Hosts must resolve such ambiguity explicitly; there is no last-write corruption policy.

Defaults clone once; later structural assignments adopt. Reconciliation copies incoming data as a tree and does not impose incoming alias identity. Snapshot/patch transport expands aliases, normalizes holes and prototypes, and does not encode graph identity. `structuredClone(state)` is not supported because state is a Proxy; use `snapshot()`. No params tombstones, declaration-value retention, piano-roll commit/history policy, or entity protocol is built in.

## Work and lifetime costs

Scalar writes validate one value and insert an object/key into a dirty set: no whole entity scan, path enumeration, payload cloning, or subscriber callback. Structural adoption validates/registers the incoming graph and checks ancestry for cycles. Previously adopted objects reuse metadata. Array methods use native operations through traps; there is no shallow previous-array copy on every call. Length truncation visits linked object elements to remove ownership edges, not every scalar leaf.

Drain scans only externally mutable regions, then resolves reverse parent links to all live paths, coalesces via a trie, and copies only emitted values. The scan cost depends on external subtree size and graph reachability, not the size of unrelated owned state. Structural assignments may traverse their input to check cycles even when graph links were changed by raw writes. Aliased DAGs can expand to many paths; heavily shared graphs and whole-array patches are deliberately not constant-cost promises. Snapshot is a full traversal plus any external scan. Reconcile scans pending external changes, validates/copies its input, and preflights alias conflicts; canonical comparisons run only for repeated shared targets. Full reconciliation still costs more than sparse assignment. Deep recursion can hit the JS stack limit. This is intended for small inspectable state, not arbitrary adversarial graphs.

Metadata is weak-keyed. Reverse parent edges and the external-node registry use WeakRef. Tracked removal unlinks ownership immediately; raw removal is reconciled during scanning. Per-object external baselines hold previous field values until the next scan. Dirty nodes are strongly held until drain/dispose; a host that never drains can retain detached writes. Retained proxies keep tracker machinery alive, so release them on host teardown. This implementation does not claim measured garbage-collection timing or leak-proof heap guarantees.

## Verification and benchmarks

See [selective scanning measurements](bench/HYBRID-RESULTS.md) for current owned/external comparisons, growth, and detachment. The original [benchmark report](bench/RESULTS.md) is retained as historical evidence before this fallback was added.

```sh
cd packages/tracked-state
npm ci --cache /tmp/tracked-state-npm-cache
npm run typecheck
npm test
npm run build
npm run format:check
npm run bench
# Actual sparse Six Sines IDs/defaults (optional; default fixture is standalone):
SCHEMA_PATH=../../../browserSynthPorts/six-sines/browser-ui/src/data/schema.json BENCH_ITERATIONS=1000 npm run bench
# Optional subset:
BENCH_FILTER=array npm run bench
# Selective external scanning, including oversized growth and detachment:
SCHEMA_PATH=../../../browserSynthPorts/six-sines/browser-ui/src/data/schema.json BENCH_FILTER=hybrid npm run bench
```

Tests include unread aliases, detached references, reattachment, replacement coalescing, payload isolation, reconciliation/silence, validation, reflection, receiver set notifications, sparse arrays and native array edits, plus deterministic randomized transport-mirror tests. External-assignment regressions cover dirty-gated consumers, raw structure edits, growth, alias moves, mixed raw/proxy batches, and invalid-data recovery. Type tests are compiled by `typecheck` but not executed.

Benchmarks report p50/p95/p99/max milliseconds, CPU/runtime metadata and heap deltas. They separately time plain/tracked assignments, idle drain, dirty drain, complete write/JSON/apply consumption, repeated 20×50 automation, full snapshots, unchanged/changed full reconciliation and tiny merges, registration, one/ten entities, and array point edits/nested leaf edits/reverse/splice/sort/front insertion at 100/10,000 elements. Every scenario has 100 warmup iterations; setup outside the timer is explicitly separated. Mutation-only cases drain in untimed preparation. Heap deltas include preparation and GC and are **not allocation counts**. GC/JIT/scheduler outliers are retained. No audio-thread deadline guarantee follows from Node microbenchmarks. See [bench/RESULTS.md](bench/RESULTS.md) for the measured run.
