# System Plumbing And Dependency Shape

## Purpose

This document describes the basic system shape for the local Deno livecoding
editor and runtime visualizer. It is intentionally focused on the important
dependencies and plumbing boundaries, not on every incidental package in the
repo.

The target system is:

- browser CodeMirror editor
- local Deno server
- real Deno LSP over WebSocket
- typed wait-callsite analysis/transform
- dynamic module execution in Deno
- runtime wait snapshots streamed back to CodeMirror

## Important Dependencies

### Deno

Deno is the local server and execution runtime.

Responsibilities:

- host WebSocket endpoints
- spawn or proxy `deno lsp`
- write user/transformed modules to local session files
- dynamically import transformed modules
- execute the default exported timed process
- stream runtime visualization snapshots

The current implementation does not serve the browser app from the Deno runtime
server. Manual and automated runs use two local processes:

- Vite serves the browser app from `apps/browser-projections`.
- The Deno server exposes LSP/runtime HTTP and WebSocket endpoints from
  `apps/deno-notebooks`.

The Deno language server is a normal LSP process. The official docs describe
`deno lsp` as communicating over stdin/stdout using the Language Server
Protocol.

Relevant design implication:

- LSP and runtime execution should be separate channels.
- The LSP should see real files and a real `deno.json` context where possible.
- Dynamic imports should use file URLs for transformed modules.
- The first local server can run with broad Deno permissions, effectively
  `--allow-all`, because this is a local-only trusted tool.
- If the same generated file URL is imported repeatedly, Deno module caching
  becomes relevant. The implementation should write each generated execution
  revision to a unique path or use an explicit revisioned specifier if rerunning
  changed source.

### `@avtools/core-timing`

This is the local timing library and semantic center of the project.

Relevant API:

- `TimeContext`
- `ctx.wait(...)`
- `ctx.waitSec(...)`
- `ctx.waitFrame(...)`
- `ctx.branch(...)`
- `ctx.branchWait(...)`
- offline and realtime scheduling behavior in `offline_time_context.ts`

The visualizer should not require changes to the base timing library in the
first implementation. Direct waits and helper calls should be wrapped by
generated code using visualizer runtime helpers.

### TypeScript And `ts-morph`

`ts-morph` is used only on the server side for typed source analysis. It is not
the runtime scheduler and does not need to understand arbitrary library
semantics.

Responsibilities:

- parse the user-edited module
- find the default exported timed process
- verify the root parameter is a `TimeContext`
- inspect `AwaitExpression` and `CallExpression` nodes
- identify direct `TimeContext` method calls
- identify awaited calls that receive a `TimeContext` argument
- walk inline callbacks passed to `ctx.branch(...)` / `ctx.branchWait(...)`
- produce transform-blocking diagnostics for unsupported async patterns

Current implementation limit:

- The analyzer supports the normal first-pass style: a default exported async
  root function with a `TimeContext` parameter, direct `ctx.wait...` calls,
  awaited calls that receive that context, and inline branch callbacks.
- It uses TypeScript/ts-morph for parsing, types, and Promise-like return
  checks, but it is not yet a full symbol/alias-resolution engine.
- Aggressive context aliasing, dynamic method access, split promises, and
  arbitrary awaited calls are treated as unsupported and should fail with
  transform diagnostics rather than silently producing partial visualization.

The important type-checker operations are resolving types and signatures for
call-like expressions. The ts-morph docs expose the project type checker via
`project.getTypeChecker()` and resolved signatures with
`typeChecker.getResolvedSignature(...)`.

Dependency note:

- The current repo already has `ts-morph` in `apps/browser-projections`.
- Use standard explicit package pins in the Deno import map or package boundary
  for the analyzer, for example `npm:ts-morph@...` and `npm:typescript@...`.
- The project does not need unusual TypeScript behavior, so current stable
  versions are fine. Pin them so analyzer behavior is reproducible, and update
  them normally when needed.
- The analysis project must resolve `@avtools/core-timing` consistently with the
  session's Deno imports.

### `magic-string`

`magic-string` should handle source-preserving rewrites.

Responsibilities:

- add the visualizer runtime import
- wrap supported awaited call expressions
- preserve the user's formatting as much as possible
- optionally generate sourcemaps for transformed runtime modules

The manifest remains the primary runtime-to-editor mapping. Sourcemaps are
useful for debugging transformed code, but CodeMirror visualization should use
manifest ranges directly.

### CodeMirror 6

CodeMirror is the browser editor and visualization surface.

Responsibilities:

- TypeScript syntax mode
- LSP UI integration
- visual wait decorations
- editor-local state for manifests and active wait snapshots

The CodeMirror update path should use extensions, state fields, state effects,
decorations, and direct `EditorView.dispatch(...)` calls. Runtime visualization
updates should not be routed through broad framework state.

