# Current Testing and Operations

Status: task matrix re-read from `apps/deno-notebooks/deno.json` and suite
counts re-run on 2026-08-18, after the engine-package extraction and the
browser-target check landed (105 unit, 26 server); first audited 2026-07-21.

## Development startup

Server, from `apps/deno-notebooks`:

```sh
deno run --unstable-webgpu --unstable-ffi --allow-all \
  livecode/visualizer/main.ts \
  --host localhost --port 7777 --log-level debug
```

Client, from `apps/livecode-tldraw` with a Vite-supported Node release (at the
current lockfile, Node 20.19+ or 22.12+):

```sh
npm run dev
```

The server emits one JSON `serverReady` line containing host, selected port,
base URL, session root, session ID, and log path. Tests use port `0` and parse
this line. Its keys are `type` (`"serverReady"`), `host`, `port`, `baseUrl`,
`sessionRoot`, `sessionId`, and `logPath`.

The default log is:

```text
apps/deno-notebooks/.avtools-livecode-sessions/logs/server.log
```

Important structured entries include `serverReady`, `analyzeStart`,
`analyzeSuccess`, `analyzeFailure`, `launchQueued`, `launchCancelled`,
`launchAborted`, `supersededTeardown`, `moduleImported`, `moduleStarted`,
`moduleStopped`, `moduleError`, `snapshot` (debug log level only, from the
legacy shim), LSP process events, client-control events, and handler errors.

Transport-specific entries worth knowing when a client stops updating:
`broadcastTickError` (the one 33 ms timer threw and was caught, so the tick was
skipped rather than the timer dying), `syncMalformedMessage` (a client sent
something that is not a subscribe), `syncSerializeFailed` / `syncSendFailed`
(one `/sync` socket's message did not go out; its `seq` deliberately does not
advance), and `snapshotSerializeFailed` / `snapshotSendFailed` for the legacy
shim.

## Actual task matrix

From `apps/deno-notebooks`:

