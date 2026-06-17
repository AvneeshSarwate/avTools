# Self-Test Loop

## Goal

The coding agent should be able to verify the livecoding visualizer end to end
without relying on manual inspection.

The self-test loop should support:

- running the local Deno server from the agent's shell
- reading server logs directly while the server is running
- steering the browser editor with Playwright
- running fast source-of-truth scripts for analysis, transform, runtime, and
  protocol behavior
- checking visible CodeMirror decorations against runtime snapshots

This document describes the intended verification shape and the first
implemented automated loop.

## Verification Layers

Use layered tests, from fastest and most deterministic to full browser smoke:

1. Analyzer/transform fixture tests
2. Runtime singleton/count-map tests
3. Dynamic import execution tests
4. Runtime protocol tests
5. Server smoke tests
6. Playwright browser E2E tests

The lower layers should catch most regressions before the browser is involved.
The browser test should prove that the whole loop is wired correctly.

## Agent-Run Server Loop

The agent should be able to start the local Deno server in its own shell and
keep that process attached long enough to inspect logs.

Recommended command shape:

```sh
deno run --unstable-webgpu --unstable-ffi --allow-all apps/deno-notebooks/livecode/visualizer/main.ts \
  --host localhost \
  --port 7777 \
  --session-root apps/deno-notebooks/.avtools-livecode-sessions \
  --log-level debug
```

Use `--port 7777` when manually checking the first browser page, because the UI
defaults to `http://localhost:7777`. For automated server tests, `--port 0` lets
the OS choose a free port. The server should print one clear machine-readable
line when ready either way:

```json
{
  "type": "serverReady",
  "host": "127.0.0.1",
  "port": 54321,
  "baseUrl": "http://127.0.0.1:54321",
  "sessionRoot": "..."
}
```

This line is important because the agent can parse it from stdout and then use
the selected port for HTTP, WebSocket, and browser tests.

The server should also write logs to disk:

```txt
apps/deno-notebooks/.avtools-livecode-sessions/logs/server.log
```

For manual browser testing, start the browser app separately from
`apps/browser-projections`:

```sh
npm run dev
```

Then open:

```txt
http://127.0.0.1:5173/livecodeVisualizer
```

The agent verification loop should be:

1. Start the Deno server in a long-running shell session.
2. Wait until the `serverReady` log line appears.
3. Run source-of-truth scripts against `baseUrl`.
4. Run Playwright browser tests against the editor URL.
5. On failure, inspect stdout and the log file.
6. Stop the server process before finishing.

The server should expose a health endpoint:

```txt
GET /health
```

Expected response:

```ts
interface HealthResponse {
  ok: true;
  serverVersion: string;
  sessionRoot: string;
  activeModules: string[];
}
```

## Source-Of-Truth Scripts

The repo should contain deterministic scripts that can be run without opening a
browser. These scripts should fail with non-zero exit codes and print concise
diagnostics.

Implemented server/runtime tests:

```txt
apps/deno-notebooks/livecode/tests/
  analyzer_transform_test.ts
  runtime_counts_test.ts
  dynamic_import_execution_test.ts
  protocol_smoke_test.ts
  lsp_smoke_test.ts
  server_smoke_test.ts
```

Implemented browser E2E runner:

```txt
apps/browser-projections/tests/livecodeVisualizer.e2e.mjs
```

The first browser fixtures are inlined in the E2E runner rather than stored as
separate fixture files. That keeps the cases readable in the test that drives
the actual browser/editor loop.

Implemented task shape:

```json
{
  "tasks": {
    "test:livecode:unit": "deno test --allow-env --allow-sys --allow-read --allow-write livecode/tests/analyzer_transform_test.ts livecode/tests/runtime_counts_test.ts livecode/tests/dynamic_import_execution_test.ts",
    "test:livecode:server": "deno test --allow-all livecode/tests/protocol_smoke_test.ts livecode/tests/server_smoke_test.ts",
    "test:livecode:e2e": "cd ../browser-projections && npm run test:livecode:e2e",
    "test:livecode": "deno task test:livecode:unit && deno task test:livecode:server && deno task test:livecode:e2e"
  }
}
```

Run the implemented Deno tasks from `apps/deno-notebooks`:

```sh
deno task test:livecode:unit
deno task test:livecode:server
deno task test:livecode:e2e
```

## Analyzer And Transform Tests

`analyzer_transform_test.ts` should verify the transform contract directly.

For valid fixtures, assert:

- default export is found
- `ctx: TimeContext` is recognized
- direct `await ctx.wait(...)` calls in the root or inline branch callback scope
  are instrumented
