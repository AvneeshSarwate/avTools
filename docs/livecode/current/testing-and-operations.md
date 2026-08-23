# Current Testing and Operations

Status: task matrix re-read from `apps/deno-notebooks/deno.json` on
2026-08-23; first audited 2026-07-21.

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
`moduleStopped`, `moduleError`, LSP process events, client-control events, and
handler errors.

Transport-specific entries worth knowing when a client stops updating:
`broadcastTickError` (the one 33 ms timer threw and was caught, so the tick was
skipped rather than the timer dying), `syncMalformedMessage` (a client sent
something that is not a subscribe), `syncSerializeFailed` / `syncSendFailed`
(one `/sync` socket's message did not go out; its `seq` deliberately does not
advance).

## Actual task matrix

From `apps/deno-notebooks`:

| Command | Current contents (files, in task order) |
| --- | --- |
| `deno task test:livecode:unit` | Analyzer, runtime instrumentation, dynamic import, MIDI, params, durable registry/piano-roll, signals, and launch-correlation unit suites. |
| `deno task test:livecode:repro` | Core-timing, analyzer, server, and piano-roll regression tests created by the July stability review (`livecode/tests/repro/`). Several test names/comments still say `BUG` although assertions now expect fixed behavior. |
| `deno task test:livecode:server` | Protocol, sync transport, launch races, LSP, server/project behavior, default source, browser-target checks, and project-shadow diagnostics. |
| `deno task test:livecode:p5gpu` | `project_p5gpu_e2e_test.ts` — temp-project p5gpu/shared-state proof; requires an available WebGPU adapter. |
| `deno task test:livecode:client` | Current tldraw client type-check and production build. |
| `deno task test:livecode:e2e` | Current tldraw Playwright E2E. |
| `deno task test:livecode:topologies` | Browser-engine slice, remote-engine, and baked-project E2Es. |
| `deno task test:livecode:fast` | Unit + repro + server + client checks. |
| `deno task test:livecode:full` | Fast gate + current tldraw E2E + all three topology E2Es. |
| `deno task test:livecode` | Alias for the fast gate. |

### `run_correlation_test.ts` imports across apps, on purpose

It is the one Deno test that imports from `apps/livecode-tldraw`:

```ts
import { ... } from "../../../livecode-tldraw/src/runCorrelation.ts";
```

It covers the small client-side join between the launch acknowledgement and
the changed-only sync feed. Engine race behavior remains in the server suites;
the browser E2E covers the user-visible replacement and instant-failure
outcomes. The project-shadow diagnostics suite is included in the server and
fast gates.

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
params write on the broadcast actions channel, the project-shaped UI boot
(read-only code shapes at manifest positions plus manifest canvas views), the
Export data download round-trip, and the one-engine-per-origin lock (second
tab blocked, takeover steals the lock and shuts the old engine down):

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

Run the full current-system gate after a cross-boundary change:

```sh
cd apps/deno-notebooks
deno task test:livecode:full
```

Run `deno task test:livecode:p5gpu` when project execution, import caching,
graphics initialization, window cleanup, or shared project state changes.

## Current coverage map

### Stronger coverage

- analyzer happy paths, unsupported awaits, syntax errors, helper internals,
  branch callbacks, and piano-roll import binding behavior;
- runtime wait counts and lookup recording/clearing;
- transformed dynamic import with a real `TimeContext`;
- health/analyze/launch/stop over HTTP with the run and wait state read back
  from `/sync`, an explicit launch token acknowledgement, retained runtime
  manifest, module stop hook, lookup-only run completion, and basic
  client-command forwarding;
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
  retired snapshot sockets being gone while the HTTP lists still answer in full,
  a params meta-only change and a signal's `ended` flip both reaching
  subscribers (neither of which a value compare could see), waits and lookups
  arriving through the same transport, and the module-keyed sources staying silent
  when a re-marked set serializes identically;
- the client's launch correlation (`livecode/tests/run_correlation_test.ts`): a
  crossing terminal is held until the HTTP acknowledgement identifies the
  accepted token, while server truth applies directly outside a local launch;
- durable-entity registry semantics per type: create rejects an existing name,
  duplicate clones without tombstones, delete is reported honestly and defeats
  lazy demo re-seeding, serialize/deserialize round-trips preserve note ids and
  params values plus meta, a load mutates a held live reference in place and
  clears its undo history, a pristine demo seed is excluded from save while a
  written one is not, invalid current values are rejected or made explicitly
  unavailable and abort project save before writes, name
  encoding is collision-free (slashes, `%`, unicode, length cap,
  case-insensitive save-time collisions), and a forced piano-roll snapshot no
  longer consumes the pending broadcast;
- tldraw piano-roll manifest/widget/static-vs-runtime name behavior and
  focus-or-create shape behavior;
- the tldraw run lifecycle, re-derived for changed-only delivery: a finite
  module edited while it runs still reaching `stopped` at its own end with no
  reload; a module that throws on its first line still
  reaching `error`, which is the instant-failure conflation seen from the
  browser; and Replace clicked on the real header button leaving a new generated
  run ID active, the replaced run's terminal in the server log, the client
  following the replacement's token rather than the replaced run's terminal (the
  straddle), and the button set still Replace/Stop;
- the tldraw params round trip: declaration manifest and gutter widget, pane
  bindings after launch, a GUI edit reaching `/params/list` with a bumped rev
  and the pane's origin id, a running module's writes reaching the pane readout
  with no client action, pane rehydration from the sync socket's subscribe reset
  after a reload, and an invalid code write replacing the controls with a
  visible unavailable state until a valid declaration restores them;
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
8. inspect `server.log`, generated code, manifests, and `/sync` state when
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
