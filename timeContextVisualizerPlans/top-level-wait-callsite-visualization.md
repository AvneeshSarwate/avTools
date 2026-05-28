# Top-Level Wait Callsite Visualization Plan

## Context

The initial design question was whether the runtime visualizer needed a full
transitive timed-function analysis pass:

- Detect functions that directly call `ctx.wait`, `ctx.waitSec`, `ctx.waitFrame`,
  `ctx.branch`, or `ctx.branchWait`.
- Build a call graph.
- Mark any caller of those functions as part of the timed flow.
- Use those results to decide where to insert runtime visualization hooks.

That approach is still useful for diagnostics and deeper visualization, but it
is heavier than the first use case requires.

The primary use case is a single user-authored module that launches one timed
process from a root function taking a `TimeContext`. The user mostly writes a
linear top-level structure directly inside that root process:

```ts
import { makeRandomMelody, playMelody } from "@helpers/melodyGenerators.ts";
import type { TimeContext } from "@avtools/core-timing";

async function rootTimedProcess(ctx: TimeContext) {
  const mel1 = makeRandomMelody();
  const mel2 = makeRandomMelody();

  await playMelody(ctx, mel1);
  await ctx.wait(1);
  await playMelody(ctx, mel2);
}
```

The important visualization target is not necessarily every internal wait
inside `playMelody`. The main goal is to show that the source-level callsite
`await playMelody(ctx, mel1)` is currently waiting somewhere underneath.

## Agreed Reframe

The first transform does not need full transitive timed-function detection.
It can instead perform timed callsite detection.

Supported rule:

> Inside a timed process function, instrument awaited call expressions where
> the call either targets a known `TimeContext` method or receives a value typed
> as `TimeContext` as one of its arguments.

This handles top-level abstractions naturally:

```ts
await playMelody(ctx, mel1);
await ctx.wait(1);
await player.play(ctx, mel2);
```

The visual semantics become:

> This source callsite is active while the promise returned by this awaited call
> is pending.

That is enough to visualize high-level helper calls like `playMelody(ctx, data)`
without needing to prove that `playMelody` transitively calls `ctx.wait`.

## Transform Shape

Input:

```ts
export default async function(ctx: TimeContext) {
  const mel1 = makeRandomMelody();
  const mel2 = makeRandomMelody();

  await playMelody(ctx, mel1);
  await ctx.wait(1);
  await playMelody(ctx, mel2);
}
```

Conceptual output:

```ts
import { visualizedAwait } from "./timeContextVisualizerRuntime.ts";

export default async function(ctx: TimeContext) {
  const mel1 = makeRandomMelody();
  const mel2 = makeRandomMelody();

  await visualizedAwait("module_1", "callsite_1", playMelody(ctx, mel1));
  await visualizedAwait("module_1", "callsite_2", ctx.wait(1));
  await visualizedAwait("module_1", "callsite_3", playMelody(ctx, mel2));
}
```

Runtime helper:

```ts
async function visualizedAwait<T>(
  moduleId: string,
  id: string,
  promise: PromiseLike<T>,
): Promise<T> {
  enterWait(moduleId, id);
  try {
    return await promise;
  } finally {
    exitWait(moduleId, id);
  }
}
```

This shape is acceptable for the first version because the main visualization
target is the top-level callsite. A thunk helper or inline `try/finally` would
enter before the called async function starts, which is better for precise
nested call-chain visualization, but that extra precision is not necessary for
the initial scope. In this first transform shape, the original call expression
begins evaluating before `visualizedAwait` increments the count map. That is an
intentional tradeoff for a simpler transform and is acceptable because the
marker is intended to show that the top-level awaited callsite is currently
pending, not to reconstruct exact nested call ordering.

## Active Wait Store

A plain `Set<string>` is not robust enough because concurrent branches or
repeated helper calls can enter the same callsite more than once:

```ts
active.add(id);
active.add(id);
active.delete(id); // incorrectly appears inactive while one activation remains
```

Use a count map instead:

```ts
class ActiveCallsiteCounts {
  private counts = new Map<string, Map<string, number>>();

  enter(moduleId: string, id: string) {
    const moduleCounts = this.counts.get(moduleId) ?? new Map<string, number>();
    moduleCounts.set(id, (moduleCounts.get(id) ?? 0) + 1);
    this.counts.set(moduleId, moduleCounts);
  }

  exit(moduleId: string, id: string) {
    const moduleCounts = this.counts.get(moduleId);
    if (!moduleCounts) return;

    const next = (moduleCounts.get(id) ?? 0) - 1;
    if (next <= 0) moduleCounts.delete(id);
    else moduleCounts.set(id, next);

    if (moduleCounts.size === 0) this.counts.delete(moduleId);
  }

  activeByModule(): Record<string, string[]> {
    return Object.fromEntries(
      [...this.counts].map(([moduleId, moduleCounts]) => [
        moduleId,
        [...moduleCounts.keys()],
      ]),
    );
  }
}
```

The editor does not need to know which branch or helper invocation produced the
wait. It only needs to know whether a source callsite has one or more active
waits underneath it.

For the first implementation, the count map can live in a singleton runtime
module imported by generated code. The Deno server is the runtime process, there
is no hot-reload requirement in this design pass, and generated callsite UUIDs
are expected to be unique.

Example singleton runtime module:

```ts
const activeWaitCounts = new Map<string, Map<string, number>>();

export function enterWait(moduleId: string, id: string) {
  const moduleCounts = activeWaitCounts.get(moduleId) ?? new Map<string, number>();
  moduleCounts.set(id, (moduleCounts.get(id) ?? 0) + 1);
  activeWaitCounts.set(moduleId, moduleCounts);
  publishSnapshot();
}

export function exitWait(moduleId: string, id: string) {
  const moduleCounts = activeWaitCounts.get(moduleId);
  if (!moduleCounts) return;
  const next = (moduleCounts.get(id) ?? 0) - 1;
  if (next <= 0) moduleCounts.delete(id);
  else moduleCounts.set(id, next);
  if (moduleCounts.size === 0) activeWaitCounts.delete(moduleId);
  publishSnapshot();
}

export async function visualizedAwait<T>(
  moduleId: string,
  id: string,
  promise: PromiseLike<T>,
): Promise<T> {
  enterWait(moduleId, id);
  try {
    return await promise;
  } finally {
    exitWait(moduleId, id);
  }
}

export function getActiveWaitsByModule() {
  return Object.fromEntries(
    [...activeWaitCounts].map(([moduleId, counts]) => [moduleId, [...counts.keys()]]),
  );
}
```

Generated code can then import the helper directly:

```ts
import { visualizedAwait } from "./timeContextVisualizerRuntime.ts";

export default async function(ctx: TimeContext) {
  await visualizedAwait("module_1", "uid_1", playMelody(ctx, mel1));
  await visualizedAwait("module_1", "uid_2", ctx.wait(1));
}
```

`moduleId` is part of the first protocol so multiple editor modules can be
routed cleanly later.

## Stable IDs And Manifest

Each inserted wrapper needs a callsite ID and a manifest entry:

```ts
interface WaitCallsiteManifestEntry {
  id: string;
  sourceUri: string;
  range: {
    from: number;
    to: number;
  };
  kind: "timeContextMethod" | "timeContextArgumentCall";
  displayName: string;
}
```

For the initial implementation, generated UUIDs are sufficient for runtime
tracking. The transformed code and manifest are produced together, so the
runtime only needs to report the UUIDs that the current manifest already knows
how to map back to source.

The manifest is still required because the browser needs to know which source
range each generated UUID belongs to.

IDs can become deterministic later if preserving marker identity across edits,
debugging transformed output, or comparing revisions becomes important. A
future deterministic ID can be derived from:

- source file identity
- original source range
- normalized callee text
- occurrence index as a tie breaker

The browser should use manifest ranges directly for CodeMirror decorations.
Sourcemaps can still be generated for debugging transformed code, but the
runtime visualization path should not depend on sourcemaps.

## Detection Scope

Initial supported root convention:

```ts
export default async function(ctx: TimeContext) {
  // user code
}
```

Use a default export rather than a fixed function name. Eventually the editor
will have multiple CodeMirror instances, each representing a separate timed
module. The filenames/module identities can differ while the exported function
shape stays consistent.

Initial transform scope:

- Walk the body of the default-exported timed function.
- Find `AwaitExpression` nodes.
- If the awaited expression is a `CallExpression`, inspect it.
- Instrument the call if:
  - the callee is a known method on a value typed as `TimeContext`, or
  - one of the call arguments is typed as `TimeContext`.
