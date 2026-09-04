# Authoring Livecode Projects with a Coding Agent

Status: checked against the authoring surface and example projects on
2026-08-26.

Use this as the entrypoint when the task is to create or change a piece, not the
livecode platform. Read the target project's README and manifest next. The
architecture reading order in `README.md` is for platform development.

## The working model

- A project is ordinary TypeScript plus a manifest and optional saved entity
  data. Edit canonical `*.orig.ts`; paired `*.ts` files are generated runtime
  artifacts.
- Every runnable module exports a default async function receiving a
  `TimeContext`. Returning ends naturally; an infinite process normally waits
  through that context so Stop can cancel it.
- Edit and analysis never imply execution. Run, Replace, Stop, Stop All, and
  Panic are explicit actions.
- A module ID is one lifecycle slot. Run refuses an occupied slot; Replace is
  explicit consent to stop its current run and launch the new preparation.
- The engine owns running modules and named entities. Reloading the UI does not
  stop sound. Conversely, switching projects does not stop the prior project's
  modules or clear its entities.
- Canvas shapes are views. Removing a view does not delete its entity, and an
  entity can have several views.

## Start the environment and choose a target

From `apps/deno-notebooks`:

```sh
deno task livecode:server
```

From `apps/livecode-tldraw`:

```sh
npm run setupLivecode   # once after checkout or component-bundle changes
npm run dev
```

Open `http://localhost:5173/projects.html`, choose a project, and choose where
its engine runs:

| Target | Use it for |
| --- | --- |
| Deno engine | Default local work, native/server capabilities, and the broad repository import map. |
| Browser engine | DOM/Web APIs and browser graphics. Set `engineTarget: "browser"` and open with **engine in browser**. The actual graphics render in the engine tab's `#livecode-stage`, not on the tldraw canvas — unless the module draws into a `canvasSurface(name)` and the canvas has a canvas view, which mirrors it on the tldraw canvas when the engine runs in the UI's own tab. |
| Single-page bake | Presenting a finished piece as a static page: `bake_project.ts` output opens with the engine in the same tab, canvas views show module canvases next to their code, and nothing can be started or stopped after boot. Give each example its own module and a `running` params toggle. See [`feature-canvas-surface`](../../apps/livecode-tldraw/example-projects/feature-canvas-surface/). |

If `engineTarget` is absent, the project follows the server's current engine
mode. A browser-target project should be authored and tested in the browser
topology; a passing Deno-target check does not prove browser delivery.

## Project and module shape

Start from
[`basic-multi-module`](../../apps/livecode-tldraw/example-projects/basic-multi-module/)
for the smallest project shape. A project contains:

- `project.avtools-livecode.json`: project name, target, module records, canvas
  views, and saved-entity references;
- canonical module source such as `modules/player.orig.ts`;
- generated runtime source such as `modules/player.ts`, which the server owns;
- optional `data/<entity-type>/*.json`, written by explicit project save.

For a new project, create the manifest and `*.orig.ts` files from that template,
or use `/project/create` and then add modules. With a mounted client,
`addProjectModule` is preferable because it updates the project and creates the
corresponding canvas shape together.

Module IDs must be unique. Imports between project modules use their runtime
paths, for example `./state.ts`, even though the file an agent edits is
`state.orig.ts`.

A minimal long-running module is:

```ts
import type { TimeContext } from "@avtools/core-timing";

export default async function run(ctx: TimeContext) {
  while (true) {
    // Produce or update piece state here.
    await ctx.waitSec(0.25);
  }
}

export function stop() {
  // Optional graceful cleanup. Do not rely on this for Panic.
}
```

Keep long-running work inside the default export. Prefer `ctx.waitSec`,
`ctx.wait`, `ctx.branch`, and `ctx.branchWait` to raw timers or detached
promises: they share logical time, participate in cancellation, and can be
visualized. `TimeContext` also exposes logical seconds/beats, tempo, and seeded
randomness; inspect
[`offline_time_context.ts`](../../packages/core-timing/offline_time_context.ts)
for the complete API.

