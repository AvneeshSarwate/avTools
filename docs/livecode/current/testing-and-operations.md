# Current Testing and Operations

Status: checked against `apps/deno-notebooks/deno.json`, the tldraw package
scripts, and current test files on 2026-08-24.

## Start and verify

From `apps/deno-notebooks`, start the local server with:

```sh
deno task livecode:server
```

From `apps/livecode-tldraw`, run `npm run setupLivecode` once after checkout or
after a bundled web component changes, then `npm run dev`.

The drawing-document round trip and the parity between the element's Konva
bake and the package's Konva-free bake are checked by `npm run test:canvas` in
`apps/browser-projections`, against the built bundle. It is not part of any
`deno task`; run it after changing the canvas element or
`packages/drawing-document`.

With both running, `projects.html` on the Vite origin (e.g.
`http://localhost:5173/projects.html`) is the human entry point: it discovers
the server via `/health` probes, lists `/projects/list`, and opens a project
in either engine topology — including asking the server to restart itself into
the other mode. Opening a project by hand means composing
`/?serverBaseUrl=<server>&projectPath=<abs project dir>` yourself.

For a cross-boundary change, the canonical gate is:

```sh
cd apps/deno-notebooks
deno task test:livecode:full
```

Important naming trap: `deno task test:livecode` aliases
`test:livecode:fast`, not `:full`. Fast includes Deno unit/repro/server tests and
client typecheck/build. Full adds the Playwright tldraw E2E and the browser
engine/remote/baked topology scripts. `test:livecode:p5gpu` remains separate
because it needs native/window/WebGPU support.

Read the task definitions in `apps/deno-notebooks/deno.json` for the current
file list rather than maintaining it here.

## Pick tests by seam

- Analyzer/generated-code behavior: `analyzer_transform_test.ts`,
  `runtime_counts_test.ts`, `dynamic_import_execution_test.ts`.
- Launch/replacement/stop races: `launch_race_test.ts`,
  `run_correlation_test.ts`, and the run portions of `sync_transport_test.ts`.
- Stores/durability: the concrete store test plus `entity_registry_test.ts`.
- Transport or remote-plane behavior: `sync_transport_test.ts`,
  `protocol_smoke_test.ts`, `execution_plane_state_test.ts`,
  `engine_attach_replay_test.ts`, and the topology E2E scripts.
- Project graph/targets/LSP: project shadow, browser-target, and LSP tests.
- Visible canvas/reconnect/save behavior: `apps/livecode-tldraw/tests/livecodeTldraw.e2e.mjs`.

`baked_project.e2e.mjs` covers both bake forms in one run: the two-tab
BroadcastChannel pair, then the single-page in-process form opened at the bare
root URL (boot defaults, in-process sync and actions, and a canvas view
mirroring a module canvas checked by pixel). The in-process form against a
live server is not E2E-covered. `browser_host_import_map_test.ts` keeps the
client and engine-page import maps identical.

The tldraw E2E is broad but monolithic; it is not a substitute for deterministic
unit/server coverage of a race or validation rule. Prefer condition-based
polling over sleeps. Tests that assert generated-code spelling should do so only
when the emitted text itself is the contract.

## Feature fixtures

A user-visible feature should leave one project under
`apps/livecode-tldraw/example-projects/` that both people and automation open.
Its README owns the manual flow. Tests must copy it before save/delete/layout
mutations rather than reconstructing its payloads or modifying tracked files.
`feature-animation-timeline` is the reference.

## High-risk manual checks

Automation does not currently prove all recovery and device behavior. Before a
release affecting these seams, manually check the applicable item:

1. reload a tab during a long run, verify token/manifest/waits rehydrate, then
   stop it;
2. restart the server and verify sync resubscribe replaces every map, LSP
   returns, and a stop queued while offline is flushed;
3. edit a project dependency and distinguish shadow diagnostics, materialized
   bytes, cached module instances, and currently running code;
4. exercise browser-engine visibility/throttling, takeover, and real Web MIDI
   permission/panic on the target browser;
5. open an external-repository project and verify relative imports in LSP.

## Environment and artifacts

Cold Deno caches require network access to JSR and npm. The server uses broad
permissions plus unstable WebGPU/FFI flags; a healthy ordinary test process may
still lack window-surface capability. MIDI is optional and tests normally inject
a fake backend. Browser E2E needs Node, Playwright, and Chromium.

Deno scripts physically under `apps/livecode-tldraw` need `--no-config` or an
explicit workspace config because that npm app is not a root Deno workspace
member. Session directories/logs survive shutdown and can accumulate.

On tldraw E2E failure, the runner prints a temporary artifact directory with a
full-page screenshot, browser errors, and server/Vite output. Inspect it before
rerunning an intermittent failure.
