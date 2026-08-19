# Current Known Risks and Invariant Gaps

Status: code-inspection audit, current as of 2026-08-13; browser-engine
entries added 2026-08-19; first audited 2026-07-21.

How to read this file: open entries are graded `P0`–`P2` and are unresolved;
`Resolved <date>` entries are kept in place because their rationale still
constrains changes. Items marked “not regression-tested” are reasoned from the
checked-in control flow and should receive a focused reproduction before a
behavioral fix.

This file is required reading because several current names and older docs imply
stronger guarantees than the implementation provides.

## Resolved 2026-08-13: hand-mirrored wire types

The repo's oldest documented drift hazard was that the Deno server and the
tldraw client each declared the wire contract by hand — `visualizer/protocol.ts`
on one side, `livecodeProtocol.ts` plus `pianoRollTypes.ts`, `paramsTypes.ts`,
and `signalsTypes.ts` on the other — with nothing but review keeping them equal.
Optional fields could hide a divergence at compile time on both sides at once.

What shipped: `packages/livecode-protocol`, a type-only workspace package that
both sides compile against. Deno resolves it through the workspace import map;
`apps/livecode-tldraw` compiles it as raw TypeScript through a vite
`resolve.alias` and a tsconfig `paths` entry. `visualizer/protocol.ts` is a
one-line re-export, the three client mirror files are deleted, and
`livecodeProtocol.ts` holds only client-local view models. Two known divergences
were fixed en passant: `HealthResponse.runtimeCapabilities` was optional on one
side and required on the other, and the client's inline `/piano-roll/set` body
became the typed `SetPianoRollRequest`.

**Resolved for wire types, except SketchWrapper's deliberately-kept local
copies.** `apps/browser-projections`' Vue client still declares its own narrower
`ActiveWaitSnapshot` (`{ type, seq, timestampMs, modules }`) and reads the
deprecated `/runtime/snapshots` shim. That is intentional: the shim's envelope is
frozen, so the narrow copy cannot drift into a disagreement, and modernizing that
client was explicitly out of scope. It is the one place where "there is one
source of wire types" needs a qualifier.

## Resolved 2026-08-13: the reused-`generatedRunId` status flicker

A terminal run state used to be correlated by `generatedRunId` plus a timestamp.
That ID identifies a prepared **build** and is reused whenever a relaunch finds
an unchanged one — which is exactly what Replace-without-an-edit does — so the
replaced run's terminal could be mistaken for the replacement's, and a module
could flicker through a wrong status for a snapshot.

What shipped: `runToken`, minted server-side when a launch is **accepted** and
carried on the `run` entity and on `/runtime/state`'s rows. The client's rule
(`runDedupe.ts`) remembers which tokens it watched go active before and since its
current claim, and suppresses only a terminal belonging to a superseded run. The
old `lastTerminalRun { generatedRunId, updatedAtMs }` heuristic is gone.

Covered by `run_dedupe_test.ts` (nine ordering cases, including the straddle and
the instant-failure conflation, both constructed exactly) and by tldraw E2E cases
that produce the straddle through the real Replace button and drive a module that
throws on its first line. The browser cannot guarantee the single-tick
conflation, which is why the unit test carries that one.

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

## P2: the live hot path still republishes the full module map

The original design called for requestAnimationFrame coalescing and direct
CodeMirror updates. Half of that arrived: every entity kind is now coalesced
through one `requestAnimationFrame` flush in `syncRuntime.tsx`, and each kind has
its own React context so a signal tick does not re-render param panes.

The remaining half has not. When runs, waits, or lookups change,
`livecodeRuntime.tsx` still mutates every module record and republishes the full
module map through React; shape components then derive ranges and dispatch
CodeMirror effects. The server caps activity at changed-only ~30 Hz, so this is
acceptable at the current scale but still conflicts with the intended scalable
hot-path boundary.

## Resolved 2026-08-13: four ship-all sockets became one subscribed transport

`/runtime/snapshots`, `/piano-roll/snapshots`, `/params/snapshots`, and
`/signals/snapshots` each sent a full store map to every open socket, with four
hand-copied broadcast blocks and four timers behind them. A canvas watching one
playhead received every signal the session published; editing one note
rebroadcast the whole roll store.