Existing repo precedent:

- The Sonar editor manager already uses CodeMirror decoration fields/effects to
  highlight runtime-visible source lines by UUID.

### VTLSP

`val-town/vtlsp` is the main reference/dependency candidate for browser
CodeMirror to real language-server plumbing.

It provides:

- `@valtown/codemirror-ls`: CodeMirror LSP client extensions
- `LSWebSocketTransport`: WebSocket transport for LSP-framed messages
- `@valtown/ls-ws-server`: language-server WebSocket server and proxy helpers
- Deno LSP demo that mirrors editor documents into a temp directory and runs
  `deno lsp -q`

Important local findings from the cloned repo:

- `codemirror-ls` sends `didOpen` and full-document `didChange` messages.
- `LSWebSocketTransport` expects raw LSP-style framing over WebSocket, including
  `Content-Length` headers.
- `ls-ws-server` can multiplex sessions and proxy a real language server
  process.
- The Deno demo creates a temp `deno.json` and writes opened/changed documents
  to disk so Deno LSP has real files.

Initial recommendation:

- Use the published VTLSP packages for the Deno LSP channel:
  - `@valtown/codemirror-ls`
  - `@valtown/ls-ws-server`
- Keep the runtime visualization channel separate from VTLSP/LSP.
- Mirror editor buffers to a synthetic LSP workspace outside the repo so Deno
  LSP has concrete files without inheriting the repo root workspace. Runtime
  analysis and dynamic import use the persistent session files separately.

The cloned `clonedCompanionRepos/vtlsp` checkout is for local inspection and
research. It is not expected to be vendored unless the published packages prove
insufficient.

### Playwright

Playwright is the browser E2E verification dependency, not part of the runtime
architecture.

Responsibilities:

- start a real Chromium browser
- drive the `/livecodeVisualizer` page through stable test selectors
- verify manifest/debug state from the browser
- verify CodeMirror wait decorations, generated history, transform diagnostics,
  and runtime log behavior

The implemented runner lives in:

```txt
apps/browser-projections/tests/livecodeVisualizer.e2e.mjs
```

It is wired through `npm run test:livecode:e2e` in the browser project and
`deno task test:livecode:e2e` from `apps/deno-notebooks`.

## Current Implementation Snapshot

Manual startup uses two local processes:

```sh
cd apps/deno-notebooks
deno run --allow-all livecode/visualizer/main.ts --host 127.0.0.1 --port 7777 --log-level debug
```

```sh
cd apps/browser-projections
npm run dev
```

Then open:

```txt
http://127.0.0.1:5173/livecodeVisualizer
```

Implemented server routes:

```txt
GET  /health
GET  /lsp?session=<moduleOrEditorSessionId>
POST /runtime/analyze
POST /runtime/launch
POST /runtime/stop
GET  /runtime/snapshots
```

The browser page keeps the Deno LSP channel and runtime visualization channel
separate. LSP traffic goes through `/lsp`; transform, launch/stop, and active
wait snapshots use the `/runtime/...` routes.

## Browser Shape

Each CodeMirror instance represents one user-edited timed module.

Browser responsibilities per module:

- hold editor text
- connect to Deno LSP through the LSP WebSocket
- send source changes or run requests to the runtime server
- receive transform diagnostics and manifest
- receive and display the generated run/build ID for a successful transform
- cache `moduleId -> callsite manifest`
- keep a visible generated session history for the editor/module
- receive active wait snapshots
- apply CodeMirror runtime decorations on animation frames

Suggested browser components:

- `CodeMirrorTimedModuleEditor`
- `denoLspClient`
- `runtimeClient`
- `visualizerManifestStore`
- `activeWaitDecorationExtension`

The Deno LSP features and runtime visualization should remain separate:

- LSP: completions, diagnostics, hover, go to definition, references
- runtime: transform diagnostics, manifest, execution, active wait snapshots

## Server Shape

The local Deno server owns three related but separate jobs.

### 1. LSP Bridge

Endpoint:

```txt
GET /lsp?session=<sessionId>
```

Responsibilities:

- accept browser WebSocket connections
- spawn or reuse a Deno LSP process through a proxy
- mirror opened/changed editor documents into a synthetic workspace directory
  outside the repo
- translate virtual/editor URIs to file URIs if needed
- keep `deno lsp` independent from runtime execution

This can be built directly from VTLSP's `ls-ws-server` pattern.

### 2. Analysis And Transform

Implemented HTTP endpoint:

```txt
POST /runtime/analyze
```

Input:

```ts
interface AnalyzeRequest {
  moduleId: string;
  sourceVersion: number;
  sourceUri: string;
  sourceText: string;
}
```

Success output:

