# Project Modules And Intra-Canvas Imports

> Historical design document. Implemented and aspirational behavior are mixed
> here. Start at `docs/livecode/README.md` for the current model.

This document tracks the project-in-tldraw line of work: code modules on a
tldraw canvas should be able to import each other, persist as a local project,
and run through the same visualization instrumentation used by single livecode
modules.

## Goal

The first usable version should support a full local project, not just transient
tldraw state. The user should be able to create, open, and save a livecode
project; run one long-lived p5gpu sketch loop; and live-run smaller modules that
import and mutate shared state.

The key product constraint is that coding agents and external editors are part
of the workflow. Source files must exist as normal files on disk, and the server
must be able to report when disk contents differ from the code that is currently
loaded or running.

## File Model

Use a real project directory as the durable boundary:

```txt
my-livecode-project/
  project.avtools-livecode.json
  deno.json
  modules/
    state.orig.ts
    state.ts
    sketch.orig.ts
    sketch.ts
    modifiers/
      pulse.orig.ts
      pulse.ts
      snapshot.orig.ts
      snapshot.ts
```

The `.orig.ts` files are editor-owned source files. They are what tldraw code
shapes display and write, and they are also the files coding agents should edit.

The `.ts` files are runtime files materialized by the visualization transform.
They intentionally do not have generated suffixes. This is the current design
decision so intra-project imports remain simple and technically possible across
all tldraw-authored files:

```ts
import { state } from "./state.ts";
import { state } from "../state.ts";
```

In other words, editor source may import `./state.ts`, and the runtime import
graph resolves to the transformed/generated `state.ts`. This keeps import paths
stable and avoids rewriting imports to generated filenames.

This `.orig.ts` vs `.ts` split is still a product/design choice to revisit
later, but it is the MVP behavior because it proves visualization
instrumentation can apply project-wide while preserving normal relative imports.

## Module Model

Each tldraw code module should have:

- stable module id
- human-readable module path
- kind: currently normalized to `runnable`
- title
- canvas x/y/w/h

All project modules are analyzed, transformed, typechecked as part of the
project graph, and launched through the same Run path. Shared-state modules can
still mainly export data for other modules, but they also need a default async
`TimeContext` root. That root can be a no-op; running the module commits the
editor buffer, regenerates runtime files, and surfaces project diagnostics.

Project modules may also export an optional module cleanup hook:

```ts
export function stop() {
  // Close native windows, stop render loops, dispose GPU resources, etc.
}

export default async function (ctx: TimeContext) {
  // Long-running timed root.
}
```

The livecode server calls `stop()` when the user stops a module, when a module
is replaced before relaunch, and during `stop-all`. The hook is intentionally
outside the timed root instrumentation path; it should be short, idempotent, and
safe to call even if the module already cleaned itself up. This is the expected
place for p5gpu/windowed sketches to close native windows and stop render loops.

For this MVP, all tldraw-authored modules pass through the visualization
transform before runtime materialization and require the default async
`TimeContext` root. This keeps the Run button meaningful for every module,
including shared-state modules.

The server also computes a general static project import graph from the
`.orig.ts` sources. This is intentionally not based on baked-in module roles.
Project-local static imports and string-literal dynamic imports are resolved to
other tldraw project modules when possible. The graph is used for dependency
freshness and diagnostics; it does not imply automatic reload or automatic run.

## p5gpu Live-Performance Shape

The default p5gpu project should be organized like:

- `modules/state.ts`: transformed runtime file exporting shared mutable state
  and flags.
- `modules/sketch.ts`: transformed runtime file owning GPU/P5GPU setup and the
  long-running draw loop.
- `modules/modifiers/*.ts`: transformed runtime files for short livecode modules
  that mutate state.

Most performance iteration should happen in modifier modules. Changing the shape
of `state.orig.ts` or sketch setup can require `Restart All`, because Deno
module caching means already-imported state shapes are not automatically
reloaded in running modules.

## Disk Status

The server should track enough hashes to show useful UI state:

- `diskHash`: current editor source contents on disk, usually `*.orig.ts`
- `editorHash`: current editor buffer
- `runHash`: source hash used by the currently running module
- `lastLoadedHash`: disk hash last loaded into the client
- `projectSourceHash`: aggregate hash for all project source files
- `dependencies`: project module ids this module imports
- `dependents`: project module ids that import this module
- `changedDependencies`: transitive dependencies whose `.orig.ts` hash differs
  from the last loaded/generated hash

Minimum states:

- clean
- editor dirty
- changed on disk
- conflict: editor dirty and disk changed
- running stale: running code differs from disk/editor source
- dependency changed: an imported module changed since this module was last
  checked/generated
- dependency issue: a changed dependency is associated with current typecheck or
  transform diagnostics

Do not auto-reload editor buffers. Show a warning and explicit actions:

- `Reload from disk`
- `Stop and reload` when a stale module is running
- conflict choices: `Keep editor` or `Reload from disk`
- `Regenerate` to explicitly rewrite real runtime `.ts` files
- `Stop and run` or `Run selected` for explicit execution

Staleness is dependency-aware. Editing `modules/modifiers/color-loop.orig.ts`
does not make `modules/sketch.ts` stale unless the sketch imports the modifier.
Editing a shared dependency such as `modules/state.orig.ts` marks transitive
dependents as dependency-changed, and a running dependent is `runningStale`.

