# Livecode test audit for behavior-preserving refactoring

Status: implementation and test-suite audit on 2026-08-23. This evaluates
whether the checked-in tests can support refactoring the LLM-style flags in
`LLM-style-flags.md`; it does not propose production compatibility policy.

## Executive judgement

The suite is substantially better than its fragmented task setup first makes
it appear. The engine stores, analyzer, launch races, multiplexed transport,
project analysis, and several complete browser topologies have meaningful
behavioral coverage. A careful refactor of a single store or server subsystem
can start from these tests with reasonable confidence.

It is **not yet a reliable blanket safety net for a cross-boundary refactor**.
The most important weaknesses are:

1. no command runs the complete current-system suite;
2. the current tldraw client has almost no component/unit-level coverage, so a
   single 2,189-line stateful E2E carries most client confidence;
3. reconnect, rehydration, project switching, and multi-client lifecycle
   orderings are weakly covered or absent;
4. several tests deliberately pin the very fallback, dedupe, and deprecated
   compatibility behavior that should change; and
5. some race tests use fixed sleeps and some analyzer tests assert generated
   text, increasing either flake risk or refactor friction.

This is an internal tool still under development, not a launched product.
Breaking wire formats, removing deprecated routes, changing failure semantics,
or changing internal module boundaries is acceptable when it improves the
system. Tests should protect the intended user-visible and engine contracts,
not turn accidental compatibility into a product commitment. A red test after
an intentional contract improvement is often a test to rewrite or delete, not
evidence that the old behavior must be preserved.

## What was reviewed

- all Deno test files under `apps/deno-notebooks/livecode/tests/`, including
  the regression suites under `tests/repro/`;
- the tldraw Playwright E2E and the browser-engine, remote-engine, and baked
  topology E2Es;
- the test task definitions in `apps/deno-notebooks/deno.json` and
  `apps/livecode-tldraw/package.json`;
- shared polling/socket helpers and representative assertions in the analyzer,
  entity-store, protocol, sync, launch-race, LSP, and browser tests; and
- the current coverage claims and known gaps in
  `current/testing-and-operations.md`, checked against the actual files.

I distinguish three kinds of test below:

- **Preserve:** it asserts a product or architectural contract that should
  remain true through the contemplated refactor.
- **Rewrite with the change:** it covers a real scenario, but its expected
  protocol or failure representation is part of what should improve.
- **Delete/replace:** it exists primarily to preserve a deprecated or local
  workaround that the refactor should remove.

## Findings by proposed refactor

### 1. Closing the launch/run identity gap: coverage is strong, but much of it protects the workaround

The engine and transport sides have good race coverage. `launch_race_test.ts`
drives concurrent launch, stop-before-start, stop-during-import, replacement,
superseded queued launch, and panic against a real server. The sync suite checks
that run entities carry unique run tokens and that cancelled/superseded launches
publish coherent terminal state. The tldraw E2E covers natural completion,
instant failure, and the replaced-run terminal straddling its replacement.

`run_dedupe_test.ts`, however, is a specification of the client inference hack:
claims, two remembered-token sets, unknown terminal handling, rehydration
seeding, and the conflated instant-failure exception. It is excellent regression
coverage for the current algorithm and should not be used as an argument to
retain that algorithm.

**Verdict:** sufficient to begin the protocol refactor, after adding one
contract test that `/runtime/launch` returns the accepted run identity (or a
correlated request identity) and one browser assertion that the client follows
that explicit acknowledgement. Preserve the engine race scenarios and the
user-visible E2E outcomes. Replace most or all of `run_dedupe_test.ts` with much
smaller acknowledgement/correlation tests when the heuristic disappears.

### 2. Making degraded/unserializable entity state explicit: store coverage is deep but pins lossy behavior

Params, signals, piano rolls, and durable entity serialization have unusually
thorough unit coverage: live-object identity, reconciliation, revisions, CAS,
no-op detection, drift sampling, tombstones, undo/redo, deletion, save/load,
and unserializable values are all exercised. These tests give a good base for
preserving the ordinary successful path.

The failure-path expectations need deliberate revision. The piano-roll repro
suite asserts that non-cloneable metadata is stripped without throwing. Entity
registry tests assert that JSON-hostile values are skipped during save. Params
and signal tests assert current `unserializable` and last-good-value behavior.
Those assertions encode the implementation criticized in
`LLM-style-flags.md`: a gesture can appear successful while metadata disappears,
a duplicate can become empty, or a wire read can represent an older value.

There is also a notable missing level: tests mostly call store functions
directly or observe the eventual browser state. There are few contract tests
for the HTTP/entity-action error shape and no focused browser test proving how
a degraded entity is presented to the user.