```ts
interface AnalyzeSuccess {
  type: "analyzeSuccess";
  moduleId: string;
  sourceVersion: number;
  generatedRunId: string;
  manifest: VisualizerManifestMessage;
  transformedModuleUri: string;
}
```

Failure output:

```ts
interface AnalyzeFailure {
  type: "analyzeFailure";
  moduleId: string;
  sourceVersion: number;
  diagnostics: Array<{
    severity: "error";
    message: string;
    from: number;
    to: number;
    code: string;
  }>;
}
```

Responsibilities:

- write or update the user module file
- construct the ts-morph project/source file
- run typed wait-callsite detection
- produce transform-blocking diagnostics for unsupported async patterns
- produce the manifest
- write transformed code to a generated module file

Unsupported async patterns should be errors for the initial version.

### 3. Runtime Execution And Visualization

Implemented runtime endpoints:

```txt
POST /runtime/launch
POST /runtime/stop
GET /runtime/snapshots
```

Responsibilities:

- receive launch/stop commands
- dynamically import transformed modules
- maintain a parent `TimeContext` loop that drains launch/stop actions from a
  queue
- launch generated modules by branching from the parent context
- expose a singleton visualizer runtime module used by transformed code
- sample active wait UUIDs around 30fps
- send active wait snapshots to the browser

This should follow the existing Sonar pattern in
`apps/browser-projections/src/sketches/sonar_sketch/LivecodeHolder.vue`:

- a parent `launchLoop(...)` stores the root context
- each tick drains `launchQueue`
- queued work starts with `parentCtx.branch(async (ctx) => ...)`
- branch handles are stored so stop/cancel can cancel active work

Launch command:

```ts
interface LaunchModuleRequest {
  moduleId: string;
  transformedModuleUri: string;
  generatedRunId: string;
}
```

Snapshot message:

```ts
interface ActiveWaitSnapshot {
  type: "activeWaitSnapshot";
  seq: number;
  timestampMs: number;
  modules: Record<string, string[]>;
}
```

There is no single `GET /runtime` endpoint in the first implementation. Snapshot
streaming is its own WebSocket at `/runtime/snapshots`, while launch and stop
are simple POST endpoints.

## Generated Runtime Shape

User input:

```ts
export default async function (ctx: TimeContext) {
  await playMelody(ctx, melody);
  await ctx.wait(1);
}
```

Generated output:

```ts
import { visualizedAwait } from "file:///.../livecode/visualizer/runtime.ts";
import type { TimeContext } from "@avtools/core-timing";

export async function runFunc(ctx: TimeContext) {
  await visualizedAwait("module_1", "uuid_1", playMelody(ctx, melody));
  await visualizedAwait("module_1", "uuid_2", ctx.wait(1));
}

export default runFunc;
```

The user-facing convention is still a default export. The generated execution
module may normalize that default export into a named `runFunc` so launch code
can consistently do:

```ts
const { runFunc } = await import(generatedModuleUrl);
parentCtx.branch(async (ctx) => runFunc(ctx));
```

Visualizer runtime singleton:

```ts
const activeWaitCounts = new Map<string, Map<string, number>>();

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
```

The singleton count map is enough for the first implementation. It can store
counts by module and UUID, for example `Map<moduleId, Map<uuid, count>>`. The
browser uses the manifest to map each module's UUIDs back to editor source
ranges.

## File And Module Layout

Possible layout:

```txt
packages/time-context-visualizer/
  analysis/
    analyzeTimedModule.ts
    diagnostics.ts
    types.ts
  transform/
    transformTimedModule.ts
    manifest.ts
  runtime/
    runtime.ts
    activeWaitSnapshots.ts
  protocol/
    messages.ts

apps/livecode-editor/
  server/
    main.ts
    lspBridge.ts
    runtimeSocket.ts
    sessionFiles.ts
  browser/
    TimedModuleEditor.ts
    denoLspClient.ts
    runtimeClient.ts
    activeWaitDecorations.ts
```

Current implementation target:

- UI page inside `apps/browser-projections/src/sketches`
- local Deno server code inside `apps/deno-notebooks`

Shared analysis/transform/runtime code can move into a package later if the
visualizer becomes reusable.

First implementation paths:

- Browser runtime visualizer page:
  `apps/browser-projections/src/sketches/livecodeVisualizer/SketchWrapper.vue`
- Deno analyzer/server/runtime: `apps/deno-notebooks/livecode/visualizer/`
- Deno source-of-truth tests: `apps/deno-notebooks/livecode/tests/`
- Browser E2E runner:
  `apps/browser-projections/tests/livecodeVisualizer.e2e.mjs`

The first implemented pass covers runtime analysis, transform, launch/stop,
CodeMirror active-wait decoration plumbing, and a Deno LSP WebSocket bridge.

