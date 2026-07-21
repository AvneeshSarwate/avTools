# Current System Architecture

Status: checked against the implementation on 2026-07-21.

## Runtime topology

Development uses two processes:

```text
browser tab
  React + tldraw + CodeMirror
       | HTTP and three WebSocket domains
       v
local Deno server
  analysis | project files | LSP proxy | runtime | shared stores
       |
       +-- spawned deno lsp processes
       +-- dynamically imported user modules
       +-- MIDI / WebGPU / window and filesystem capabilities
```

Start the server from `apps/deno-notebooks`:

```sh
deno run --unstable-webgpu --unstable-ffi --allow-all \
  livecode/visualizer/main.ts \
  --host localhost --port 7777 --log-level debug
```

Start the client from `apps/livecode-tldraw`:

```sh
npm run dev
```

Open `http://localhost:5173/`. Useful URL parameters are:

- `serverBaseUrl=http://localhost:7777`: override the Deno server.
- `projectPath=/absolute/or/working-directory-relative/path`: open a project,
  populate its shapes, and connect the runtime.
- `tldr=/test-canvases/file.tldr`: load a tldraw file served by Vite. `canvas`
  and `canvasUrl` are accepted aliases.

## State ownership

| State | Canonical owner | Recovery/persistence |
| --- | --- | --- |
| Freeform canvas shapes and non-project layout | tldraw client | In-memory unless explicitly saved as `.tldr`; no `persistenceKey`. |
| Project module source | Project `*.orig.ts` files | Written by the server during project edit analysis. |
| Project runtime source | Project `*.ts` files | Materialized by the server transform; never hand-edit. |
| Project module and piano-roll-view layout | `project.avtools-livecode.json` | Module layout through `/project/modules/update`; piano-roll views through `/project/canvas`. |
| Prepared builds and manifests | Deno server memory plus generated/runtime files | Latest manifests exposed by `/runtime/state`; non-project builds are pruned to a small rolling set. |
| Active module lifecycle | Deno server | `/runtime/state`, `/runtime/status`, and `/runtime/snapshots`. |
| Active wait counts and resolved piano-roll lookup names | Process-global runtime singleton in `visualizer/runtime.ts` | Snapshots only; lookup values persist after completion until a later analyze clears that module. |
| Named piano-roll objects and undo/redo | Process-global `piano_roll_store.ts` | In memory only; not persisted in the project manifest. |
| Editor text in a shape | `livecode-editor.props.source` plus mirrored React runtime record | `.tldr` for transient canvases; project source is also written to `*.orig.ts`. |
| LSP document mirror | One temp workspace per LSP proxy | Removed best-effort on shutdown; stale roots older than 24 hours are swept at server start. |

“Server truth” applies to execution and domain objects, not every byte of the
tldraw document. Project layout is persisted server-side, while a transient
canvas remains explicit `.tldr` file state.

## Connection domains

The client does not have one unified connection:

1. `/runtime/snapshots` is controlled by the Connect button. Its open handler
   checks `/health`, creates a new `/lsp` session, rehydrates `/runtime/state`,
   flushes queued stops, and immediately schedules analysis for every shape.
2. `/piano-roll/snapshots` connects whenever `PianoRollRuntimeProvider` is
   mounted, independent of the Connect button.
3. `/client/control` connects whenever the tldraw page is mounted, also
   independent of the Connect button. It lets an HTTP caller ask the server to
   forward commands to this browser.
4. `/lsp` is recreated after every runtime snapshot-socket open. It is not the
   execution or visualization channel.

All three application WebSockets use the shared exponential-backoff helper in
`apps/livecode-tldraw/src/reconnectingSocket.ts`. LSP connection lifecycle is
managed by the VTLSP transport and explicitly retired when replaced.

## Edit, analyze, and run flow

### Transient module

1. CodeMirror calls the shape `onChange` handler.
2. The new source is written into the tldraw shape prop and the React runtime
   record.
3. The runtime invalidates its prepared build/manifest and schedules analysis
   after 100 ms.
