# plorkSketch — library index

Short index. Deep dives: `p5gpu.md`, `shader_fx_raw.md`, `core_timing.md`, `param_system.md`, `animation_editor.md`, `window_manager.md`.

## What the sketch is

A GPU-rendered animated visual with a flood-fill trail post-process, driven by a unified tweakpane + keyframe-animation-editor control surface.

- **State model**: all animated state lives on module-level mutable objects (`params`, shared Sets, per-element records). Branches mutate these asynchronously between their `waitSec(...)` yields; the draw path does no update-time computation — it reads whatever the current values are at frame time and issues p5 draw calls. No double-buffering or locks. The contract is JS single-threading + cooperative scheduling: a branch's mutations are always observed atomically by the next `renderFrame` tick.
- **Scene** (p5gpu immediate-mode draw): the draw function reads `params` + module-level state each frame and issues p5 draw calls. Scene elements follow one of two patterns:
  - **Persistent** — state is either pure per-frame math on `params` inside `drawCircle`, or tweened by a long-running `ctx.branch` that gates on a param flag (sleeping while the flag is off so only the active variant runs).
  - **Transient** — an action button (or func-track keyframe) pushes an `actionQueue` closure that spawns a fixed-duration `ctx.branch` with its own per-instance state; the branch updates that state each tick, removes itself from a shared set on completion, and uses `handleCancel` to cover early termination.
- **Post-process** (shader-fx/raw): the drawn texture feeds a flood-fill-with-time-decay DAG: `AlphaTimeTag` stamps draw time into alpha → `FloodFillStep` propagates drawn pixels outward (JFA) → `FeedbackNode` carries prior flood state → a second `FloodFillStep` refines → `FloodFillDisplay` composites. Result: smearing/trailing color fields that decay with time-since-draw.
- **Control**: one `paramDefs` tree generates the tweakpane sliders/toggles *and* the animation editor's tracks. The editor (separate native webview) records snapshots at the current playhead, holds multiple named animations, and drives `params` during playback; a sync flag controls whether playback also refreshes the pane.
- **Timing**: a single 60 Hz core-timing root loop drains an action queue per frame and advances animation playback. Every animated element is a fire-and-forget `ctx.branch` child that gates on params and self-terminates.
- **Output**: native window + optional Syphon publish for downstream video routing.

## Run

From `apps/deno-notebooks`:
`deno run --unstable-webgpu --unstable-ffi --allow-all plorkSketch/sketch.ts`

## Reading sketch.ts

See the `CODE MAP` comment at the top of `sketch.ts`. Jump to a numbered section via its `// === N. TITLE ===` banner. Most edits touch one or two sections:

| Change | Sections to read/edit |
|---|---|
| Add/remove a param | 3 (paramDefs, SketchParams) |
| Add a button/action | 3 (`_actions` in a folder) + existing launcher patterns in 6 |
| New draw behavior | 11 (drawCircle) |
| New shader effect | 12 (createFloodFillChain), 10 (renderFrame return) |
| New long-running animation | 6 (follow `startWalkAnim` or `launchCircle` pattern) |
| Change playback behavior | 9 (rootAnim) |

## How the libraries compose

p5gpu draws per-frame into a GPUTexture → shader-fx/raw post-processes via a chain of effects → `createWindowRenderManager` blits the terminal effect to the window (+ optional Syphon). core-timing runs one root loop (§9) that drains an `actionQueue` of branch launchers and drives the animation editor's playhead. paramSystem turns `paramDefs` into a mutable `params` object, a tweakpane UI, and animation-editor tracks. The editor writes back to `params` via `TrackCallbacks` on every frame where the playhead changes.

## Per-library one-liners

**p5gpu** — `p5.beginFrame()` / draw / `p5.endFrame(): GPUTexture`. p5-style API (`fill`, `stroke`, `circle`, `rect`, `translate`, `push/pop`, `text`, …). `circle(x,y,diameter)`. Mode constants live on the instance (`p5.HSL`, `p5.CORNER`, `p5.OPEN`). → **p5gpu.md**

