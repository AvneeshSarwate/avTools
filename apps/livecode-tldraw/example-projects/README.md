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
| `minimal-p5gpu` | **Deliberately-broken diagnostics fixture** (`sped`/`speed` mismatch). It exists to show failing project diagnostics; do not "fix" it and do not use it as a smoke test. |
| `feature-params-basics` | `canvasParams` slice: nested groups, meta bounds/labels, a `graph: true` field, code-driven automation writes, loop-rate reads, `/params/set`. |
| `feature-piano-roll-flows` | Piano-roll slice: module write-back (`setPianoRollClip`), live playback (`playPianoRoll`), multiple views of one roll, entity CRUD via topbar and HTTP. |
| `feature-signals-and-scopes` | Ephemeral-signal slice: anchored playhead, two playheads on one melody (both marker value shapes), numeric signal + scopes, sticky `ended`, one restored data-file roll. |
| `feature-lifecycle-basics` | Lifecycle slice: natural completion, Replace-while-running with state continuity, observable `stop()` hook, 409 without replacement consent. |
| `feature-studio-combined` | Richer combined project **with checked-in `data/`**: pre-launch restored pane (values + meta) and roll, edit→save→mutate→re-open loop, playhead + graph field + both scope source types, layout persistence across every view kind. |

## Feature coverage matrix (feature-* projects)

| Behavior | params-basics | piano-roll-flows | signals-and-scopes | lifecycle-basics | studio-combined |
| --- | :-: | :-: | :-: | :-: | :-: |
| canvasParams nested groups + meta (bounds/labels) | x | | | | x |
| `graph: true` monitored field | x | | | | x |
| Module reads params at frame/loop rate | x | | | | x |
| Module writes params (code automation) | x | | | x | x |
| Module reads/plays a piano roll | | x | | | x |
| Module writes back to a piano roll | | x | | | x |
| Multiple views of one roll | | x | | | |
| Entity CRUD (create/duplicate/delete) | | x (HTTP + topbar) | | | x (topbar) |
| Checked-in `data/` restored on open | | | x (roll) | | x (roll + params w/ meta) |
| Save → mutate → re-open → verify checklist | | | | | x |
| Playhead signal anchored to a roll | | | x | | x |
| Two playheads against one melody | | | x | | |
| Plain numeric signal for a scope | x | | x | | |
| Scope views persisted in canvas (signal / params leaf) | x (signal) | | x (signal) | | x (both) |
| Finite module ending naturally | x (no-op root) | x (seed/echo) | | x | x (sparkle) |
| Infinite module for Replace testing | x | x | | x | x |
| Observable `stop()` hook | | | | x | x |
| Canvas layout persistence (modules + all view kinds) | partial | partial | partial | partial | all |

## Automated verification

`verify-feature-projects.ts` (in this directory) starts a real server on a
random port and, for every feature project: opens it over `/project/open`,
asserts `/project/diagnostics` is clean, launches its modules headlessly
through `/runtime/analyze` + `/runtime/launch`, and asserts the documented
observable state (entity values/meta, roll contents, signal anchors and
movement, terminal lifecycle states, stop-hook effects, CRUD status codes).

```sh
deno run --no-config --allow-all \
  apps/livecode-tldraw/example-projects/verify-feature-projects.ts
```

`--no-config` is required because this directory sits under
`apps/livecode-tldraw`, which is not a member of the root Deno workspace.
The script is deliberately not wired into any existing test task. Expect
brief MIDI output if a device is connected; everything is stopped on exit.
