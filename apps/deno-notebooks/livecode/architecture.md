# Time Context Visualizer Architecture And File Index

This is the quick entrypoint for agent chats about the local Deno livecoding
editor/runtime visualizer work. Start here before editing code.

## Agent Jumpstart

The project is a local-only browser CodeMirror editor connected to a local Deno
server/runtime.

Core constraints:

- Deno LSP and runtime visualization are separate systems.
- Deno LSP handles editor semantics: diagnostics, hover, completions,
  references.
- Runtime visualization handles transform diagnostics, generated runs, active
  wait snapshots, and CodeMirror wait decorations.
- User code is independent single-file livecode modules. The first convention is
  a default exported async function whose first parameter is a `TimeContext`.
- Only user-written code from the editor module is highlighted. Imported helper
  internals are not highlighted, but awaited helper calls that receive a
  `TimeContext` can be visualized at the callsite.
- The server analyzes/transforms/writes generated modules on edit, debounced in
  the browser. `Run` launches the latest matching prepared build and then Deno
  dynamically imports it.
- Dynamic import stays on `Run`, not edit, because importing evaluates module
  top-level code.
- Project-mode tldraw modules use `*.orig.ts` as canonical editable source and
  `*.ts` as transformed runtime output. The server can inspect current source
  in a shadow directory without mutating real runtime files or importing user
  code.
- Runtime launch is no-surprise: launching an already running module is rejected
  unless the caller explicitly passes `replaceRunning: true`.
- Active wait state is tracked by stable callsite UUIDs plus `moduleId`, with a
  count map so repeated/overlapping waits at the same callsite remain active
  until all outstanding waits finish.
- Unsupported detectable async patterns should error rather than silently
  produce misleading visualization.

For details, read these next:

- `system-plumbing-and-dependency-shape.md`: current architecture, dependency
  boundaries, server routes, generated module shape, and session files.
- `top-level-wait-callsite-visualization.md`: transform decisions and why the
  first implementation focuses on user-written top-level awaited callsites.
- `batched-runtime-editor-updates.md`: runtime snapshot cadence and CodeMirror
  decoration update strategy.
- `self-test-loop.md`: manual and automated verification workflow.

When resuming work, usually inspect these first:

```sh
sed -n '1,220p' timeContextVisualizerPlans/architecture.md
sed -n '1,260p' apps/deno-notebooks/livecode/visualizer/analyze_transform.ts
sed -n '1,220p' apps/deno-notebooks/livecode/visualizer/server.ts
sed -n '1,260p' apps/browser-projections/src/sketches/livecodeVisualizer/SketchWrapper.vue
```

## Current Shape

Manual development uses two local processes:

```sh
cd apps/deno-notebooks
deno run --unstable-webgpu --unstable-ffi --allow-all livecode/visualizer/main.ts --host localhost --port 7777 --log-level debug
```

```sh
cd apps/browser-projections
npm run dev
```

Open:

```txt
http://localhost:5173/livecodeVisualizer
```

The Deno server exposes:

```txt
GET  /health
GET  /lsp?session=<moduleOrEditorSessionId>
GET  /project/status
GET  /project/diagnostics
POST /runtime/analyze
POST /runtime/launch
POST /runtime/stop
GET  /runtime/snapshots
```

The browser page accepts an optional server override:

```txt
http://localhost:5173/livecodeVisualizer?serverBaseUrl=http://localhost:7777
```

## Runtime Flow

1. Browser editor changes.
2. `SketchWrapper.vue` schedules `/runtime/analyze` with a 100ms debounce.
3. Deno server writes the source module, runs the typed transform, writes a
   generated module, and returns a manifest plus generated module URI.
4. Browser caches the prepared build if it still matches current `sourceText`,
   `moduleId`, and server URL.
5. User hits `Run`.
6. Browser launches the cached prepared build, or analyzes immediately only if
   no current prepared build exists.
7. Server queues launch into the parent `TimeContext` loop, dynamically imports
   the generated module, and branches the default export.