## Session Files

A server session should have a real directory, for example:

```txt
apps/deno-notebooks/.avtools-livecode-sessions/
  logs/
    server.log
    lsp/
      proxy-stdout.log
      proxy-stderr.log
  <sessionId>/
    modules/
      <moduleId>.ts
    generated/
      <generatedRunId>.ts

$TMPDIR/avtools-livecode-lsp-workspaces/<serverSessionId>/
  <lspWorkspaceId>/
    deno.json
    main.ts
```

The generated module currently imports the visualizer runtime helper from the
repo source file `apps/deno-notebooks/livecode/visualizer/runtime.ts`; that
helper is not copied into each generated session directory.

Every successful source change + execution should create a newly named generated
module file. Use a UUID for the first implementation, generated by a small
helper function such as `createGeneratedRunId()`. Keep name creation behind that
function so it can later be replaced with a human-readable scheme.

Return the generated run ID to the browser so it can be shown in the UI and
stored in the editor's generated session history.

Generated session files should not be aggressively deleted. Leaving successful
generated modules on disk is useful for debugging, Deno import identity, and
later inspection.

The UI can surface all generated session history initially. It is just strings
and metadata at this stage, and can be optimized later if it becomes noisy.

The same physical files can support:

- ts-morph analysis
- dynamic Deno import
- sourcemap/debugging output

The LSP bridge uses separate per-session workspace files under
`$TMPDIR/avtools-livecode-lsp-workspaces/<serverSessionId>/`, not under the
repo. This avoids Deno treating the repo root `deno.json` as the owning
workspace and ignoring the synthetic LSP `deno.json`. It still mirrors the VTLSP
Deno demo's key idea: Deno LSP behaves better when the documents it sees are
real files in a real workspace.

## Dependency Boundaries

The clean boundaries are:

- Deno server owns process/runtime/files/WebSockets.
- VTLSP owns browser-to-LSP message plumbing.
- Deno LSP owns editor semantics like completion/hover/diagnostics.
- ts-morph owns local typed transform analysis.
- magic-string owns text rewriting.
- CodeMirror owns editor state and visual decorations.
- `@avtools/core-timing` owns logical-time semantics.
- visualizer runtime owns `uuid -> active count` tracking and snapshots.
- `moduleId` is included in manifest and snapshot messages from the start so
  multiple editor modules can be routed cleanly later.

No dependency except generated visualizer runtime code should know about active
wait UUIDs.

## First Plumbing Milestone

1. Single browser CodeMirror editor page under
   `apps/browser-projections/src/sketches`.
2. Deno server under `apps/deno-notebooks` with `/lsp` and `/runtime`.
3. VTLSP-style bridge to `deno lsp`.
4. Default-exported timed module file in a session directory.
5. Analysis/transform for direct awaited `TimeContext` callsites.
6. Hard errors for detectable unsupported async patterns.
7. Transformed file written to session `generated/` using a UUID generated by
   `createGeneratedRunId()`.
8. Dynamic import of transformed file.
9. Parent timing loop drains launch actions and starts generated modules with
   `parentCtx.branch(async (ctx) => runFunc(ctx))`.
10. Stop/cancel cancels the stored branch handle and clears active wait counts
    for that module.
11. Singleton visualizer runtime with `Map<moduleId, Map<uuid, count>>`.
12. 30fps active snapshot loop.
13. CodeMirror decoration extension driven by cached manifest and snapshots.

## Settled Implementation Choices

- Use published `@valtown/codemirror-ls` and `@valtown/ls-ws-server`.
- Include `moduleId` in the first manifest and snapshot protocol.
- Use UUIDs for generated run/build names initially, wrapped behind
  `createGeneratedRunId()` so a human-readable scheme can replace it later.
- Keep generated session files instead of deleting them aggressively.
- Surface all generated session history in the UI initially.
- Use explicit standard semver pins for `ts-morph` and TypeScript.
- Put the first UI in `apps/browser-projections/src/sketches`.
- Put the first local server code in `apps/deno-notebooks`.
- Run the local server with broad Deno permissions, effectively `--allow-all`,
  because this is a local-only trusted tool.
- Launch generated modules from a parent timing context by queueing actions and
  branching, following the Sonar `launchQueue` pattern.

## Decisions Still Worth Reviewing

- Exact UI presentation for generated session history.

## External References

- Deno `deno lsp` docs: https://docs.deno.com/runtime/reference/cli/lsp/
- CodeMirror reference: https://codemirror.net/docs/ref/
- ts-morph type checker docs: https://ts-morph.com/navigation/type-checker
- VTLSP repo: https://github.com/val-town/vtlsp
- magic-string repo: https://github.com/Rich-Harris/magic-string