- awaited helper calls that receive `ctx` in the root or inline branch callback
  scope are instrumented
- inline `ctx.branch(async (branchCtx) => { ... })` callback bodies are walked
- manifest callsite count matches expected
- manifest ranges point at the original source call expressions
- generated code imports `visualizedAwait`
- generated code passes `moduleId` and UUID to `visualizedAwait`

For invalid fixtures, assert transform-blocking diagnostics:

- `await fetch(url)` errors as unsupported arbitrary await
- split promise usage errors:

```ts
const p = playMelody(ctx, melody);
await p;
```

- unawaited timed helper call errors:

```ts
playMelody(ctx, melody);
```

Each diagnostic should include:

- stable diagnostic code
- human-readable message
- source range
- severity `"error"`

This script is the source of truth for what syntax the first implementation
supports.

## User-Code Fixture Examples

Keep these fixtures boring. They should print timestamped logs and expose clear
source callsites. Verification is two-way:

1. Server/runtime logs prove the user code ran in the expected order.
2. Runtime snapshot/client checks prove the expected highlight UUIDs were sent
   and applied.

Comments marked `HIGHLIGHT` indicate source locations where the visualizer
should create a manifest entry and where CodeMirror should be able to show an
active wait decoration while that awaited call is pending.

Comments marked `NO HIGHLIGHT` indicate synchronous code that should not produce
a visualized callsite.

### Shared Test Helper

Fixtures can use a tiny helper to keep logs consistent:

```ts
function log(label: string, ctx?: TimeContext) {
  const wall = Date.now();
  const logical = ctx ? ctx.time.toFixed(3) : "none";
  console.log(`[fixture] wall=${wall} logical=${logical} ${label}`);
}
```

Test assertions should check for ordered labels rather than exact wall-clock
timestamps.

### Fixture: Linear Waits

```ts
import type { TimeContext } from "@avtools/core-timing";

function log(label: string, ctx?: TimeContext) {
  const wall = Date.now();
  const logical = ctx ? ctx.time.toFixed(3) : "none";
  console.log(`[fixture] wall=${wall} logical=${logical} ${label}`);
}

export default async function (ctx: TimeContext) {
  log("start", ctx); // NO HIGHLIGHT

  await ctx.waitSec(0.20); // HIGHLIGHT: id linear_wait_1
  log("after waitSec 0.20", ctx); // NO HIGHLIGHT

  await ctx.wait(1); // HIGHLIGHT: id linear_wait_2
  log("after wait 1 beat", ctx); // NO HIGHLIGHT

  log("done", ctx); // NO HIGHLIGHT
}
```

Expected runtime logs, in order:

```txt
[fixture] ... start
[fixture] ... after waitSec 0.20
[fixture] ... after wait 1 beat
[fixture] ... done
```

Expected snapshots:

- while first wait is pending: `{ moduleId: ["linear_wait_1"] }`
- while second wait is pending: `{ moduleId: ["linear_wait_2"] }`
- after completion: `{ moduleId: [] }` or the module omitted from the snapshot

Expected client checks:

- manifest has two callsites
- CodeMirror receives/applies `linear_wait_1`
- CodeMirror later receives/applies `linear_wait_2`
- active decoration clears after completion

### Fixture: Awaited Helper Call

```ts
import type { TimeContext } from "@avtools/core-timing";

function log(label: string, ctx?: TimeContext) {
  const wall = Date.now();
  const logical = ctx ? ctx.time.toFixed(3) : "none";
  console.log(`[fixture] wall=${wall} logical=${logical} ${label}`);
}

async function helper(ctx: TimeContext, label: string) {
  log(`helper ${label} start`, ctx); // NO HIGHLIGHT in first transform scope
  await ctx.waitSec(0.20); // NO HIGHLIGHT in first transform scope
  log(`helper ${label} done`, ctx); // NO HIGHLIGHT
}

export default async function (ctx: TimeContext) {
  log("root start", ctx); // NO HIGHLIGHT

  await helper(ctx, "a"); // HIGHLIGHT: id helper_call_1
  log("between helpers", ctx); // NO HIGHLIGHT

  await helper(ctx, "b"); // HIGHLIGHT: id helper_call_2
  log("root done", ctx); // NO HIGHLIGHT
}
```

Expected runtime logs, in order:

```txt
[fixture] ... root start
[fixture] ... helper a start
[fixture] ... helper a done
[fixture] ... between helpers
[fixture] ... helper b start
[fixture] ... helper b done
[fixture] ... root done
```

Expected snapshots:

