# Project Modules And Intra-Canvas Imports

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
- kind: `library` or `runnable`
- title
- canvas x/y/w/h

Library modules are written to disk and imported by other modules. Runnable
modules are analyzed, transformed, and launched using the default async
`TimeContext` root function convention.

For this MVP, all tldraw-authored modules pass through the visualization
transform before runtime materialization. Library files without a default timed
root can transform/pass through. Runnable files still require the default async
`TimeContext` root.

No complex static import graph is required for MVP. The conservative approach is
to materialize all project modules whenever a project module is analyzed or
written.

## p5gpu Live-Performance Shape

The default p5gpu project should be organized like:

- `modules/state.ts`: transformed runtime file exporting shared mutable state
  and flags.
- `modules/sketch.ts`: transformed runtime file owning GPU/P5GPU setup and the
  long-running draw loop.
- `modules/modifiers/*.ts`: transformed runtime files for short runnable
  livecode modules that mutate state.

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

Minimum states:

- clean
- editor dirty
- changed on disk
- conflict: editor dirty and disk changed
- running stale: running code differs from disk/editor source

Do not auto-reload editor buffers. Show a warning and explicit actions:

- `Reload from disk`
- `Stop and reload` when a stale module is running
- conflict choices: `Keep editor` or `Reload from disk`

For MVP, imported library dependency staleness can be conservative. If any
project source file changes on disk, mark running modules stale and recommend
`Restart All`.

## Agent Steering API

Server endpoints should allow agents and tests to drive the project without
Playwright:

```txt
POST /project/create
POST /project/open
POST /project/save
GET  /project/current
GET  /project/status
GET  /project/events

POST /project/modules/add
POST /project/modules/update
POST /project/modules/remove
POST /project/modules/reload
POST /project/modules/write

POST /runtime/launch
POST /runtime/stop
POST /runtime/stop-all
POST /runtime/restart-all
GET  /runtime/status
```

This is enough for automated tests and coding agents to create modules, write
source, run modules, stop modules, and inspect state without driving the browser
UI.

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
8. Mutate one `.orig.ts` file on disk and assert project status reports both
   changed-on-disk and running-stale state.
9. Stop all modules and close the project.

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
- `apps/deno-notebooks/livecode/tests/project_p5gpu_e2e_test.ts`

The UI still needs to adopt the project endpoints and the paired source/runtime
file model.
