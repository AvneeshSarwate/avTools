# Current Known Risks and Invariant Gaps

Status: unresolved hazards checked against the implementation on 2026-08-24.

This register contains only open risks and accepted limitations. Resolved
investigations are preserved in
`docs/livecode/history/doc-snapshot-2026-08-24/known-risks.md`; the invariants
they established now live in the relevant architecture documents and tests.

## P0: prepared project builds are not immutable

Transient prepared builds have unique generated paths. Project preparations
retain a build ID/hash/manifest but point at a mutable project runtime file that
later materialization can overwrite. Launching an older remembered ID can
therefore execute bytes that do not match its manifest.

The low-level launch route also accepts caller-provided IDs/URIs that were never
prepared and does not bind them to remembered metadata. Until project entry
files become immutable or the protocol stops presenting preparation as a build
identity, never treat `generatedRunId`, hash, and manifest as a correctness or
security boundary. This path lacks a focused regression test.

## P1: project and entity state are process-global

One `currentProject` and module-ID namespace serve every client. Project open
selects it before every read/materialization succeeds, does not stop prior runs,
and can leave partial loaded state on failure. Duplicate IDs/paths are not fully
schema-validated and can make lookup/status ambiguous.

Engine entity stores also survive project switches. Explicit save captures all
durable names in those stores, including leftovers created by another project
or caller; it is not a capture of “entities belonging to this manifest.” Data
file writes are non-atomic. Project-scoped stores/identities or a project-owned
store view are the real fix.

## P1: dependency reload is not an isolate/cache reset

Only the launched entry URL is cache-busted. Its relative imports retain stable
URLs and may reuse old Deno module instances after their files change. This
preserves existing shared mutable state but makes dependency initialization and
shape changes unreliable as hot reload.

`/runtime/restart-all` stops and rematerializes; it neither relaunches nor
creates a new isolate. Restarting the Deno process is the reliable reset.

## P1: project UI/layout paths are incomplete and whole-replace

Project save UI and canvas-view persistence are gated by the page's initial
`projectPath` URL. A project opened later through client control can render but
cannot be fully saved/relaid out through normal human UI. That command path also
lacks all bulk-restore suppression used by URL boot.

`/project/canvas` replaces the whole canvas object. The current codec collector
keeps all known view arrays together, but an older client that moves any view
can erase newer view kinds it does not know. A live project selection plus
granular or merge-aware canvas updates is needed.

Module remove and entity-delete-plus-save are manifest-only: files remain. This
is documented behavior but destructive if mistaken for filesystem deletion.

## P1: trust boundary is local only

The server offers unauthenticated arbitrary code execution and caller-selected
filesystem writes with permissive CORS and broad Deno permissions. Do not bind
it to an untrusted interface. Any remote/MCP exposure needs authentication on
every mutation/execution route and WebSocket, origin/host restrictions, runtime
request validation, and imported-path constraints.

## P1: browser target checking over-promises module delivery

The browser engine serves relative project files, the generated runtime, and a
fixed alias-bundle set (the livecode helpers plus `three` and `p5`).
Browser-target shadow checking resolves the wider repository import map, so a
module can typecheck successfully and then fail at browser import on an
unserved bare specifier. Either expand bundling (add the specifier to
`ALIAS_ENTRIES`/the import map in `build_host_assets.ts`) or narrow the
checker's import map to the served surface.

## P1: browser-engine timing is not guaranteed in the background

Hidden/occluded tabs can clamp timers and stretch musical timing. The engine
uses a silent `AudioContext` keepalive and a >250 ms watchdog, but autoplay may
leave the context suspended until a gesture and the warning is log-only. Keep
the engine tab visible for timing-sensitive use. E2E disables throttling, so
this is manually verified.

## P1: external-project LSP mirroring is incomplete

The LSP proxy's synthetic workspace works best for repository-backed files. For
a project outside the repo, an opened document is mirrored but unopened sibling
files are not necessarily represented as a coherent tree, so relative-import
completion/diagnostics can disagree with runtime shadow analysis. This needs an
external-project test and explicit mirroring policy.

## P2: analysis and diagnostic attribution are deliberately narrow

Timed-context discovery is type-text/direct-identifier based and helper
recognition uses hard-coded import surfaces; it is not a symbol-flow engine.
Shadow checking rewrites imports/inserts instrumentation without complete source
maps, so Deno positions can point into generated coordinates. New detector work
should add explicit confidence/unsupported cases rather than silently widening
heuristics.

## P2: sync and long-process state have personal-scale bounds

Sync subscriptions are per type, not name, and each changed entity ships whole.
Large values changing every tick therefore serialize at full approximately
30 Hz even if a page shows one name. The client also republishes the full module
view map when run/wait/lookup state changes.

Several identities have no eviction: latest run rows per module, serialized
module-source caches, lookup maps until reanalysis, named durable entities,
params tombstones, ended signals, and session directories/logs. Dynamically
generated module/signal/entity names can make an hours-long process grow and
keep sampling dead logical state.

## P2: client acceptance and liveness can look stronger than truth

The client enters optimistic running UI before analysis/diagnostics/launch have
all succeeded, while the launch response itself means only queued. Client
control maps a failed server-status read to an empty active list. A future UI
should distinguish preparing, accepted/launching, running, and unavailable.

Broadcast sync has no heartbeat: a closed browser engine is indistinguishable
from an idle one, so the UI can retain stale state. The server-uplink topology
does better by issuing empty resets on detach.

Web Locks enforce one engine only per origin/profile. A second profile or
machine can still replace the uplink repeatedly; browsers without Web Locks are
unguarded. Explicit takeover intentionally panics and destroys the losing
engine's state.

## P2: browser MIDI and checked-in p5gpu coverage are incomplete

The browser engine host initializes Web MIDI at engine start and retries from
the first user gesture, with a visible status line. The residual gaps: the
first-ever permission grant needs a focused tab (a background engine tab shows
"not enabled" until visited once), and there is no hotplug rescan — devices
connected after init need a tab reload. Tests use fakes and cannot prove real
ports. Chrome is the supported browser target.

The checked-in `minimal-p5gpu` example has a `sped`/`speed` mismatch. The p5gpu
test builds a different temporary project, so do not use the checked-in example
as a green smoke fixture.

## Accepted limitations

- Persistence is explicit: no autosave, save-on-close, or save-on-shutdown.
- Entity rename is absent; duplicate is the variation gesture.
- Views and entities have independent deletion and may be many-to-one.
- Params have no undo; no entity undo history is serialized.
- Analysis never launches, dependency changes never orchestrate execution, and
  source may be edited while an older run continues.
- Direct launch may bypass project diagnostics.
- Signals are observation-only, ephemeral, and unreadable by other modules as a
  data API. Scope history is client-side, numeric-only, and conflates writes
  within one sync tick.
- Playhead markers accept numbers or `{position}` objects. Piano-roll position
  means beats; animation-timeline position means seconds.