## The authoring loop

1. Inspect the manifest, project README, all `*.orig.ts`, and any checked-in
   data before changing behavior. Do not infer launch order from file order.
2. Edit canonical source. With a UI client open, `setModuleSource` keeps the
   canvas editor and server coordinated; after an external file edit, use
   `reloadProjectModule` or reopen the project.
3. Let analysis complete; project analysis writes the current buffer through to
   `*.orig.ts`. Project Run also performs a target-aware whole-project check.
4. Run an idle module. If its slot is occupied, decide explicitly whether to
   leave the old run playing, Stop it, or Replace it.
5. Observe engine truth through the canvas or `getState`. An accepted launch is
   initially queued; running or terminal run state confirms what happened.
6. Stop the modules the task started. Use **Save project** only when current
   durable entity values should become project data.

Editing a dependency does not restart dependents, and stable dependency import
URLs may retain their existing module instance. When initialization or exported
state shape must be unquestionably fresh, restart the engine process/tab.

## Run, Replace, Stop, and Panic

| Action | Meaning |
| --- | --- |
| Run | Analyze the freshest source and launch only if the module slot is idle. |
| Natural completion | Returning from the default function ends that run without a Stop action. |
| Replace | Gracefully stop the occupied slot, then launch the new preparation. Other modules keep running. |
| Stop | Run the optional exported `stop()` with a two-second bound, then cancel the module context and end its ephemeral signals/waits. |
| Stop All | Cancel pending launches and apply graceful Stop to every active module. |
| Panic | Immediately cancel all modules and send MIDI panic; exported stop hooks are skipped. |

The coding-agent surface is `POST /client/command`. It requires a mounted
tldraw client; without `clientId`, the server selects the first connected one.
For example:

```sh
curl -s -X POST http://localhost:7777/client/command \
  -H 'content-type: application/json' \
  -d '{"command":{"type":"runModule","path":"modules/player.ts"}}'
```

Use `replaceRunning: true` only for an intentional Replace. Other commands are
`getState`, `openProject`, `addProjectModule`, `reloadProjectModule`,
`setModuleSource`, `stopModule`, and `stopAllModules`; their exact shapes live in
[`client_control.ts`](../../packages/livecode-protocol/client_control.ts).
Always inspect the JSON `ok` field—a command failure may still use HTTP 200.
Panic is the separate `POST /runtime/panic` emergency action.

For operation without a browser client, use the project and runtime HTTP routes.
[`verify-feature-projects.ts`](../../apps/livecode-tldraw/example-projects/verify-feature-projects.ts)
is the executable reference for open, diagnostics, analyze, launch, observation,
and cleanup; shared request types live in `packages/livecode-protocol`.

## Core authoring libraries

These bare imports are the intentionally supported livecode surface:

| Import | Purpose | Targets |
| --- | --- | --- |
| `@avtools/core-timing` | `TimeContext` types and logical-time primitives. Project modules normally import `TimeContext` as a type and use the injected context. | Deno; type-only import in browser modules |
| `canvas-params` | `canvasParams(name, defaults, meta)` returns a live JSON-simple object that panes can edit; redeclaration reattaches to existing values. | Deno and browser |
| `canvas-signals` | `signal(name)` publishes ephemeral monitor/playhead values and optional entity anchors. Signals end with their owner run and are not a cross-module data API. | Deno and browser |
| `animation-timeline` | Declare and sample durable number, enum, and function tracks. | Deno and browser |
| `piano-roll-store` | Read or update named piano-roll entities. | Deno and browser |
| `piano-roll-helpers` | Convert clips, write roll data, and play a roll through logical time and optional MIDI output. | Deno and browser |
| `midi-helpers` | Discover/select outputs, send notes/CC, and panic. Browser MIDI may require a focused user gesture and permission. | Deno and browser |
| `canvas-surface` | `canvasSurface(name)` returns a named container/canvas under `#livecode-stage` for Canvas 2D or as a p5 parent; a canvas view shape mirrors it when the engine runs in the UI tab. | Browser engine |
| `p5`, `three` | Browser graphics rendered in the engine tab (or into a `canvasSurface`). | Browser engine |

