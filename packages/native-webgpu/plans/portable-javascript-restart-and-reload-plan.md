# Portable JavaScript, full sketch restart, and reload controls

Status: implemented and validated, 2026-10-20. See [current behavior](../RELOAD.md)
and [reproduction/measurement results](../test/restart/README.md). This document
records the accepted design; the linked guide describes the shipped controls.

## User priorities and decisions

The primary goals are ordinary TypeScript checking and reusable web-oriented
JavaScript. Code that does not access TouchDesigner should be easy to extract and
run in a browser or another compatible JS environment.

The user explicitly does not need state-preserving hot reload and prioritizes
portability and a normal JavaScript mental model over elaborate reload behavior.
Automatic reload must be a per-operator toggle, with a manual Reload pulse button.
Automatic compilation and automatic activation are separate controls.

Implement the following contract for both TOP and CHOP:

- TimeContext is usable through normal imports, not only host.timing.
- A successful activation is a fresh sketch execution environment with fresh
  module/global state, analogous to refreshing a page.
- Compilation failure leaves the current sketch running.
- Once activation starts, stop the old sketch before evaluating/initializing the
  replacement. A replacement that fails at runtime reports an error; it does not
  resurrect the old running sketch.
- Automatic Reload controls activation of changed source, not whether the compiler
  runs. Reload explicitly restarts the latest successful available bundle even
  when its bytes are unchanged.
- Real-time timers remain independent of TD cooking. Frame waits remain driven by
  accepted TD frame requests. This work must not change scheduling semantics.

## Relation to earlier plans

The native TypeScript build-tool plan already excludes state-preserving HMR.
Successful source replacement already resets user sketch state. The complexity
being reconsidered is transactional runtime replacement: candidate setup currently
runs alongside the old sketch inside a persistent runtime, preserving the old
running program if candidate evaluation/setup fails.

The earlier TimeContext plan introduced host.timing before ordinary bundled
imports were available, to expose a canonical library and intercept task launches
for ownership, cancellation and error supervision. It also required candidate/
active generation overlap and graceful cancellation during replacement. This new
plan supersedes those requirements where they conflict with full environment
restart. It does not discard native memory/resource safety or timer correctness.

Keep the companion [TD type environment plan](td-typescript-runtime-environment-plan.md)
for accurate ambient declarations. Its assumptions about requiring host.timing or
rejecting a bundled timing library must be revised to match this plan when the
main thread implements them. Do not maintain two conflicting public contracts.

The main thread is concurrently changing npm/workspace resolution, single-file
TypeScript setup and template creation. Reinspect current code and integrate with
those changes. Do not revert their APIs to match a stale snapshot of this plan.

## What remains TD-specific

Keep TD dependencies at the sketch entry-point boundary:

- Read CHOP inputs and publish outputs through the host.
- Receive the renderer/GPU device and frame metadata through the existing API.
- Receive TD pulse events and configure operator behavior.
- Optionally register synchronous disposal of explicitly owned resources.

Reusable code imports TimeContext and other libraries normally, accepts ordinary
state/callbacks/devices, and does not require the TD host object to schedule work.
Reusable animation functions may return a cancellation handle for ordinary
application-level cancellation, but cancellation is not required merely to make
a fresh environment replaceable.

Example intended API (illustrative, not an implementation):

```ts
// animation.ts — portable library code
import { launch } from '@avtools/core-timing';

export function animate(state: { x: number }) {
  return launch(async ctx => {
    while (true) {
      state.x += 1;
      await ctx.waitSec(0.1);
    }
  });
}
```

```ts
// td-entry.ts — only this adapter knows about TD
import type { ChopHost } from '@avtools/native-webgpu/td-chop';
import { animate } from './animation';

const state = { x: 0 };

export function setup(host: ChopHost) {
  const task = animate(state);
  // Optional cooperative cancellation; not the isolation boundary.
  host.onDispose(() => task.cancel());
}

export function onCook(host: ChopHost) {
  host.outputs.set('x', state.x);
}
```

