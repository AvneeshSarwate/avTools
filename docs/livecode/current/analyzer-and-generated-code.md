# Current Analyzer and Generated Code

Status: checked against the analyzer and shadow-analysis modules in
`apps/deno-notebooks/livecode/visualizer/` and
`packages/livecode-protocol/analysis.ts` on 2026-08-24.

## Boundary

The analyzer transforms one user-authored TypeScript module into an executable
module plus a source-range manifest. It provides runtime observation, not full
typechecking or general async data-flow analysis. Project graph construction and
`deno check` belong to `project_shadow_analysis.ts`; LSP is independent editor
feedback.

Normal server paths require a default-exported async function declaration whose
first parameter's type text contains `TimeContext`. Named and anonymous
declarations work; default-exported arrow/function expressions do not. Even a
data-only project module currently needs a no-op timed root. An optional named
`stop()` export passes through for graceful lifecycle cleanup.

## Timed-scope model

The transform visits local functions, arrows, expressions, and methods with a
`TimeContext`-looking parameter, whether or not the default root can reach them.
Within those scopes it understands direct awaited context methods, directly
awaited helpers receiving the context identifier, `ctx.branch`, and inline
branch callbacks with their own context parameter.

Recognition is intentionally syntactic:

- the type is detected by `TimeContext` text;
- the receiver/argument must be the direct context identifier;
- aliases, destructuring, bound methods, property-held contexts, transitive
  calls, arbitrary receiver expressions, and re-export chains are not followed.

Detectable timed patterns that cannot be visualized honestly are diagnostics,
including arbitrary awaits, unawaited timed/Promise-like calls, dynamic context
access, and branch callbacks without a context parameter. Parser errors are
reported before root-shape errors so an incomplete edit is not misdiagnosed.
`analyzer_transform_test.ts` is the executable list of accepted/rejected cases.

## Instrumentation and observations

| Manifest kind | Detection scope | Generated edit | Runtime meaning |
| --- | --- | --- | --- |
| timed method/helper | timed scopes | wraps the pending promise | Count of currently pending activations for the source callsite. |
| piano-roll lookup | timed scopes, recognized symbol/import | wraps the name argument | Latest resolved string name for editor/view linking. |
| `canvasParams` | whole file, recognized helper import | none | Static declaration location/name for a params-view widget. |
| `animationTimeline` | whole file, recognized helper import | none | Static declaration location/name for an animation-view widget. |
| `signal` | whole file, recognized helper import | wraps the whole call | Attributes the returned signal handle to the executing module so its end follows the run. |

Recognized helpers are matched through direct named/aliased or namespace import
bindings from the configured aliases/source files. A same-named local or
unrelated import does not match. The name-carrying entries record the name
argument range and a `staticName` only for a string literal or uninterpolated
template. Params, animation, and signal declarations have no runtime
name-resolution channel, so computed names have no inline widget.

A wait wrapper increments only after the original call expression has produced
its promise; its marker means “promise pending,” not “callee entered.” Counts,
not booleans, preserve concurrent activations. A piano-roll wrapper returns its
argument unchanged and records only strings. A signal wrapper returns any value
unchanged and structurally stamps actual signal handles; untransformed headless
runs therefore still work, but their signals remain unowned and do not auto-end.

## Manifest and generated-module invariants

The manifest types live once in `packages/livecode-protocol/analysis.ts`.
Offsets refer to analyzer input before edits. Callsite IDs are random and stable
only for one generated-code/manifest pair; never persist them across analysis.
Project shadow import rewriting can move positions before instrumentation, and
there is no source-map reversal for later Deno diagnostics.

The transform normalizes the default function to a `runFunc` binding and
re-exports it as default while preserving recursive references. A conflicting
top-level binding blocks the transform instead of emitting ambiguous code.

When any callsite actually needs a wrapper, one generated import names every
runtime helper the transform may emit. Observation-only params/animation
entries must not cause that import. The runtime URL must be stable across every
generated module so counts, lookups, signal ownership, and root-clock state meet
the same singleton.

Changing a manifest kind is cross-boundary work: update the shared union, the
transform, the generated helper import if applicable, engine runtime/sync state
if applicable, and the client's decoration/view logic. A new detector should
reuse the binding-resolution machinery rather than add another hand-copied
specifier branch.

## Typechecking boundary

The per-module ts-morph project is not the repository graph. Transient analysis
may succeed and dynamic import may still fail. Project-mode Run separately
requires a successful shadow `deno check` in the client; direct
`/runtime/launch` bypasses it. Browser-target checking also currently accepts a
wider import map than the browser engine can actually serve; see
`known-risks.md`.
