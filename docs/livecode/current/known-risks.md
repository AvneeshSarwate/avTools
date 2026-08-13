# Current Known Risks and Invariant Gaps

Status: code-inspection audit on 2026-07-21, extended for the canvas-params
slice on 2026-08-13. These are unresolved unless a later entry says otherwise.
Items marked “not regression-tested” are reasoned from the checked-in control
flow and should receive a focused reproduction before a behavioral fix.

This file is required reading because several current names and older docs imply
stronger guarantees than the implementation provides.

## P0: queued launches are outside active-module safety controls

Code path: `launchModule` in `visualizer/server.ts` checks
`activeModules.has(moduleId)` before pushing an action into `launchQueue`.
The queued action does not repeat the check.

Consequences:

- two rapid/concurrent launch requests can both pass the no-replacement check;
- both branches can start, with the second overwriting the first entry in
  `activeModules`;
- the first branch then has no addressable handle for Stop/Panic and can keep
  running until it ends itself;
- Stop, stop-all, or panic after HTTP launch acceptance but before the queued
  import creates `activeModules` sees nothing to cancel; the queued launch can
  start afterward;
- multi-client/agent callers can violate the documented no-surprise execution
  invariant even if one tldraw Run button prevents double-clicks.

This is not regression-tested. The queue needs an explicit pending state and
launch generation/intent cancellation, with the replacement decision enforced
at execution time as well as request time.

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

Module layout persistence keys off each shape's `projectModulePath` and does
work after command-driven open.

The server replaces the entire `manifest.canvas` object on each call. The client
mitigates this for the two view kinds it owns by collecting both arrays into
every post, but the underlying behavior is unchanged: a third canvas field, or a
second writer, would still be lost unless the client reads/merges it or the
server offers granular actions.

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
Canvas-params detection reuses the piano-roll binding and call-resolution
helpers through a shared specifier/function table rather than a second copy of
the branches, but the specifier list is still hard-coded and there is still no
match-confidence concept.

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

## P2: long-process state is not fully bounded

Prepared transient builds and client history are bounded, but these server
maps/stores can grow with new identities over an hours-long process:

- `moduleRunSnapshots` retains the latest entry for every module ID ever seen;
- runtime piano-roll lookup maps persist until that module is analyzed again;
- named piano-roll objects have no eviction/persistence lifecycle;
- named params entities have none either, and their per-entity tombstone maps
  retain the values of dropped fields indefinitely. A stopped module's entity
  stays live, and its sampler tick keeps serializing that value every 100 ms;
- old session directories/logs persist across process runs.

This is unlikely to matter for small sets, but it is contrary to an unqualified
“hours-long server has bounded state” claim.

## P2: a forced piano-roll snapshot consumes the shared dirty flag

`makePianoRollSnapshot({ force: true })` clears `dirty` unconditionally, and
that call runs on every `/piano-roll/snapshots` socket open and every
`/piano-roll/list` request. A forced snapshot for one caller therefore consumes
the pending broadcast for all the others: the next 100 ms tick sees a clean
store and sends nothing, so already-connected clients receive that generation
only when something changes again.

The window is one tick and every affected client is at most one revision
behind, so this has not been observed as a user-visible fault. It was found by
inspection while building the params store, which avoids it: forced params
snapshots are read-only and touch neither the broadcast gate nor the per-entity
caches. This is not regression-tested, and the fix would be to give the
piano-roll store the same read-only forced path.

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
- piano-roll note state is in memory and server-owned, not project/canvas data;
- params values are the same: server-owned, in memory, and not persisted, so a
  server restart returns every entity to its declared defaults;
- params changes have no undo; undo is reserved for operator actions, and
  wiring GUI-edit undo through a generic action layer is deferred;
- active callsite IDs are per-build random UUIDs, not stable across edits;
- imported helper internals outside the edited project module are opaque;
- a client can edit source while an older module version keeps running;
- direct HTTP launch can bypass the tldraw project's diagnostic guard;
- project remove is currently manifest-only (dangerous if assumed otherwise,
  but documented as current behavior).