Do not turn the portable module's import into a hidden dependency on TD's host
object. Bundle the ordinary package implementation, resolved using normal project
configuration. Keep one resolved library instance within each bundle where the
normal module graph permits it; distinct operators still have independent state.

## Execution environment and teardown

### Existing primitives are largely sufficient

The embedded environment already provides the primitives used by TimeContext:
setTimeout/clearTimeout, setImmediate/clearImmediate, microtasks/promises,
performance.now, the required AbortController/Event subset, crypto.randomUUID,
and TD-driven requestAnimationFrame/cancelAnimationFrame. Keep accurate types for
their actual supported subsets. Normal library imports do not require a different
scheduler or a TD-specific TimeContext implementation.

### Fresh environment is an implementation requirement, not just a new closure

Re-evaluating a bundle with new Function in the same global context is not a full
restart: old promises, timers, listeners, global mutations and native callbacks
may remain. Establish a real lifetime boundary that prevents old JS from running
after replacement and releases the objects retaining it.

Investigate two implementations:

1. Recreate the per-operator Runtime/isolate using the existing owner worker.
   Start with this as the simplest correctness baseline. Do not recreate the
   worker or shut down shared process-wide V8 infrastructure unnecessarily.
2. Recreate a context/realm and its native binding environment while retaining
   carefully separated host resources. Choose this only if the binding lifecycle
   is demonstrably safe and measured restart costs justify the complexity.

Dawn's napi_v8 environment, foreground task queues, promise callbacks, mapped GPU
buffers, renderer/text resources and Syphon objects all need explicit ownership.
Destroying a context alone does not prove old native callbacks can no longer run.
Do not retain JS wrapper handles into a destroyed context. A GPU device may be
retained only if ownership and fresh wrapper creation are supported and tested;
otherwise recreate it on explicit reload and measure the cost.

Teardown happens on the owning worker, never by deleting an isolate from the TD
cook/UI thread. Stop new work for the retiring lifetime, finish or safely retire
native in-flight operations, release references/resources in the correct order,
destroy the JS environment, then create and initialize the replacement.
Cancellation/retirement must not shut down other TOP/CHOP instances.

### Cancellation contract

Do not promise that arbitrary pending finally blocks, promise continuations or
TimeContext cancellation handlers run on a full reload. Clearing a timeout alone
does not reject a promise waiting on it. Fresh environment teardown is the hard
boundary, similar to discarding a worker or refreshing a page.

Existing onDispose callbacks may remain as a bounded, synchronous best-effort
convenience while their host resources are valid. Native resources must be cleaned
up even if those callbacks throw, loop, are absent, or the runtime is poisoned.
Do not require graceful library cancellation to make teardown safe. If a bounded
microtask drain is retained, document it as best effort, not guaranteed completion
of arbitrary asynchronous cleanup or external promises.

The current disposal sequence drains managed-root cancellation before user
onDispose callbacks. Do not assume registering task.cancel there guarantees that
its resulting asynchronous cleanup finishes before resource destruction.

Errors should remain ordinary JS errors: synchronous callback failures and true
unhandled rejections reach operator diagnostics. Errors explicitly handled inside
a library are not necessarily observable by the host. The current host.timing
wrapper supervises returned roots even when the library has its own rejection
handlers; do not claim identical supervision automatically survives normal imports.
Document explicit task.catch(...) where an application needs that supervision.

## Build versus activation state

Keep separate native state for:

- Selected source identity: TypeScript file/project entry, JS file, or DAT.
- Latest successful available bundle, its source identity and content hash.
- Active bundle/hash and runtime generation.
- A pending changed bundle and queued manual restart request.
- Build diagnostics versus runtime/activation diagnostics.

Do not overwrite the active source just because NativeBuild returns a new bundle.
Only the activation policy can advance the active version. Compare content hashes
so an identical rebuild does not automatically restart the sketch.

Successful build results may be shared between operators, but activation state and
Automatic Reload are per instance. One instance can stay on its old version while
another adopts a new build from the same shared compiler service.

### Controls

