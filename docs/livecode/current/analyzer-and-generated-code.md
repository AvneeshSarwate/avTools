# Current Analyzer and Generated Code

Status: checked against `visualizer/analyze_transform.ts` on 2026-07-21.

## Purpose and boundary

The analyzer transforms one user-authored TypeScript module at a time. It is
responsible for source-anchored runtime observation, not full project
typechecking or arbitrary async-program understanding.

It uses ts-morph for the AST, symbols, and selected type queries, and
magic-string for offset-preserving text edits. Project-wide import graph and
`deno check` behavior are owned by `project_shadow_analysis.ts`.

## Required root shape

Normal runtime/project analysis requires a default-exported async **function
declaration** whose first parameter's written/inferred type text contains the
word `TimeContext`:

```ts
export default async function (ctx: TimeContext) {
  // ...
}
```

Named default functions are accepted. Default-exported arrow/function
expressions are not found by the current root finder. Every project module,
including data-only modules, currently needs this root; a no-op root is valid.

An optional named export `stop()` is preserved untouched for server cleanup.

The analysis helper has `requireDefaultTimedRoot: false`, but server runtime and
project paths pass `true`.

## What is instrumented

The analyzer discovers every local function, arrow function, function
expression, and method whose parameters include a `TimeContext`-looking type.
It processes each such body once, whether or not it is reachable from the
default root. This means local helper internals are instrumented in addition to
root callsites.

Inside those scopes it supports:

- directly awaited `ctx.wait`, `ctx.waitSec`, `ctx.waitFrame`, and
  `ctx.branchWait` calls;
- directly awaited calls with one of the current scope's context identifiers as
  a direct argument;
- unawaited `ctx.branch(...)`;
- inline arrow/function callbacks passed directly to `ctx.branch` or
  `ctx.branchWait`, provided the callback declares a first parameter;
- recognized piano-roll access calls anywhere in a processed body, including
  nested inside an awaited expression.

Context recognition for wait/helper analysis is primarily syntactic:

- a parameter is considered a context when its type text matches
  `/\bTimeContext\b/`;
- a method call receiver must be a direct context identifier;
- a helper argument must be that direct identifier;
- aliases, destructuring, bound methods, properties containing a context, and
  transitive call analysis are not supported.

Do not describe this part of the analyzer as fully type-safe or a complete
symbol-flow engine. ts-morph's return type is used to decide whether an
unawaited helper call looks Promise-like, but context flow is name/syntax based.

## Unsupported timed patterns

The transform deliberately blocks detectable patterns it cannot visualize
accurately:

- `await` of a non-call expression;
- arbitrary awaited calls that are neither a recognized direct context method
  nor passed a direct context identifier;
- a direct recognized context method that is not awaited (except `branch`);
- a Promise-like helper called with a context but not directly awaited;
- dynamic context access such as `ctx[method](...)`;
- inline branch callbacks with no context parameter.

Representative diagnostics are:

- `TCV_SYNTAX_ERROR`
- `TCV_NO_DEFAULT_TIMED_ROOT`
- `TCV_UNSUPPORTED_AWAIT`
- `TCV_UNAWAITED_TIMED_CALL`
- `TCV_DYNAMIC_TIME_CONTEXT_CALL`
- `TCV_BRANCH_CALLBACK_CTX`
- `TCV_DEFAULT_EXPORT_RENAME_COLLISION`

The analyzer checks parser diagnostics before looking for the root so incomplete
mid-edit syntax does not degrade into a misleading “no root” error.

## Wait instrumentation

Given:

```ts
await play(ctx);
await ctx.waitSec(0.2);
```

the generated code is conceptually:

```ts
await __tcvVisualizedAwait(moduleId, callsiteIdA, play(ctx));
await __tcvVisualizedAwait(moduleId, callsiteIdB, ctx.waitSec(0.2));
```

The original call expression starts evaluating before `visualizedAwait`
increments the count. The marker therefore means “the returned promise is
currently pending,” not “execution entered before any callee evaluation.”

The runtime uses counts, not booleans, so concurrent activations of the same
source callsite remain active until every pending promise settles.

## Piano-roll detection

Recognized imported names are:

- `getPianoRollClip`
- `setPianoRollClip`
- `getPianoRoll`
- `setPianoRoll`

Recognized sources are the aliases `piano-roll-helpers` and
`piano-roll-store`, the two repository source suffixes, or the corresponding
bare source basenames.

Named imports (including aliases) and namespace imports are matched through
their local ts-morph symbols, so a same-named local function or unrelated import
is ignored. Re-export chains and arbitrary receiver expressions are not traced.

The first argument is treated as the roll name. The analyzer wraps only that
argument:

```ts
getPianoRollClip(
  __tcvPianoRollLookup(moduleId, callsiteId, expression),
)
```

The wrapper records the value only when it is a string and returns every value
unchanged. The manifest includes the full call range, the argument range, and a
`staticName` only for string literals or template literals without
interpolation.

## Manifest contract

Each entry contains:

```ts
{
  id: string;
  moduleId: string;
  sourceUri: string;
  range: { from: number; to: number };
  kind:
    | "timeContextMethod"
    | "timeContextArgumentCall"
    | "pianoRollLookup";
  displayName: string;
  nameArgRange?: { from: number; to: number };
  staticName?: string;
}
```

Default IDs are `crypto.randomUUID()`. They are stable only within the generated
code + manifest pair. They are not deterministic across reanalysis, even when
source text is unchanged. Tests inject deterministic factories where useful.

Manifest offsets refer to the analyzer input before instrumentation. For normal
modules that is the editor source. In project shadow diagnostics, external
relative imports may be rewritten before this transform, so later offsets/line
numbers can diverge from the original `*.orig.ts` file.

## Default-export normalization

The generated execution module exports `runFunc`:

- `export default` on the declaration becomes `export`;
- an anonymous function receives the name `runFunc`;
- a named function is renamed to `runFunc`;
- if the original name differs, `const <oldName> = runFunc` is appended after
  the declaration to preserve recursive self-references;
- `export default runFunc` is appended at the end.

A conflicting top-level binding/import with the old function name blocks the
transform rather than emitting invalid code.

When at least one callsite is instrumented, one generated import aliases both
runtime helpers:

```ts
import {
  visualizedAwait as __tcvVisualizedAwait,
  visualizedPianoRollLookup as __tcvPianoRollLookup,
} from "<stable runtime.ts URL>";
```

The stable runtime URL is essential: every generated run must share the same
process-global count and lookup maps.

## Typechecking boundary

The per-module transform is not a full correctness check. It creates an
isolated ts-morph project without loading the repository project graph. A
successful transient analysis can still fail at dynamic import or execution.
Deno LSP provides editor feedback but does not gate launch.

Project-mode Run in the tldraw client separately requires a successful shadow
`deno check`. Direct callers of `/runtime/launch` can bypass that client guard.

## Tests that define current scope

`apps/deno-notebooks/livecode/tests/analyzer_transform_test.ts` is the primary
executable contract. It covers local helper internals, branch callbacks,
unsupported awaits, syntax positions, recursive rename collision, piano-roll
aliases/namespaces/shadowing, and nested lookups.

`runtime_counts_test.ts` covers wait counts and lookup recording.
`dynamic_import_execution_test.ts` proves generated code imports the stable
runtime singleton and reports active IDs.