| Command | Current contents (files, in task order) |
| --- | --- |
| `deno task test:livecode:unit` | `analyzer_transform_test.ts`, `runtime_counts_test.ts`, `dynamic_import_execution_test.ts`, `midi_helpers_test.ts`, `params_store_test.ts`, `entity_registry_test.ts` (also covers name encoding and the piano-roll store's delete/save/load seams), `signals_store_test.ts`, `run_dedupe_test.ts`. **105 tests.** |
| `deno task test:livecode:repro` | Core-timing, analyzer, server, and piano-roll regression tests created by the July stability review (`livecode/tests/repro/`). Several test names/comments still say `BUG` although assertions now expect fixed behavior. |
| `deno task test:livecode:server` | `protocol_smoke_test.ts`, `sync_transport_test.ts`, `launch_race_test.ts`, `lsp_smoke_test.ts`, `server_smoke_test.ts`, `default_source_integration_test.ts`, `browser_target_check_test.ts` (the portable helper graph must typecheck under a browser lib — `deno check` with `lib: ["esnext", "dom", ...]` over the alias targets, plus a negative control proving the config rejects bare `Deno` globals), `browser_target_project_test.ts` (the shadow check follows the manifest `engineTarget` in both directions, and a remote-mode server defaults untargeted projects to the browser lib). **26 tests.** |
| `deno task test:livecode:p5gpu` | `project_p5gpu_e2e_test.ts` — temp-project p5gpu/shared-state proof; requires an available WebGPU adapter. |
| `deno task test:livecode:e2e` | Delegates to `apps/browser-projections`' `test:livecode:e2e`: the older Vue livecode visualizer E2E, not the tldraw client. It is now also the only automated coverage of the deprecated `/runtime/snapshots` shim from a real client. |
| `deno task test:livecode` | Unit + server + old Vue E2E only. It is not the complete current-system suite. |

### `run_dedupe_test.ts` imports across apps, on purpose

It is the one Deno test that imports from `apps/livecode-tldraw`:

```ts
import { ... } from "../../../livecode-tldraw/src/runDedupe.ts";
```

The rule it covers lives in the client because only the client knows what *it*
claimed, but the orderings that break it are **transport** orderings — a
superseded run's terminal straddling a replacement, a launch conflated with an
instant error inside one 33 ms tick — and neither is reproducible on demand
through a browser. `runDedupe.ts` is therefore a pure module with no imports at
all, precisely so a Deno unit test and the Vite bundle can both load the exact
same file with no build step, no duplicate, and no mock. The browser E2E covers
the user-visible outcomes on top of it.

If that file ever acquires an import, this test breaks loudly rather than
silently testing a copy — which is the intended failure mode.

Additional Deno project test, not included in those aggregate tasks:

```sh
deno test --allow-all livecode/tests/project_shadow_diagnostics_test.ts
```

The browser-engine vertical slice has its own Playwright E2E, run from
`apps/deno-notebooks` (same `PW_CHROMIUM_PATH` convention as the tldraw E2E;
it builds its own assets via `livecode/browser_host/build_slice.ts` and serves
them from a temp dir):

```sh
node livecode/tests/browser_engine_slice.e2e.mjs
```

The remote engine mode has its own E2E (same conventions), which starts a
`--engine remote` server, attaches a headless engine tab, and drives the whole
agent HTTP surface plus a `/sync` watcher against it — including module
write-back, params edits, entity CRUD, stop/panic semantics, and
detach/re-attach:

```sh
node livecode/tests/remote_engine.e2e.mjs
```

The baked (serverless) topology has one too: it bakes a temp project with
`livecode/browser_host/bake_project.ts` (requires a built tldraw client),
serves the output from a dumb static file server, and drives the engine tab
plus the real UI purely over BroadcastChannel — including entity CRUD and a
params write on the broadcast actions channel:

```sh
node livecode/tests/baked_project.e2e.mjs
```

The tldraw E2E itself also runs against a remote engine:
`LIVECODE_E2E_ENGINE=remote` starts its server with `--engine remote` and
opens an engine tab before any case runs. Adding `LIVECODE_E2E_UI=served`
(requires remote and a prior `npm run build`) skips Vite entirely: the server
serves `dist/` at its own origin and the page uses the `sync=broadcast`
transport, reading the engine tab's BroadcastChannel directly. The whole
suite passes in all three modes; the client under test is identical.

From `apps/livecode-tldraw`:

```sh
npm run type-check
npm run build
npm run test:e2e
```

The tldraw E2E imports `playwright`, but `apps/livecode-tldraw/package.json`
does not declare it. It currently relies on Playwright being resolvable from
another repository install/`NODE_PATH`. The runner's guard checks only the Node
major version, while current Vite requires Node 20.19+ or 22.12+. The script
starts and stops its own Deno server and Vite process; a caller does not
pre-start either one.

Two env vars adapt the E2E to constrained environments (both used by Claude
Code cloud sessions, where the full E2E passes):

- `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium` points the Playwright launch at
  a system Chromium when the pinned browser download is absent;
- `LIVECODE_E2E_TIMEOUT_SCALE=4` multiplies every wait timeout — a cold
  container's first analyze takes ~16 s while ts-morph loads, and polling
  waits still return early on green, so scaling costs a fast machine nothing.

After changing the Vue piano-roll source, from `apps/browser-projections`:

```sh
npm run buildPianoRoll
```

The tldraw app consumes the generated ignored bundle. A green tldraw build does
not prove the source and bundle agree — and neither does a green type-check, so
this is a prerequisite for client work and for the tldraw E2E after any change
under `src/pianoRoll`. Anyone pulling a commit that touched the component must
rebuild it locally; the bundle is gitignored on purpose.

`npm run setupLivecode` (from `apps/livecode-tldraw`) is the one-shot wrapper
for every such local step: both npm installs, the piano-roll bundle, a
best-effort Deno dependency pre-cache, and best-effort builds of
not-yet-integrated component bundles (tweakpane, animation editor). Required
steps fail the run; optional ones warn and continue. New locally-built
components should be added to `scripts/setupLivecode.mjs` as one step each.

## Recommended full verification

There is not yet one task for all current behavior. Run this sequence when a
cross-boundary feature changes the system:

```sh
cd apps/deno-notebooks
deno task test:livecode:unit
deno task test:livecode:repro
deno task test:livecode:server
deno test --allow-all livecode/tests/project_shadow_diagnostics_test.ts

cd ../livecode-tldraw
npm run type-check
npm run build
npm run test:e2e
```

Run `deno task test:livecode:p5gpu` when project execution, import caching,
graphics initialization, window cleanup, or shared project state changes.

Run the older Vue E2E only when changing the still-supported Vue visualizer or
shared server behavior it uniquely exercises. It should not substitute for the
tldraw E2E.

## Current coverage map

### Stronger coverage

- analyzer happy paths, unsupported awaits, syntax errors, helper internals,
  branch callbacks, and piano-roll import binding behavior;
- runtime wait counts and lookup recording/clearing;
- transformed dynamic import with a real `TimeContext`;
- health/analyze/launch/stop over HTTP with the run and wait state read back
  from `/sync`, retained runtime manifest, module stop hook, lookup-only run
  completion, the legacy shim's envelope pinned (including that its rows carry
  no `runToken`), and basic client-command forwarding;