| Control | Intended behavior |
| --- | --- |
| Automatic Builds | Existing project/source build-watching behavior; preserve the shared-service semantics. |
| Build Script / Build Project | Request compilation. Does not force activation when Automatic Reload is off. Preserve current internal parameter identifiers where possible. |
| Automatic Reload | New per-instance toggle, default on for compatibility with existing save-to-restart behavior. Successful changed bundles activate at a safe execution boundary. |
| Reload | Restart using the latest successful available bundle for the selected source, even if unchanged. Does not implicitly require a new compilation. |
| Reset | Recommended distinction: restart the currently active bundle without adopting pending source. Preserve the parameter for saved-project compatibility and document this distinction. |

Recommended parameter identifier for the new toggle: Autoreload. Reuse the
existing Reload pulse parameter; do not add a second synonymous button.

Manual Reload is independent of Automatic Builds. If a build is still running,
Reload selects the latest successful version available when the request is
accepted, and reports its identity; it does not silently become a promise to
activate some later build. Users can Build, wait for Ready, then Reload. If no
successful version exists for that source, report that condition without tearing
down a working runtime. Do not silently load another entry's stale bundle.

In raw JS-file/DAT modes, the latest readable source is the candidate; syntax or
evaluation errors can occur at activation because there may be no compiler stage.
Avoid claiming compile-error retention for source modes without a corresponding
preflight compile step. File-read failures should leave the running version alone.

### Detailed activation behavior

- First load initializes the first successful source even when Automatic Reload
  is off. That toggle freezes an existing running version, not initial startup.
- Off -> on adopts the latest pending changed bundle once. On -> off prevents
  not-yet-started automatic activation; it cannot undo an activation already begun.
- With Automatic Reload off, source edits can build and update diagnostics while
  current JS state/timers continue. Expose Pending Reload when hashes differ.
- Compilation/type/shader failures do not retire the active runtime.
- When activation starts, retire the old runtime first. If evaluation/setup fails,
  leave the operator in a visible error state. Do not roll back to old execution
  or retry the same failing version on every cook. A changed bundle, Reload or
  Reset may start another attempt under the documented policy.
- Preserve the distinction between retaining a native last-output buffer and
  preserving a running sketch. Holding a last image/channel buffer while restarting
  is acceptable if compatible and explicitly reported; old JS must not keep running.
- Output schema changes and TOP resizes may require restart independent of source
  reload. Treat them as explicit structural changes; do not label them source edits.
  Never expose an old CHOP buffer using a new incompatible layout.

Source-selector changes must not make pending versions ambiguous. Recommended:
stage the new source behind the reload toggle while an instance is active, label
active versus selected source, and initialize normally if no active version exists.
Keep the old source's running state until a valid new activation is requested.

## Scheduling and existing execution modes

Reuse the existing worker submission/control mechanisms. A restart is an ordered
control operation, not a replaceable buffered input. Manual requests must not be
lost when ordinary frame requests coalesce. Define which queued pulse events belong
to the old/new generation and preserve their ordering; do not replay old-generation
events accidentally after restart.

Do not make a buffered cook block while destroying/recreating the runtime. Return
a compatible retained output or the documented empty output while the worker is
restarting. Blocking mode may wait for its ordered restart/current request, bounded
by existing failure handling. Pre-trigger mode must remain nonblocking.

For the first version, activation can remain at the next accepted execution/cook
boundary, as today. When playback is paused or an operator is not requested, display
Reload Pending honestly; do not promise a button restarts immediately unless the
implementation explicitly queues worker activation without a TD cook. Keep real-time
timers running independently until the old runtime is actually retired.

## API migration and documentation

- Remove blanket rejection of core-timing runtime imports; support its ordinary
  package entry through the normal bundler and checker resolution paths.
- Update templates and examples to normal imports. TD-specific setup/draw/onCook
  adapters retain host input/output APIs, not a required injected timing library.
- Treat host.timing as a compatibility question, not the architectural center.
  Prefer a clearly documented transitional alias if inexpensive. Do not add a
  complicated second managed scheduler solely to preserve the old wrapper shape.
  If compatibility would require that complexity, explicitly document/migrate the
  API rather than silently breaking saved examples.