- Also walk inline callbacks passed to allowed branch APIs such as
  `ctx.branch(...)` and `ctx.branchWait(...)`.

Only calls actually written in the user-edited module need to be instrumented.
This is a livecoding editor for musical and graphics sequencing, and each
CodeMirror instance visualizes the code in one specific module. Imported helper
libraries may contain waits internally, but the first visualization pass only
needs to mark the user-authored awaited callsites in the active editor module.

Examples that should instrument:

```ts
await ctx.wait(1);
await ctx.waitSec(0.25);
await playMelody(ctx, melody);
await player.play(ctx, melody);

ctx.branch(async (branchCtx) => {
  await playMelody(branchCtx, melody);
});
```

Examples that can remain unsupported or diagnostic-only:

```ts
const sleep = ctx.waitSec.bind(ctx);
await sleep(1);

const method = "waitSec";
await ctx[method](1);

const { waitSec } = ctx;
await waitSec(1);
```

Aggressive mangling of the `ctx` instance is considered user error. The
analysis only needs to be robust under normal usage.

Detectable unsupported async patterns inside the default exported timed process
should be hard errors for now. The expected authoring style is happy-path,
direct code in the live editor, and the transform should fail clearly instead
of silently producing misleading visualization.

Errors should include:

- arbitrary awaited calls that do not target a `TimeContext` method and do not
  receive a `TimeContext` argument
- split promise usage where a timed helper is called first and awaited later
- unawaited Promise-like calls that receive a `TimeContext`, unless they are
  allowed branch APIs such as `ctx.branch(...)`

Examples that should error:

```ts
await fetch(url);

const p = playMelody(ctx, melody);
await p;

playMelody(ctx, melody);
```

## Relationship To Transitive Analysis

Transitive timed-function detection is no longer the core mechanism for the
first visualization pass.

It remains useful later for:

- diagnostics for unresolved calls inside timed code
- detecting unsupported arbitrary awaits
- richer nested call-chain visualization
- optional instrumentation inside local helper functions
- explaining why a helper participates in logical-time scheduling

But for the initial runtime visualization, top-level awaited callsite wrapping
is simpler and matches the desired user experience better.

Imported helpers are intentionally opaque in this model. For example,
`await playMelody(ctx, melody)` highlights the callsite written in the custom
editor module. The transform does not need to inspect or instrument the
internal waits inside `playMelody`.

## Runtime Event Flow

The helper updates the singleton visualizer runtime module's count map.

Conceptual event flow:

1. Generated code imports `visualizedAwait`.
2. `visualizedAwait(moduleId, id, promise)` increments the singleton count map.
3. The singleton emits or schedules an active-ID snapshot.
4. Browser batches snapshots with `requestAnimationFrame`.
5. CodeMirror extension dispatches direct decoration effects for active IDs.
6. `finally` decrements the singleton count map when the promise settles.
7. The browser receives a later snapshot with that ID removed once its count
   reaches zero.

Events should include at least:

```ts
interface RuntimeWaitSnapshot {
  modules: Record<string, string[]>;
}
```

Each key is a `moduleId`; each value is the active callsite UUIDs for that
module.

## Open Design Questions

- Whether imported helper calls should ever be instrumented by transforming
  helper modules, or whether the visualizer should stay focused on user-edited
  module source only.

## Current Recommendation

Start with the smallest architecture that matches the real use case:

1. Default-exported root timed process function taking `ctx: TimeContext`.
2. Type-aware detection of awaited calls in that root body.
3. Wrap direct `TimeContext` waits and awaited calls that receive `ctx`.
4. Transform inline `ctx.branch(...)` and `ctx.branchWait(...)` callbacks so
   awaited calls inside branch bodies are highlighted too.
5. Treat detectable unsupported async patterns as transform-blocking errors.
6. Track active callsites with a singleton count map in the visualizer runtime
   module, keyed by `moduleId` and callsite UUID.
7. Emit active callsite snapshots to the browser.
8. Decorate CodeMirror using the manifest ranges and active IDs.

This keeps the transform close in spirit to the existing Acorn helper:

- find meaningful runtime source locations
- assign stable IDs
- rewrite those locations to report runtime state
- map runtime state back into CodeMirror

The major difference is that the new pass uses TypeScript type information to
find `TimeContext`-participating callsites instead of hard-coded string-pattern
matches like `line(...)`.
