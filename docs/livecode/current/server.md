# Current Server and Engine Architecture

Status: checked against
`apps/deno-notebooks/livecode/visualizer/server.ts`, its execution-plane seam,
and `packages/livecode-engine` on 2026-08-24.

Use `apps/deno-notebooks/livecode/architecture.md` for the local file index.
This document records the seams and lifecycle rules that are easy to violate
while editing one file.

## Host versus execution plane

`createLivecodeVisualizerServer` owns HTTP/WebSocket routing, project files,
analysis, prepared-run bookkeeping, LSP proxies, client control, and session
cleanup. It sends every execution/entity operation through an `ExecutionPlane`:

- local mode calls `executeEngineOp` against an in-process
  `createLivecodeEngine`;
- remote mode forwards the same `EngineOp` through `/engine/uplink` to the
  newest attached browser engine.

Keep behavior in `packages/livecode-engine` when it needs only injected import,
logging, MIDI-panic, and sync-sink capabilities. Keep filesystem, HTTP, Deno
process, source transformation, and project concerns in the host. Both modes
must use the same op shapes from `packages/livecode-protocol/engine_uplink.ts`;
do not special-case route semantics by topology.

Engine mode is fixed for a server's lifetime: the plane, MIDI capability, the
generated-code instrumentation import, and default engine target are all
derived from it at creation. `POST /server/engine-mode` therefore does not
mutate a live server; it answers ok and asks its embedder (the `main.ts` loop)
to close this server and create a new one in the requested mode on the same
host/port. Everything engine-held — runs, unsaved entities — dies with the
restart, and an embedderless server (tests, direct library use) answers 501.
The projects index page (`projects.html` in the tldraw app) drives this and
`GET /projects/list`, which scans configured roots (default:
`apps/livecode-tldraw/example-projects`; override with `--projects-root`) for
project manifests.

The engine package contains module-level stores and runtime instrumentation.
They intentionally provide a stable singleton imported by every generated
module, but also mean multiple engines in one isolate are unsupported. Active
run records are per engine instance; stores, waits/lookups, signal ownership,
and the root-clock reference are not.

## Launch identity and race discipline

There are three different identities:

- `moduleId` is the lifecycle slot;
- `generatedRunId` identifies a prepared build and may be reused after an
  unchanged reanalysis;
- `runToken` identifies one accepted launch and is the only safe key for
  correlating a terminal event with its replacement.

`launchModule` creates a pending entry before queueing work. Stop, panic, and a
replacing launch can therefore address the acceptance-to-import window. The
queued action rechecks cancellation before import and before entering user
code, then transfers ownership to `activeModules` without a moment when the
slot is unowned. Teardown mutates the slot only if it still owns that exact run;
a slow older `stop()` must not retire a replacement.

The launch response means accepted/queued. A `run` sync entity distinguishes
`launching`, `running`, and terminal state, and carries the token plus an
engine-process-local `executionCount`. The count advances only when user code
is entered, so a cancelled launch or import failure does not pretend to have
executed.

These rules are concentrated in `packages/livecode-engine/engine.ts` and are
protected by `launch_race_test.ts`, `sync_transport_test.ts`, and
`run_correlation_test.ts`. Treat changes here as a cross-server/client change.

## Sync-source discipline

The engine has one `SyncSourceRegistry` and one approximately 33 ms collector.
Each source provides two operations with deliberately different effects:

- `collectChanges()` is the sole consumer of its change gate;
- `snapshotAll()` is read-only and may be called for subscriptions, HTTP reads,
  remote-engine hello, or detach recovery without swallowing a future update.

Store-backed kinds are registered once in
`packages/livecode-engine/entity_kinds.ts`. Piano rolls, params, and animation
timelines add a durable descriptor; signals omit it and therefore cannot be
saved or reached through generic entity CRUD. Run/wait/lookup sources are wired
separately because their state is engine/runtime-owned rather than a named
domain store.

Change tracking is per entity name. A deletion ships as a null entity; meta,
anchor, availability, and ended-state changes must mark the name even when the
value revision does not change. Params and signals also sample caller-held live
objects every tick, even with no subscribers, because direct code mutation
bypasses route setters.

## Project coordination

Analysis and prepared builds remain server-side in both engine modes. Transient
builds use immutable generated files and are pruned to a small rolling set.
Project builds point at materialized project files, whose mutability and import
caching are important risks described in `known-risks.md`.

There is one process-global `currentProject`. Open/create select it for every
client; they do not stop the prior project's modules. Project save first asks
the engine to capture every durable entity, writes entity files, then rewrites
the manifest with successful entries. It is explicit, non-atomic, and not
project-scoped at the store level.

Shadow diagnostics use a temporary transformed project and `deno check`; LSP
uses a separate synthetic workspace/process. Neither is the runtime, and LSP
diagnostics do not gate launch. Browser-engine target selection is published to
LSP/shadow configuration because Deno and browser module surfaces differ.

## Route traps

The exact handlers are contiguous in
`apps/deno-notebooks/livecode/visualizer/server.ts`; read them instead of
maintaining a duplicate catalog. The behaviors most likely to surprise a caller
are:

- `/runtime/restart-all` stops and rematerializes but does not relaunch and does
  not reset Deno's dependency module cache.
- `/runtime/launch` can be called without prior preparation and direct callers
  bypass project diagnostics. Refusal of an occupied slot is 409 unless
  replacement was explicit.
- `/project/events` is a one-shot status response, not SSE.
- `/projects/list` is read-only discovery over the configured roots (a few
  levels deep; an unreadable manifest is listed with an `error`, and a project
  directory is never scanned for nested projects). It does not consult or
  affect the current project.
- `/server/engine-mode` with a different mode restarts the whole server
  process-side (see above); callers must re-poll `/health` and expect every
  connection to drop.
- module remove is manifest-only; it neither deletes files nor stops a run.
- `/project/canvas` replaces the whole canvas object.
- generic `/entities/*` sees durable registered kinds only and never deletes
  views.
- piano-roll set is an upsert, while params/timeline writes require an existing
  entity; signals have no set route.
- `*/list` entity routes return read-only full snapshots despite their names.
- shared TypeScript request types are not runtime schemas. The outer handler
  generally maps thrown errors to status 500 JSON.

## Browser-engine hosting and shutdown

In remote mode `/engine/` lazily builds/serves the engine host and helper
bundles; generated and project modules are served under stable engine-asset
URLs with type stripping. A new uplink replaces the old one. Detach broadcasts
empty resets because the watched engine world has disappeared; attach hello
replaces it with full resets.

The browser host separately enforces one engine per origin with Web Locks and
explicit takeover, provides a silent-audio throttling mitigation, and logs
stretched ticks. These are operational defenses, not timing guarantees.

Engine close clears its broadcast timer, cancels pending and active runs,
panics MIDI, unregisters the root clock, and stops its parent context. Server
close also retires sockets, control requests, LSP processes, and the HTTP
server. Session directories/logs intentionally survive normal shutdown.
