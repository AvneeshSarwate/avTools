# Current System Architecture

Status: checked against the local, remote-browser, and baked paths on
2026-08-24.

## Three planes, three topologies

The system is easier to change when treated as three planes:

| Plane | Owns | Primary code |
| --- | --- | --- |
| Coordination | analysis, generated/project files, prepared-build metadata, project selection, shadow checks, LSP, HTTP/WS | `apps/deno-notebooks/livecode/visualizer/` |
| Execution | module lifecycle, `TimeContext` root, entity stores, runtime observation, one sync tick | `packages/livecode-engine/` |
| View | tldraw document, editors, entity views, connection UX, client-side sample history | `apps/livecode-tldraw/src/` |

The supported topologies move these planes without changing their contracts:

| Topology | Placement |
| --- | --- |
| Local (default) | Deno hosts coordination and one in-process engine; Vite hosts the UI. |
| Remote browser engine | Deno keeps coordination; `/engine/` runs the execution plane in a browser tab. Ops use `/engine/uplink`; a same-origin served UI may receive sync and send actions through `BroadcastChannel`. |
| Baked static project | Static UI and engine tabs communicate through `BroadcastChannel`; `baked.json` replaces project/file routes. There is no coordination server at runtime. |

`apps/deno-notebooks/livecode/visualizer/execution_plane.ts` is the local/remote
seam. `apps/deno-notebooks/livecode/browser_host/engine_page.ts` hosts the
browser engine, and `apps/deno-notebooks/livecode/browser_host/bake_project.ts`
creates the static form. The engine package must
remain browser-typecheckable; host-only filesystem, Deno, and MIDI choices do
not belong in it.

Moving between the local and remote-browser topologies is a server restart,
not a live reconfiguration: `POST /server/engine-mode` makes `main.ts` close
and re-create the server in the other mode on the same port, losing all engine
state. The projects index page (`projects.html` in the tldraw app) is the
human front door for picking a project and a topology together.

## State ownership

- Canonical project source is `*.orig.ts`; generated `*.ts` files are
  materialized runtime artifacts and must not be hand-edited.
- The project manifest owns module metadata/layout, canvas-view layout, and
  references to saved entity files. It does not own live execution.
- The engine owns active/pending runs and all named entities. Piano rolls,
  params, and animation timelines are durable only when explicitly captured by
  project save. Signals, run state, waits, and lookups are ephemeral.
- tldraw owns transient canvas shapes and editor buffers. A transient canvas is
  memory-only unless saved as `.tldr`.
- Signal-scope histories are browser-side ring buffers over delivered samples,
  not engine records. A reload starts them over.
- LSP workspaces are mirrors for editor tooling, never source or execution
  truth.

“Engine memory” means Deno memory locally and the engine tab's memory remotely
or in a bake. Closing that tab kills its runs and unsaved entities.

## Edit, analyze, and run

For a transient module, the client stores each edit in its shape, debounces
analysis, and receives a prepared build plus source-range manifest. Run reuses
the matching preparation or analyzes immediately, then explicitly launches it.

For a project module, the edit first writes canonical source through the
project route. Materialization updates affected runtime files; project Run also
asks the shadow checker for a whole-project `deno check`. That check is a client
guard: a direct launch caller can bypass it.

Launch acceptance means queued, not started. The engine publishes a pending run
and returns a `runToken`; it rechecks cancellation/replacement before import and
again before user code. Run does not replace an active module implicitly. The
same button becomes Replace, and only that explicit gesture sends
`replaceRunning: true`.

At execution time, generated wrappers update wait counts, resolved piano-roll
names, and signal ownership. One approximately 33 ms engine tick drains all
changed sync sources once. The host fans the result out; the client applies it
to isolated per-kind stores and coalesces React publication to one animation
frame. This two-stage batching is the hot-path boundary.

## Connection domains

Sync, client control, and LSP are separate connections:

- Sync opens when `SyncRuntimeProvider` mounts, even before Connect, so entity
  views can show engine truth. It is `/sync` normally or `BroadcastChannel` in
  a same-origin browser-engine topology.
- Connect only arms the runtime sequence: health, a fresh LSP session,
  `/runtime/state` rehydration, queued-stop flush, and reanalysis.
- `/client/control` lets an external caller drive a mounted UI and is unrelated
  to runtime observation.

On a sync gap or reconnect, resubscription returns full per-type resets. A reset
replaces the local map, so deletions that happened while disconnected are not
resurrected. When an armed connection drops, run/wait/lookup presentation is
marked unknown until rehydration; durable/ephemeral entity recovery continues
through sync independently.

## Stop and cleanup

Graceful stop runs an optional exported `stop()` with a two-second bound, then
cancels the branch, ends the run's signals, clears waits, and publishes terminal
run truth. Stop-all does this in parallel. Panic skips stop hooks, cancels
pending and active work, and flushes MIDI. Server/engine shutdown additionally
retires LSP, sockets, the root clock, and timers.

## Scope and trust

There is one current project per coordination server, not per client. Engine
stores and runtime instrumentation are module singletons; multiple engine
objects in one isolate would share them. The supported model is one engine per
process or browser origin.

This is a trusted local code-execution tool: routes are unauthenticated, CORS is
permissive, project paths can write files, and user modules inherit broad host
capabilities. Do not expose it to an untrusted network. See `known-risks.md` for
the remaining scoping, browser-engine, and safety gaps.
