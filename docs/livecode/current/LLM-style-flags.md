# LLM-style flags in the livecode implementation

Status: analysis pass against the checked-in implementation on 2026-08-23.
This is a thematic review, not a mechanical audit and not a fix plan.

## Frame of reference

I treated `user-level-project-goals.md` and `principles.md` as the standard for
judgement, rather than treating abstraction, validation, or code volume as bad
in themselves. In particular, this system genuinely needs some unusual
machinery: it spans a disposable UI and a long-lived execution engine, exposes
mutable live objects, instruments TypeScript, survives module replacement, and
prioritizes performance reliability over architectural purity. The product also
explicitly permits complexity in rich, forkable view components. Those facts
make several patterns that would look suspicious in an ordinary CRUD app quite
reasonable here.

The flags below are places where the implementation goes beyond that justified
complexity, hides a broken contract instead of repairing it, or makes future
changes pay a disproportionate coordination cost. Examples are illustrative.
They are not claims that every instance of the pattern should be deleted.

## High-confidence flags

### 1. A missing launch acknowledgement is compensated for by a client-side run-identity heuristic

`runDedupe.ts` is the clearest example of a local patch for an architectural
gap. The server mints a run token, but the launch response does not tell the
launching client that token. The client consequently maintains two bounded
sets of observed tokens, stakes a "claim" immediately before the POST, infers
which active token belongs to which launch, and has a special rule for a launch
and terminal state conflated into one transport tick. The runtime then has to
seed, release, and consult this memory at several lifecycle boundaries.

This is thoughtful code for the protocol it has, but the protocol is making the
client solve an identity problem with timing and observation. Returning the
accepted run token (or a client request ID correlated with it) would put the
fact at the engine boundary where it is known and would remove much of the
heuristic state. This matters especially because the principles say engine
truth must not be replaced by client inference. The extensive comments in this
file are useful evidence that the underlying contract is too indirect; they
are not themselves the main problem.

Representative examples:

- `apps/livecode-tldraw/src/runDedupe.ts`: the claim model,
  `supersededRunTokens`, `activeRunTokens`, and the unknown-token exception.
- `apps/livecode-tldraw/src/livecodeRuntime.tsx`: orchestration of the dedupe
  memory alongside POSTs, sync updates, reconnect rehydration, edits, and
  terminal states.
- `packages/livecode-protocol/runtime.ts`: separate prepared-build and run
  identities, without a launch acknowledgement that closes the loop for the
  caller.

**Why flag it:** it is precisely a lower-layer workaround for missing
higher-layer information, and it creates race-sensitive client state in a
system whose stated source of runtime truth is the engine.

### 2. "Never throw" fallback ladders silently change or discard user data after violated invariants

The entity stores repeatedly attempt `structuredClone`, fall back to a JSON
round trip, then fall back again to a hand-built subset, an empty object, or a
cached "last good" value. Some comments explicitly say that a fallback remains
even though the stored-data invariant should make it unreachable.

The performance rationale is legitimate: a visualization write should not
break caller-owned musical timing. The suspicious part is combining that hot
path rule with silent semantic repair. Examples include stripping arbitrary
piano-roll metadata, turning an uncloneable params duplicate into `{}`, and
serving an older cached entity value after the current value becomes
unserializable. A console warning is easy to miss in a performance environment,
and downstream views can appear valid while no longer representing current
engine state. That conflicts with the principle that inconsistency should be
surfaced rather than hidden or presented as fully understood.

Representative examples:

- `packages/livecode-engine/piano_roll_store.ts`: `cloneShapedData`,
  `rebuildSafeData`, and `cloneRollData` form two overlapping recovery ladders;
  the latter expressly retains fallbacks instead of trusting the store's own
  invariant.
- `packages/livecode-engine/params_store.ts`: `cloneParamsValues` converts a
  failed duplicate gesture into an empty entity, while `sanitizeMeta` drops
  invalid metadata.
- `packages/livecode-engine/entity_store.ts`:
  `cloneEntityValueForWire` can substitute `lastValueJson` for the live value.
