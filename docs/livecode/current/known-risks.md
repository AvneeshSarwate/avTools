# Current Known Risks and Invariant Gaps

Status: code-inspection audit on 2026-07-21, extended for the canvas-params
slice, again for the entity-CRUD/persistence slice, and again for the ephemeral
signals slice and the launch-lifecycle fix on 2026-08-13. These are unresolved
unless a later entry says otherwise.
Items marked “not regression-tested” are reasoned from the checked-in control
flow and should receive a focused reproduction before a behavioral fix.

This file is required reading because several current names and older docs imply
stronger guarantees than the implementation provides.

## Resolved 2026-08-13: queued launches are inside the safety controls

`launchModule` used to check `activeModules.has(moduleId)` before pushing an
action into `launchQueue`, and the queued action never repeated the check. Two
rapid launches could both pass it and both start, leaving the first branch with
no addressable handle; and a Stop, stop-all, or panic arriving after HTTP
acceptance but before the import created `activeModules` saw nothing to cancel,
so the launch started afterward regardless.

What shipped: a `pendingLaunches` map is the identity of the window between
acceptance and start. A pending launch is refused exactly like a running one, or
marked cancelled when the new request carries `replaceRunning`. The queued
action re-applies every decision taken since acceptance — cancelled before
start, a run that appeared meanwhile (replaced with the flag, aborted silently
without it), and cancelled again after the import await, which is the one long
suspension in the action. Stop cancels a pending launch and emits the terminal
snapshot the accepted request's `launching` entry owed; stop-all and panic
cancel every pending entry first. Ownership transfers to `activeModules` before
the pending entry is deleted, so a module is never absent from both maps while
it is startable.

Two follow-up defects found in review, both from treating `generatedRunId` as a
run identity when it is a *build* identity (an unchanged prepared build is
relaunched under the same ID, which is what Replace without an edit does):

- an `ActiveModule` now carries a per-run `runToken`, and the branch's terminal
  bookkeeping guards on that instead. A slow-dying older branch could otherwise
  delete the replacement's entry, end its signals, and publish a terminal for a
  run still playing;
- `teardownActiveModule` always cancels the handle it was given, but only
  touches the module slot while that record is still the active run, by object
  identity. A stop that awaited a two-second `stop()` hook could otherwise
  retire the replacement that won meanwhile. The skipped case logs
  `supersededTeardown`.

Two smaller ones from the same review: the request-time stop suspends past the
point where it empties `activeModules`, so a racing request could leave an
orphaned uncancelled pending entry — any entry holding the slot is now cancelled
immediately before the new one is registered — and a cancelled pending entry no
longer refuses the next launch, nor publishes a terminal once something else has
written to `moduleRuns`.

Covered by `livecode/tests/launch_race_test.ts` (in `test:livecode:server`):
concurrent launches, stop before the queue drains, stop during the import,
replacement, a launch superseded before it started, and panic against a queued
launch.

Deliberately unchanged: the ID/URI validation gap and the mutable prepared
identity described in the next entry. A launch is still accepted for an ID that
was never prepared, and nothing here makes build identity a boundary — this
entry is about *when* a launch is allowed to start, not about *what* it is
allowed to import.

## P0: prepared project identity is not immutable

Transient prepared builds use unique generated files. Project prepared runs
store a `generatedRunId`, source hash, and manifest but point at a mutable
project `modules/*.ts` path. Later materialization can overwrite those bytes.

Launching an older remembered ID can therefore execute code that does not match
its retained hash or manifest. `/runtime/state` can then expose misleading
source-range/run correlation.

The server also accepts launch IDs/URIs that were never prepared and does not
validate that a remembered ID matches the request URI/module. That flexibility
may be useful for a trusted low-level API, but it prevents build identity from
being a security or correctness boundary.

This is not regression-tested. Either project launches need immutable
revisioned entry files, or the protocol must stop presenting
`generatedRunId + manifest + hash` as an immutable prepared build.

## P1: project dependency reload is not a cache reset

The launched entry URL gets a fresh query, while its relative imports resolve
to stable project file URLs. Deno may reuse old dependency module instances.
This preserves shared mutable state across separately launched modules, but a
dependency source edit/materialization does not imply a new dependency
instance.

`POST /runtime/restart-all` stops active modules and rematerializes files. It
does not relaunch them and does not create a new isolate, so it is neither
“restart all” nor a reliable reset of cached dependencies. The client exposes no
button or control command for it.