**Verdict:** strong enough to preserve valid-value behavior, not strong enough
to define the replacement degradation contract. Before changing the fallback
ladders, write table-driven tests for each operation (declare/write, duplicate,
save, sync snapshot/change, and load) specifying whether it succeeds, rejects,
or produces an explicit degraded result. Add one UI/E2E assertion that the
degradation is visible rather than silently rendered as valid data. Rewrite
the existing stripping/skipping assertions to the chosen contract; do not
preserve them solely because this is a breaking change.

### 3. Splitting the server and client god modules: server coverage is usable; client coverage is too top-heavy

The server is exercised through real HTTP and WebSocket boundaries in the
protocol, sync, race, project-target, LSP, remote-engine, and baked tests. That
is favorable for extracting project persistence, launch coordination, or sync
session ownership: tests generally enter through public routes rather than
importing closure-local helpers. The topology tests also verify that portable
engine behavior survives local, remote browser, and baked execution.

The client is less well protected. There is no React component test suite and
no unit coverage for `SyncRuntimeProvider`, `LivecodeRuntimeProvider`, project
boot, canvas persistence scheduling, reconnecting sockets, or client-control
dispatch. The tldraw E2E covers valuable user flows, but it is one sequential
script with shared module IDs, shape IDs, browser/server processes, and a
project-mode phase that must run last. It consults the bespoke
`__livecodeTldrawRuntimeDebug` surface extensively. A failure early in the
script prevents later scenarios from being evaluated, and internal debug-state
assertions can pass while a real interaction boundary is broken (or fail after
a harmless internal reorganization).

**Verdict:** server extractions can proceed incrementally with the existing
integration suites plus subsystem unit tests added at each new boundary.
Before a major client provider split, add focused tests around pure state
transitions: sync reset/change reduction, socket gap/reconnect behavior,
run acknowledgement application, project-open state replacement, and pending
stop flushing. The E2E should remain an outer smoke test, not the only test of
those state machines.

### 4. Resolved 2026-08-23: mechanical entity-kind seams have contract coverage

Per-kind store behavior is covered well, and sync tests verify resets, changes,
deletions, metadata-only changes, ended signals, and module-keyed ephemeral
sources. The registry suite also verifies create/duplicate/delete and durable
serialization. These are useful behavioral anchors when moving mechanical
registration data.

`entity_registry_test.ts` now materializes a minimal fake
`EntityKindRegistration` and proves that one type ID supplies matching sync and
durability artifacts. `canvas_view_registry_test.ts` does the same for canvas
collection, change dispatch, and entity references. The built-in durable list
now includes the third type, `animationTimeline`, and its concrete tests cover
CRUD, serialization, sync reset/change/delete, project persistence, and the
custom-element round trip.

**Verdict:** the mechanical seams are covered without pretending domain
semantics are uniform. New kinds still need their own store and browser behavior
tests; piano-roll history, params reconciliation, animation evaluation, and
signal lifetime remain concrete contracts.

### 5. Removing deprecated compatibility paths: existing tests should not block removal

The protocol and sync suites explicitly assert the deprecated
`/runtime/snapshots` envelope, including the absence of `runToken`, and verify
that one broadcast tick feeds both new sync sockets and the legacy shim. The
aggregate `test:livecode:e2e` task runs the older Vue client and is the only
real-client exercise of that shim.

For a launched product those would be compatibility guarantees. Here they are
inventory: they identify exactly what can be deleted once the remaining
internal consumer is retired. Keeping them green by retaining dual transport
would work against the stated goal.

**Verdict:** confirm that no active internal workflow still needs the Vue
visualizer, then delete the shim assertions, old E2E task, and compatibility
surface in the same change. Replace their place in the aggregate task with the
current tldraw E2E. No migration period or backwards-compatible response shape
is justified merely by the current tests.

### 6. Trimming redundant comments: tests are irrelevant, as they should be

No test meaningfully depends on explanatory prose. Generated-code substring
assertions sometimes depend on emitted identifiers and import text, but those
are implementation assertions rather than comments.

**Verdict:** comment cleanup needs review and `git diff --check`, not new tests.
If cleanup reveals that a contract exists only in comments, first capture it in
a behavioral test or authoritative protocol document.

## Cross-cutting weaknesses

### There is no trustworthy “all current livecode checks” command

`deno task test:livecode` runs unit, server, and the old Vue E2E. It omits the
repro suite, `project_shadow_diagnostics_test.ts`, the tldraw E2E, browser-engine
slice, remote-engine E2E, baked-project E2E, client type-check/build, and the
optional p5gpu test. Several of the omitted suites cover precisely the modern
browser-engine and tldraw boundaries most likely to change.