- the launch queue's safety window, driven over HTTP against a real server:
  two concurrent launches leaving exactly one active run and one execution of
  user code, a stop before the queue drains and a stop during the module import
  both preventing the run entirely, `replaceRunning` retiring the running run
  and starting a new generated run ID, a launch superseded by `replaceRunning`
  before it ever started, and panic cancelling a still-queued launch. Its
  fixtures are launched by URI instead of prepared through
  `/runtime/analyze`, which lets a fixture slow its own import with a top-level
  await and makes the during-import window deterministic;
- Deno LSP initialization, diagnostics, and import resolution for repository
  aliases;
- project dependency graph/staleness/shadow diagnostics and non-mutation of
  runtime files;
- prepared-run pruning, cached project materialization, panic timing, canvas
  persistence, MIDI panic, and core-timing stability regressions;
- params store create/reattach/reconcile, tombstone restore, CAS conflict,
  no-op detection, live-object identity, sampler drift adoption, read-only
  snapshot builders, and JSON-simple validation;
- the sync transport, over a real server socket
  (`livecode/tests/sync_transport_test.ts`): a subscribe resetting every listed
  type and replacing the previous set, per-entity changes with a deletion
  shipping as a `null` entity, `seq` being per-socket monotonic and gap-free,
  run entities carrying the launch token with a supersede never republishing the
  old one, a cancelled launch publishing exactly one terminal run entity, the
  three entity sockets being gone while their HTTP lists still answer in full,
  one tick feeding the sync sockets and the legacy shim without starving either,
  a params meta-only change and a signal's `ended` flip both reaching
  subscribers (neither of which a value compare could see), waits and lookups
  agreeing across both transports, and the module-keyed sources staying silent
  when a re-marked set serializes identically;
- the client's terminal-run rule (`livecode/tests/run_dedupe_test.ts`, in the
  unit suite): a run's own terminal applying after it was watched active, an
  edit dropping the claim without forgetting the run, the straddle, the
  instant-failure conflation, a stranger's terminal suppressed under a
  seen-active claim, a terminal as server truth with no claim at all, both
  rehydration seeding directions, and a superseded run not being re-adopted when
  it reports itself active;
- durable-entity registry semantics per type: create rejects an existing name,
  duplicate clones without tombstones, delete is reported honestly and defeats
  lazy demo re-seeding, serialize/deserialize round-trips preserve note ids and
  params values plus meta, a load mutates a held live reference in place and
  clears its undo history, a pristine demo seed is excluded from save while a
  written one is not, a JSON-hostile value is skipped rather than thrown, name
  encoding is collision-free (slashes, `%`, unicode, length cap,
  case-insensitive save-time collisions), and a forced piano-roll snapshot no
  longer consumes the pending broadcast;
- tldraw piano-roll manifest/widget/static-vs-runtime name behavior and
  focus-or-create shape behavior;
- the tldraw run lifecycle, re-derived for changed-only delivery: a finite
  module edited while it runs still reaching `stopped` at its own end with no
  reload (the case waits for the `running` run entity to reach the client,
  because that is where it learns the token whose terminal it must later accept
  — the old mechanism, a full `moduleRuns` map re-delivered on unrelated
  traffic, no longer exists); a module that throws on its first line still
  reaching `error`, which is the instant-failure conflation seen from the
  browser; and Replace clicked on the real header button leaving a new generated
  run ID active, the replaced run's terminal in the server log, the client
  following the replacement's token rather than the replaced run's terminal (the
  straddle), and the button set still Replace/Stop;
- the tldraw params round trip: declaration manifest and gutter widget, pane
  bindings after launch, a GUI edit reaching `/params/list` with a bumped rev
  and the pane's origin id, a running module's writes reaching the pane readout
  with no client action, and pane rehydration from the sync socket's subscribe
  reset after a reload;
- the tldraw signal tier: an anchored playhead signal driven by a module loop
  producing a moving marker in the bound roll view and losing it when the module
  stops (asserted as server `ended` first, missing marker second), two modules
  publishing two markers on one melody through both accepted value shapes,
  scopes over an ephemeral signal and over a durable param leaf both
  accumulating changing traces in their ring buffers, and a `meta.graph` field
  rendering its readonly graph row;
- the tldraw project-mode block, which runs last on its own canvas: booting
  from a temp project created over HTTP, creating an entity plus its first view
  from the GUI surface, an explicit save asserted from Node against the real
  manifest `data` entries and both percent-encoded JSON files, the status
  section going from unsaved to clean across that save, `/project/open`
  reverting live edits to both entity types, a fresh param pane rendering
  bindings with no module running, and duplicate/delete including the surviving
  view, the removed manifest entry, and the orphaned data file, plus the proof
  that a save writes no signal files and no `"signal"` manifest entries while
  signals are still live in the store;
- a temp-project p5gpu snapshot and shared module state.

### Material gaps

There are no dedicated automated tests for:

- project prepared-build identity after a later runtime-file overwrite;
- `/runtime/restart-all` semantics or dependency cache reset;
- project events/add/update/reload/remove route semantics as independent
  contracts. `/project/save` and `/entities/*` now have end-to-end coverage
  through the browser, but not server-side contract tests of their own — their
  error shapes (409 on an existing name, 404 on a missing one) and the
  skipped/failed halves of a save response are untested;
- piano-roll HTTP routes, WebSocket reconnection, undo/redo, and client echo
  suppression end to end;
- params HTTP routes as independent server contracts: `/params/set`
  compare-and-set, its 404 for an undeclared name, and `/params/list`. Params
  coverage is currently the store unit test plus the browser E2E;
- `/signals/list` as an independent server contract; it is exercised only
  through the store unit test and the browser E2E. (The `signal` kind's transport
  behavior *is* covered, in `sync_transport_test.ts`.) There is also no
  automated check that a dropped sync socket clears playhead markers, or that a
  scope dims and freezes on an ended source — both are client-side behaviors the
  E2E currently reaches only indirectly;
- livecode runtime reconnect/backoff, browser reload rehydration, and queued
  stops in the tldraw client. Stale lifecycle ordering now has one case each
  way — a terminal that must apply after an edit, and a replaced run's terminal
  that must not retire its replacement — but nothing covers the reconnect-time
  orderings;
- URL-driven versus client-command project load behavior;
- project layout persistence after client-command opening;
- more than one browser/control client or project-switch interactions;
- external-project Deno LSP relative-import resolution;
- the client's own reconnect/resubscribe path against a server restart: the
  server-side transport tests drive `/sync` directly, and no automated case
  covers `syncRuntime.tsx` re-subscribing and replacing its maps after a real
  disconnect;
- the checked-in `example-projects/minimal-p5gpu` source itself;
- documentation link/route/test-command consistency.

The tldraw E2E is feature-specific; it is not a broad editor/runtime/reconnect
smoke test. Its project-mode block is also the only automated coverage of the
URL-driven project boot path, and it deliberately runs after every
default-canvas case because entering project mode replaces the canvas. The old
`self-test-loop.md` in history describes broader Vue E2E coverage that should
not be attributed to the tldraw client.

## Manual high-risk checks

For release/performance work, supplement tests with:

1. run a long-wait module, hard-reload the tab, reconnect, confirm the exact run
   and manifest rehydrate, then stop it;
2. kill and restart the server, confirm the sync and control sockets recover,
   every entity map repopulates from the resubscribe, and the LSP becomes ready
   again;
3. delete a module shape while disconnected, reconnect, and confirm its old run
   is stopped;
4. start multiple modules with hung `stop()` hooks and confirm stop-all remains
   bounded while panic is immediate;
5. create notes, stop/cancel/panic, and confirm no MIDI notes remain sounding;
6. edit a shared project dependency and distinguish shadow diagnostics,
   materialized bytes, existing module instances, and explicit launch state;
7. open a project outside the repository and verify LSP imports, because the
   current proxy mirror is repository-oriented;
8. inspect `server.log`, generated code, manifests, and runtime snapshots when
   behavior disagrees with the UI.

## Environment caveats

- The server intentionally uses `--allow-all` and unstable WebGPU/FFI flags.
- Deno tests import `jsr:@std/assert@1`, and the server graph resolves several
  `jsr:` and `npm:` specifiers. On a cold cache every Deno task therefore needs
  network access to `jsr.io` and `registry.npmjs.org`; a sandbox that blocks
  either one fails at module resolution rather than at an assertion.
- `/health.runtimeCapabilities` reports whether Deno exposes WebGPU and
  `UnsafeWindowSurface`. A normal Deno test process may be healthy while unable
  to run windowed p5gpu.
- MIDI hardware is optional; helpers log unavailability and most tests inject a
  fake transport.
- p5gpu tests can be platform/native-library dependent and are intentionally
  separate.
- Broad `apps/browser-projections` TypeScript checking has unrelated failures;
  use focused livecode commands unless working on that app.
- Deno scripts stored under `apps/livecode-tldraw` (for example beside the
  checked-in example projects) need `--no-config` or an explicit `--config`:
  config discovery finds that app's `package.json`, which is not a member of
  the root `deno.json` workspace, and refuses to run.
- Server session directories/logs persist after normal shutdown and can
  accumulate. Non-project generated files are pruned within a live server
  session, not across old sessions.

## Failure artifacts

The tldraw E2E writes a temporary artifact directory on failure containing:

- full-page screenshot;
- browser errors;
- server stdout/stderr;
- Vite stdout/stderr.

The test prints the artifact path. Server tests create temp session roots and
normally remove them in `finally`; inspect output before cleanup when debugging
intermittent failures.