What shipped: `GET /sync`, one socket carrying every entity kind, per entity,
changed-only, scoped to the types that socket subscribed to; one
`SyncSourceRegistry` and one 33 ms timer that collects changes exactly once and
fans them out; per-name change tracking in `entity_store.ts` so deletions and
meta-only changes are visible at all. The three entity sockets are deleted;
`/runtime/snapshots` survives only as the SketchWrapper shim.

Two bounds from the old entry survive the change and are still accepted:

- a high-rate `set` alternating between two values defeats changed-only gating
  and ships at the full tick rate for that entity;
- signal and params values are user-shaped, so a large object written every tick
  is serialized and shipped in full. Nothing decimates or diffs it — see the
  sub-entity-diff entry below.

### Waits were migrated after all

An earlier revision of this file recorded why wait decorations were **not**
moved onto the entity tier: they rode `/runtime/snapshots` fused with lifecycle
truth that reconnect rehydration depended on, and splitting the wait half alone
would have spread one module's state across two sockets. That blocker dissolved
when runs became entities too — `run`, `moduleWaits`, and `moduleLookups` now
travel together on `/sync` — and the two-client concern is handled by the frozen
shim rather than by a second migration.

## P2: sync subscriptions are type-level only

A `/sync` subscribe names entity **types**, not names. A canvas showing one param
pane subscribes to `params` and receives every params entity that changes, not
just the one it renders. This is a deliberate v1 scope decision: the envelope
already admits per-name scoping without a breaking change, and the changed-only
delivery it sits on removed the large majority of the old traffic.

The bound is the number of *changing* entities per tick, not the store size, so
it is comfortable at personal scale. It becomes worth revisiting when one page
holds many views of many entities, or when a remote/multi-client surface makes
"who may watch what" a security question rather than a bandwidth one.

## P2: a changed entity ships whole; there are no sub-entity diffs

Editing one note re-sends that roll's entire `data`, and writing one param leaf
re-sends that entity's whole `values` tree. Per-entity granularity was the whole
win over per-store snapshots and it is enough today, but nothing below the
entity is diffed, so a very large roll edited at gesture rate is the shape of
workload that would expose it. Note-level or leaf-level patches are a deliberate
future optimization, not a defect.

## P2: SketchWrapper's debug snapshot array is unbounded

`apps/browser-projections`' livecode SketchWrapper pushes **every**
`/runtime/snapshots` message it receives into `debugState.receivedSnapshots` and
only ever clears it from the debug `reset()` helper. A long session on that page
accumulates one object per changed tick forever. It is a debug surface in a
client this slice deliberately did not modernize, so it is recorded rather than
fixed; the tldraw client has no equivalent array.

## P2: long-process state is not fully bounded

Prepared transient builds and client history are bounded, but these server
maps/stores can grow with new identities over an hours-long process:

- `moduleRunSnapshots` retains the latest run record for every module ID ever
  seen, so each also stays a live `run` entity on the transport;
- the module-keyed sync sources keep one last-serialized-value string per name
  they have ever shipped, and nothing evicts those either;
- runtime piano-roll lookup maps persist until that module is analyzed again;
- named piano-roll objects have no eviction lifecycle; an explicit project save
  can persist them, but nothing ever removes one from memory except an explicit
  delete;
- named params entities are the same, and their per-entity tombstone maps
  retain the values of dropped fields indefinitely. A stopped module's entity
  stays live, and the adopt pass keeps serializing that value every 33 ms;
- ended signals are retained until their name is redeclared or the server
  restarts. That is deliberate — a stopped run's last reading stays watchable,
  and clients render it as ended — but it is unbounded in exactly the same way:
  the bound is the number of distinct signal names a session produces, and the
  33 ms adopt pass keeps serialize-comparing each one. A session that generates
  names dynamically (one signal per voice id) accumulates records that nothing
  ever removes;
- old session directories/logs persist across process runs.

This is unlikely to matter for small sets, but it is contrary to an unqualified
“hours-long server has bounded state” claim.

## Resolved 2026-08-13: a forced piano-roll snapshot consumed the dirty flag

`makePianoRollSnapshot({ force: true })` used to clear `dirty` unconditionally,
and that call ran on every `/piano-roll/snapshots` socket open and every
`/piano-roll/list` request, so a forced snapshot for one caller consumed the
pending broadcast for all the others.

