## MVP usage slice - project modules, disk sync, agent control, p5gpu proof

The first usable version should support a full local project, not just transient
tldraw state. The user should be able to create/open/save a livecode project,
run one long-lived p5gpu sketch loop, and live-run smaller modules that import
and mutate shared state.

### project layout

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

The project file stores canvas/layout metadata and module metadata. Source text
from the editor belongs in the `.orig.ts` files so coding agents and regular
editors can modify it directly. The visualization transform materializes the
runtime files at the normal `.ts` paths, with no generated suffix mangling. That
keeps relative imports simple: editor files can import `./state.ts`, and the
runtime graph resolves to the transformed/generated `state.ts` file.

### module model

Each tldraw code module should have:

- stable module id
- human-readable module path
- kind: `library` or `runnable`
- title
- canvas x/y/w/h

Library modules are written to disk and imported by other modules. Runnable
modules are analyzed/transformed/launched and still use the default async
`TimeContext` root function convention.

For this MVP, all tldraw-authored modules should pass through the visualization
transform before runtime materialization. Libraries without a default timed root
can be transform/pass-through files; runnable modules still require the default
async `TimeContext` root.

The minimum import story is normal relative imports:

```ts
import { state } from "./state.ts";
import { state } from "../state.ts";
```

No complex static import graph is required for MVP, but paths should be stable
and backed by real files.

### p5gpu live-performance structure

The default p5gpu project should be organized like:

- `modules/state.ts`: exports shared mutable state and flags.
- `modules/sketch.ts`: owns GPU/window/P5GPU setup and a long-running draw loop.
- `modules/modifiers/*.ts`: short runnable livecode modules that mutate state.

Most performance iteration should happen in modifier modules. Changing the shape
of `state.ts` or sketch setup can require `Restart All`.

### project disk watch and stale-running indicators

The server should watch the open project directory and emit project events when
module files change on disk. This matters because coding-agent edits are a core
workflow.

Track enough hashes to show useful UI state:

- `diskHash`: current file contents on disk
- `editorHash`: current editor buffer
- `runHash`: source hash used by the currently running module
- `lastLoadedHash`: disk hash last loaded into the client

Minimum states:

- clean
- editor dirty
- changed on disk
- conflict: editor dirty and disk changed
- running stale: running code differs from disk/editor source

Do not auto-reload editor buffers. Show a warning and explicit actions:

- `Reload from disk`
- `Stop and reload` when the stale module is running
- conflict choices: `Keep editor` or `Reload from disk`

For MVP, imported library dependency staleness can be conservative. If
`state.ts` changes on disk, mark running modules stale and recommend
`Restart All`.

### agent steering API

Add server endpoints so agents/tests can drive the project without Playwright:

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

This should be sufficient for automated tests and for coding agents to create
modules, write source, run modules, stop modules, and inspect state without
driving the browser UI.

### required p5gpu end-to-end test

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
8. Stop all modules and close the project.

This test should use actual P5GPU/window infrastructure in the smallest possible
way. It is the proof that:

- modules import each other through real files
- a long-running sketch sees state changes from a separately launched livecoded
  module
- agent/server APIs are enough to exercise the workflow
- the runtime can produce an observable artifact without browser automation

## static code analysis => visual node linking

this could be another "big idea" to investigate, as big as the
time-visualization stuff

- example: for piano rolls, you have the library call in the function that
  referces a piano roll, and the piano rolls visible in the UI. need to add
  static analysis that looks at what pianoRoll ids are explicitly detected in
  module code, and if an instance of that piano roll is open in the UI, draws a
  little connector line from the code to the UI.
  - don't need to worry about complex code cases with constructed piano roll ids
    or such
  - need to think about what to do if there are multiple views of same piano
    roll - link all? or just grab nearest one

## initial architecture idea - no blessed orchestrators

All "loops" besides module-launch should be done "in app". For example, for an
audiovisual sketch you want to livecode, all of the shared state (definitions
and variables) are a single module in tldrawy, the window managment and draw
loop is another (just reads shared state), slider definitions can be another
(write to shared state), and then all dynamic processes just write to shared
state too.

some core things that need to be worked out for this

- tldraw modules need to be able to import each other - can't just have them
  write to temp files?
  - this immediately might mean you need to init a project directory for a
    session to not totally spam your repo?
- need to work out some necessary execution order related things for "app level
  singletons"
  - eg, maybe need to init a window context before you can start the draw loop?
    is this an issue if you don't have them in the same module?
  - could have a pattern like in the initial browser sketches - eg, shared state
    definition module is intialized first, and includes a handle to
    webGPU-device (inits as none). actual initialzer module runs and writes to
    it. other draw modules can pull it as necessary (but ideally, shouldn't need
    this much)
  - ideally, most of the work during performance is just modifying modules that
    read/write shared state
- might need some kind of clean "restart all" for when you need to change the
  shape of your shared state (will need to kill/restart drawloop with new state,
  or worse, kill/restart windows?)

## view vs edit mode of modules

much like for the sonar_sketch editor, you could have tldraw code modules be
either in edit or run/view mode. when you execute a module, it could switch to
view mode and cease to be editable until stopped. then in view mode, you could
do all kinds of run-time data code-view augmentation (eg, like in sonar_sketch,
inject slider values over the variables where they are used). View mode could
also help solve the problem of the user not knowing whether the version of code
in a buffer is currently running or not. if tldraw code modules can import other
modules, you could even see about doing this transitiviely? eg if the run-loop
module imports the state module, then hitting run on the run-loop also makes the
state module view-mode. You'd still have live-codeable modules that modify
state, but then those would see a view-only state module so you know what shape
you're dealing with

## general todos and smaller ideas

- module structure and relationships need to be cleaned up - module level
  instantiations (eg, piano roll store, midi init) should happen in a unified
  way (how is tbd). maybe force editor scripts to init the modules via an
  idempotent module level init func. editor scripts are modules so have access
  to top level await and can `await init()` before defining their `run()`
  function - the small amount of boiler plate is worth it for "no magic"
  understandability
- figure out some solution for persistence keys for the UI (quick flag to allow
  refreshes while developing stuff), and then also file-system data saving for
  "projects"
- add the ability to have agent send commands to running UI to steer it (eg,
  create piano roll with id, add/modify ntoes in piano roll, create code block,
  start/stop code block)
- add known data ids into text editors so you can use playwrite or something
  like that to add the code back to the editors?
- maybe refactor piano roll client/server websocket sync libs so that old ones
  for notebook sync and apps/scene-inspector can also be used with the
  livecode-tldraw one