- while helper `a` is pending: `{ moduleId: ["helper_call_1"] }`
- while helper `b` is pending: `{ moduleId: ["helper_call_2"] }`
- helper-internal `await ctx.waitSec(...)` does not create its own highlight in
  the first transform scope

Expected client checks:

- manifest has two callsites
- client sees active IDs `helper_call_1`, then `helper_call_2`
- CodeMirror highlights the root-level helper call lines, not the helper body

### Fixture: Inline Branch

```ts
import type { TimeContext } from "@avtools/core-timing";

function log(label: string, ctx?: TimeContext) {
  const wall = Date.now();
  const logical = ctx ? ctx.time.toFixed(3) : "none";
  console.log(`[fixture] wall=${wall} logical=${logical} ${label}`);
}

export default async function (ctx: TimeContext) {
  log("root start", ctx); // NO HIGHLIGHT

  ctx.branch(async (branchCtx) => {
    log("branch start", branchCtx); // NO HIGHLIGHT
    await branchCtx.waitSec(0.30); // HIGHLIGHT: id branch_wait_1
    log("branch done", branchCtx); // NO HIGHLIGHT
  }); // NO HIGHLIGHT: allowed branch launch call

  await ctx.waitSec(0.10); // HIGHLIGHT: id root_wait_1
  log("root after short wait", ctx); // NO HIGHLIGHT

  await ctx.waitSec(0.30); // HIGHLIGHT: id root_wait_2
  log("root done", ctx); // NO HIGHLIGHT
}
```

Expected runtime logs, in order by causality:

```txt
[fixture] ... root start
[fixture] ... branch start
[fixture] ... root after short wait
[fixture] ... branch done
[fixture] ... root done
```

Expected snapshots:

- shortly after launch, both `branch_wait_1` and `root_wait_1` may be active
- after root short wait resolves, `branch_wait_1` remains active
- during final root wait, `branch_wait_1` and `root_wait_2` may overlap
- after both complete, no IDs remain active

Expected client checks:

- manifest has three callsites
- client sees snapshots containing branch and root IDs at the same time at least
  once, unless timing cadence misses the short overlap
- CodeMirror can highlight both active source ranges simultaneously

### Fixture: Repeated Same Callsite Count

```ts
import type { TimeContext } from "@avtools/core-timing";

function log(label: string, ctx?: TimeContext) {
  const wall = Date.now();
  const logical = ctx ? ctx.time.toFixed(3) : "none";
  console.log(`[fixture] wall=${wall} logical=${logical} ${label}`);
}

export default async function (ctx: TimeContext) {
  for (const name of ["a", "b", "c"]) {
    ctx.branch(async (branchCtx) => {
      log(`branch ${name} start`, branchCtx); // NO HIGHLIGHT
      await branchCtx.waitSec(0.25); // HIGHLIGHT: id repeated_branch_wait
      log(`branch ${name} done`, branchCtx); // NO HIGHLIGHT
    });
  }

  await ctx.waitSec(0.40); // HIGHLIGHT: id repeated_root_wait
  log("root done", ctx); // NO HIGHLIGHT
}
```

Expected runtime logs:

- `branch a start`, `branch b start`, and `branch c start` all appear
- each branch eventually logs `done`
- `root done` appears after the root wait

Expected snapshots:

- `repeated_branch_wait` appears once in active IDs even though the count is 3
- it remains active until all three branch waits resolve
- `repeated_root_wait` is independently active while root wait is pending

Expected client checks:

- manifest has two callsites
- CodeMirror shows one active decoration for `repeated_branch_wait`, not three
- active decoration for `repeated_branch_wait` clears only after all branch
  invocations complete

### Fixture: Unsupported Arbitrary Await Error

```ts
import type { TimeContext } from "@avtools/core-timing";

export default async function (ctx: TimeContext) {
  console.log("[fixture] start");
  await fetch("https://example.com/data.json"); // ERROR: arbitrary await not tied to TimeContext.
  await ctx.waitSec(0.10); // not reached; transform should fail before execution
}
```

Expected behavior:

- transform fails
- no generated runtime module is launched
- no `[fixture] start` runtime log appears
- diagnostic range points at `await fetch(...)`
- client receives diagnostics and no manifest/run for this source

### Fixture: Split Promise Error

```ts
import type { TimeContext } from "@avtools/core-timing";

async function helper(ctx: TimeContext) {
  console.log("[fixture] helper start");
  await ctx.waitSec(0.10);
  console.log("[fixture] helper done");
}

export default async function (ctx: TimeContext) {
  const p = helper(ctx); // ERROR: timed helper promise is created before visualized await wrapper.
  await p;
}
```

Expected behavior:

