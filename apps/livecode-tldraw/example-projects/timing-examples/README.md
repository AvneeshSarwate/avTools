# timing-examples

Five small p5.js instance-mode sketches for learning `@avtools/core-timing`.
Start here, then try [timing-composition](../timing-composition/).

| Module | Idea | Try it |
| --- | --- | --- |
| `sequence` | Change state, `waitSec`, repeat. Waits advance logical deadlines, so lateness does not accumulate into the rhythm. | Change `stepSec` to move the dot faster or slower. |
| `branches` | `branchWait` starts independent timelines; joining waits for every bar. | Change `voices` or `longestSec`; the next cycle uses them. Green means finished. |
| `barrier` | A plays a phrase, then `awaitBarrier` waits for B's current cycle to resolve. | Make A shorter than B and watch it wait. If A is longer, B can complete several cycles during A's phrase. |
| `cancel` | A branch handle cancels a child and its grandchildren. | Change `lifetimeSec`. The orbit dots disappear when the family is cancelled, but the parent heartbeat continues. |
| `tempo` | `wait(1)` waits a beat; shared tempo follows edits while cloned tempo stays independent. | Change `bpm`, try `rubato`, then turn rubato off. Restart to give the cloned voice a new starting tempo. |

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

`branches` directly awaits `Promise.all(children)` over the cancelable handles
returned by `branchWait`. The analyzer visualizes the join and its children.
Each child completion updates the parent's logical time, so no `wait(0)` is
needed after the join.

`tempo` starts its scene with `{ tempo: "cloned" }` so its controls do not
change the tempo of the other examples. Its second voice clones that map again.

## Bake and open

From `apps/livecode-tldraw`, run `npm run setupLivecode` once, then
`npm run build`. From `apps/deno-notebooks`:

```sh
deno run --allow-all livecode/browser_host/bake_project.ts \
  --project ../livecode-tldraw/example-projects/timing-examples \
  --out /tmp/timing-examples-bake
npx --yes serve /tmp/timing-examples-bake
```

Open the served root URL. For live editing, use the project picker and
**Open · engine in same tab**, then Run the modules. No launch order is needed.

## Verify

From `apps/deno-notebooks`:

```sh
node livecode/tests/timing_examples.e2e.mjs timing-examples
```

This bakes the checked-in sources, runs all five modules in a browser, checks
their canvas views, and exercises a running toggle through the params transport.
It is also part of `deno task test:livecode:topologies`.

In the live IDE, also Stop and Run a module, then Replace it while playing:
there should be one canvas and one animation for that example each time.