This is the largest operational risk to a refactor: good tests that are not in
the invoked gate provide no safety. Add a fast default task and an explicit
full task, with platform-dependent p5gpu clearly separated. The default should
not call the deprecated Vue suite once that client is retired.

### The client E2E is broad but monolithic

The tldraw E2E contains many worthwhile scenarios, but all run in one browser
session and later project tests depend on ordering. It uses hand-rolled polling,
global variables, and a large debug API rather than a test runner with isolated
cases, per-case fixtures, filtering, and independent failure reporting.

Split it by durable areas (analyzer/editor projection, params, signals/scopes,
run lifecycle, and project persistence). Reuse a fixture that owns server,
engine tab, UI, temporary project, and cleanup. This need not mean one fresh
browser for every assertion; suites can share expensive setup while still
making order dependencies explicit and allowing a focused rerun.

Also declare Playwright in the tldraw app's dev dependencies. A test gate that
works only because another repository directory happens to provide its runner
is not reproducible enough to certify a refactor.

### Async tests mix sound polling with brittle sleeps

The shared `waitFor` and `SyncClient.waitForChange` helpers are generally sound:
they wait for observable conditions and fail with labels. The E2Es similarly
poll many user-visible or debug-visible outcomes. In contrast, sync and launch
tests contain fixed waits of 200–700 ms, LSP tests use 250–1,000 ms sleeps, and
some negative assertions merely sleep and check that nothing arrived. Those
tests are vulnerable to slow machines and can unnecessarily delay fast ones.

Prefer protocol barriers and controllable fixtures: acknowledge broadcast
ticks, expose deterministic import gates in test fixtures, wait for a known
later sequence before asserting absence, and use fake/logical time for pure
scheduler behavior. Timing itself remains a legitimate contract for panic and
bounded-stop tests, but thresholds should be generous and isolated from normal
state-transition coverage.

### Some analyzer tests are coupled to code-generation spelling

The analyzer suite correctly checks diagnostics, source ranges, manifest
entries, shadowing, aliases, and execution behavior. It also contains many
`assertStringIncludes` checks for generated function names, wrapper calls, and
import strings. A behavior-preserving transformer rewrite may fail these even
when the output parses, typechecks, and behaves identically.

Retain a small number of textual assertions for requirements that are truly
about emitted syntax (for example preserving a stop export). For most cases,
parse the transformed module and assert AST structure, or execute/typecheck it
and assert manifest/runtime observations. This will make a detector-registry or
transform-pipeline refactor much less noisy without weakening behavior checks.

### Global stores and cleanup conventions deserve an explicit isolation test

Entity stores and runtime instrumentation are process-global. Unit files call
custom clear-and-drain helpers, while server tests create isolated filesystem
roots but still host engines in the same Deno process. The suite currently
passes in its documented ordering, but there is no explicit test proving that
two server/engine instances do not share entity or runtime state, nor a common
fixture that guarantees all global stores are reset after failure.

That is important if the server god module is split or tests are parallelized.
Either make engine state instance-owned as part of the refactor or codify the
single-engine-per-process constraint and run affected tests serially. Add a
test for the intended ownership rather than relying on unique entity names.

## Minimum test work before the mechanical fix pass

1. Add `test:livecode:fast` and `test:livecode:full` tasks that enumerate the
   current system deliberately; make CI or the normal agent workflow invoke
   them.
2. Add the launch acknowledgement/correlation contract before deleting client
   dedupe state.
3. Decide the degraded entity wire/operation contract and add table-driven
   store + transport tests before rewriting fallback ladders.
4. Add focused pure tests for sync reduction/reconnect and livecode runtime
   lifecycle transitions before splitting the React providers.
5. Split the tldraw E2E into independently reportable suites and declare its
   Playwright dependency.
6. Add a generic entity registration conformance fixture if, and only if, the
   fix pass introduces a declarative registration seam.
7. Remove legacy-shim tests alongside the shim rather than preserving them as
   compatibility requirements.

## Bottom line

The tests are strong enough to support **incremental, subsystem-scoped
refactors**, especially in the stores, analyzer, engine launch lifecycle, and
server transport. They are not strong enough to justify a single broad rewrite
of the server and client state machines while confidently claiming behavior
preservation.

More importantly, “behavior preserving” should apply to the intended creative
workflow and architectural guarantees, not every current response field,
fallback value, debug hook, or deprecated route. Because this is an internal
tool under active development, the right strategy is to add missing tests for
the desired contract, make the breaking improvement, and delete tests whose
only purpose was to pin the obsolete workaround.
