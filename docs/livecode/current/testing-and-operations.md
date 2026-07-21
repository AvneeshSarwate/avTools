# Current Testing and Operations

Status: task definitions and test inventory checked on 2026-07-21. The final
audit report records which commands were actually run in this review.

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
| `deno task test:livecode:unit` | Analyzer transform, runtime singleton, dynamic import, and MIDI helper tests. |
| `deno task test:livecode:repro` | Core-timing, analyzer, server, and piano-roll regression tests created by the July stability review. Several test names/comments still say `BUG` although assertions now expect fixed behavior. |
| `deno task test:livecode:server` | Runtime protocol/client-control, LSP bridge, CLI smoke, and default-source integration. |
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
not prove the source and bundle agree.

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
- Deno LSP initialization, diagnostics, and import resolution for repository
  aliases;
- project dependency graph/staleness/shadow diagnostics and non-mutation of
  runtime files;
- prepared-run pruning, cached project materialization, panic timing, canvas
  persistence, MIDI panic, and core-timing stability regressions;
- tldraw piano-roll manifest/widget/static-vs-runtime name behavior and
  focus-or-create shape behavior;
- a temp-project p5gpu snapshot and shared module state.

### Material gaps

There are no dedicated automated tests for:

- immediate Stop/Panic while a launch is queued but not yet active;
- project prepared-build identity after a later runtime-file overwrite;
- `/runtime/restart-all` semantics or dependency cache reset;
- project save/events/add/update/reload/remove route semantics as independent
  contracts;
- piano-roll HTTP routes, WebSocket reconnection, undo/redo, and client echo
  suppression end to end;
- livecode runtime reconnect/backoff, browser reload rehydration, queued stops,
  and stale lifecycle ordering in the tldraw client;
- URL-driven versus client-command project load behavior;
- project layout persistence after client-command opening;
- more than one browser/control client or project-switch interactions;
- external-project Deno LSP relative-import resolution;
- parity/drift between the Deno and client protocol type copies;
- the checked-in `example-projects/minimal-p5gpu` source itself;
- documentation link/route/test-command consistency.

The tldraw E2E is feature-specific; it is not a broad editor/runtime/reconnect
smoke test. The old `self-test-loop.md` in history describes broader Vue E2E
coverage that should not be attributed to the tldraw client.

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