- transform fails
- no runtime logs appear
- diagnostic range points at `helper(ctx)`
- client receives diagnostics and no active highlight snapshots

### Fixture: Unawaited Timed Helper Error

```ts
import type { TimeContext } from "@avtools/core-timing";

async function helper(ctx: TimeContext) {
  await ctx.waitSec(0.10);
}

export default async function (ctx: TimeContext) {
  helper(ctx); // ERROR: unawaited Promise-like call that receives TimeContext.
  await ctx.waitSec(0.10);
}
```

Expected behavior:

- transform fails
- no generated runtime module is launched
- diagnostic range points at `helper(ctx)`

### Fixture: Dynamic Context Method Error

```ts
import type { TimeContext } from "@avtools/core-timing";

export default async function (ctx: TimeContext) {
  const method = "waitSec";
  await ctx[method](0.10); // ERROR: dynamic TimeContext method access is unsupported.
}
```

Expected behavior:

- transform fails
- diagnostic range points at `ctx[method](0.10)`

## Browser Snapshot Truth

For browser-side verification, expose a test-only debug object on `window`:

```ts
interface LivecodeVisualizerDebug {
  lastManifestByModule: Record<string, VisualizerManifestMessage>;
  receivedSnapshots: ActiveWaitSnapshot[];
  appliedHighlightsByModule: Record<string, string[]>;
  appliedHighlightHistoryByModule: Record<string, string[][]>;
}

declare global {
  interface Window {
    __livecodeVisualizerDebug?: LivecodeVisualizerDebug;
  }
}
```

Playwright should verify both:

- `receivedSnapshots`: what the runtime sent over the WebSocket
- `appliedHighlightsByModule`: what CodeMirror actually applied

This catches both classes of bugs:

- server/runtime bugs where the wrong UUIDs are sent
- client/editor bugs where correct UUIDs are received but not highlighted

## Runtime Count Tests

`runtime_counts_test.ts` should verify the singleton visualizer runtime without
Deno server or browser.

Cases:

1. `enterWait(moduleId, id)` increments the count.
2. `exitWait(moduleId, id)` decrements the count.
3. The ID remains active until count reaches zero.
4. Multiple module IDs stay isolated.
5. `visualizedAwait(moduleId, id, promise)` exits in `finally` on resolve.
6. `visualizedAwait(moduleId, id, promise)` exits in `finally` on reject.
7. Clearing a module removes all active IDs for that module.

Expected active snapshot shape:

```ts
{
  moduleA: ["uuid_1", "uuid_2"],
  moduleB: ["uuid_3"]
}
```

This test should not depend on timing sleeps except for a small controlled
promise when needed.

## Dynamic Import Execution Test

`dynamic_import_execution_test.ts` should prove that transformed modules can be
written, imported, and launched.

Flow:

1. Create a temp session directory.
2. Write a fixture user module.
3. Analyze and transform it.
4. Write generated code to `<generatedRunId>.ts`.
5. Dynamically import the generated file URL.
6. Assert it exports `runFunc`.
7. Run `runFunc(ctx)` with a real `TimeContext`.
8. Assert active wait snapshots include the expected UUID while the wait is
   pending.
9. Assert the active UUID clears after the wait resolves or the task is
   cancelled.

This test can use the existing timing runtime directly. If realtime sleeps make
the test slow or flaky, use the offline runner where practical.

## Protocol Smoke Test

`protocol_smoke_test.ts` should test server endpoints without a browser.

Minimum checks:

1. `GET /health` returns `ok: true`.
2. Analyze a valid module and receive:
   - `moduleId`
   - `sourceVersion`
   - `generatedRunId`
   - manifest
   - transformed module URI
3. Analyze an invalid module and receive transform-blocking diagnostics.
4. Launch the valid transformed module.
5. Receive at least one `activeWaitSnapshot` with the expected `moduleId`.
6. Stop the module.
7. Receive a later snapshot with no active IDs for that module.

This can be implemented with direct HTTP and WebSocket clients. It should not
need Playwright.

## Server Smoke Test

`server_smoke_test.ts` should own its server process so it can run in CI or from
an agent shell without manual setup.

Flow:

1. Spawn the Deno server with `--port 0`.
2. Parse the `serverReady` stdout line.
3. Run protocol smoke checks against the reported `baseUrl`.
4. Kill the server process.
5. If anything fails, print:
   - command used
   - server stdout tail
   - server stderr tail
   - server log path

This is the first command the agent should run when checking whether the server
side is healthy.

## Playwright Browser E2E

The implemented browser E2E runner verifies the real browser/editor path:

```txt
apps/browser-projections/tests/livecodeVisualizer.e2e.mjs
```

