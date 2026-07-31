# Current Project Model

Status: checked against the server, tldraw client, project tests, and checked-in
example on 2026-07-21.

## Durable file model

A project is a caller-selected directory containing a version-1 manifest and
paired source/runtime files:

```text
project/
  project.avtools-livecode.json
  deno.json                         # optional/caller-maintained; not created by the server
  modules/
    state.orig.ts                   # canonical editable source
    state.ts                        # transformed runtime output
    sketch.orig.ts
    sketch.ts
    modifiers/
      color-loop.orig.ts
      color-loop.ts
```

Editor source imports runtime paths, not `.orig.ts` paths:

```ts
import { state } from "./state.ts";
```

The same specifier continues to work after transformation because generated
project output is written at `state.ts`. Coding agents and external editors
must edit only `*.orig.ts`; `*.ts` is derived output.

## Manifest

`project.avtools-livecode.json` has this shape:

```ts
interface LivecodeProjectManifest {
  version: 1;
  name: string;
  modules: Array<{
    id: string;
    path: string;          // normalized runtime path
    sourcePath: string;    // paired *.orig.ts path
    runtimePath: string;   // normalized *.ts output path
    kind: "runnable";
    title: string;
    sourceVersion: number;
    x?: number;
    y?: number;
    w?: number;
    h?: number;
  }>;
  canvas?: {
    pianoRollViews?: Array<{
      id: string;
      rollName: string;
      x: number;
      y: number;
      w: number;
      h: number;
    }>;
  };
}
```

All modules are normalized to kind `runnable`. For `/project/create` and
`/project/modules/add`, an omitted ID defaults to the normalized runtime path.
A manifest written directly to disk must currently include `id`; the
`/project/open` normalization path does not synthesize a missing one. Paths must
be relative, remain lexically inside the project, and end in `.ts`; passing an
`.orig.ts` path is normalized to its runtime `.ts` path.

The server does not currently create or validate a project `deno.json`, nor
does it migrate manifest versions.

## Agent recipe: create a saved UI example

Use the project format, not raw `.tldr`, when an agent needs to author multiple
code modules as ordinary files and prescribe their initial canvas layout. The
small copyable reference is
`apps/livecode-tldraw/example-projects/basic-multi-module`.

1. Create `apps/livecode-tldraw/example-projects/<name>/` with a
   `project.avtools-livecode.json` and a `modules/` directory. Copy the basic
   example's `modules/.gitignore` so materialized runtime files do not appear as
   new source files in Git.
2. Write only canonical `modules/*.orig.ts` sources. Do not author or edit the
   derived `modules/*.ts` files; `/project/open` materializes them.
3. Give every module a complete manifest record, including `id`, `path`,
   `sourcePath`, `runtimePath`, `kind`, `title`, `sourceVersion`, and
   `x`/`y`/`w`/`h`. Explicit layout prevents modules without coordinates from
   being created on top of each other at the viewport center.
4. Import another project module through its runtime path, such as
   `import { state } from "./state.ts"`, never through `state.orig.ts`.
5. Give every source a supported default async `TimeContext` function. A
   data-only module may use a no-op root.
6. Start the Deno server and Vite client, then open
   `http://localhost:5173/?projectPath=<absolute-project-directory>`. An
   absolute path avoids the server resolving a relative path against its own
   working directory.
7. After changing the manifest externally, reload the project/page. The open
   client does not watch the manifest and rebuild the canvas automatically.

On successful open, the server reads every `*.orig.ts`, writes transformed
`*.ts` runtime files, and the client creates one code shape per manifest record
at the saved coordinates. Source edits in those shapes write through to
`*.orig.ts`; moving/resizing a project code shape writes layout back after a
one-second debounce.

This project format currently persists code-module layout and optional
piano-roll-view layout only. It does not persist arbitrary tldraw shapes,
piano-roll note data/history, active runs, or runtime snapshots. Standalone
`.tldr` files preserve a tldraw document snapshot but are tldraw-owned,
version-sensitive, and not the preferred agent-authored multi-file format.

## One current project

The server has one global `currentProject`. It is not associated with a client
ID, browser tab, or LSP session. Every project route and every project-mode
analysis operates on that selection.

Opening/creating a project while modules from another project are active does
not automatically stop them. An operator must explicitly stop or panic runs.

## Module contract

Every project source is passed through the normal analyzer and therefore needs
a default async `TimeContext` function. A shared-state-only module can use a
no-op root:

```ts
export const state = { value: 1 };

export default async function (_ctx: TimeContext) {}
```

A module may also export `stop()` for window/GPU/event cleanup. The server calls
it on a graceful stop, replacement, stop-all, and server close, but not panic.

## Materialization

Project materialization:

1. reads and hashes all manifest sources;
2. computes a sorted aggregate project source hash;
3. reuses a successful per-module transform only when its cached source hash
   matches;
4. transforms changed modules with one materialization `generatedRunId`;
5. writes successful transformed code to each `runtimePath`;
6. records the current disk hash as both editor and last-loaded hash.