The Deno engine can resolve additional repository and notebook imports,
including creative algorithms, music types, MIDI backends, Power2D/shader
packages, Babylon, Pixi, Tone, and other dependencies. The authoritative maps
are [`deno.json`](../../deno.json) and
[`apps/deno-notebooks/deno.json`](../../apps/deno-notebooks/deno.json). These are
not all established portable livecode APIs. Browser modules receive only the
bundled aliases above; confirm a new browser dependency in the engine itself,
not only through diagnostics.

## State and persistence

| Kind | Authoring rule |
| --- | --- |
| Imported module state | Ordinary shared JavaScript state. Useful within one engine, but dependency modules may remain cached across entry-module replacement. |
| Params, piano rolls, animation timelines | Durable engine entities. Values outlive the declaring run and reach disk only through explicit project save. |
| Signals | Ephemeral latest-value observations. They end with their owner run and are never saved or read by other modules for coordination. |
| Waits, run state, lookup annotations | Ephemeral visualization/runtime state. Never project data. |
| Canvas views | Bindings and layout can be project-persisted; deleting a view does not delete its entity. Arbitrary tldraw shapes require a separate `.tldr` save. |

## Reference projects by task

| Need | Start here |
| --- | --- |
| Minimal manifest, module imports, shared mutable state | [`basic-multi-module`](../../apps/livecode-tldraw/example-projects/basic-multi-module/) |
| Natural completion, Replace, graceful `stop()`, Panic behavior | [`feature-lifecycle-basics`](../../apps/livecode-tldraw/example-projects/feature-lifecycle-basics/README.md) |
| Nested live params, metadata, code writes, scopes | [`feature-params-basics`](../../apps/livecode-tldraw/example-projects/feature-params-basics/README.md) |
| Create/read/play piano rolls and use MIDI | [`feature-piano-roll-flows`](../../apps/livecode-tldraw/example-projects/feature-piano-roll-flows/README.md) |
| Durable timelines, sampling, function cues, animation playheads | [`feature-animation-timeline`](../../apps/livecode-tldraw/example-projects/feature-animation-timeline/README.md) |
| Ephemeral signals, scopes, and one-to-many playhead anchors | [`feature-signals-and-scopes`](../../apps/livecode-tldraw/example-projects/feature-signals-and-scopes/README.md) |
| Combined durable save/reopen and multiple entity/view types | [`feature-studio-combined`](../../apps/livecode-tldraw/example-projects/feature-studio-combined/README.md) |
| Browser `p5`, DOM stage, timeline-driven graphics, cleanup | [`browser-p5-animation`](../../apps/livecode-tldraw/example-projects/browser-p5-animation/README.md) |

`minimal-p5gpu` is deliberately broken to exercise diagnostics. Do not use it as
a green template.

## Before handing a project back

- Confirm only intended `*.orig.ts`, manifest, canvas, and saved-data changes
  remain; generated `*.ts` is not authored source.
- Run target-aware project diagnostics and exercise every changed module.
- Verify natural completion or Stop, and Replace when the module is intended to
  be replaceable while active.
- Stop anything started for verification. Save durable entities only when those
  current values are intended project content.
- Update the project's README when launch order, controls, target, device needs,
  or the manual verification flow changed.

For deeper semantics, use
[`current/project-model.md`](current/project-model.md),
[`current/analyzer-and-generated-code.md`](current/analyzer-and-generated-code.md),
and [`current/known-risks.md`](current/known-risks.md). Read the full architecture
sequence only when the task crosses from authoring a piece into changing the
platform.