It uses the browser project's normal `playwright` dev dependency and can be run
directly:

```sh
cd apps/browser-projections
npm run test:livecode:e2e
```

The browser project currently needs Node 20+ for Vite/Playwright. The runner
fails early with a clear error if it is launched with an older Node binary.

or through the Deno livecode task:

```sh
cd apps/deno-notebooks
deno task test:livecode:e2e
```

Recommended browser flow:

1. Start or connect to the Deno visualizer server.
2. Start the Vite/browser editor app.
3. Open the livecode visualizer page at `/livecodeVisualizer`.
4. Wait for the CodeMirror editor to be visible.
5. Insert a valid timed module:

```ts
import type { TimeContext } from "@avtools/core-timing";

async function playNote(ctx: TimeContext) {
  await ctx.waitSec(0.25);
}

export default async function (ctx: TimeContext) {
  await playNote(ctx);
  await ctx.wait(1);
}
```

6. Click Run.
7. Assert transform succeeds and a `generatedRunId` appears in the UI history.
8. Assert the manifest has two visualizable callsites.
9. Assert one of the CodeMirror wait decorations appears while the runtime is
   waiting.
10. Wait for the next snapshot and assert decorations update or clear.
11. Replace the editor contents with an invalid fixture:

```ts
import type { TimeContext } from "@avtools/core-timing";

export default async function (ctx: TimeContext) {
  await fetch("https://example.com");
}
```

12. Click Run.
13. Assert execution is blocked and an unsupported-await diagnostic appears.

The first implemented E2E runner covers more than the initial smoke:

- linear direct waits: manifest count, runtime logs, active IDs, CodeMirror
  decoration, and clear after completion
- awaited helper calls: only root-level helper awaits are manifested, helper
  internals are not
- repeated branch callsite: three branches share one callsite UUID, active
  snapshots/decorations show that UUID once while the root wait overlaps
- unsupported arbitrary await: transform diagnostic, no generated history, and
  no runtime fixture logs
- split promise helper call: transform diagnostic, no generated history, and no
  runtime fixture logs

On failure the runner writes a screenshot, server output, Vite output, and the
session root path to a temp artifact directory and prints that directory.

The browser smoke should rely on stable test selectors rather than visual text
where possible.

Suggested selectors:

```txt
[data-testid="livecode-editor"]
[data-testid="run-module"]
[data-testid="generated-history"]
[data-testid="transform-diagnostics"]
[data-testid="wait-decoration-layer"]
```

CodeMirror decorations can also carry stable classes:

```txt
.tcv-wait-active
.tcv-wait-scheduled
```

## Log Expectations

The server should log important events in a structured form that is easy for an
agent to search:

```json
{"type":"analyzeStart","moduleId":"...","sourceVersion":3}
{"type":"analyzeSuccess","moduleId":"...","generatedRunId":"...","callsiteCount":2}
{"type":"analyzeFailure","moduleId":"...","diagnosticCount":1}
{"type":"launchQueued","moduleId":"...","generatedRunId":"..."}
{"type":"moduleStarted","moduleId":"...","generatedRunId":"..."}
{"type":"moduleStopped","moduleId":"...","reason":"cancelled"}
{"type":"snapshot","activeModuleCount":1,"activeCallsiteCount":2}
```

The agent should be able to run:

```sh
rg "analyzeSuccess|analyzeFailure|moduleStarted|snapshot" apps/deno-notebooks/.avtools-livecode-sessions/logs/server.log
```

and quickly understand what happened.

## Expected Agent Workflow

When implementing or changing the visualizer, the agent should verify in this
order:

1. Run analyzer/transform unit tests.
2. Run runtime count tests.
3. Run dynamic import execution tests.
4. Run protocol smoke tests.
5. Start the Deno server in a shell and inspect logs.
6. Run the Playwright editor smoke.
7. If a browser test fails, inspect:
   - Playwright trace or screenshot
   - browser console logs
   - server stdout/stderr
   - `server.log`
   - generated module file
   - transform manifest

The final report should include:

- commands run
- pass/fail status
- server URL used
- generated run IDs involved
- log file path
- any screenshots/traces if browser verification failed

## Minimum First Self-Test Target

The first useful implementation does not need exhaustive coverage. It should
support at least:

1. One valid transform fixture.
2. One unsupported-await error fixture.
3. Runtime count-map resolve/reject tests.
4. Server health + analyze + launch + stop smoke.
5. Playwright smoke that proves a wait decoration appears in CodeMirror after
   clicking Run.

Once those pass, the agent has a real feedback loop for continuing the feature
without guessing from static code inspection alone.