- `packages/livecode-engine/signals_store.ts`: conversion codifies the same
  "last good value" behavior.

**Why flag it:** keeping the realtime path alive is product-aligned, but data
loss and stale displays should become explicit entity/operation states, not
plausible-looking success values. A future fix should preserve the non-throwing
hot path while making degradation visible and actionable.

### 3. Core behavior has accumulated into several god modules and distributed state machines

The main server is roughly 2,700 lines in one closure. It owns HTTP routing,
WebSocket sets, remote/local execution selection, project persistence,
materialization caches, shadow analysis, LSP workspaces, client-control request
correlation, legacy transport, entity actions, and cleanup. On the client,
`App.tsx` is roughly 1,800 lines and combines canvas bootstrapping, project
loading/saving, shape persistence, entity view creation, baked-mode behavior,
client-control dispatch, and UI. `livecodeRuntime.tsx` and `syncRuntime.tsx` add
another pair of large providers with state mirrored into refs to coordinate
imperative socket and async lifecycle edges.

Large files are not automatically overengineered. Here the problem is the
opposite: boundaries described in the current docs exist conceptually but are
often encoded as nearby local variables and callbacks. A change to launch or
reconnect behavior requires reasoning across engine state, server closure
state, sync delivery, React state, mirrored refs, and shape registration. That
encourages the next LLM edit to add one more boolean, ref, timer, cache, or
special-case callback where the symptom appears.

Representative examples:

- `apps/deno-notebooks/livecode/visualizer/server.ts`:
  `createLivecodeVisualizerServer` and its large set of captured mutable maps,
  caches, socket registries, and route-local helpers.
- `apps/livecode-tldraw/src/App.tsx`: `LivecodeTldrawPage` plus the many project,
  canvas, baked, and client-control helpers in the same module.
- `apps/livecode-tldraw/src/livecodeRuntime.tsx`: React state mirrored by
  `modulesRef`, `armedRef`, `connectionStatusRef`, callback refs, pending-stop
  queues, and an open-sequence generation counter.

**Why flag it:** this structure amplifies local-fix behavior and makes important
lifecycle invariants implicit. The likely repair is not more generic framework
layers; it is a few ownership-oriented extractions with narrow state and
explicit inputs/outputs (for example project service, launch coordinator, and
transport/session lifecycle).

## Medium-confidence flags

### 4. Entity-kind generalization stops halfway, so abstractions coexist with repeated end-to-end plumbing

There is a generic entity store, an entity registry, a sync-source registry,
shared protocol modules, and a detailed 267-line recipe for adding an entity
kind. Despite those abstractions, each type still needs custom store wrappers,
snapshot and change collection, protocol unions, sync-source factories,
server action switches/routes, client contexts/hooks, canvas persistence
arrays, shape guards, and save/load handling. `syncRuntime.tsx` has six contexts
and largely parallel reducers/providers; `App.tsx` separately collects and
recreates each view type; `sync_sources.ts` manually registers factory
functions per kind.

Some repetition is intentional and healthy: piano rolls, params, and signals
have materially different mutation and lifetime semantics, and the principles
reject a second generic patch-cable model. The flag is the combination of
generic infrastructure and remaining mechanical cross-layer enumeration. It
offers neither the simplicity of explicit bespoke features nor a single
declarative extension seam.

**Why flag it:** the long addition recipe is a useful warning sign that a small
feature can require many synchronized edits that an LLM will happily produce
without noticing drift. Consolidate only truly mechanical facts (type ID,
wire decoder/handler, sync adapter, persistence/view codec); do not force the
different domain semantics into a universal base class.

### 5. Deprecated compatibility paths remain live inside the hottest core modules

The current sync transport still feeds a deprecated `/runtime/snapshots` shim,
the engine exposes `legacyModuleRuns`, the execution plane retains direct
engine access for that shim, and piano-roll snapshot APIs retain an unused
`force` option solely for call-site compatibility. The comments identify one
remaining Vue consumer, but the compatibility code is interleaved with the
new broadcast path rather than isolated at an adapter boundary.

