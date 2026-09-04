# Example projects

Checked-in livecode project directories in the format described by
`docs/livecode/current/project-model.md`. Open any of them with the server
and client running:

```sh
# from apps/deno-notebooks
deno run --unstable-webgpu --unstable-ffi --allow-all \
  livecode/visualizer/main.ts --host localhost --port 7777 --log-level debug

# from apps/livecode-tldraw
npm run dev
```

then browse to
`http://localhost:5173/?projectPath=<absolute path to a project directory>`.

Only `modules/*.orig.ts` files are canonical source; the paired `*.ts`
runtime files are materialized by the server and gitignored. Moving shapes in
an open project writes layout back into that project's manifest after a
one-second debounce — use `git checkout` on the project directory to discard
layout churn you did not mean to keep.

## Directory

| Project | Purpose |
| --- | --- |
| `basic-multi-module` | Minimal known-green template for agent-authored projects: three modules sharing imported mutable state. |
| `browser-six-sines-piano-roll` | Browser-engine AudioWorklet example: a canvas-visible project helper plays an editable piano roll through the packaged Six Sines Wasm synth, with note-identity and per-note modulation helpers. |
| `minimal-p5gpu` | **Deliberately-broken diagnostics fixture** (`sped`/`speed` mismatch). It exists to show failing project diagnostics; do not "fix" it and do not use it as a smoke test. |
| `feature-params-basics` | `canvasParams` slice: nested groups, meta bounds/labels, a `graph: true` field, code-driven automation writes, loop-rate reads, `/params/set`. |
| `feature-piano-roll-flows` | Piano-roll slice: module write-back (`setPianoRollClip`), live playback (`playPianoRoll`), multiple views of one roll, entity CRUD via topbar and HTTP. |
| `feature-animation-timeline` | Durable animation slice **with checked-in `data/`**: number/enum/function tracks, restored editor view, signal playhead, loop-rate sampling into a saved scope, whole-timeline CAS, and save/reopen. This is also the browser E2E's project fixture. |
| `feature-signals-and-scopes` | Ephemeral-signal slice: one playhead sent to two restored rolls, two playheads on one melody (both marker value shapes), numeric signal + scopes, and sticky `ended`. |
| `feature-lifecycle-basics` | Lifecycle slice: natural completion, Replace-while-running with state continuity, observable `stop()` hook, 409 without replacement consent. |
| `feature-studio-combined` | Richer combined project **with checked-in `data/`**: pre-launch restored pane (values + meta) and roll, edit→save→mutate→re-open loop, playhead + graph field, and both scope source types. |
| `feature-drawing-p5` | Durable drawing slice **with checked-in `data/`** (browser-engine target): restored canvas view, a module that upserts a circle into the drawing from code, a p5 sketch drawing the baked render data in the engine tab, whole-document CAS, and save/reopen. |

## Feature coverage matrix (feature-* projects)

| Behavior | params-basics | piano-roll-flows | animation-timeline | signals-and-scopes | lifecycle-basics | studio-combined | drawing-p5 |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| canvasParams nested groups + meta (bounds/labels) | x | | | | | x |  |
| `graph: true` monitored field | x | | | | | x |  |
| Module reads params at frame/loop rate | x | | | | | x |  |
| Module writes params (code automation) | x | | | | x | x |  |
| Module reads/plays a piano roll | | x | | | | x |  |
| Module writes back to a piano roll | | x | | | | x |  |
| Multiple views of one roll | | x | | | | |  |
| Entity CRUD (create/duplicate/delete) | | x (HTTP + topbar) | | | | x (topbar) | x (topbar) |
| Number, enum, and function animation tracks | | | x | | | |  |
| Module samples an animation at loop rate | | | x | | | |  |
| Whole-timeline compare-and-set edit | | | x | | | |  |
| Animation-editor view persisted in canvas | | | x | | | |  |
| Checked-in `data/` restored on open | | | x (timeline) | x (roll) | | x (roll + params w/ meta) | x (drawing) |
| Save → mutate → re-open → verify checklist | | | x | | | x | x |
| Playhead signal anchored to a roll | | | | x | | x |  |
| One signal sent to multiple anchors | | | | x | | |  |
| Two playheads against one melody | | | | x | | |  |
| Playhead signal anchored to an animation editor | | | x | | | |  |
| Plain numeric signal for a scope | x | | x | x | | |  |
| Scope views persisted in canvas (signal / params leaf) | x (signal) | | x (signal) | x (signal) | | x (both) |  |
| Finite module ending naturally | x (no-op root) | x (seed/echo) | | | x | x (sparkle) | x (writer) |
| Infinite module | x | x | x | | x | x | x (sketch) |
| Observable `stop()` hook | | | | | x | x | x (sketch) |
| Canvas layout persistence | partial | partial | module + animation + scope | partial | partial | module + roll + params + scopes | module + drawing |
| Module writes into a drawing (code upsert by node id) |  |  |  |  |  |  | x |
| Module reads baked drawing render data at frame rate (p5) |  |  |  |  |  |  | x |
| Whole-document compare-and-set edit |  |  |  |  |  |  | x |
| Drawing view persisted in canvas |  |  |  |  |  |  | x |

## Automated verification

`verify-feature-projects.ts` (in this directory) starts a real server on a
random port and, for every feature project: opens it over `/project/open`,
asserts `/project/diagnostics` is clean, launches its modules headlessly
through `/runtime/analyze` + `/runtime/launch`, and asserts the documented
observable state (entity values/meta, roll contents, signal anchors and
movement, animation sampling/CAS, terminal lifecycle states, stop-hook effects,
and CRUD status codes).

The Playwright tldraw E2E also copies `feature-animation-timeline` into its
temporary session and verifies the restored entity, editor, and scope before
running destructive save/reopen cases against that copy.

```sh
deno run --no-config --allow-all \
  apps/livecode-tldraw/example-projects/verify-feature-projects.ts
```

`--no-config` is required because this directory sits under
`apps/livecode-tldraw`, which is not a member of the root Deno workspace.
The script is deliberately not wired into any existing test task. Expect
brief MIDI output if a device is connected; everything is stopped on exit.