**shader-fx/raw** — Raw WebGPU, *not* Babylon. Import effect classes from `@avtools/shader-fx/generated-raw/shaders/<name>.frag.raw.generated.ts`. Chain by passing effects as sources; `terminal.renderAll()`. `FeedbackNode + setFeedbackSrc` for temporal loops. `selectShaderFxFormat(device, ["rgba16float"])` to pick format. → **shader_fx_raw.md**

**core-timing** — One `launch(async (ctx) => { while(true) await ctx.waitSec(1/60); })` root. Animations are `ctx.branch(async (bc) => {...})`. UI callbacks push closures into `actionQueue` so branches inherit live root time. Use `bc.progTime`, `bc.isCanceled`, `bc.waitSec(1/60)`. Cleanup via `handle.handleCancel(fn)` (not `.finally`). Always `rootAnim.catch(err => err.message !== "aborted" && console.error)`. → **core_timing.md**

**paramSystem** — `buildParamSystem(paramDefs)` returns `{ params, trackInputs, paramMeta, actionMap, setupPane }`. Folders use `_folder`; leaves are `{value, min, max, step?}` (number), `{value}` (bool), `{value, options}` (enum); buttons/triggerables go in `_actions`. Leaf keys must be globally unique. Cast `params as SketchParams`. → **param_system.md**

**animation-editor** — `createAnimationEditorBridge({ management })` then `showBoundInWindow(window, "default", {...})`. Handle methods used each frame: `scrubAndEvaluate(t)` (evaluate tracks → push to params), `scrubToTime(t)` (no eval), `setLivePlayhead(t)`. `AnimationPlaybackState` shared with §9 root loop. → **animation_editor.md**

**window** — `createWindowRenderManager({device, width, height, syphon?, pane?})` → `renderWindow.run(renderFrame, { cleanup })`. Populate tweakpane inside `pane.setup` via `paramSystem.setupPane(pane)` — don't call `addBinding` directly. → **window_manager.md**

## Recipes

- **Add a param**: add leaf in §3 `paramDefs`, add its field to `SketchParams`, read `params.newKey` wherever. Rebuild existing animation via deleting it in the editor or calling `tracks.setFromInputs` again.
- **Add an action button**: add to the appropriate `_actions` in §3. For actions that spawn animations, wrap the side-effect in `actionQueue.push((ctx) => { ctx.branch(async (bc) => { … }); })` — see §6 `launchCircle` as template.
- **Add a shader effect**: import class from `generated-raw/shaders/`, instantiate inside §12 `createFloodFillChain`, wire as `src` of the next effect or add a new terminal. Return the terminal from §10 `renderFrame`. Extend §10 `cleanup` to dispose.
- **Add a long-running animation**: follow §6 `startWalkAnim`. Gate its inner loop on a param flag (e.g. `params.bwMode === "walk"`) so it sleeps rather than running work you don't want.

## Gotchas

1. Root loop MUST tick ≥ 60 Hz (`await ctx.waitSec(1/60)` in §9) — a slower root causes branches to start mid-animation.
2. `GPUColor` is `{r,g,b,a}`, not an array.
3. `p5.circle(x, y, diameter)` — diameter, not radius.
4. Import paths are `/raw` and `/generated-raw/shaders/*.frag.raw.generated.ts` — NOT `/babylon` / `/generated/`.
5. Use `handle.handleCancel(fn)` in Deno for cancel-only cleanup; `.finally` rejects and becomes unhandled.
6. Leaf param keys must be globally unique across the whole ParamDefs tree.
7. `FeedbackNode.setFeedbackSrc` keeps the feedback source OUT of `inputs` — `renderAll` won't cycle, and `disposeAll` on the terminal doesn't reach it. Dispose the feedback chain explicitly if it's off the terminal's DAG.
8. Always attach `rootAnim.catch(err => if "aborted") console.error)`.