8. Generated code calls `visualizedAwait(moduleId, callsiteId, promise)` around
   instrumented waits/helper awaits.
9. Runtime snapshots publish active callsite UUIDs at frame-ish cadence.
10. Browser batches snapshot handling through `requestAnimationFrame` and
    updates CodeMirror decorations directly.

## File Index

### Browser Editor

- `apps/browser-projections/src/sketches/livecodeVisualizer/SketchWrapper.vue`
  owns the CodeMirror UI, Deno LSP client, runtime HTTP/WebSocket client,
  edit-time analyze debounce, prepared-build cache, generated run history, wait
  decoration extension, snapshot batching, and test debug hooks.
- `apps/browser-projections/src/sketches/livecodeVisualizer/defaultSource.ts`
  contains the built-in example source shown when the editor loads. It currently
  exercises `midi-helpers`, `ctx.branch`, helper-defined waits, root waits, and
  Deno import-map resolution.
- `apps/browser-projections/src/router/index.ts` registers the
  `/livecodeVisualizer` sketch route.
- `apps/browser-projections/tests/livecodeVisualizer.e2e.mjs` starts the Deno
  server and Vite, drives the real browser page with Playwright, and verifies
  Deno LSP diagnostics/completions, prepared-build Run behavior, CodeMirror Tab
  indentation, runtime snapshots, wait highlighting, and transform errors.
- `apps/browser-projections/package.json` declares `@valtown/codemirror-ls`,
  CodeMirror packages, `playwright`, and the `test:livecode:e2e` npm script.

### Deno Server And Runtime

- `apps/deno-notebooks/livecode/visualizer/main.ts` is the CLI entrypoint for
  the local Deno visualizer server.
- `apps/deno-notebooks/livecode/visualizer/server.ts` owns HTTP/WebSocket
  routes, session directories, analysis/transform requests, generated module
  writes, dynamic imports, parent `TimeContext` launch queue, snapshot
  broadcasting, duration logging, and LSP WebSocket server setup.
- `apps/deno-notebooks/livecode/visualizer/lsp_proxy.ts` runs as the spawned LSP
  proxy process. It creates a real temp workspace, writes a normalized
  `deno.json`, mirrors editor documents into files, and runs `deno lsp -q`.
  These synthetic LSP workspaces live under
  `$TMPDIR/avtools-livecode-lsp-workspaces/...`, outside the repo, so Deno does
  not treat the repo root `deno.json` as the owning workspace and ignore the
  generated LSP config.
- `apps/deno-notebooks/livecode/visualizer/analyze_transform.ts` uses ts-morph
  and magic-string to find the default timed root, detect supported awaited
  wait/helper callsites, reject unsupported async patterns, wrap calls in
  `visualizedAwait`, and produce the source-range manifest.
- `apps/deno-notebooks/livecode/visualizer/project_shadow_analysis.ts` uses
  ts-morph to build the project module import graph, writes transformed current
  `*.orig.ts` source to a session-owned shadow runtime tree, runs `deno check`
  against that tree, and returns non-mutating dependency/typecheck diagnostics
  for `/project/diagnostics`.
- `apps/deno-notebooks/livecode/visualizer/runtime.ts` is the singleton runtime
  store used by generated modules. It tracks active wait counts by `moduleId`
  and callsite UUID and produces active wait snapshots.
- `apps/deno-notebooks/livecode/visualizer/protocol.ts` defines the shared
  request/response, diagnostic, manifest, launch, stop, health, and snapshot
  message shapes.
- `apps/deno-notebooks/livecode/visualizer/generated_run_id.ts` wraps generated
  run/build ID creation so UUIDs can later be replaced with a human-readable
  naming scheme.
- `apps/deno-notebooks/livecode/helpers/` contains local helper modules meant
  for livecode scripts, including the eager MIDI device wrapper exposed as
  `midi-helpers`.
- `apps/deno-notebooks/livecode/helpers/midi_helpers.ts` initializes MIDI
  outputs up front and exposes `midiDevices`, `getMidiDevice`,
  `requireMidiDevice`, `listMidiDevices`, and `closeMidiDevices`.
