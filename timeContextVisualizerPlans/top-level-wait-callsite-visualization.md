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
async function rootTimedProcess(ctx: TimeContext) {
  const mel1 = makeRandomMelody();
  const mel2 = makeRandomMelody();

  await playMelody(ctx, mel1);
  await ctx.wait(1);
  await playMelody(ctx, mel2);
}
```

Conceptual output:

```ts
async function rootTimedProcess(ctx: TimeContext) {
  const mel1 = makeRandomMelody();
  const mel2 = makeRandomMelody();

  await __avAwait("callsite_1", ctx, playMelody(ctx, mel1));
  await __avAwait("callsite_2", ctx, ctx.wait(1));
  await __avAwait("callsite_3", ctx, playMelody(ctx, mel2));
}
```

Runtime helper:

```ts
async function __avAwait<T>(
  id: string,
  ctx: TimeContext,
  promise: PromiseLike<T>,
): Promise<T> {
  const trace = traceFor(ctx);
  trace.enter(id);
  try {
    return await promise;
  } finally {
    trace.exit(id);
  }
}
```

This shape is acceptable for the first version because the main visualization
target is the top-level callsite. A thunk helper or inline `try/finally` would
enter before the called async function starts, which is better for precise
nested call-chain visualization, but that extra precision is not necessary for
the initial scope.

## Active Wait Store

A plain `Set<string>` is not robust enough because concurrent branches or
repeated helper calls can enter the same callsite more than once:

```ts
active.add(id);
active.add(id);
active.delete(id); // incorrectly appears inactive while one activation remains
```

Use a per-run count map instead:

```ts
class ActiveCallsiteCounts {
  private counts = new Map<string, number>();

  enter(id: string) {
    this.counts.set(id, (this.counts.get(id) ?? 0) + 1);
  }

  exit(id: string) {
    const next = (this.counts.get(id) ?? 0) - 1;
    if (next <= 0) this.counts.delete(id);
    else this.counts.set(id, next);
  }

  activeIds(): string[] {
    return [...this.counts.keys()];
  }
}
```

The editor does not need to know which branch or helper invocation produced the
wait. It only needs to know whether a source callsite has one or more active
waits underneath it.

## Stable IDs And Manifest

Each inserted wrapper needs a stable-ish callsite ID and a manifest entry:

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

IDs should be deterministic for a revision, preferably derived from:

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
export async function rootTimedProcess(ctx: TimeContext) {
  // user code
}
```

Initial transform scope:

- Walk the body of the root timed function.
- Find `AwaitExpression` nodes.
- If the awaited expression is a `CallExpression`, inspect it.
- Instrument the call if:
  - the callee is a known method on a value typed as `TimeContext`, or
  - one of the call arguments is typed as `TimeContext`.

Examples that should instrument:

```ts
await ctx.wait(1);
await ctx.waitSec(0.25);
await playMelody(ctx, melody);
await player.play(ctx, melody);
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

## Runtime Event Flow

The helper updates a per-run trace store keyed by `runId` or by root
`TimeContext`.

Conceptual event flow:

1. `__avAwait(id, ctx, promise)` calls `trace.enter(id)`.
2. Trace store increments the callsite count.
3. Runtime channel emits or schedules an active-ID snapshot.
4. Browser batches snapshots with `requestAnimationFrame`.
5. CodeMirror extension dispatches direct decoration effects for active IDs.
6. `finally` calls `trace.exit(id)` when the awaited promise settles.
7. The browser receives a later snapshot with that ID removed once its count
   reaches zero.

Events should include at least:

```ts
interface RuntimeWaitSnapshot {
  runId: string;
  revisionId: string;
  activeCallsiteIds: string[];
}
```

This prevents stale events from previous hot-reload revisions from decorating
the current editor document.

## Open Design Questions

- Should the first root convention be a fixed export name, a default export, or
  server-provided entrypoint metadata?
  - default export - eventually there will be an editor with multiple of these - the user will be able to launch them dynamically - the filenames can be different but the function name can be the same
- Should helper calls be instrumented only in the root function at first, or in
  any local function with a `TimeContext` parameter?
  - only calls actually written in the user-code from the specific module need to be instrumented - the context of this is a live-code editor for musical and graphics sequencing - each codemirror instance will visualze a separate module and only the code actually written in the custom editor eneds to be instrumented
- Should arbitrary awaited calls inside the root be ignored, warned, or treated
  as external waits?
  - they can be warned - in the context of the greater livecoding editor, they could even be detected and used to throw an error so the user has to fix it before the underlying system actually transforms and runs the code
- Should direct `ctx.wait(...)` calls be wrapped with `__avAwait`, or should
  the base `TimeContext` methods eventually accept optional visualization
  metadata?
  - the wrapper seems flexible enough to not have to modify the base TimeContext, and that seems preferrable as then the base library doesn't need to know about visualization
- Should the trace store be attached with a `WeakMap<TimeContext, TraceStore>`,
  explicit extra arguments, or a run-scoped singleton keyed by `runId`?
  - i'm not sure i understand this - i thought the trace store would just map the UUID of each unique  line to a count of how many promises are waiting at that line

## Current Recommendation

Start with the smallest architecture that matches the real use case:

1. Explicit root timed process function taking `ctx: TimeContext`.
2. Type-aware detection of awaited calls in that root body.
3. Wrap direct `TimeContext` waits and awaited calls that receive `ctx`.
4. Track active callsites with a per-run count map.
5. Emit active callsite snapshots to the browser.
6. Decorate CodeMirror using the manifest ranges and active IDs.

This keeps the transform close in spirit to the existing Acorn helper:

- find meaningful runtime source locations
- assign stable IDs
- rewrite those locations to report runtime state
- map runtime state back into CodeMirror

The major difference is that the new pass uses TypeScript type information to
find `TimeContext`-participating callsites instead of hard-coded string-pattern
matches like `line(...)`.
