# Current Testing and Operations

Status: task definitions and test inventory checked on 2026-07-21, extended for
the canvas-params slice, again for the entity-CRUD/persistence slice, again for
the ephemeral signals slice, and again for the launch-lifecycle slice on
2026-08-13. The final audit report records
which commands were actually run in this review.

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
this line.

The default log is:

```text
apps/deno-notebooks/.avtools-livecode-sessions/logs/server.log
```

Important structured entries include `serverReady`, `analyzeStart`,
`analyzeSuccess`, `analyzeFailure`, `launchQueued`, `moduleImported`,
`moduleStarted`, `moduleStopped`, `moduleError`, `snapshot`, LSP process events,
client-control events, and handler errors.

## Actual task matrix

From `apps/deno-notebooks`:

| Command | Current contents |
| --- | --- |
| `deno task test:livecode:unit` | Analyzer transform, runtime singleton, dynamic import, MIDI helper, params store, durable-entity registry (`livecode/tests/entity_registry_test.ts`, which also covers name encoding and the piano-roll store's delete/save/load seams), and signals store (`livecode/tests/signals_store_test.ts`) tests. |
| `deno task test:livecode:repro` | Core-timing, analyzer, server, and piano-roll regression tests created by the July stability review. Several test names/comments still say `BUG` although assertions now expect fixed behavior. |
| `deno task test:livecode:server` | Runtime protocol/client-control, launch-queue races (`livecode/tests/launch_race_test.ts`), LSP bridge, CLI smoke, and default-source integration. |
| `deno task test:livecode:p5gpu` | Temp-project p5gpu/shared-state snapshot proof; requires an available WebGPU adapter. |
| `deno task test:livecode:e2e` | The older Vue `apps/browser-projections` livecode visualizer E2E, not the tldraw client. |
| `deno task test:livecode` | Unit + server + old Vue E2E only. It is not the complete current-system suite. |

Additional Deno project test, not included in those aggregate tasks:

```sh
deno test --allow-all livecode/tests/project_shadow_diagnostics_test.ts
```

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
- health/analyze/launch/snapshot/stop, retained runtime manifest, module stop
  hook, lookup-only lifecycle completion, and basic client-command forwarding;
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
  forced snapshots, and JSON-simple validation;
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
- the tldraw run lifecycle: a finite module edited while it runs still reaching
  `stopped` at its own end with no reload (the case waits for the running
  snapshot to land before editing, because that snapshot is what re-asserts the
  active-run claim the edit must drop — without the wait it passes against the
  old guard by accident), and Replace clicked on the real header button leaving
  a new generated run ID active, the replaced run's terminal in the server log,
  and the button set still Replace/Stop;
- the tldraw params round trip: declaration manifest and gutter widget, pane
  bindings after launch, a GUI edit reaching `/params/list` with a bumped rev
  and the pane's origin id, a running module's writes reaching the pane readout
  with no client action, and pane rehydration from the snapshot after a reload;
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
- signals HTTP/WebSocket routes as independent server contracts: `/signals/list`
  and `/signals/snapshots` are exercised only through the store unit test and
  the browser E2E. There is also no automated check that a dropped signals
  socket clears markers, or that a scope dims and freezes on an ended source —
  both are client-side behaviors the E2E currently reaches only indirectly;
- livecode runtime reconnect/backoff, browser reload rehydration, and queued
  stops in the tldraw client. Stale lifecycle ordering now has one case each
  way — a terminal that must apply after an edit, and a replaced run's terminal
  that must not retire its replacement — but nothing covers the reconnect-time
  orderings;
- URL-driven versus client-command project load behavior;
- project layout persistence after client-command opening;
- more than one browser/control client or project-switch interactions;
- external-project Deno LSP relative-import resolution;
- parity/drift between the Deno and client protocol type copies;
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
2. kill and restart the server, confirm runtime/piano/control sockets recover
   and the LSP becomes ready again;
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