- `apps/deno-notebooks/deno.json` wires Deno imports and the livecode test
  tasks.
- `deno.json` at repo root also maps `midi-helpers` for repo-level Deno checks
  and LSP workspace config generation.

### Tests

- `apps/deno-notebooks/livecode/tests/analyzer_transform_test.ts` verifies the
  transform contract for linear waits, helper awaits, inline branch callbacks,
  and current transform-blocking diagnostics.
- `apps/deno-notebooks/livecode/tests/runtime_counts_test.ts` verifies the
  singleton active wait count map and `visualizedAwait` cleanup behavior.
- `apps/deno-notebooks/livecode/tests/dynamic_import_execution_test.ts` verifies
  generated module files can be imported and run with a real `TimeContext`.
- `apps/deno-notebooks/livecode/tests/protocol_smoke_test.ts` verifies health,
  analyze, launch, launch replacement refusal, snapshot, and stop over
  HTTP/WebSocket without a browser.
- `apps/deno-notebooks/livecode/tests/lsp_smoke_test.ts` verifies the `/lsp`
  bridge reaches real `deno lsp` diagnostics and that `@avtools/core-timing` and
  `midi-helpers` resolve for diagnostics, hover, and completion.
- `apps/deno-notebooks/livecode/tests/project_shadow_diagnostics_test.ts`
  verifies `/project/diagnostics`, dependency-aware staleness, dependency
  warnings, no-surprise launch refusal, and that shadow checks do not rewrite
  real runtime `.ts` files.
- `apps/deno-notebooks/livecode/tests/project_p5gpu_e2e_test.ts` verifies
  project modules share transformed files, a livecoded modifier mutates shared
  state seen by a p5gpu sketch, snapshot output is produced, and changing an
  unrelated modifier does not mark the running sketch stale.
- `apps/deno-notebooks/livecode/tests/server_smoke_test.ts` spawns the server
  CLI, parses `serverReady`, and checks the server responds.
- `apps/deno-notebooks/livecode/tests/default_source_integration_test.ts`
  verifies the built-in editor source type-checks with Deno, analyzes to the
  expected wait callsites, and initializes MIDI helpers.

### Planning Docs

- `timeContextVisualizerPlans/architecture.md` is this agent handoff and file
  index.
- `timeContextVisualizerPlans/system-plumbing-and-dependency-shape.md` is the
  fuller architecture/protocol/dependency plan.
- `timeContextVisualizerPlans/top-level-wait-callsite-visualization.md` records
  the transform design decisions and scope.
- `timeContextVisualizerPlans/batched-runtime-editor-updates.md` records the
  snapshot/decorator update strategy.
- `timeContextVisualizerPlans/self-test-loop.md` records manual and automated
  verification workflows and minimal fixture sources.

## Current Analyzer Scope

The first analyzer supports normal single-file livecoding usage:

- default exported async root function
- root `TimeContext` parameter
- direct awaited `ctx.wait...` calls
- awaited helper calls that receive the active context
- inline branch callbacks passed to `ctx.branch(...)` / `ctx.branchWait(...)`

Unsupported detectable patterns are errors for now:

- arbitrary awaited calls such as `await fetch(...)`
- split timed promises such as `const p = helper(ctx); await p`
- unawaited Promise-like calls that receive a `TimeContext`
- dynamic context method access such as `ctx[method](...)`

The implementation uses TypeScript/ts-morph, but it is not yet a full
symbol/alias-resolution engine.

## Verification Commands

From `apps/deno-notebooks`:

```sh
deno task test:livecode:unit
deno task test:livecode:server
deno task test:livecode:e2e
```

The browser E2E runner requires Node 20+ because the browser app uses Vite 7 and
Playwright.

Known broad check caveat: `npm run type-check` in `apps/browser-projections`
currently fails on unrelated repo-wide TypeScript issues outside the livecode
visualizer area. Prefer the livecode-specific Deno and E2E commands above for
this work unless you are intentionally fixing repo-wide type checking.
