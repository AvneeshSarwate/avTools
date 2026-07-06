# Livecode Stability Fix Plan (2026-07 review)

This is a handoff implementation plan. It fixes defects found in a full review
of the livecode system: the `core-timing` engine, the Deno visualizer server,
the analyzer/shadow-diagnostics layer, the MIDI/piano-roll helpers, and the
`apps/livecode-tldraw` browser client.

## What this project is

A live-coding graphical IDE for realtime music and visuals — but more
importantly, an **exploration of one central idea: using type-level and
static analysis of user code to automatically bridge the gap between code and
GUI.** The analyzer reads the user's TypeScript, recognizes semantically
meaningful constructs (a timed wait, a reference to a named piano roll, a
store access, eventually signals/channels/barriers), and uses that knowledge
to *generate UI affordances* that visualize or modify runtime state, anchored
directly to the source code: live highlights on the exact callsite a running
module is parked at, an "open piano roll" button next to the call that reads
that roll, connector lines between a module and the GUI object it touches,
staleness/safety warnings when one module's edits would break another. The
specific features that exist today are instances of this pattern, not the
point — expect the same pattern to be applied to more and more constructs
(control signals, event handlers, state machines, custom per-piece
"live monitors"), which is exactly why the analyzer is being generalized into
a detector-plugin API.

Concretely: the user writes TypeScript modules, each a node on an infinite
canvas (tldraw). A local Deno server executes the modules (MIDI out, WebGPU
windows, shared piano-roll data); the browser is only the editing and
visualization surface. Modules coordinate through shared server-side state
rather than importing each other's live values, so any module can be
stopped, edited, and relaunched mid-performance without restarting the rest.
Timing is driven by the `TimeContext` engine: a deterministic logical-time
scheduler with structured concurrency (branch/cancel cascades), tempo maps,
cross-coroutine barriers, and an offline stepping mode with seeded RNG for
faster-than-realtime deterministic rendering.

## Project map (where everything lives)

```
packages/core-timing/
  offline_time_context.ts   The TimeContext engine: scheduler, tempo maps,
                            branch/branchWait/cancel, barriers, launch(),
                            OfflineRunner. ~1800 lines; the header comment
                            documents intended invariants — read it first.
  priority_queue.ts         Min-heap used by the scheduler.
  mod.ts                    Package entrypoint (re-exports).

apps/deno-notebooks/livecode/
  visualizer/server.ts      The hub. HTTP+WS server: /runtime/analyze,
                            /runtime/launch|stop|stop-all|status|snapshots,
                            /project/* (project mode), /piano-roll/*,
                            /lsp, /client/control (server->browser command
                            channel). Owns the launch queue (a long-lived
                            parent TimeContext that all modules branch from),
                            activeModules, preparedRuns, snapshot broadcast
                            timers, session dirs.
  visualizer/analyze_transform.ts
                            ts-morph analysis + magic-string transform of one
                            module: finds the default timed root, instruments
                            awaited waits/helper calls with __tcvVisualizedAwait,
                            wraps piano-roll name args, emits the callsite
                            manifest (source ranges), rejects unsupported async
                            patterns with diagnostics.
  visualizer/project_shadow_analysis.ts
                            Project mode: builds the module import graph,
                            writes transformed sources to a shadow dir, runs
                            `deno check` there, returns dependency/typecheck
                            diagnostics without touching real runtime files.
  visualizer/runtime.ts     Process-global instrumentation store the GENERATED
                            modules import at run time: active wait counts per
                            (moduleId, callsiteId), piano-roll lookup names,
                            snapshot assembly. Singleton because it is imported
                            at a stable URL while generated modules are
                            cache-busted per run.
  visualizer/piano_roll_store.ts
                            Server-owned named piano-roll objects: revisions,
                            per-object undo/redo, dirty-flag snapshot cadence.
                            This is the prototype for the future unified
                            entity store.
  visualizer/lsp_proxy.ts   Spawned per LSP session; creates a temp workspace
                            and runs `deno lsp` for real editor semantics.
  visualizer/main.ts        CLI entrypoint for the server.
  visualizer/protocol.ts    All shared request/response/snapshot types.
  helpers/midi_helpers.ts   Eager MIDI device init + output registry.
  helpers/piano_roll_helpers.ts
                            Livecode-facing API over the piano-roll store
                            (getPianoRollClip/setPianoRollClip/playPianoRoll).
  tests/                    Unit + server-protocol + e2e tests. tests/repro/
                            holds the reproducing tests for THIS plan.
  architecture.md           Deno-side architecture doc + file index.
  timeContextVisualizerPlans/
                            Planning docs, including this plan and
                            brainstorming.md.

apps/livecode-tldraw/
  architecture.md           Client-side architecture doc + file index.
  brainstorm.md             Owner's notes on future features/usage.

apps/livecode-tldraw/src/
  App.tsx                   Providers, server toolbar, .tldr load/save, tldraw
                            store->runtime registration listener, the
                            /client/control websocket (agent command channel).
  livecodeRuntime.tsx       React runtime store: module records (source, build
                            state, run state, manifest, snapshots), the
                            /runtime/snapshots websocket, analyze debounce,
                            project diagnostics polling, LSP connection.
  LivecodeEditorShape.tsx   The `livecode-editor` custom tldraw shape: Run/Stop
                            UI, CodeMirror host, wait-highlight range mapping.
  CodeMirrorEditor.tsx      CodeMirror instance, LSP extension, decorations,
                            canvas event shielding.
  PianoRollShape.tsx        The `piano-roll-view` shape: a named VIEW onto a
                            server-owned roll (notes are not canonical in
                            shape props).
  pianoRollRuntime.tsx      /piano-roll/snapshots websocket + set/undo/redo.
  livecodeProtocol.ts, pianoRollTypes.ts
                            Hand-mirrored copies of the Deno protocol types
                            (drift-prone; a shared package is planned).
  livecodeTldrawDebug.ts    window.__livecodeTldrawRuntimeDebug — the API the
                            Playwright e2e (and agents) use to drive the app.
  tests/livecodeTldraw.e2e.mjs  Playwright end-to-end test.

apps/browser-projections/src/pianoRoll/   Vue piano-roll source; built into
webcomponents/piano-roll/dist/piano-roll.js which livecode-tldraw imports.
```

### Required reading

Read these four docs BEFORE starting work, and re-read them as needed after
any context compaction — they are the grounding this plan assumes:

- `apps/deno-notebooks/livecode/architecture.md` — Deno-side constraints,
  routes, runtime flow, file index, verification commands.
- `apps/livecode-tldraw/architecture.md` — client-side constraints, event
  boundaries, file index, verification commands.
- `apps/livecode-tldraw/brainstorm.md` and
  `apps/deno-notebooks/livecode/timeContextVisualizerPlans/brainstorming.md`
  — the owner's notes on where the project goes next (features and usage).
  A fix that makes these directions harder is the wrong fix even if it
  closes the ticket.

Key runtime relationships to keep in your head:

- **Edit flow:** keystroke → (100ms debounce) → `/runtime/analyze` → server
  writes source, runs the ts-morph transform, writes a generated module file,
  returns `{ generatedRunId, transformedModuleUri, manifest }`.
- **Run flow:** Run button → `/runtime/launch {generatedRunId}` → server queues
  into the parent TimeContext loop → dynamic `import()` of the generated file
  (cache-busted with a query param per launch) → `ctx.branch(runFunc)`.
  Stopping = cancelling that branch (cancellation cascades to children).
- **Visualization flow:** generated code calls
  `visualizedAwait(moduleId, callsiteId, promise)` around instrumented waits →
  `runtime.ts` counts them → server broadcasts snapshots at ~30Hz →
  client joins active callsite IDs to the manifest's source ranges →
  CodeMirror decorations.
- **Module identity:** generated modules are immutable once imported (fresh
  import per launch). Helpers (`runtime.ts`, `midi-helpers`,
  `piano-roll-helpers`) are imported at STABLE specifiers, so they are
  process-global singletons shared across all module runs. This is the seam
  that makes shared state work; preserve it.
- **Project mode:** `*.orig.ts` files are the canonical editable source;
  `*.ts` files are transformed runtime output. Never edit `*.ts` runtime
  files by hand; the server regenerates them.

## Motivations and design principles (read before making ANY judgement call)

These were established explicitly with the project owner. When an item in
this plan under-specifies something, resolve the ambiguity in the direction
these principles point; if two principles conflict, stop and ask.

1. **Live performance first.** This tool's primary context is a human on
   stage. The Deno server must survive an hours-long set: nothing may crash
   the process, leak without bound, block the edit loop for seconds, or leave
   a MIDI note sounding with no way to silence it. "Studio" features matter
   only insofar as the OfflineRunner's deterministic stepping enables offline
   rendering. When you must trade elegance against on-stage failure modes,
   choose the boring option that cannot fail loudly at a gig.

2. **Deno executes; the browser is disposable chrome.** Code never runs in the
   browser, and that will not change. The browser may crash or reload mid-set
   while the music keeps playing; on reconnect it must recover EVERYTHING from
   the server (run state, manifests, layout). Therefore: the server is the
   single source of truth; the client must never be the only holder of any
   state that matters; client-side inference about server state ("it was
   running when I last looked") is a bug pattern, not a feature.

3. **No blessed orchestrators.** There is deliberately no privileged
   "conductor" module type and no hardcoded registry object in the system.
   All coordination between modules is a *pattern of usage*: shared state
   lives in process-global stores (like the piano-roll store), modules
   communicate by reading/writing named entries, and module re-runs are
   invisible to other modules except through the values they write. The
   agreed convention: **imports carry types and tokens; the store carries
   values.** A token is `{ key: string }` plus a phantom type; token identity
   must always be the string key, never object identity, because generated
   modules are re-imported per run and project modules can be reloaded.

4. **Safety comes from analysis, not enforcement.** The system should never
   stop the user from doing something musical; instead, "blessed" usage
   patterns (typed tokens, literal names, awaited context-carrying calls) get
   precise automatic warnings via the TypeScript compiler and the analyzer's
   detectors, and everything else gets best-effort warnings or an explicit
   "unanalyzable" notice. Corollary from the existing analyzer: **unsupported
   detectable patterns should ERROR visibly rather than silently produce
   misleading behavior or visualization.** Silence is the enemy — a no-op
   that looks like success (e.g. the old `awaitBarrier`-before-`startBarrier`
   behavior) is the worst failure mode this project has.

5. **No-surprise execution.** Disk changes, agent edits, and analysis are
   *state*, never an instruction to run code. Launching, replacing, or
   stopping a module is always an explicit user or agent action
   (`replaceRunning: true` is opt-in). Preserve this in every fix: never make
   something auto-run, auto-restart, or auto-replace as a side effect.

6. **An AI agent is a first-class operator.** Agents drive the system through
   the same server-side actions as the human (the `/client/control` channel
   and, later, an MCP surface over store actions). Design consequences:
   actions should be serializable data (auditable, loggable, replayable); the
   agent and the human must see the SAME state (no client-only corrections);
   and anything the UI can do should be reachable without a browser.

7. **Cross-module synchronization is musical, not metric.** Barriers exist to
   synchronize generative voices whose phase boundaries do NOT fall on clean
   downbeats — so do not "fix" barrier problems by imposing quantized-launch
   or conductor-ownership semantics. The agreed direction: make barrier state
   indifferent to which module's lifetime created it (auto-create on await,
   adopt in-progress cycles when the previous starter is dead), and surface
   everything else (collisions, orphaned waiters, missing producers) as
   warnings computed from statically-detected per-module barrier roles.

