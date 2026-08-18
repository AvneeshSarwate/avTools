# Current System Architecture

Status: describes the checked-in code as of 2026-08-13, through the multiplexed
`/sync` transport slice; first audited 2026-07-21.

## Runtime topology

Development uses two processes:

```text
browser tab
  React + tldraw + CodeMirror
       | HTTP + WebSockets (sync, client-control, lsp)
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
| Project module, piano-roll-view, param-pane, and signal-scope layout | `project.avtools-livecode.json` | Module layout through `/project/modules/update`; all three canvas view arrays through `/project/canvas`. A scope persists its binding, never its samples. |
| Prepared builds and manifests | Deno server memory plus generated/runtime files | Latest manifests exposed by `/runtime/state`; non-project builds are pruned to a small rolling set. |
| Active module lifecycle | Deno server (`moduleRunSnapshots`, on the server object) | `run` entities on `/sync`, plus `/runtime/state` and `/runtime/status`. Each row carries a `runToken` that identifies the run rather than its build. |
| Active wait counts and resolved piano-roll lookup names | Process-global runtime singleton in `visualizer/runtime.ts` | `moduleWaits` / `moduleLookups` entities on `/sync` only; lookup values persist after completion until a later analyze clears that module. |
| Named piano-roll objects | Process-global `entity_store.ts` through `piano_roll_store.ts` | In memory, and written to a project's `data/pianoRoll/*.json` by an explicit `/project/save`; `/project/open` loads them back before any module runs. |
| Piano-roll undo/redo history | A side map in `piano_roll_store.ts`, keyed by entity name | In memory only. Never serialized, dropped when the entity is deleted, and cleared per roll on load, because open adopts disk truth. |
| Named params entities and their values | Process-global `entity_store.ts` through `params_store.ts`; the live value object is shared with the declaring module | In memory, and saved/loaded with their `meta` like piano rolls, so an opened project renders panes before any module runs. Declaration reattaches and reconciles rather than resetting, so values also survive a relaunch inside one server process. |
| Named ephemeral signals and their latest values | Process-global `entity_store.ts` through `signals_store.ts`; the value is written by the publishing module | Process-runtime truth, **never persisted**. Not registered as a durable type, so no save, status row, project load, or `/entities/*` action can see one. A reconnecting client recovers current values only — there is no history on the server — and a run's signals end with it. |
| Scope sample history | The browser tab's `signal-scope` shape | Nothing. Ring buffers are per-shape, in-memory, and discarded on unmount or rebind; they are a view over shipped samples, not a record. |
| Editor text in a shape | `livecode-editor.props.source` plus mirrored React runtime record | `.tldr` for transient canvases; project source is also written to `*.orig.ts`. |
| LSP document mirror | One temp workspace per LSP proxy | Removed best-effort on shutdown; stale roots older than 24 hours are swept at server start. |

“Server truth” applies to execution and domain objects, not every byte of the
tldraw document. Project layout is persisted server-side, while a transient
canvas remains explicit `.tldr` file state.

## Connection domains

Four domains, three of them used by the tldraw client:

1. **Sync** — `/sync`, one socket for every watched entity kind: piano rolls,
   params, signals, runs, module waits, and module lookups. It connects when
   `SyncRuntimeProvider` mounts, independent of the Connect button, and it is
   the only channel carrying watched state. Delivery is per entity,
   changed-only, and scoped to what that socket subscribed to.
2. **Client control** — `/client/control`, connected whenever the tldraw page is
   mounted, also independent of Connect. It lets an HTTP caller ask the server
   to forward commands to this browser.
3. **LSP** — `/lsp`, recreated by every armed sync-socket open. It is not the
   execution or visualization channel.
4. **Legacy shim** — `/runtime/snapshots`, deprecated, read only by the Vue
   SketchWrapper in `apps/browser-projections`. The tldraw client never opens
   it.

The **Connect button is a separate axis from the socket**. `/sync` opens at
mount because entity data has always flowed without pressing Connect; what
Connect arms is the runtime domain — the `/health` check, the LSP session,
`/runtime/state` rehydration, flushing queued stops, and analysis scheduling.
An unarmed client still receives entity data and still shows every pane and roll
live; it simply does not render as "connected" and does not apply run or wait
state. Disconnect disarms without closing the socket.

The application WebSockets use the shared exponential-backoff helper in
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
explicitly includes `replaceRunning: true`. Run never sets it. The gesture that
does is Replace — while a module runs, its Run button reads Replace, and that
click is the explicit consent the flag encodes.

Acceptance means queued, not started, so the server holds a pending-launch
entry for the window between the HTTP response and the queued action's turn. A
launch, stop, or panic arriving in that window is applied to the pending entry,
and the queued action re-checks it before importing and again before starting:
a second launch cannot slip past the replacement decision by being early, and a
stop or panic cannot be outlived by a launch it never saw.

## Execution and observation flow

The analyzer normalizes the default export to `runFunc`, inserts runtime helper
imports, and emits a source-range manifest. At execution time:

- `visualizedAwait(moduleId, callsiteId, promise)` increments/decrements an
  active count around the pending promise.
- `visualizedPianoRollLookup(moduleId, callsiteId, name)` records a resolved
  string and returns it unchanged.
- `visualizedOwnedSignal(moduleId, callsiteId, handle)` stamps the declared
  signal's owner and returns the handle unchanged, which is what lets the run's
  end also end its signals.
- one server timer at 33 ms walks every sync source, collects the changes once,
  and fans them out to each `/sync` socket filtered to its subscriptions and to
  the legacy shim;
- the sync provider applies the changes into per-kind maps and flushes them into
  React state once per animation frame;
- the React runtime copies runs, waits, and lookups into per-module view state;
- `LivecodeEditorShape` joins active IDs and lookup IDs to manifest ranges;
- `CodeMirrorEditor` replaces its wait marks and piano-roll widgets through
  CodeMirror state effects.

Batching now happens twice: the server's changed-only ~30 Hz cadence, and one
`requestAnimationFrame` coalescing pass in the sync provider that covers every
entity kind rather than three of them.

## Stop, cleanup, and panic

A graceful module stop runs an optional exported `stop()` hook with a two-second
timeout, then cancels the `TimeContext` branch, clears active waits, removes the
active module, and publishes a terminal run record. `stop-all` performs those
graceful stops in parallel. A module that is only queued has no branch to
cancel, so stop, stop-all, and panic cancel its pending launch instead and
publish the same terminal record.

`POST /runtime/panic` skips module stop hooks, cancels active branches, clears
their wait state, marks them stopped, and calls `panicMidi()`. Server shutdown
gracefully stops modules, panics MIDI, cancels the parent context, shuts down
LSP processes, closes sockets, and stops the HTTP server.

The MIDI wrapper tracks sounding `(device, channel, pitch)` entries and panic
sends note-offs plus CC 123 and CC 120 on observed channels (with channel 0 as
a fallback).

## Reconnect and browser reload

When the sync socket closes and the client is armed, it marks every module's run
state `unknown`, clears transient highlights/lookups, and reports `connecting` —
the reconnecting controller is already retrying with backoff. On reopen, if
still armed, it:

1. fetches health/capabilities;
2. creates a fresh LSP session;
3. fetches `/runtime/state` and adopts active runs, run tokens, and manifests;
4. sends stops queued for shapes deleted while disconnected;
5. re-analyzes all registered shapes.

Entity state recovers separately and unconditionally: a reopened socket
resubscribes, and the reply's `resets` replace each per-type map wholesale, so
an entity deleted while the client was away does not survive the reconnect.

Terminal run entities are correlated by **run token**, not by `generatedRunId`,
which identifies a build and is reused when a relaunch finds an unchanged one.
Step 3 is where a freshly reloaded client seeds that token memory; without the
seed, the running run's own terminal would look like a stranger's the next time
Replace staked a claim over it.

## Project and process scope

There is exactly one `currentProject` per server instance. Opening or creating a
project changes that global server selection for every connected browser and
HTTP caller. Project endpoints are not client-scoped.

The execution plane now lives in `packages/livecode-engine` (see `server.md`):
the server constructs one `createLivecodeEngine` instance and hosts it behind
its transports, with the moved store/runtime modules re-exported at their old
`visualizer/` paths. The runtime instrumentation map and the entity store
(piano rolls, params, and signals alike) are module-level singletons in that
package, so two server instances created in the same isolate would share them.
The root-clock context in `runtime.ts` is a singleton for the same reason: the
last engine to start its parent loop would own it. Run records are the
exception — they live on the per-server engine object, which is why the run
sync source is constructed with accessors rather than importing a store. The
supported operational model is one server instance per process.

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