It was predicted here as a one-tick, at-most-one-revision-behind nuisance. It
was worse: creating a roll over HTTP and then listing it — an agent poll, or
the project-mode E2E — left every open view on its waiting placeholder
indefinitely, because nothing wrote to the store again. Only the broadcast tick
consumes the gate now; every read path is read-only, matching the params store.
Covered by a unit test in `livecode/tests/entity_registry_test.ts` and by the
E2E's create-from-GUI case.

The rule outlived the socket it was written for. `/piano-roll/snapshots` is
gone, but a `/sync` subscribe reset takes the same read-only path, and
`sync_sources.ts` states the invariant explicitly: `collectChanges()` drains,
`snapshotAll()` never does.

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

## P1: background-tab throttling can stretch browser-engine timing

A hidden/occluded engine tab gets its timers clamped by Chrome (1 s, worse
under intensive throttling), which would wreck the ~33 ms tick and musical
timing. Mitigations shipped per the plan's decision: a silent `AudioContext`
keepalive in the engine page (exempts the tab from intensive throttling;
autoplay policy may hold it suspended until a gesture lands on the tab), a
timer watchdog that logs `engineTickStretch` locally and over the uplink
whenever the main-thread clock stretches past 250 ms, and operator discipline
(keep the engine tab visible). The warning is log-tier, not a UI surface, and
every E2E launches Chromium with throttling disabled, so this path is
reasoned-not-regression-tested. The Worker time-source upgrade is recorded in
`next-stuff-brainstorm.md`.

## P2: Web MIDI is window-scoped, permission-gated, and gesture-dependent

In a browser engine, MIDI outputs exist only after `initMidi()` succeeds,
which requires the Web MIDI permission and — under autoplay-style policies — a
user gesture in the engine tab. Until then instrumented modules see no
devices (send helpers degrade to no-ops) and `panicMidi` has nothing to
flush. Chrome is the reliable target; Safari has no Web MIDI. The panic hook
itself is wired identically on both engines; headless E2Es cannot exercise
real MIDI ports, so device-level behavior is manually verified only.

## P2: single-engine enforcement has explicit takeover semantics

One engine per origin is enforced by a `navigator.locks` exclusive lock in
the engine page: a second tab renders "already running" with a takeover
button; taking over steals the lock, and the losing tab panics its runtime
(MIDI flush included), closes its channels, and stops reconnecting. The
server-side uplink keeps the independent newest-socket-wins replacement rule.
Web Locks are per browser profile, so two engine tabs in DIFFERENT browsers
(or machines) are not lock-arbitrated: each reconnect replaces the other on
the uplink every ~2 s. Don't do that; the lock protects the supported
one-browser topologies.
Takeover is deliberately destructive — the old tab's execution state dies
with it, exactly like killing a Deno engine process. Covered by the baked
E2E's lock section. Browsers without Web Locks run unguarded.

## P2: the broadcast sync transport cannot detect a dead engine tab

Over `?sync=broadcast` the channel is "open" the moment it exists, and an
idle engine legitimately sends nothing, so a closed engine tab is
indistinguishable from a quiet one — the UI keeps rendering the last-known
world with no error. The uplink relay path answers this with detach
empty-resets; the broadcast path has no equivalent (a heartbeat would need
its own protocol). Accepted for the single-operator topologies where the
operator closed the tab themselves.

## P1: the browser module-delivery surface is narrower than the Run gate

A browser engine can import exactly: the five helper aliases bundled by
`build_host_assets.ts` (`piano-roll-helpers`, `midi-helpers`,
`canvas-params`, `canvas-signals`, `piano-roll-store`), the generated
runtime, and relative project files. The browser-target shadow check resolves
the WHOLE repo import map, so a module importing anything else (e.g.
`@avtools/shader-fx`, npm packages) typechecks green and then fails at
launch in the tab with a bare-specifier/fetch import error rather than a
source-located diagnostic. Closing the gap means either bundling more aliases
into the host assets or narrowing the browser-check import map to the served
surface; until then the gate over-promises for non-alias imports.

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
  value that changed twice inside one 33 ms tick appears once;
- scopes render numbers only in v1, and a playhead marker is drawn only for a
  numeric value or an object with a numeric `position`. Any other shape renders
  the placeholder, or nothing, rather than a guess.
