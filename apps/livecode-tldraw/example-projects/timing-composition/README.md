# timing-composition

Five small p5.js instance-mode sketches that build on
[timing-examples](../timing-examples/). A timed behavior is an ordinary async
function taking a `TimeContext`: choose it with `if/else`, reuse it with
arguments, or combine it with other functions.

| Module | Idea | Try it |
| --- | --- | --- |
| `phrases` | Await movement functions to build a phrase; choose the next phrase with `if/else`. | Set `pattern` to 0 (sweep), 1 (zigzag), or 2 (spiral). The current phrase finishes first. Length is read at phrase start. |
| `reuse` | Run one `bounce(c, index)` function on three branches. | Change `voices › a › period` or `height`. A reads its controls at the next bounce; B and C keep theirs. |
| `triggers` | A checkbox launches a branch, then clears itself. | Set `autoFireSec` to 0 and tick `fire` repeatedly. Rings overlap on independent timelines. Each reads `burstSec` at birth. |
| `combinators` | `seq`, `repeat`, and `par` assemble a score from functions. | Change repeat count or durations. The next score uses them. Melody and drums light together; outro waits for both. |
| `modes` | Hold the current behavior's branch handle, fade out, cancel it, start another, fade in. | Set `mode` to 0 (orbit), 1 (wave), or 2 (falling dot). Try `fadeSec` = 0 for an immediate change. |

## How to read the code

Each module is a complete, independent sketch. Read it from top to bottom:

1. `params` declares the controls in the pane.
2. `state` is a plain object at module scope: the current picture.
3. The async timing functions change that state and wait through `TimeContext`.
4. `p.setup` creates the canvas; `p.draw` only reads state and renders it.

For example, the timing code changes a dot's position, then calls
`await c.waitSec(1 / 60)`. p5's own draw loop paints that position whenever
it renders a frame. No animation state advances inside `draw`: there is no
`frameCount`, `millis`, or separate timer driving the picture.

The small loop at the bottom manages `running`. Turning it off cancels the
scene and its children; turning it on resets state and starts a new scene.
p5 keeps drawing while paused. Cancellation cleanup may remove active shapes.
This toggle is needed because a baked page launches modules once and cannot
relaunch them. Each sketch uses its own named `canvasSurface` container, so
its p5 canvas appears beside its code in the same-tab IDE or a bake.
`stop()` and `finally` remove the p5 instance when the module ends, including
cancellation, so Stop/Replace do not leave old draw loops behind.

`combinators` is the most advanced example. Each section turns its tile on,
waits, then turns it off. `seq` awaits functions in order; `repeat` awaits one
function several times; `par` starts `branchWait` children and joins them.
`par` directly awaits `Promise.all` over the cancelable task handles returned
by `branchWait`. The analyzer visualizes the join and its children. Each
`branchWait` completion updates its parent's logical time, so after the join
the parent is already at the longest child's finish time; no `wait(0)` is needed.

## Bake and open

From `apps/livecode-tldraw`, run `npm run setupLivecode` once, then
`npm run build`. From `apps/deno-notebooks`:

```sh
deno run --allow-all livecode/browser_host/bake_project.ts \
  --project ../livecode-tldraw/example-projects/timing-composition \
  --out /tmp/timing-composition-bake
npx --yes serve /tmp/timing-composition-bake
```

Open the served root URL. For live editing, use the project picker and
**Open · engine in same tab**, then Run the modules. No launch order is needed.

## Verify

From `apps/deno-notebooks`:

```sh
node livecode/tests/timing_examples.e2e.mjs timing-composition
```

This bakes the checked-in sources, runs all five modules in a browser, checks
their canvas views, and exercises a running toggle through the params transport.
It is also part of `deno task test:livecode:topologies`.

In the live IDE, also Stop and Run a module, then Replace it while playing:
there should be one canvas and one animation for that example each time.