It runs on project create/open (when modules exist), add, metadata/layout
update, source write, reload, project analyze, and `/runtime/restart-all`.
Source-hash caching prevents unchanged runtime files from being rewritten, but
the operation still reads/hashes sources and creates a new materialization ID.

A failed transform leaves that module's previous runtime file on disk and
removes its transform-cache entry. Callers must use the returned analysis and
shadow diagnostics rather than assuming the presence of a `.ts` file means the
current source transformed successfully.

## CRUD semantics

- **Create:** uses the requested directory, or a `project` directory inside
  the current server session. It writes initial modules and the manifest.
- **Open:** reads and normalizes a manifest, initializes hashes from disk, and
  materializes. It does not stop existing runs.
- **Add:** writes/ensures source, writes the manifest, and materializes.
- **Update:** updates title/version/layout fields on an existing record. It does
  not implement path renaming even though the input type includes `path`.
- **Write:** writes canonical source, sets/increments source version, writes the
  manifest, and materializes.
- **Reload:** reads disk, adopts that hash as editor/loaded truth, and
  materializes. It does not send the source to a browser; the browser control
  command separately fetches it and updates the shape.
- **Remove:** removes only the manifest record and caches. It does not delete
  either file and does not stop a run with the same module ID.
- **Save:** rewrites the in-memory manifest.
- **Canvas:** replaces the entire optional canvas object. The current client
  sends only its piano-roll-view array.

## Client edit behavior

The tldraw project editor is write-through after its 100 ms analyze debounce:
it posts the whole buffer to `/project/modules/write` before
`/runtime/analyze`. There is no long-lived unsaved project editor buffer in the
current path.

As a result, `dirty` and `conflict` fields exist in project status but are not
normally produced by current client behavior: writes set `editorHash` and
`lastLoadedHash` together. External changes produce `changedOnDisk`; an explicit
reload adopts them.

The UI currently surfaces dependency-change and dependency-diagnostic badges.
It does not implement the historical design's full set of Reload/Keep editor/
Regenerate/Stop-and-run conflict controls. Browser-aware reload is available
through `/client/command`.

## Staleness and dependency graph

Project status parses `*.orig.ts` and recognizes:

- static imports;
- source-module re-exports;
- string-literal dynamic imports;
- only relative specifiers for project dependency edges.

Each module reports direct dependencies/dependents and transitive
`changedDependencies`. A module is `runningStale` when it is active and either:

- its current disk hash differs from the run's source hash; or
- one of its transitive dependencies changed relative to the last loaded hash.

These are informational. No dependency change automatically stops, reloads, or
launches anything.

## Shadow diagnostics

Shadow diagnostics are separate from materialization. They use current
`*.orig.ts` source, write transformed output to a unique temporary tree, and run
`deno check` without touching project runtime files or importing user code.

The response contains the graph, aggregate diagnostics, per-module diagnostics,
changed dependencies, and the raw Deno check result. See `server.md` for cache
and position-mapping details.

The tldraw Run path refuses a project launch when the latest requested shadow
check fails. Direct HTTP launch remains possible.

## Module identity and Deno caching

Transient generated builds have immutable unique file paths. Project prepared
builds do not: their `transformedModuleUri` points at the mutable project
`runtimePath`.

The server cache-busts the launched entry module with `?launch=<uuid>`, but
relative dependencies such as `./state.ts` resolve to stable URLs. Deno can
therefore retain a previously imported dependency instance across entry-module
relaunches. This is why existing shared mutable state can remain visible across
separate module launches, but it also means changing the shape/initialization of
a dependency is not a normal hot reload.

`/runtime/restart-all` currently stops and rematerializes only; it neither
relaunches prior modules nor creates a new Deno isolate. It is not a complete
module-cache reset. A server process restart is the reliable reset today.

The mutable runtime path also means an older remembered project
`generatedRunId` does not guarantee immutable bytes. This is a documented high
priority invariant gap in `known-risks.md`.

## Layout persistence

Module x/y/w/h changes are debounced to `/project/modules/update` for any shape
with a project module path.

Piano-roll-view persistence currently activates only when the page's initial
URL has `projectPath`. Opening a project later through the browser-control
command does not update that captured URL-derived flag, so later piano-roll
layout edits are not posted. This is listed in `known-risks.md`.

Named piano-roll notes and history are never stored in the project manifest;
only view identity/name/layout is persisted.

## Checked-in example

`apps/livecode-tldraw/example-projects/basic-multi-module` is the minimal,
source-only, known-green template for agent-authored examples. It contains
three modules with explicit layouts and deliberately omits generated `*.ts`
files from version control so opening it exercises normal materialization.

`apps/livecode-tldraw/example-projects/minimal-p5gpu` demonstrates the expected
directory/import/layout shape and optional `stop()` cleanup. Its current
`state.orig.ts` exports `sped`, while sketch/modifier sources read or write
`speed`, so the checked-in example does not currently pass its intended project
typecheck. The automated p5gpu test creates a separate temporary project and
does not validate this checked-in example.