Current reliable reset: restart the Deno server process. The intended long-term
store/token model should make dependency-value reload less central, but current
project examples still rely on imported shared mutable values.

## P1: project switching is global and non-transactional

One `currentProject` is shared by every client. Create/open assigns it before
all source reads and materialization complete. A missing/broken file can make
the route fail after the server has already switched to a partially initialized
project.

Project switching does not stop active modules from the prior project. Module
IDs can collide across projects. Runtime state, prepared-run indexes, and
lifecycle history are keyed primarily by module ID rather than project ID.

The browser project loader clears the canvas before `/project/open` succeeds, so
a failed open destroys the visible canvas. The client-control `openProject`
path also bypasses the bulk-load store-listener suppression used by the
URL-driven path, producing per-shape unregister/register side effects and
analysis work.

## P1: an explicit save captures the whole process-global entity store

`POST /project/save` iterates every registered entity type and every name
currently in memory. The stores are process-global and outlive a project
switch, so a save can write files for entities the open project never used:
leftovers from a previously opened project, entities an agent created for
something else, and — once anything writes to it — the demo `melody` roll.
Those files become manifest `data` entries, so the next open of that project
loads them back.

Two mitigations exist, and neither makes the capture project-scoped. An
untouched demo seed is skipped, so a project that never used `melody` does not
acquire a junk `melody.json`; and deleting an entity plus saving drops its
manifest entry (leaving the file, per the manifest-only remove precedent). The
real fix is the same one the rest of this family needs: project-scoped stores,
or at least a project-scoped view over them.

Data file writes are also non-atomic, exactly like every existing project
write. A crash mid-save can leave a partial or missing data file; the manifest
is written last with only the entries that reached disk, which limits the blast
radius to an orphan file rather than a dangling entry. Save-time path
allocation additionally disambiguates names that collide case-insensitively, so
two entities cannot silently share one file on a case-insensitive filesystem.

## P1: project identity validation is incomplete

The manifest is cast from JSON and normalized but not schema-validated.
Duplicate module IDs or paths are not rejected. Internal maps keyed by ID/path
can overwrite or select the first record, making materialization, status, and
launch behavior ambiguous.

`/project/modules/update` accepts `path` in its input type but does not rename
paths; it finds an existing record and updates only kind/title/version/layout.
`/project/modules/remove` leaves source/runtime files, prepared runs, lifecycle
entries, and any active module behind.

## P1: external-project LSP resolution is under-specified

The LSP proxy mirrors/symlinks the repository into its synthetic workspace.
Repository-backed project URIs can resolve sibling runtime files on real disk.
For a project outside the repository, an open source document is copied into
the temp workspace but unopened sibling project runtime/source files are not
mirrored as a tree. Relative import completion/diagnostics can therefore fail
even though runtime project analysis works.

This needs an external-project LSP test and an explicit workspace mirroring
strategy.

## P1: destructive and incomplete project layout paths

The client captures `projectPath` from the initial URL. Canvas-view persistence
is conditioned on that captured value, for both piano-roll views and param
panes. A project opened later via `/client/control` can display saved views of
either kind, but subsequent view layout/name changes are not posted to
`/project/canvas`.

The save UI inherits the same gate: the "Save project" button, the unsaved
pill, and its `/project/status` poll all render only when the initial URL
carried a `projectPath`. A human who opened the project through client control
sees no way to save the entities they just edited. Agents and the E2E are
unaffected — `window.__livecodeTldrawRuntimeDebug.saveProject()` and the raw
`POST /project/save` do not consult that flag — so the gap is a human-facing
one, and it disappears with whatever fix gives the client a live project
selection instead of a captured URL value.

Module layout persistence keys off each shape's `projectModulePath` and does
work after command-driven open.

The server replaces the entire `manifest.canvas` object on each call. The client
mitigates this for the view kinds it owns by collecting every array into every
post, but the underlying behavior is unchanged: a further canvas field, or a
second writer, would still be lost unless the client reads/merges it or the
server offers granular actions.

`scopeViews` is the predicted third field arriving, and it arrived exactly as
predicted: an **older client** — one that does not know about scopes — still
posts a whole-canvas replacement built from the shapes it understands, so
opening a project in an old client and moving any view **deletes every saved
scope binding** from the manifest. Nothing warns. The current client is
consistent with itself; the exposure is mixed-version use of one project, and it
is the same shape the third-field prediction described. The real fix is the same
one: merge-on-read, or granular per-kind canvas actions.