4. `POST /runtime/analyze` writes a session source file, transforms it, writes
   an immutable generated file, remembers a prepared run, and returns a
   manifest.
5. Run reuses the current matching prepared build, or analyzes immediately.
6. `POST /runtime/launch` queues a dynamic import and `TimeContext` branch on
   the server's long-lived parent loop.

### Project module

The first three steps are the same, but analysis first posts the shape buffer to
`/project/modules/write`. That route writes `*.orig.ts` and materializes changed
project runtime files. The following `/runtime/analyze` materializes again
(normally using the source-hash cache) and returns the selected module's build
metadata.

Before launch, the tldraw client requests `/project/diagnostics` and blocks its
own Run action when `deno check` fails. This is a client guard; the raw server
launch endpoint does not independently run project diagnostics.

Launch is no-surprise: an active module is not replaced unless the request
explicitly includes `replaceRunning: true`. The tldraw Run path does not set
that flag, and its button is disabled while the client believes the module is
running.

## Execution and observation flow

The analyzer normalizes the default export to `runFunc`, inserts runtime helper
imports, and emits a source-range manifest. At execution time:

- `visualizedAwait(moduleId, callsiteId, promise)` increments/decrements an
  active count around the pending promise.
- `visualizedPianoRollLookup(moduleId, callsiteId, name)` records a resolved
  string and returns it unchanged.
- the server samples wait, lookup, active-module, and run-lifecycle state every
  33 ms and sends only when serialized state changes;
- the React runtime copies the snapshot into per-module view state;
- `LivecodeEditorShape` joins active IDs and lookup IDs to manifest ranges;
- `CodeMirrorEditor` replaces its wait marks and piano-roll widgets through
  CodeMirror state effects.

The current tldraw client does not use `requestAnimationFrame` for livecode
snapshots. The server's changed-only, roughly 30 Hz cadence is the batching
mechanism. Piano-roll snapshots are separately coalesced through
`requestAnimationFrame` in `pianoRollRuntime.tsx`.

## Stop, cleanup, and panic

A graceful module stop runs an optional exported `stop()` hook with a two-second
timeout, then cancels the `TimeContext` branch, clears active waits, removes the
active module, and publishes a terminal lifecycle snapshot. `stop-all` performs
those graceful stops in parallel.

`POST /runtime/panic` skips module stop hooks, cancels active branches, clears
their wait state, marks them stopped, and calls `panicMidi()`. Server shutdown
gracefully stops modules, panics MIDI, cancels the parent context, shuts down
LSP processes, closes sockets, and stops the HTTP server.

The MIDI wrapper tracks sounding `(device, channel, pitch)` entries and panic
sends note-offs plus CC 123 and CC 120 on observed channels (with channel 0 as
a fallback).

## Reconnect and browser reload

When the runtime snapshot socket closes, the client marks every module's run
state `unknown` and clears transient highlights/lookups. On reopen it:

1. fetches health/capabilities;
2. creates a fresh LSP session;
3. fetches `/runtime/state` and adopts active run IDs and manifests;
4. sends stops queued for shapes deleted while disconnected;
5. re-analyzes all registered shapes.

Terminal run snapshots are correlated by `generatedRunId` and timestamp to
avoid an older running update reviving a run the client already saw stop.

## Project and process scope

There is exactly one `currentProject` per server instance. Opening or creating a
project changes that global server selection for every connected browser and
HTTP caller. Project endpoints are not client-scoped.

The runtime instrumentation map and piano-roll store are module-level Deno
singletons, so two server instances created in the same Deno isolate would
share them. The supported operational model is one server instance per process.

## Trust boundary

This is a trusted local tool:

- user modules are imported into the server process with its permissions;
- project routes can write files under a caller-selected project directory;
- mutation and execution routes have no authentication;
- CORS allows `*`;
- the CLI defaults to loopback, but a caller can choose another host.

Do not bind this server to an untrusted network. See
`docs/livecode/current/known-risks.md` for the planned auth prerequisite and
other unresolved invariants.