- Keep emitted/public timing types aligned with the actual imported package and
  companion environment plan. Avoid duplicate nominal class identities from mixing
  source-side classes and a separately emitted declaration tree in one consumer.
- Update current native-build and TD guides, SDK snapshot/version, embedded CLI
  template and distributed prebuilts through the established release process.
- Document the three actions plainly: Build compiles, Reload adopts the latest
  successful source, Reset restarts the active source. State is reset on restart.

## Implementation order

1. Reinspect current main-thread APIs and tests. Record active/available source
   ownership, reset/reload ordering and runtime/native resource destruction paths.
2. Prototype fresh runtime restart in a headless native fixture using ordinary
   imported TimeContext. Prove no old JS/native callbacks survive before removing
   the existing generation protections.
3. Separate active/available source selection; add per-operator Automatic Reload
   and reliable manual controls for every existing source mode.
4. Remove the required host.timing integration from new sketch APIs/examples,
   retain generic runtime safeguards, and update the companion typing design.
5. Run native correctness/lifetime tests, then actual TD control/fixture tests.
   Package an openable example next to the integration source and update guides.

Likely integration points: native/embedded/Bridge.cpp, Runtime.cpp/Runtime.h,
ChopExchange.h, src/td-runtime.ts, src/td-chop-runtime.ts, src/td-timing.ts,
native/td/SketchTOP.cpp, SketchCHOP.cpp, NativeBuild.h, the native bundler/checker,
SDK preparation and existing TD fixtures. All paths are relative to
packages/native-webgpu except the tools/td-native-build components.

## Acceptance and performance checks

- The same imported animation module runs in the embedded native fixture and a
  browser/Node test environment with compatible standard primitives; no TD import
  or host.timing reference occurs inside the reusable module.
- Successful restart resets module variables and deliberately mutated user globals.
  Old timers, RAF subscriptions, listeners and retained async closures cannot
  publish or execute against the new runtime.
- Repeated restarts during timer waits, microtask activity and GPU work do not crash,
  leak monotonically, hang teardown or allow use of destroyed native resources.
  Test a poisoned/runtime-error state as well as a cooperative sketch.
- TimeContext logical conformance and independent timers while TD is paused remain
  correct. Frame waits retain their accepted-cook semantics.
- Auto-build on/auto-reload off: diagnostics update, old output/state/ticks continue,
  pending revision is visible, and manual Reload starts the new version once.
- Auto-build off/auto-reload on: no automatic compilation; an explicit successful
  build activates a changed bundle. Shared subscribers retain existing build rules.
- Manual Reload with unchanged bytes really restarts. Reset with a pending newer
  bundle restarts the active version. Two instances sharing a build can adopt it
  independently.
- Build failure does not disturb active execution. Runtime setup failure after a
  valid build stops old execution and produces an actionable error without an
  automatic retry loop or rollback.
- Source deletion/recreation, source-selector changes, rapid edits, builds completing
  while reload is queued, mode toggles, paused playback, pre-trigger operation,
  structural changes and queued pulses have deterministic documented outcomes.
- Measure restart latency and peak/steady memory for scalar CHOPs and four 1080p
  TOPs, including GPU device recreation if used. Report JS startup/resource costs
  separately from compilation. Warm steady-state cook performance should remain
  comparable; an occasional explicit restart cost is an acceptable tradeoff to
  measure, not a reason to quietly restore transactional state preservation.
- Store the actual TD .toe and reproduction scripts in the repository, as with
  the previous integration examples. Check types, source templates and shipped
  binaries agree on the new controls and lifecycle contract.

## Non-goals

State migration, state-preserving HMR, rollback after runtime initialization failure,
guaranteed asynchronous user cleanup, a new timing DSL, Node/browser API emulation
beyond the supported environment, worker sharing, and a generic security sandbox.

The implementation should favor a small, explicit runtime lifetime boundary over
library-specific machinery. Optimize restart cost only after correctness and
measurements, without compromising normal imports or TypeScript portability.