Run and replacement are no-surprise operations. `/runtime/launch` refuses to
replace an already running module unless the caller explicitly passes
`replaceRunning: true`.

## Shadow Diagnostics

The server exposes a non-mutating shadow check:

```txt
GET /project/diagnostics
```

The implementation writes transformed versions of current `*.orig.ts` files to
a session-owned shadow directory:

```txt
<session>/shadow/
  modules/state.ts
  modules/sketch.ts
  modules/modifiers/color-loop.ts
```

It then runs Deno type checking against the shadow runtime graph and returns:

- dependency edges
- per-module dependencies and dependents
- changed dependencies
- transform diagnostics
- Deno typecheck diagnostics
- dependency diagnostics for modules whose changed dependencies are implicated

This check intentionally does not overwrite the real project `*.ts` runtime
files and does not import or execute user code. It lets the UI and agents show
"current source would typecheck if regenerated" separately from "real runtime
output has been regenerated" and "running code has been restarted."

## Agent Steering API

Implemented server endpoints allow agents and tests to manipulate the project
model without Playwright:

```txt
POST /project/create
POST /project/open
GET  /project/current
GET  /project/status
GET  /project/diagnostics
GET  /project/modules/source

POST /project/modules/add
POST /project/modules/update
POST /project/modules/remove
POST /project/modules/reload
POST /project/modules/write

POST /runtime/launch
POST /runtime/stop
POST /runtime/stop-all
GET  /runtime/status
```

This is enough for automated tests and coding agents to create modules, write
source, inspect dependency/typecheck status, launch transformed runtime modules,
stop modules, and inspect server state. Launching a module that is already
running requires explicit `replaceRunning: true`; otherwise the server returns a
409 instead of stopping live code.

Some actions still need the live tldraw client because they change browser
canvas state or use the same UI runtime path as a human would. The client opens
a browser-control WebSocket, and agents send HTTP commands to the server:

```txt
GET  /client/clients
GET  /client/control            # browser websocket
POST /client/command            # agent -> server -> browser websocket
```

`POST /client/command` forwards a command envelope to one connected
livecode-tldraw client and waits for a `clientCommandResult`. Initial commands:

- `getState`
- `openProject`
- `addProjectModule`
- `reloadProjectModule`
- `setModuleSource`
- `runModule`
- `stopModule`
- `stopAllModules`

This gives agents a browser-aware path for tests without needing to click tldraw
internals through Playwright. The state response includes both local UI
build/run status and server runtime truth (`serverRunning`) from
`/runtime/status`.

## Required p5gpu Proof

Add one minimal end-to-end test that proves real p5gpu interaction works through
the project/module system.

Test shape:

1. Create a temp project through the project API.
2. Add `modules/state.ts` with a shared snapshot flag:

```ts
export const state = {
  frame: 0,
  color: [20, 30, 60] as [number, number, number],
  snapshotRequested: false,
  snapshotPath: "",
};
```

3. Add `modules/sketch.ts` as the long-running p5gpu loop. It imports `state`,
   renders a minimal scene, and on each frame:
   - increments `state.frame`
   - if `state.snapshotRequested` is true, saves the current frame image to
     `state.snapshotPath`
   - sets `state.snapshotRequested = false` after saving
4. Launch `modules/sketch.ts`.
5. Add/run `modules/modifiers/snapshot.ts`, whose only job is to set:

```ts
import type { TimeContext } from "@avtools/core-timing";
import { state } from "../state.ts";

export default async function (_ctx: TimeContext) {
  state.snapshotPath = "./snapshots/livecode-test.png";
  state.snapshotRequested = true;
}
```

6. Poll project/runtime status until the sketch clears the flag or the snapshot
   file appears.
7. Assert the PNG exists and is non-empty. If practical, decode enough of it to
   verify width/height and at least one non-background/non-transparent pixel.
8. Mutate a modifier `.orig.ts` file on disk and assert project status reports
   only that modifier changed, without marking the independent running sketch
   stale.
9. Mutate a shared dependency `.orig.ts` file and assert shadow diagnostics show
   dependency warnings on affected dependents without rewriting real runtime
   files.
10. Stop all modules and close the project.

This test proves:

- modules import each other through real files
- all tldraw-authored project files can be materialized through the transform
- a long-running sketch sees state changes from a separately launched livecoded
  module
- agent/server APIs are enough to exercise the workflow
- the runtime can produce an observable artifact without browser automation

## Current Implementation Notes

The current implementation lives in the livecode visualizer server:

- `apps/deno-notebooks/livecode/visualizer/server.ts`
- `apps/deno-notebooks/livecode/visualizer/protocol.ts`
- `apps/deno-notebooks/livecode/visualizer/analyze_transform.ts`
- `apps/deno-notebooks/livecode/visualizer/project_shadow_analysis.ts`
- `apps/deno-notebooks/livecode/tests/project_p5gpu_e2e_test.ts`
- `apps/deno-notebooks/livecode/tests/project_shadow_diagnostics_test.ts`

The livecode-tldraw UI now loads project modules from `projectPath`, displays
`.orig.ts` editor files, writes through `/project/modules/write`, and launches
the transformed `.ts` runtime files. It also connects to `/client/control` for
agent steering commands. It polls `/project/diagnostics` while connected and
surfaces dependency-change and dependency-issue badges on module shapes; these
warnings are informational and do not run, stop, or regenerate code.
