# Time Context Visualizer Architecture

This is the quick entrypoint for the local Deno livecoding editor/runtime
visualizer work.

For details, read these next:

- `system-plumbing-and-dependency-shape.md`: current architecture, dependency
  boundaries, server routes, generated module shape, and session files.
- `top-level-wait-callsite-visualization.md`: transform decisions and why the
  first implementation focuses on user-written top-level awaited callsites.
- `batched-runtime-editor-updates.md`: runtime snapshot cadence and CodeMirror
  decoration update strategy.
- `self-test-loop.md`: manual and automated verification workflow.

## Current Shape

Manual development uses two local processes:

```sh
cd apps/deno-notebooks
deno run --allow-all livecode_visualizer/main.ts --host 127.0.0.1 --port 7777 --log-level debug
```

```sh
cd apps/browser-projections
npm run dev
```

Open:

```txt
http://127.0.0.1:5173/livecodeVisualizer
```

The Deno server exposes:

```txt
GET  /health
GET  /lsp?session=<moduleOrEditorSessionId>
POST /runtime/analyze
POST /runtime/launch
POST /runtime/stop
GET  /runtime/snapshots
```

LSP and runtime visualization are separate channels. LSP is for Deno editor
semantics; runtime visualization is for transform diagnostics, generated runs,
active wait snapshots, and CodeMirror wait decorations.

## Important Files

### Browser

- `apps/browser-projections/src/sketches/livecodeVisualizer/SketchWrapper.vue`
  owns the first CodeMirror UI, Deno LSP client, runtime HTTP/WebSocket client,
  manifest cache, generated run history, wait decoration extension, and test
  debug hooks.
- `apps/browser-projections/src/router/index.ts` registers the
  `/livecodeVisualizer` sketch route.
- `apps/browser-projections/tests/livecodeVisualizer.e2e.mjs` starts the Deno
  server and Vite, drives the real browser page, and verifies several runtime
  visualization cases end to end.
- `apps/browser-projections/package.json` declares `@valtown/codemirror-ls`,
  `playwright`, and the `test:livecode:e2e` npm script.

### Deno Server And Runtime

- `apps/deno-notebooks/livecode_visualizer/main.ts` is the CLI entrypoint for
  the local Deno visualizer server.
- `apps/deno-notebooks/livecode_visualizer/server.ts` owns HTTP/WebSocket
  routes, session directories, analysis/transform requests, generated module
  writes, dynamic imports, parent `TimeContext` launch queue, snapshot
  broadcasting, and LSP WebSocket server setup.
- `apps/deno-notebooks/livecode_visualizer/lsp_proxy.ts` runs as the spawned
  LSP proxy process. It creates a real temp workspace, writes a normalized
  `deno.json`, mirrors editor documents into files, and runs `deno lsp -q`.
- `apps/deno-notebooks/livecode_visualizer/analyze_transform.ts` uses
  ts-morph and magic-string to find the default timed root, detect supported
  awaited wait/helper callsites, reject unsupported async patterns, wrap calls
  in `visualizedAwait`, and produce the manifest.
- `apps/deno-notebooks/livecode_visualizer/runtime.ts` is the singleton
  runtime store used by generated modules. It tracks active wait counts by
  `moduleId` and callsite UUID and produces active wait snapshots.
- `apps/deno-notebooks/livecode_visualizer/protocol.ts` defines the shared
  request/response, diagnostic, manifest, launch, stop, health, and snapshot
  message shapes.
- `apps/deno-notebooks/livecode_visualizer/generated_run_id.ts` wraps generated
  run/build ID creation so UUIDs can later be replaced with a human-readable
  naming scheme.
- `apps/deno-notebooks/deno.json` wires Deno imports and the livecode test
  tasks.

### Tests

- `apps/deno-notebooks/livecode_visualizer_tests/analyzer_transform_test.ts`
  verifies the transform contract for linear waits, helper awaits, inline
  branch callbacks, and current transform-blocking diagnostics.
- `apps/deno-notebooks/livecode_visualizer_tests/runtime_counts_test.ts`
  verifies the singleton active wait count map and `visualizedAwait` cleanup
  behavior.
- `apps/deno-notebooks/livecode_visualizer_tests/dynamic_import_execution_test.ts`
  verifies generated module files can be imported and run with a real
  `TimeContext`.
- `apps/deno-notebooks/livecode_visualizer_tests/protocol_smoke_test.ts`
  verifies health, analyze, launch, snapshot, and stop over HTTP/WebSocket
  without a browser.
- `apps/deno-notebooks/livecode_visualizer_tests/lsp_smoke_test.ts` verifies
  the `/lsp` bridge reaches real `deno lsp` diagnostics.
- `apps/deno-notebooks/livecode_visualizer_tests/server_smoke_test.ts` spawns
  the server CLI, parses `serverReady`, and checks the server responds.

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

The browser E2E runner requires Node 20+ because the browser app uses Vite 7
and Playwright.