8. **Direction of travel (don't build against it).** Planned refactors, in
   order: a unified `(type,id)`-keyed entity store with action dispatch and an
   ops log, one multiplexed snapshot/patch WebSocket replacing the several
   sockets + polls; a detector plugin API generalizing the piano-roll
   detector (kind + import bindings + match + wrap + manifest payload); an
   MCP agent surface gated on a session auth token. When fixing something in
   an area these will replace, prefer the minimal fix over new parallel
   infrastructure that would deepen the pattern being replaced.

9. **Judgement-call heuristics, in priority order:** (a) never crash the Deno
   process; (b) never silently do nothing — error, warn, or visualize;
   (c) server truth beats client inference; (d) keep the user-facing livecode
   API small and explicit — a little boilerplate beats magic; (e) never
   change timing-engine semantics beyond what an item explicitly authorizes —
   the engine's determinism and drift-free invariants are the most valuable
   thing in this codebase.

## How to use this document (rules for the implementing model)

- Work **phase by phase, item by item, in order**. Do not start a later phase
  before the earlier phase's verification passes. Items within a phase marked
  (independent) can be done in any order.
- Every item lists **Evidence**, **Fix**, **Verify**, and (where needed)
  **Do NOT**. Follow the Verify steps literally.
- Line numbers are approximate (they drift). Always locate code by the quoted
  function/identifier names, not by line number alone.
- **Reproducing tests already exist** in
  `apps/deno-notebooks/livecode/tests/repro/`. They currently PASS by
  asserting the *buggy* behavior. Each test contains an `AFTER FIX:` comment
  telling you how to flip its assertions once the fix lands. Flipping the
  assertion converts the repro into a permanent regression test — always do
  this as part of the fix, in the same change.
- Run the repro suite from `apps/deno-notebooks` with:
  `deno task test:livecode:repro`
- After any change in an area, also run the relevant existing suites:
  `deno task test:livecode:unit`, `deno task test:livecode:server`, and for
  client work `cd apps/livecode-tldraw && npm run type-check && npm run build`.
- If a fix requires an engine semantics decision that is not spelled out here,
  STOP and ask the project owner. Do not invent timing semantics.

## IMPLEMENTATION STATUS (as of 2026-07-02) — read this before picking up work

**DONE (implemented, reviewed, all suites green):**

- Phases 0–3 in full, plus Phase 4 items 4 (E6 tempo compaction) and
  5 (E7 beatPQs cleanup).
- A post-implementation multi-agent code review of that commit found 10
  defects, ALL fixed since: real LSP child kill (`proxy.process.kill`),
  tempo-compaction `progBeats` fix (contexts cache `startBeats` at
  creation), in-flight diagnostics hash guard, parse-diagnostics without
  `getProgram()` on the analyze hot path, never-throwing piano-roll
  `normalizeData`, import-binding rename-collision check, broadened
  run-adoption with `lastTerminalRun` staleness guard, one shared
  `reconnectingSocket.ts` (replacing 3 bespoke copies; auto-reconnect also
  re-runs health + LSP recovery in onOpen), piano-roll echo suppression
  independent of HTTP timing (undo/redo use a distinct `:history` origin),
  and piano-roll view layout persisted via `POST /project/canvas` +
  restored on project load.
- Phase 4 decision points, all resolved by the owner and implemented:
  E3 (`cancelSafe(value)` on the proxy), E9/E10 barrier semantics
  (start-never-releases / adopt; `purgeBarriersForRoot`), E8 zero-advance
  stall guard (`MAX_ZERO_ADVANCE_SLICES = 10_000`).
- The eight known-but-unfixed cleanup items from the code review (2026-07-06):
  shared `teardownActiveModule` used by both `stopModule` and `panicRuntime`;
  `ProjectState.materialized` validity is now documented as a read-time
  `sourceHash` comparison and the scattered manual `materialized.delete`
  invalidations were removed; the diagnostics poll reuses a per-project
  stat-keyed (mtime+size) `sourceContentCache` so idle polls stop re-reading
  and re-hashing every `*.orig.ts` (out-of-band editor edits still detected
  via the stat check); `clampMidi` lives once in `helpers/midi_math.ts`
  (side-effect-free so it does not disturb piano_roll_helpers' deliberate
  dynamic import of midi_helpers); the startup LSP-workspace sweep is
  fire-and-forget; `setPianoRoll` no-ops with a single serialize against a
  cached `lastDataJson` (with a `safeStringify` guard so circular/BigInt
  metadata still never throws — regression test in
  piano_roll_store_repro_test.ts "P4 addendum"); shared
  `tests/test_helpers.ts` (postJson/fetchJson/sleep/waitFor) replaces the
  copy-pasted test helpers; shared `visualizer/fs_utils.ts`
  `removePathBestEffort` replaces the repeated remove-and-swallow idiom.

**OPEN WORK (documented in-place in the phases below; consolidated here):**

1. **E4 replacement (Phase 4 item 2 — unblocked, no decisions pending):**
   move the ts-morph analyze/materialize transform into a Deno `Worker`,
   and pre-warm heavy library imports at server startup. The catch-up
   clamp itself is deliberately NOT being built.
2. **E5 visibility (Phase 4 item 3):** runtime rebase detection surfaced
   as a snapshot badge — ships with the Phase 5 snapshot/detector work.
3. **Barrier visibility (Phase 4 item 7):** barrier state in runtime
   snapshots ("awaiting 'phrase' — no producer") so typo'd names / dead
   producers are distinguishable from intentional free-run — also Phase 5.
4. **All of Phase 5** (unified store, detector plugin API, MCP surface +
   auth token, shared protocol package, shadow-diagnostic position
   mapping). Each needs an owner checkpoint before starting.

(The former item 5 — the eight known-but-unfixed cleanup items from the
code review — was completed 2026-07-06; see the DONE inventory above.)

## Validation status of the findings

Reproduced by executable tests (all in `livecode/tests/repro/`, all passing
against current code as of this writing):

| ID  | Test file | Defect |
|-----|-----------|--------|
| E1  | engine_repro_test.ts | Root cancel emits an unhandled rejection (process-fatal in Deno without a trap) |
| E2  | engine_repro_test.ts | `branch(...).finally(fn)` emits an unhandled rejection on branch cancel |
| E3  | engine_repro_test.ts | Cancelling a `branchWait` child rejects/tears down the awaiting parent |
| E4  | engine_repro_test.ts | No catch-up clamp: after an event-loop stall, overdue waits replay in a zero-delay burst |
| E5  | engine_repro_test.ts | Global `mostRecentDescendentTime` floor: a module resuming from a non-engine await silently jumps forward |
| E6  | engine_repro_test.ts | Tempo map segments grow unbounded (one per `setBpm`, two per ramp) |
| E7  | engine_repro_test.ts | `scheduler.beatPQs` leaks one entry per cancelled cloned-tempo branch |
| E8  | engine_repro_test.ts | `wait(0)` resolves without advancing logical time → `while(true){await ctx.wait(0)}` spins forever |
| E9  | engine_repro_test.ts | `awaitBarrier` on a never-started barrier silently resolves immediately (no sync) |
| E10 | engine_repro_test.ts | `startBarrier` during an in-progress cycle force-releases all waiters early |
| A1  | analyzer_repro_test.ts | Renaming a recursive named default export leaves dangling self-references (`ReferenceError` at run) |
| P1  | piano_roll_store_repro_test.ts | Stored notes alias caller-owned nested objects (`mpePitch` mutates store silently, no rev bump) |
| P2  | piano_roll_store_repro_test.ts | Piano-roll writes ignore revisions; concurrent writers silently clobber |
| S1  | server_repro_test.ts | Any throwing route handler produces an opaque 500 (no error guard on the HTTP layer) |
| S2  | server_repro_test.ts | `preparedRuns` + generated module files accumulate forever (one per analyze) |
| S3  | server_repro_test.ts | Analyzing ONE project module re-transforms and rewrites EVERY module's runtime file |

Verified by code inspection only (no executable repro yet; verification steps
are given inline): all client (React/tldraw) findings in Phase 3, the MIDI
device findings (no MIDI hardware in CI), the LSP subprocess/temp-dir
findings, the shadow-diagnostics overlap race, and the shadow diagnostic
line-offset mismatch. Grep-confirmed: `closeMidiDevices` has zero callers;
`main.ts` has no `Deno.addSignalListener`; `lsp_proxy.ts` contains no cleanup
of its temp workspaces.

---

# PHASE 0 — Process-killers and panic ✅ DONE 2026-07

## 0.1 Fix the engine's fatal `.finally` on root cleanup (E1)

**Evidence:** `packages/core-timing/offline_time_context.ts`, in
`createAndLaunchContext`, the root-only block:

```ts
if (!parentContext) {
  rootContexts.add(newContext);
  const cleanupRoot = () => rootContexts.delete(newContext);
  promiseProxy.handleCancel(cleanupRoot);
  promiseProxy.finally(cleanupRoot);   // <-- BUG
}
```

`promiseProxy.finally` delegates to `blockPromise.finally(...)`, which returns
a NEW promise that rejects whenever the block rejects (i.e. on every cancel of
a root that is parked on a wait). That derived promise is discarded → Deno
unhandled rejection → process death. Repro: test `BUG E1`.

**Fix:** replace `promiseProxy.finally(cleanupRoot)` with a chain off the
already-caught `bp` (defined a few lines above as
`const bp = blockPromise.catch(...)`):

```ts
bp.finally(cleanupRoot);
```

Keep the `handleCancel(cleanupRoot)` line (it covers cancellation that never
settles the block). `handleCancel`'s internal `called` guard makes double
invocation harmless, but confirm `cleanupRoot` is idempotent (it is — Set
delete).

**Verify:** flip the assertion in `BUG E1` to
`assertEquals(trap.events.length, 0)` and run
`deno task test:livecode:repro`. Also run the whole existing core-timing test
surface if one exists (search `packages/core-timing` and
`apps/deno-notebooks` for tests importing `@avtools/core-timing`).

## 0.2 Make the public `branch(...).finally` safe (E2)

**Evidence:** in `TimeContext.branch(...)` (same file), the returned handle:

```ts
return {
  finally: (finalFunc: () => void) => promise.finally(finalFunc),  // <-- BUG
  cancel: () => promise.cancel(),
  handleCancel: (cancelFunc: () => void) => promise.handleCancel(cancelFunc),
};
```

`promise.finally(f)` returns a derived promise that rejects on cancel; callers
(reasonably) discard it. Repro: test `BUG E2`.

**Fix:** attach the callback to a caught chain and swallow the propagated
rejection on the derived promise:

```ts
finally: (finalFunc: () => void) => {
  const chained = promise.finally(finalFunc);
  chained.catch(() => {});
  return chained;
},
```

This preserves the return value for callers who DO chain on it, while making
the discard pattern safe.

**Verify:** flip `BUG E2` to `assertEquals(trap.events.length, 0)` (keep the
`cleanupRan` assertion). Run the repro suite.

## 0.3 Sounding-note registry + `panicMidi()` in midi_helpers

**Evidence:** `apps/deno-notebooks/livecode/helpers/midi_helpers.ts` —
`closeMidiDevices` (≈lines 110-119) has zero callers anywhere in the repo.
There is no record of currently-sounding notes; note-offs in
`piano_roll_helpers.ts` `playPianoRoll` (≈lines 150-161) fire only from branch
`finally`/`handleCancel`. If a note-off throws or is never delivered, nothing
can silence the note.

**Fix (all in midi_helpers.ts, no API breaks):**

1. Add a module-global registry:
   `const soundingNotes = new Map<string, { device: <existing device type>, channel: number, pitch: number }>()`
   keyed by `"<deviceName>:<channel>:<pitch>"`.
2. Find where note-on/note-off are sent (the device wrapper used by
   `playPianoRoll` — follow `requireMidiDevice`/`getMidiDevice` to the object
   with `noteOn`/`noteOff` methods). Wrap sends so:
   - note-on inserts into `soundingNotes`;
   - note-off deletes from `soundingNotes`;
   - both catch device errors, log them via `console.error`, and DO NOT throw
     into music code.
3. Export `panicMidi(): void` that, for every opened output:
   - sends note-off for every entry in `soundingNotes` for that device;
   - sends CC 123 (All Notes Off) and CC 120 (All Sound Off) on every channel
     seen in the registry (and channel 0 as a fallback);
   - clears the registry. Every send is individually try/caught.
4. Make the top-level device-open loop resilient: wrap each per-port
   `openOutput` in try/catch so one unopenable port logs a warning instead of
   failing the entire module import (currently a listable-but-unopenable port
   throws at import time and breaks `playPianoRoll`'s dynamic import).

**Verify:** `deno check` the file; add a unit test that stubs a fake device
object, plays note-ons via the wrapper, calls `panicMidi()`, and asserts
note-offs + CC123/120 were sent and the registry is empty. No MIDI hardware
needed if the device wrapper is injectable — if it is not, make the send
functions take the device object so the test can pass a fake.

## 0.4 `POST /runtime/panic` + parallel stop

**Evidence:** `apps/deno-notebooks/livecode/visualizer/server.ts` —
`stopAllModules` (search for `async function stopAllModules`) stops modules
**sequentially**, and `runModuleStopFunc` waits up to `STOP_HOOK_TIMEOUT_MS`
(2000ms) per module. 8 modules with hung `stop()` hooks = 16 seconds of sound
after "stop all". There is no panic route and server `close()` never touches
MIDI.

**Fix (server.ts):**

1. Add a route `POST /runtime/panic` (place next to `/runtime/stop-all`):
   - For every entry in `activeModules`: call `active.handle.cancel()`
     immediately (do NOT run `stopFunc` — panic must be instant), delete from
     `activeModules`, `clearModuleWaits(moduleId)`, and set the run snapshot
     to `stopped` with message `"panic"`.
   - Then `import { panicMidi } from "../helpers/midi_helpers.ts"` (static
     import at top of file) and call it.
   - Return `{ ok: true }`.
2. Change `stopAllModules` to run its per-module stops with
   `await Promise.all([...activeModules.keys()].map(id => stopModule(id, reason)))`
   so graceful stop-hook timeouts overlap instead of stacking.
3. In the server `close()` function, call `panicMidi()` after stopping
   modules.

**Verify:** extend `server_repro_test.ts` (or a new test) — launch two fixture
modules whose source exports `export function stop() { return new Promise(() => {}); }`
(a hung stop hook), call `/runtime/stop-all`, assert wall time < 3500ms (was
~4000ms+ sequential; now the two 2s timeouts overlap). Then call
`/runtime/panic` with a running module and assert it returns in < 500ms and
`/runtime/status` shows no active modules.

## 0.5 Signal handlers and LSP cleanup

**Evidence:** `livecode/visualizer/main.ts` has no `Deno.addSignalListener`
(grep-confirmed) — Ctrl-C skips `server.close()` entirely, orphaning `deno
lsp` grandchildren and leaving notes sounding. `lsp_proxy.ts` creates a
uuid-named temp workspace per invocation (≈lines 21-26) and never removes it,
and installs no signal handling to kill its spawned `deno lsp` child.

**Fix:**

1. `main.ts`: after creating the server, register:
   ```ts
   for (const sig of ["SIGINT", "SIGTERM"] as const) {
     Deno.addSignalListener(sig, async () => {
       await server.close(); // close() now includes panicMidi() from 0.4
       Deno.exit(0);
     });
   }
   ```
2. `lsp_proxy.ts`: record the created workspace dir path and the spawned child
   process; add SIGINT/SIGTERM listeners (and a `finally` around the main
   loop) that kill the child and `Deno.remove(workspaceDir, { recursive: true })`
   best-effort.
3. Server startup sweep: in `createLivecodeVisualizerServer`, after computing
   `lspWorkspacesDir`'s parent (`$TMPDIR/avtools-livecode-lsp-workspaces`),
   best-effort delete subdirectories older than 24h (wrap in try/catch; never
   fail startup over this).

**Verify:** start the server via `deno task livecode:server`, connect the
tldraw client so an LSP session spawns, Ctrl-C the server, then check
`ps aux | grep "deno lsp"` shows no orphans and the session's workspace dir under
`$TMPDIR/avtools-livecode-lsp-workspaces` is gone.

---

# PHASE 1 — Edit-loop robustness and performance ✅ DONE 2026-07

## 1.1 Guard the HTTP handler (S1) (independent)

**Evidence:** `server.ts` — `const handler = async (request) => {...}` has no
outer try/catch; `requireCurrentProject()`, ts-morph, and filesystem errors
propagate to `Deno.serve`'s opaque 500. Repro: test `BUG S1`.

**Fix:** wrap the entire handler body:

```ts
const handler = async (request: Request): Promise<Response> => {
  try {
    return await routeRequest(request); // rename current body to routeRequest
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void log({ type: "handlerError", path: new URL(request.url).pathname, message });
    return json({ ok: false, error: message }, { status: 500 });
  }
};
```

Keep WebSocket-upgrade routes working: `Deno.upgradeWebSocket` responses must
be returned as-is (they are — the try/catch only matters when something
throws before returning).

**Verify:** flip `BUG S1` to expect a JSON body with `ok === false` and an
`error` string (status may stay 500). Run `deno task test:livecode:repro` and
`deno task test:livecode:server`.

## 1.2 Skip unchanged modules in `materializeProjectRuntime` (S3)

**Evidence:** `server.ts` `materializeProjectRuntime` transforms and rewrites
every project module on every call; it is called on every
`/project/modules/write` AND every `/runtime/analyze` (twice per edit
debounce). Repro: test `BUG S3` (mtimes of unrelated modules change).

**Fix:** inside `materializeProjectRuntime`, cache the last successful
transform per module: add to `ProjectState` a
`materialized: Map<string, { sourceHash: string; transformResult: AnalyzeResponse }>`.
In the per-module loop: if `sourceHashes.get(id)` equals the cached
`sourceHash` and a cached success result exists, reuse the cached result and
SKIP `analyzeAndTransformTimedModule` and the `Deno.writeTextFile` for that
module. Invalidate a module's cache entry in `writeProjectModuleSource`,
`reloadProjectModule`, and `removeProjectModule`.

Note: the per-run `generatedRunId` is shared by the whole materialize result;
cached entries keep their manifests (callsite IDs are content-derived via the
id factory — confirm by checking `generated_run_id.ts` and the `idFactory`
used; if callsite IDs embed the generatedRunId, keep the manifest cached but
refresh only the `generatedRunId` field in the returned response).

**Do NOT** change the double-call structure yet (write→materialize,
analyze→materialize). With the hash-skip in place the second call is nearly
free. Removing the double call is optional follow-up.

**Verify:** flip `BUG S3` so only `mod_a.ts`'s mtime changes. Run repro +
`deno test --allow-all livecode/tests/project_shadow_diagnostics_test.ts` +
`deno task test:livecode:server`.

## 1.3 Prune prepared runs and generated files (S2) (independent)

**Evidence:** `server.ts` `preparedRuns` map — entries added in
`analyzeModule`, never deleted; generated files written to `generatedDir`
accumulate one per analyze. Repro: test `BUG S2`.

**Fix:** keep at most N=3 prepared runs per moduleId. Maintain
`preparedRunIdsByModule: Map<string, string[]>`. After inserting into
`preparedRuns`, push the id; while length > 3: shift the oldest id, delete it
from `preparedRuns`, and `Deno.remove` its generated file (only for
non-project runs — project runs share per-module runtime paths that get
overwritten, not accumulated) — wrap the remove in try/catch. NEVER delete a
prepared run whose `generatedRunId` matches a currently `activeModules` entry.

**Verify:** flip `BUG S2` to expect `<= 3` generated files after 6 analyzes.
Run repro + `deno task test:livecode:server` (the smoke test analyzes then
launches — pruning must not break the launch of the latest build).

## 1.4 Shadow diagnostics: in-flight guard + hash short-circuit (independent)

**Evidence:** `project_shadow_analysis.ts` `analyzeProjectShadow` starts with
`recreateDirectory(shadowRoot)` (a shared per-session dir), builds ~3·N
ts-morph Projects, and spawns a cold `deno check` per poll; the client polls
every 2.5s (`PROJECT_DIAGNOSTICS_POLL_MS` in `livecodeRuntime.tsx`). Polls
that outlast the interval overlap and race on the shared dir.

**Fix (in server.ts around `makeProjectDiagnosticsResponse`):**

1. Add module-scope state: `let diagnosticsInFlight: Promise<ProjectShadowCheckResponse> | null = null;`
   and `let lastDiagnostics: { projectSourceHash: string; response: ProjectShadowCheckResponse } | null = null;`
2. In `makeProjectDiagnosticsResponse`: compute the current
   `projectSourceHash` first (reuse the logic from `makeProjectStatusResponse`
   — extract a helper). If `lastDiagnostics` matches the hash, return the
   cached response. If `diagnosticsInFlight` is set, return
   `await diagnosticsInFlight`. Otherwise set `diagnosticsInFlight` to the
   real work, cache the result keyed by the hash it was computed FROM, clear
   `diagnosticsInFlight` in `finally`.
3. In `analyzeProjectShadow`, write into a fresh subdirectory
   `join(request.shadowRoot, crypto.randomUUID())` instead of wiping
   `shadowRoot` itself; delete that subdirectory (best-effort) after
   `deno check` finishes.

**Verify:** run `deno test --allow-all livecode/tests/project_shadow_diagnostics_test.ts`
(must still pass). Then a manual check: open a project with a few modules,
fire 5 parallel `curl $base/project/diagnostics &` and confirm all return
`ok: true` and the server logs no `handlerError`.

## 1.5 Analyzer correctness fixes (A1 + syntax-error reporting) (independent)

**Evidence A1:** `analyze_transform.ts` `normalizeDefaultExportToRunFunc`
renames the declaration name node only; recursive references keep the old
name. Repro: test `BUG A1`.

**Fix A1:** simplest robust approach — when the default export function has a
name (e.g. `loop`), after renaming the declaration to `runFunc`, also append
`const loop = runFunc;` immediately after the function declaration in the
magic-string output (use the original name captured before rename). This
preserves self-references without needing full reference rewriting. (Do not
try symbol-renaming every reference with ts-morph `rename()` — it mutates the
AST underneath magic-string offsets. The alias line is offset-safe because it
is an insertion, and the manifest ranges reference original source offsets.)

Check for a collision first: if the module already declares another top-level
binding named the same as the alias (impossible for the function's own name,
but be safe), skip the alias and emit a diagnostic instead.

**Evidence (syntax errors):** `analyzeAndTransformTimedModule` never inspects
parse diagnostics; broken mid-typing input yields a misleading
`TCV_NO_DEFAULT_TIMED_ROOT` with a 1-character range at offset 0.

**Fix:** at the top of the function, after creating the source file, check
`sourceFile.getPreEmitDiagnostics()` — actually for speed use only *syntactic*
diagnostics: `project.getProgram().compilerObject.getSyntacticDiagnostics(sourceFile.compilerNode)`.
If any exist, return an `analyzeFailure` with code `TCV_SYNTAX_ERROR`, one
diagnostic per entry, using each diagnostic's `start`/`length` for
`from`/`to`. This is cheap (no type-check) and turns mid-typing garbage into
positioned squiggles instead of a bogus "no default timed root".

**Verify:** flip `BUG A1` per its comment. Add one unit test: input
`export default async function f(ctx: TimeContext) { await ctx.waitSec(0.1);`
(missing brace) → expect `analyzeFailure` with `TCV_SYNTAX_ERROR` and a range
near the end of the text. Run `deno task test:livecode:unit`.

## 1.6 Piano-roll store fixes (P1, P2) (independent)

**Evidence:** `piano_roll_store.ts` `normalizeNote` uses a shallow spread —
nested `mpePitch`/`metadata` alias caller objects (repro `BUG P1`);
`setPianoRoll` has no revision argument (repro `BUG P2`); livecode writes
default to `undoable: true`, churning full-data clones.

**Fix:**

1. In `normalizeData` (or `normalizeNote`), deep-clone:
   `return structuredClone({ ...data, notes: data.notes.map(normalizeNote) })`
   — one `structuredClone` of the whole normalized payload is simplest.
2. Add `expectedRev?: number` to `SetPianoRollOptions`. In `setPianoRoll`, if
   `expectedRev !== undefined && existing && existing.rev !== expectedRev`,
   return the current object unchanged plus a conflict signal. To avoid
   breaking the return type, add an optional field to the returned object:
   `{ ...toObject(existing), conflict: true }` and extend the protocol type
   (`PianoRollObject`) with `conflict?: boolean`. Plumb `expectedRev` through
   `POST /piano-roll/set` (`SetPianoRollRequest`) and through
   `setPianoRollClip` in `piano_roll_helpers.ts` as an optional option.
   Callers that don't pass it keep last-write-wins (current behavior).
3. In `piano_roll_helpers.ts` `setPianoRollClip`, default the store write to
   `undoable: false` (livecode loops should not spam the user's undo stack);
   add an options parameter so callers can opt back in.

**Verify:** flip `BUG P1` (expect 1 point, unchanged rev) and update `BUG P2`
to exercise `expectedRev` (stale rev → `conflict: true`, data unchanged; fresh
rev → applied). Run repro + `deno task test:livecode:server` (piano-roll
snapshot shapes must not break — `conflict` is optional).

---

# PHASE 2 — Server-truth run state and rehydration ✅ DONE 2026-07

## 2.1 Retain manifests server-side; add `GET /runtime/state`

**Evidence:** `server.ts` — `PreparedRun` and `ActiveModule` store no
manifest; after a browser reload the wait-highlight manifest for a running
module is unrecoverable (`/runtime/status` returns only ids/uris/hashes).

**Fix:**

1. Add `manifest: VisualizerManifestMessage` to `PreparedRun` and
   `ActiveModule`. Populate `PreparedRun.manifest` in both branches of
   `analyzeModule` (project and single-file: `result.manifest`). Copy it into
   the `ActiveModule` record in `launchModule` (from
   `preparedRuns.get(generatedRunId)`; if the prepared run is missing —
   client-supplied launch — accept an optional `manifest` field on
   `LaunchModuleRequest`, else store `null` and note it in the response).
2. Add route `GET /runtime/state` returning:
   ```ts
   {
     ok: true,
     activeModules: [...activeModules.values()].map(a => ({
       moduleId, generatedRunId, transformedModuleUri, projectModulePath,
       sourceHash, projectSourceHash, manifest,
     })),
     moduleRuns: Object.fromEntries(moduleRunSnapshots.entries()),
     latestPreparedByModule: /* newest preparedRuns entry per moduleId:
        { generatedRunId, sourceHash, manifest } */,
   }
   ```
3. Mirror the new types in `apps/livecode-tldraw/src/livecodeProtocol.ts`.

**Verify:** new server test — analyze, launch, then `GET /runtime/state` and
assert the running module's entry includes a manifest whose callsites match
the analyze response. Run `deno task test:livecode:server`.

## 2.2 Client: auto-reconnect both sockets

**Evidence:** `apps/livecode-tldraw/src/livecodeRuntime.tsx` — the
`/runtime/snapshots` socket's `onclose` (search `socket.onclose`) only sets
status `"closed"`; `pianoRollRuntime.tsx`'s socket effect likewise never
retries. The control socket in `App.tsx` DOES reconnect (search
`setTimeout` near the control socket) — use the same pattern.

**Fix:**

1. `livecodeRuntime.tsx`: add a `reconnectTimerRef` and a
   `shouldReconnectRef` (set true in `connect()`, false in `disconnect()`).
   In `socket.onclose`: if `shouldReconnectRef.current` and this socket is the
   current one, schedule `connect()` after a backoff (start 1000ms, double to
   max 10s, reset on successful open). In `socket.onopen`, reset the backoff.
2. `pianoRollRuntime.tsx`: same pattern inside the effect — on `close`, if the
   effect is still mounted (track with a local `disposed` flag in the effect
   closure), schedule re-creation of the socket after backoff. Ensure the
   cleanup function clears the timer.
3. While disconnected, set each module's `runStatus` to a new value
   `"unknown"` (add to the `RunStatus` union) rather than leaving `"running"`
   — the UI must not assert state it cannot know. Render `"unknown"` as a
   distinct badge in `LivecodeEditorShape.tsx`.

**Verify:** `npm run type-check && npm run build`. Manual: start server +
client, connect, run a module, kill the server, restart it — within ~10s the
client must reconnect, and after reconnect the module state must reflect
server truth (with 2.3 below, exactly; without it, at least no stale
"running"). If the Playwright e2e (`npm run test:e2e`) exists in your
environment, run it.

## 2.3 Client: rehydrate from `/runtime/state` on connect

**Evidence:** on reload/reconnect, `livecodeRuntime.tsx` re-analyzes all
modules (`socket.onopen` → `scheduleAnalyze`) but rebuilds no run state; run
correlation relies on the reload-lost `activeGeneratedRunId`; and
`applyModuleRunSnapshot` re-marks stopped modules as running when a stale
snapshot arrives (the `!record.activeGeneratedRunId` clause — confirmed in
code).

**Fix:**

1. In `connect()`, after the snapshot socket opens, `fetch
   ${serverBaseUrl}/runtime/state`; for each registered module present in
   `activeModules` of the response: set `runStatus = "running"`,
   `activeGeneratedRunId = generatedRunId`, `manifest = manifest ?? record.manifest`.
   For registered modules NOT active: set `runStatus` from
   `moduleRuns[moduleId]?.state ?? "idle"` and `activeGeneratedRunId = null`.
2. Fix `applyModuleRunSnapshot`: a snapshot may only set `runStatus =
   "running"` when `run.generatedRunId === record.activeGeneratedRunId` OR
   when the record has `runStatus === "unknown"` (post-reconnect, adopt server
   truth). Delete the `!record.activeGeneratedRunId ||` clause in the
   is-server-active branch. Keep terminal-state application when
   `matchesActiveRun`.
3. On `stopModule` success, keep `activeGeneratedRunId` set until a terminal
   snapshot for THAT run id arrives (i.e. stop clearing it eagerly — change
   the stop handler to leave the id in place and set `runStatus: "stopping"`).
   This removes the window where stale snapshots matched a null id.
4. Queue stops for shapes deleted while disconnected: in `unregisterModule`,
   if not connected, push the moduleId onto a `pendingStopsRef` array; flush
   it (POST `/runtime/stop` per id) right after rehydrate in `connect()`.

**Verify:** manual script (or extend the Playwright e2e): connect, run a
module with waits, hard-reload the browser tab, click Connect — the module
must show running WITH wait highlights (manifest recovered), and Stop must
work. Then: run a module, disconnect (kill server), delete the shape,
restart server, reconnect — the orphaned run must be stopped within one
connect cycle.

## 2.4 Canvas layout persistence (project mode)

**Evidence:** `App.tsx` reads `ProjectModuleRecord` x/y/w/h at load; nothing
writes them back. `LivecodeProjectManifest` already has the fields.

**Fix:** in `App.tsx`'s store listener (the `updated` branch), when a
livecode-editor or piano-roll shape's `x/y/w/h` change and the module is a
project module, debounce (1s) a POST to `/project/modules/update` with
`{ id, x, y, w, h }`. Do the same for the shape's `w/h` props. Guard against
loops: `/project/modules/update` responses must not re-apply positions to
shapes (they don't today — verify no code path does).

**Verify:** open a project, move a module shape, wait 2s, reload the page —
the shape must come back where it was moved (check the project manifest JSON
on disk shows the new x/y).

---

# PHASE 3 — Remaining client fixes ✅ DONE 2026-07

For each, the evidence was verified by reading the cited code; there are no
executable repros. Keep changes minimal and run
`npm run type-check && npm run build` after each.

1. **`connect()` status clobber:** in `livecodeRuntime.tsx` `connect()`, the
   old socket's queued `onclose` can stomp the new socket's status. Capture
   the socket in each handler and no-op unless
   `snapshotsSocketRef.current === socket` for STATUS updates too (currently
   only the ref-null is guarded).
2. **`setServerBaseUrl` desync:** `setServerBaseUrl` updates the ref only; the
   snapshot socket stays on the old URL. Make it call `disconnect()` and (if
   previously connected) `connect()`.
3. **`history[]` unbounded:** cap the per-module analyze `history` array at 50
   entries (slice after prepend). Also prune `lspDiagnosticsByUri` entries
   for URIs whose module was unregistered.
4. **Control-socket result drop:** in `App.tsx`, command results are sent on
   the socket captured at receipt; buffer unsent results by `commandId` and
   flush them in the control socket's `onopen`.
5. **One-shot load guards:** `App.tsx` sets `canvasLoadedRef`/`projectLoadedRef`
   before awaiting the load; move the `= true` assignment to after the await
   succeeds, and reset it in the catch so a retry (e.g. next Connect) can
   re-attempt.
6. **Keyboard shielding:** `PianoRollShape.tsx` stops pointer events but not
   `keydown` in the shape body; add `onKeyDownCapture={e => e.stopPropagation()}`
   to the piano-roll body wrapper so Delete/Backspace can't reach tldraw and
   delete the shape. Mirror what `CodeMirrorEditor.tsx` does.
7. **Piano-roll self-echo:** `PianoRollShape.tsx` re-applies its own edits
   when the confirming snapshot returns. Pass the shape's `originId` into
   `pianoRollRuntime` state; when applying a snapshot roll whose latest
   `updatedBy`/origin matches this view's `originId` and whose rev equals the
   rev produced by this view's last `setRoll` response, skip `el.setNotes`.
   (The `/piano-roll/set` response already returns the new object with `rev` —
   record it as `lastOwnRevRef`.)
8. **Project/canvas load storm:** in `App.tsx`, wrap programmatic bulk loads
   (`loadTldrawCanvasJson`, project load) in a `suppressStoreListenerRef =
   true` block; perform registrations explicitly after the load completes
   (one `registerModule` pass over final shapes), instead of letting the
   store listener fire per-shape add/remove (which currently POSTs
   `/runtime/stop` per removed shape and schedules N analyzes).

---

# PHASE 4 — Engine hardening — decisions RESOLVED 2026-07; open work: item 2 worker/pre-warm, items 3/7 visibility

Work in `packages/core-timing/offline_time_context.ts`. These change timing
semantics — implement each behind an option where noted, add tests, and flip
the corresponding repro assertions per their `AFTER FIX:` comments.

1. **E3 (branchWait teardown): RESOLVED 2026-07 (owner decision,
   implemented).** `CancelablePromiseProxy<T>` gained `cancelSafe(value: T)`:
   it settles the awaited join with `value` ("yield with an arg"), then
   cancels the subtree — the awaiting parent receives the value instead of a
   rejection and keeps running. For `<void>` proxies it is callable with no
   argument. Plain `cancel()` remains the hard path (parent's await rejects)
   — unchanged default. Implementation: the proxy's then/catch/finally now
   delegate to an internal first-settle-wins deferred (with a pre-attached
   no-op catch, which also eliminates unhandled rejections from unawaited
   proxies whose blocks reject on cancel). No nullable typing needed — the
   parent always receives a T.
2. **E4 (catch-up clamp): OWNER DECISION 2026-07 — do not implement the
   clamp. Fix the stalls instead.** The owner's call: anything CPU-heavy on
   the music thread is the design error, not the catch-up behavior. The
   replacement work items (unblocked, no further decisions needed):
   - **Move `analyzeAndTransformTimedModule` / `materializeProjectRuntime`'s
     transform work into a Deno `Worker`.** The transform is a pure function
     (plain-data request in, transformed code + manifest + diagnostics out);
     the worker loads ts-morph, the main thread keeps HTTP handling and does
     the cheap file writes from returned text.
   - **Pre-warm heavy imports at server startup:** eagerly `import()` the
     heavy helper libraries (midi-helpers, piano-roll-helpers, and the
     graphics stacks used by project sketches) before any music runs, so
     mid-set module launches only evaluate the small cache-busted user
     module. Dynamic import of user modules cannot move off-thread (must
     share the runtime isolate) — pre-warming is the mitigation.
   After both land, remaining stalls are small enough that the current
   compress-to-catch-up behavior is acceptable; revisit a clamp only if
   measured stalls still exceed ~100ms in practice.
3. **E5 (global floor): RESOLVED 2026-07 (owner decision) — semantics stay;
   non-engine awaits inside timed code are user error.** The analyzer
   already ERRORS at edit time on detectable cases in editor code
   (`TCV_UNSUPPORTED_AWAIT`); the uncovered case is helper-INTERNAL IO,
   which no static check can see. Remaining work (visibility only, goes
   with the Phase 5 snapshot/detector work): runtime rebase detection — in
   the wait path, when `baseTime - ctx.time` exceeds a threshold (~1s),
   record a rebase event (module/debugName + jump size) and surface it in
   runtime snapshots as a UI badge. NOTE: gaps also arise from legitimate
   patterns (a context that computes or parks on a barrier while siblings
   advance), so this is an advisory heuristic, not a precise error.
4. **E6 (tempo compaction):** in `_setBpmAtTime` (and the ramp variant), after
   appending, compact: find the segment containing
   `rootContext.mostRecentDescendentTime`, and if more than ~16 segments lie
   entirely before it, merge them into a single historical segment that
   preserves `beatsAtTime` continuity (keep `beats0` bookkeeping: the merged
   segment must map the compaction boundary to the same beat value). Add a
   unit test asserting `beatsAtTime` is unchanged for times after the
   boundary, before/after compaction.
5. **E7 (beatPQs cleanup):** in the beat-wait abort/resolve paths (search
   `beatPQs`), after removing a waiter, if that tempo's PQ is empty AND the
   tempoId is not the root tempo's id, delete the map entry (and its
   tempoHeadPQ entry via the existing `refreshTempoHead` path).
6. **E8 (wait(0) spin): RESOLVED 2026-07 (owner decision, implemented).**
   Empirical finding: each `wait(0)` resolves through a real macrotask, so
   the JS event loop is NOT starved (HTTP/Stop stay responsive) — but the
   ENGINE's scheduler IS: a `wait(0)` hot loop in one branch prevented a
   sibling's ordinary waits from EVER firing (the zero-advance waiter
   re-enters the queue at the frozen earliest target every slice). A
   fairness/reordering fix was considered and REJECTED because execution
   order would start depending on wall-clock arrival, breaking realtime
   re-run order-determinism and realtime/offline parity — under logical-time
   semantics, starving later targets is the CORRECT reading of "infinite
   work at one instant" (offline already bounds it: MAX_TIMESLICES throws).
   Implemented instead: the realtime/offline-shared **zero-advance stall
   guard** — `MAX_ZERO_ADVANCE_SLICES = 10_000` (constant at the top of
   `offline_time_context.ts`). After that many consecutive slices at an
   unchanged logical time, waiters at that instant are rejected with
   "Logical time stalled at t=…"; the stalled branch tears down like any
   module error and all other contexts keep exact timing. No reordering
   ever occurs, so determinism is fully preserved and the failure itself is
   deterministic across modes. Occasional/bounded `wait(0)` remains legal
   and semantically unchanged (zero logical advance). Regression test:
   "E8 guard (fixed)" in engine_repro_test.ts.
7. **E9/E10 (barriers): RESOLVED 2026-07 (owner decisions, implemented).**
   - **E9 is BY DESIGN, not a bug.** Barriers are an optional sync overlay:
     `awaitBarrier` on a never-started barrier releases immediately (no sync
     constraint until a producer exists); `resolveBarrier` on a missing
     barrier no-ops. Do NOT add auto-create-and-park. The residual work is
     VISIBILITY only (Phase 5 detector/snapshot work): a typo'd barrier name
     or dead producer is currently indistinguishable from "no sync intended",
     so barrier state should eventually appear in runtime snapshots.
   - **E10 implemented as adopt-always:** `startBarrier` NEVER releases
     waiters; if a cycle is in progress it adopts it (waiters stay parked
     until the next explicit `resolveBarrier`). A producer wanting
     release-on-restart calls `resolveBarrier` at the top of its loop.
     Rationale: only-explicit-release keeps barrier semantics magic-free and
     fits "no blessed orchestrators". NOTE: old sketches relying on
     start-as-release (e.g. `mpe_projmapGL_sonar` transformed user code)
     must add the explicit resolve. No `starterCtx` tracking was added
     (not needed under adopt-always).
   - `barrierMap` entries are purged in root cleanup
     (`purgeBarriersForRoot`). Repro tests E9/E10 updated to assert the
     intended semantics.

---

# PHASE 5 — Larger refactors (design already agreed; checkpoint with owner before starting each)

These are architecture-level; full design rationale lives in the conversation
that produced this plan. Summaries here are enough to scope but NOT enough to
implement without a design pass — write a short design note and confirm
before coding.

1. **Unified entity store + action dispatch + single multiplexed WebSocket.**
   Generalize `piano_roll_store.ts` to `(type, id)`-keyed entities with
   per-entity dirty tracking, a global inverse-patch undo log, a single
   `dispatch(action)` entry point that appends to an ops-log file, and one
   socket with topic subscriptions + `seq` + full-snapshot-on-subscribe.
   Migrate piano-rolls first, then module run state, then layout. This
   subsumes the per-socket reconnect code from Phase 2/3 (one reconnect path).
2. **Detector plugin API in the analyzer.** Extract the piano-roll detector's
   hardcoded pieces (constants at the top of `analyze_transform.ts`, the
   import-binding collector, the wrapper dispatch, the runtime-import prelude,
   and the `WaitCallsiteKind` union + piano-roll-specific optional manifest
   fields in `protocol.ts`) into a registry of
   `{ kind, moduleSpecifiers, functionNames, match, wrap, runtimeImport,
   manifestPayload }`. Then implement barrier/signal/channel detectors and the
   cross-module warnings (multi-producer collision, no-producer-running at
   launch, orphaned-waiters at stop, potential barrier deadlock cycles).
3. **MCP agent surface.** Wrap store actions + run/stop/panic +
   `/runtime/state` + diagnostics as an MCP server. Prereq: add a shared
   session token to all mutating HTTP routes (the server is currently
   unauthenticated arbitrary-code-execution with `CORS: *` — acceptable only
   on 127.0.0.1, and the agent surface must not ship without the token).
4. **Shared protocol package.** Move `protocol.ts` types to a
   `packages/livecode-protocol` (plain .ts) consumed by both the Deno server
   and the Vite client, replacing the hand-mirrored
   `livecodeProtocol.ts`/`pianoRollTypes.ts`.
5. **Shadow-diagnostic position mapping.** Map `deno check` and shadow
   visualizer diagnostic positions back through the import-rewrite and
   instrumentation deltas (magic-string can produce a source map; or track
   per-edit offset deltas) so errors land on the user's real source lines.

---

# Appendix: full findings index (for traceability)

Engine: E1-E10 above. Also noted, no action required yet: `cancelAllContexts`
does not tear down the old scheduler's armed timer directly (relies on waiter
aborts); `contextId`/`seqCounter` grow monotonically (harmless).

Server: S1-S3 above. Also: launch queue polls at 30ms via `ctx.waitSec(0.03)`
(fine); parent loop dies silently on any non-abort error (`throw error` in the
loop — consider wrapping with restart + log, low priority); snapshot diffing
re-serializes everything at 30Hz (fine at current scale).

Analyzer: A1 + syntax reporting above. Also (Phase 5.5 or opportunistic):
`returnsPromiseLike` is a substring heuristic on the type text (false
positives on type names containing "Promise"); piano-roll detection misses
non-identifier receivers; `parseDenoDiagnostics` is regex-fragile against
`deno check` output format changes.

Helpers/stores: P1/P2 + Phase 0.3 MIDI items above. Also: MIDI output
fallback substring-matches device names (log the chosen device loudly at
startup); `runtime.ts` wait counts are sound (server force-clears on
stop/relaunch).

Client: Phase 2/3 items above. Also minor: `debugEditorViews` keyed by
`documentUri` collides when two shapes view one file; piano-roll
`fitZoomToNotes` only fires at rev 1 (post-reconnect views open un-zoomed).