Compatibility may be required; this review cannot establish that the Vue
consumer is disposable. The LLM-style smell is preserving old contracts
indefinitely because removal is riskier than adding another branch, even after
the code calls them deprecated and no-op. Such branches enlarge the state
space for every transport and lifecycle change.

Representative examples:

- `apps/deno-notebooks/livecode/visualizer/server.ts`: the legacy socket set,
  local-mode-only route behavior, and conversion of collected changes back to
  full snapshots.
- `packages/livecode-engine/engine.ts`: `legacyModuleRuns` remains part of the
  primary engine interface.
- `packages/livecode-engine/piano_roll_store.ts`:
  `makePianoRollSnapshot({ force? })` accepts an option that does nothing.

**Why flag it:** either document the supported external consumer and isolate
the adapter, or remove the path. "Deprecated but entwined" is not a stable
contract.

### 6. Comments frequently restate local mechanics with contract-level emphasis

The code contains many valuable explanations of non-obvious concurrency and
product constraints. It also has a recurring LLM-like style of long preambles,
capitalized emphasis (`ONE`, `DRAINS`, `READ-ONLY`, `NEVER`), commentary on
nearly every small helper, and narration of branches that are already clear
from the code. The opening blocks in `entity_store.ts`, `sync_sources.ts`, and
`syncRuntime.tsx` repeat overlapping transport rules that are also covered in
the livecode documentation. Small examples such as "Same, addressed by name"
or "Test seam" docblocks add little beyond the signature.

This is lower priority than the architectural flags. In race-heavy code, a
local statement of an invariant is useful. The issue is repetition and lack of
hierarchy: genuinely surprising constraints are harder to distinguish from a
paragraph attached to a routine adapter. Repeated prose also becomes another
copy of the contract that can drift.

**Why flag it:** retain comments that explain *why* a decision is surprising or
name an invariant not expressible in types. Remove comments that translate the
next few statements into English, and put cross-module protocol contracts in
one authoritative place with short references from code.

## Patterns I did not flag

- **Source-located analyzer checks.** The timing restrictions and relatively
  detailed diagnostics are intentional HCI, not generic LLM pedantry. The
  human-written goals explicitly prefer incomplete, actionable blocking rules
  to exhaustive soundness.
- **Separate React contexts for high-frequency entity kinds.** Although
  verbose, this follows the real requirement that signal traffic not rerender
  unrelated editors and monitors. It is justified until profiling or a simpler
  external-store design proves otherwise.
- **Path normalization and project-boundary validation.** Checks preventing
  absolute paths, traversal, NULs, and wrong source/data suffixes protect a
  real filesystem boundary. They are not fanciful edge-case handling.
- **Explicit lifecycle actions and some boilerplate.** Run, replace, stop, and
  panic being distinct is core product behavior. Collapsing them for elegance
  would violate the human-written principles.
- **Rich piece-specific UI protocol code.** The goals explicitly tolerate
  heavyweight reusable components and agent-written piece-specific views.
  Complexity there should be judged by whether it leaks into engine truth, not
  by line count alone.

## Suggested order for a later fix pass

1. Close the run-identity protocol gap first; it should delete heuristic client
   state rather than merely reorganize it.
2. Decide and encode what an unserializable/degraded entity means on the wire,
   preserving realtime non-throwing behavior without stale or fabricated
   success values.
3. Extract ownership boundaries from the server and client god modules only
   where doing so makes lifecycle state explicit. Avoid a broad "service
   framework" rewrite.
4. Inventory the deprecated snapshot consumer and either retire it or move all
   compatibility translation behind one adapter.
5. Use the next entity-kind addition to identify the genuinely mechanical
   registry metadata; do not preemptively generalize domain-specific stores.
6. Trim redundant comments as touched code is simplified, after the important
   invariants have a single authoritative home.

That order intentionally targets deletions and clearer ownership before style
cleanup. Otherwise a mechanical pass risks making verbose, overdistributed
machinery look tidier without reducing its conceptual cost.