## P1: server safety is local-trust only

The server exposes unauthenticated arbitrary code execution and filesystem
mutation with `CORS: *` and broad Deno permissions. A malicious webpage can
target a server reachable on loopback unless browser/network protections happen
to prevent it. Never bind to an untrusted interface.

Before an MCP or remote surface ships, add a shared session token to every
mutating/execution route and WebSocket, restrict origins/hosts, and validate
request schemas and imported paths.

## P2: analyzer semantics are narrower than “typed analysis” suggests

Context discovery uses type-text regexes and direct identifier matching. It can
miss aliases/destructuring/wrapped contexts and can accept unrelated types named
`TimeContext`. Promise-like detection includes a type-text substring heuristic.
Piano-roll import binding is symbol-aware but limited to hard-coded specifiers
and direct identifier/namespace receivers.

This is intentional first-pass scope and is now documented, but new detector
features should not copy these hard-coded branches. The planned detector
registry needs explicit match confidence and unsupported-pattern diagnostics.
Canvas-params and canvas-signal detection reuse the piano-roll binding and
call-resolution helpers through a shared specifier/function table rather than
copies of the branches, but the specifier list is still hard-coded and there is
still no match-confidence concept.

## P2: shadow diagnostic attribution is lossy

External relative imports are rewritten and instrumentation/import text is
inserted before `deno check`. Parsed Deno line/column positions are reported
against generated shadow files without source-map reversal. The textual Deno
parser is format-sensitive.

Per-module `diagnostics` and `dependencyDiagnostics` currently contain the same
attributed array. The latter is not a separately propagated dependency set,
despite its name.

## P2: the live snapshot hot path uses React state

The original design called for requestAnimationFrame coalescing and direct
CodeMirror updates. `livecodeRuntime.tsx` currently parses each changed snapshot,
mutates every module record, and republishes the full module map through React;
shape components then derive ranges and dispatch CodeMirror effects.

The server caps activity at changed-only ~30 Hz, so this is acceptable at the
current scale but conflicts with the intended scalable hot-path boundary.
Piano-roll snapshots do use requestAnimationFrame coalescing.

## P2: signal transport ships everything to everyone

`/signals/snapshots` sends every changed signal to every open socket, exactly
like the params and piano-roll sockets. There is no per-client subscription, so
a canvas watching one playhead still receives every other signal the session
publishes, and a page with ten scope shapes and one roll view pays for all of
them once per tick rather than once per binding.

That is within good-enough at personal scale — the 100 ms tick bounds it to at
most ten messages per second per socket, and changed-only gating keeps an idle
session silent — and it is deliberately not fixed here, because the standing
direction is a **single multiplexed transport** with subscriptions, replacing
four independent ship-all sockets rather than adding a fifth scoping scheme.

Two related bounds, both accepted and noted rather than mitigated:

- a high-rate `set` alternating between two values defeats changed-only gating,
  and ships at the full 10 Hz for that signal;
- signal values are user-shaped, so a large object published every tick is
  serialized and shipped in full. Nothing decimates or diffs it.

### Why waits were not migrated onto the signal tier

The signal tier is the natural home for wait decorations, and the retrofit was
assessed and **deferred**, for reasons worth keeping:

- wait counts ride `/runtime/snapshots` fused with lifecycle truth
  (`activeModules`, `moduleRuns`) that reconnect rehydration depends on.
  Migrating the wait half alone would split lifecycle from waits across two
  sockets;
- that snapshot's wait half has two consumers — the tldraw client and
  `browser-projections`' SketchWrapper — so the migration is a two-client
  change;
- the user-visible gain is zero: the decorations would look identical.

The tier now exists and is proven by three consumers; unification belongs to
the multiplexed-transport work, not to a migration done for tidiness.

## P2: long-process state is not fully bounded

Prepared transient builds and client history are bounded, but these server
maps/stores can grow with new identities over an hours-long process:

- `moduleRunSnapshots` retains the latest entry for every module ID ever seen;
- runtime piano-roll lookup maps persist until that module is analyzed again;
- named piano-roll objects have no eviction lifecycle; an explicit project save
  can persist them, but nothing ever removes one from memory except an explicit
  delete;
