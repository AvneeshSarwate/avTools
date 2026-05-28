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

This is not a Jupyter notebook architecture.

## Important Dependencies

### Deno

Deno is the local server and execution runtime.

Responsibilities:

- serve the browser editor app
- host WebSocket endpoints
- spawn or proxy `deno lsp`
- write user/transformed modules to local session files
- dynamically import transformed modules
- execute the default exported timed process
- stream runtime visualization snapshots

The Deno language server is a normal LSP process. The official docs describe
`deno lsp` as communicating over stdin/stdout using the Language Server
Protocol.

Relevant design implication:

- LSP and runtime execution should be separate channels.
- The LSP should see real files and a real `deno.json` context where possible.
- Dynamic imports should use file URLs for transformed modules.
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

The important type-checker operations are resolving types and signatures for
call-like expressions. The ts-morph docs expose the project type checker via
`project.getTypeChecker()` and resolved signatures with
`typeChecker.getResolvedSignature(...)`.

Dependency note:

- The current repo already has `ts-morph` in `apps/browser-projections`.
- The exact package version should be pinned intentionally when this becomes a
  Deno server package.
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

- Reuse or adapt VTLSP for the Deno LSP channel.
- Keep the runtime visualization channel separate from VTLSP/LSP.
- Start by mirroring editor buffers to a session work directory so Deno LSP,
  transform analysis, and runtime import all have concrete files.

## Browser Shape

Each CodeMirror instance represents one user-edited timed module.

Browser responsibilities per module:

- hold editor text
- connect to Deno LSP through the LSP WebSocket
- send source changes or run requests to the runtime server
- receive transform diagnostics and manifest
- cache `moduleId -> callsite manifest`
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
- mirror opened/changed editor documents into a session directory
- translate virtual/editor URIs to file URIs if needed
- keep `deno lsp` independent from runtime execution

This can be built directly from VTLSP's `ls-ws-server` pattern.

### 2. Analysis And Transform

Endpoint shape could be request/response over the runtime WebSocket or a simple
HTTP endpoint:

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

Endpoint:

```txt
GET /runtime
```

Responsibilities:

- receive launch/stop commands
- dynamically import transformed modules
- create the root `TimeContext`
- call the module's default export with `ctx`
- expose a singleton visualizer runtime module used by transformed code
- sample active wait UUIDs around 30fps
- send active wait snapshots to the browser

Launch command:

```ts
interface LaunchModuleRequest {
  type: "launchModule";
  moduleId: string;
  sourceVersion: number;
  transformedModuleUri: string;
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

## Generated Runtime Shape

User input:

```ts
export default async function(ctx: TimeContext) {
  await playMelody(ctx, melody);
  await ctx.wait(1);
}
```

Generated output:

```ts
import { visualizedAwait } from "./timeContextVisualizerRuntime.ts";

export default async function(ctx: TimeContext) {
  await visualizedAwait("uuid_1", playMelody(ctx, melody));
  await visualizedAwait("uuid_2", ctx.wait(1));
}
```

Visualizer runtime singleton:

```ts
const activeWaitCounts = new Map<string, number>();

export async function visualizedAwait<T>(
  id: string,
  promise: PromiseLike<T>,
): Promise<T> {
  enterWait(id);
  try {
    return await promise;
  } finally {
    exitWait(id);
  }
}
```

The singleton count map is enough for the first implementation. The browser
uses the manifest to map UUIDs back to editor source ranges.

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
    timeContextVisualizerRuntime.ts
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

This could also be integrated into `apps/browser-projections` first if that is
faster, but the package boundary is cleaner if the visualizer becomes reusable.

## Session Files

A server session should have a real directory, for example:

```txt
.avtools-livecode-sessions/
  <sessionId>/
    deno.json
    modules/
      <moduleId>.ts
    generated/
      <moduleId>.<sourceVersion>.visualized.ts
      timeContextVisualizerRuntime.ts
```

The same physical files can support:

- Deno LSP
- ts-morph analysis
- dynamic Deno import
- sourcemap/debugging output

This mirrors the VTLSP Deno demo's key idea: Deno LSP behaves better when the
documents it sees are real files in a real workspace.

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

No dependency except generated visualizer runtime code should know about active
wait UUIDs.

## First Plumbing Milestone

1. Single browser CodeMirror editor.
2. Deno server with `/lsp` and `/runtime`.
3. VTLSP-style bridge to `deno lsp`.
4. Default-exported timed module file in a session directory.
5. Analysis/transform for direct awaited `TimeContext` callsites.
6. Hard errors for detectable unsupported async patterns.
7. Transformed file written to session `generated/`.
8. Dynamic import of transformed file.
9. Singleton visualizer runtime with `Map<uuid, count>`.
10. 30fps active snapshot loop.
11. CodeMirror decoration extension driven by cached manifest and snapshots.

## Decisions Still Worth Reviewing

- Whether to depend directly on published `@valtown/codemirror-ls` and
  `@valtown/ls-ws-server`, vendor a copy, or adapt the cloned source.
- Whether `moduleId` is mandatory in the first manifest/snapshot protocol.
- Where session directories should live and how aggressively they should be
  cleaned up.
- How to pin `ts-morph` and TypeScript versions for the Deno-side analyzer.
- Whether the first implementation should live inside `apps/browser-projections`
  or a new app/package boundary.
- What Deno permissions the local server should require.
- How launch/stop/cancel maps onto the existing `@avtools/core-timing` lifecycle.

## External References

- Deno `deno lsp` docs: https://docs.deno.com/runtime/reference/cli/lsp/
- CodeMirror reference: https://codemirror.net/docs/ref/
- ts-morph type checker docs: https://ts-morph.com/navigation/type-checker
- VTLSP repo: https://github.com/val-town/vtlsp
- magic-string repo: https://github.com/Rich-Harris/magic-string
