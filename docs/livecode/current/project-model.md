# Current Project Model

Status: checked against project routes, shadow analysis, the tldraw project
bridge, and feature fixtures on 2026-08-26.

## Files and ownership

A project is a caller-selected directory with
`project.avtools-livecode.json`, canonical `*.orig.ts` source, derived `*.ts`
runtime files, and optional `data/<entity-type>/*.json` files. Imports between
project sources name runtime paths such as `./state.ts`; agents and editors
must edit only the paired `*.orig.ts`.

The manifest's exact interface is `LivecodeProjectManifest` in
`packages/livecode-protocol/project.ts`. Its architectural roles are:

- select the engine target and enumerate runnable modules with source/runtime
  paths, versions, and layout;
- persist registered canvas-view bindings/layout, not arbitrary tldraw shapes;
- reference saved durable entity files by type, true name, and path.

View IDs are tldraw shape IDs and hand-authored ones therefore need the
`shape:` prefix. A scope saves its binding and window, never sample history.
Signals are absent from project data by design. The server neither creates a
project `deno.json` nor migrates/fully schema-validates manifests.

There is exactly one current project per server. It is shared by every client,
route, analysis, and LSP-related operation. Switching projects does not stop
old runs or clear engine stores.

## Source, materialization, and run identity

Create/open/add/write/reload/analyze and the misleading restart-all path can
materialize project modules. Materialization hashes canonical sources, reuses a
successful transform only for an unchanged source hash, and overwrites derived
runtime files for changed modules. A failed transform may leave the prior
runtime file on disk, so file existence is not proof that current source is
runnable.

The tldraw project editor is write-through: after its analysis debounce it
writes the whole buffer to canonical source before requesting runtime analysis.
Consequently the status model's `dirty`/`conflict` concepts are rarely produced
by the current UI; external disk edits normally appear as `changedOnDisk` until
explicit reload.

Transient prepared builds use unique immutable generated paths. Project
preparations point at mutable runtime paths. The launched entry gets a cache
busting query, but relative dependencies keep stable URLs and may retain old
module instances. This both enables shared imported state and prevents ordinary
dependency hot reload. A process restart is the only reliable Deno dependency
cache reset today; `/runtime/restart-all` is not one.

## Project operations that are not conventional CRUD

- Open/create is serialized with other project-backed operations and publishes
  the new global selection only after preparation succeeds. It does not stop
  active modules, and filesystem or engine-entity side effects are not rolled
  back if a later step fails.
- Module update changes metadata/layout but does not implement path rename,
  despite accepting a path-shaped input.
- Module remove drops the manifest/cache record only. Source/runtime files and
  an active run remain.
- `/project/canvas` replaces the complete canvas object. The client must post
  every registered view kind together.
- Project events is a status read, not a subscription.
- Module layout is debounced from shapes carrying `projectModulePath`. Canvas
  layout/save UI currently depends on the initial URL's `projectPath`, so a
  later command-opened project has incomplete human save behavior.

Exact requests and status fields live in `packages/livecode-protocol/project.ts`
and their handlers in
`apps/deno-notebooks/livecode/visualizer/server.ts`.

## Durable entity persistence

Piano rolls, params, and animation timelines live in engine memory. Only an
explicit project save captures them; code writes never touch disk and shutdown
does not auto-save. Save first captures all durable registered stores, writes
one JSON file per entity, and rewrites manifest data entries. The save is not
atomic and captures the process-global store, not only entities introduced by
the current project.

The entity registry owns collision-safe filename encoding and allocation.
Manifest entries retain the true name, so filenames are never decoded. Deleting
an entity followed by save removes its manifest entry but deliberately leaves
the old data file, matching manifest-only module removal. Piano-roll undo/redo
history is never serialized; loading disk truth clears it. Params save their
metadata and load mutates held live objects in place so running code does not
retain a detached value.

Save aborts before writes if a current durable value cannot serialize. An
untouched demo roll is deliberately skipped. Open, in contrast, skips/logs an
invalid or unknown individual data entry and continues; partial data already
loaded is not rolled back if a later open step fails.

Signals are excluded by the absence of a durable descriptor, not by a save-time
filter. Adding one accidentally would make them visible to save/status/load and
generic entity CRUD.

## Diagnostics and staleness

Project status builds a relative-import graph from static imports, source
re-exports, and literal dynamic imports. Dependency changes and
`runningStale` are informational; nothing automatically stops, reloads, orders,
or relaunches modules.

Shadow diagnostics transform current canonical sources into a temporary tree
and run target-aware `deno check` without touching runtime files or importing
user code. The tldraw Run path blocks on failure. LSP uses another workspace and
is feedback only. Rewritten imports and inserted instrumentation are not
source-mapped back perfectly, so generated line/column attribution can be
lossy.

## Authoring a checked-in project

Start from `apps/livecode-tldraw/example-projects/basic-multi-module` and the
manifest/protocol interfaces rather than copying a manifest shape from this
doc. Give each module explicit layout, canonical `*.orig.ts` source, runtime
path imports, and a supported default async `TimeContext` function (a no-op root
is valid). Keep generated `*.ts` files ignored.

A user-visible feature should have one checked-in `feature-*` project whose
README describes startup and save/reopen behavior. Manual verification and E2E
must consume that same manifest/source/data; destructive tests copy it first.
`feature-animation-timeline` is the reference. Keep invalid/boundary payloads in
focused tests rather than bloating the project fixture.