- named params entities are the same, and their per-entity tombstone maps
  retain the values of dropped fields indefinitely. A stopped module's entity
  stays live, and its sampler tick keeps serializing that value every 100 ms;
- ended signals are retained until their name is redeclared or the server
  restarts. That is deliberate — a stopped run's last reading stays watchable,
  and clients render it as ended — but it is unbounded in exactly the same way:
  the bound is the number of distinct signal names a session produces, and the
  100 ms sampler keeps serialize-comparing each one. A session that generates
  names dynamically (one signal per voice id) accumulates records that nothing
  ever removes;
- old session directories/logs persist across process runs.

This is unlikely to matter for small sets, but it is contrary to an unqualified
“hours-long server has bounded state” claim.

## Resolved 2026-08-13: a forced piano-roll snapshot consumed the dirty flag

`makePianoRollSnapshot({ force: true })` used to clear `dirty` unconditionally,
and that call runs on every `/piano-roll/snapshots` socket open and every
`/piano-roll/list` request, so a forced snapshot for one caller consumed the
pending broadcast for all the others.

It was predicted here as a one-tick, at-most-one-revision-behind nuisance. It
was worse: creating a roll over HTTP and then listing it — an agent poll, or
the new project-mode E2E — left every open view on its waiting placeholder
indefinitely, because nothing wrote to the store again. Only the broadcast tick
clears the flag now; a forced snapshot is read-only, matching the params store.
Covered by a unit test in `livecode/tests/entity_registry_test.ts` and by the
E2E's create-from-GUI case.

## P2: optimistic client states can obscure acceptance semantics

The client sets a module to `running` before analysis, project diagnostics, and
launch acceptance complete. The server launch response itself means queued, not
started. A future UI should distinguish `preparing`, `queued/launching`, and
server-confirmed `running` consistently.

`getState` catches a failed `/runtime/status` fetch and substitutes no active
modules, which can report `serverRunning: false` when server truth is simply
unavailable.

## P2: checked-in example and aggregate test commands are misleading

The checked-in minimal p5gpu project has a `sped`/`speed` mismatch, while the
automated p5gpu test builds a separate temp project. A fresh agent can mistake
the example for a working smoke fixture.

`deno task test:livecode` omits the tldraw E2E, project shadow test, repro suite,
and p5gpu test, and its E2E target is the older Vue client. Do not call that
single task a complete verification pass.

## Accepted limitations versus bugs

These behaviors are deliberate until a design changes them:

- transient tldraw canvases are not automatically persistent;
- dynamic import occurs only on explicit launch, never analysis;
- piano-roll note state and params values are server-owned and in memory;
  writes at any rate never touch disk, and only an explicit `/project/save`
  persists them. Nothing auto-saves, saves on shutdown, or saves on close, so
  losing a server process loses whatever was not saved. The unsaved count in
  the topbar is informational only;
- entity **rename** is deliberately absent. Duplicate covers the variations
  gesture; rename orphans the name literals in module source, which deserves
  its own design beat;
- an entity created empty (no declaration, no load) is legal but only useful
  once a declaration fills it; there is no GUI schema editor for params;
- params changes have no undo, and no undo history of any kind is serialized;
  undo is reserved for operator actions, and wiring GUI-edit undo through a
  generic action layer is deferred;
- active callsite IDs are per-build random UUIDs, not stable across edits;
- imported helper internals outside the edited project module are opaque;
- a client can edit source while an older module version keeps running;
- direct HTTP launch can bypass the tldraw project's diagnostic guard;
- project remove is currently manifest-only (dangerous if assumed otherwise,
  but documented as current behavior), and entity delete plus save follows the
  same precedent: the manifest entry goes, the data file stays;
- deleting a view never deletes the entity, and deleting an entity never
  deletes its views: a shape is a view, and the two removals are separate,
  separately confirmed choices;
- ephemeral signals are **never** persisted, undoable, or readable by other
  modules' code. A headless run is complete without them; they exist to be
  watched. A reconnecting client recovers current values only, because the
  server keeps no history;
- signal history in a scope is view-side accumulation over shipped samples, not
  a record of what the process computed. It starts when the scope mounts, ends
  when it unmounts or rebinds, and shows the transport's conflated view — a
  value that changed twice inside one 100 ms tick appears once;
- scopes render numbers only in v1, and a playhead marker is drawn only for a
  numeric value or an object with a numeric `position`. Any other shape renders
  the placeholder, or nothing, rather than a guess.
