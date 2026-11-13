# core-timing — dense reference (sketch-specific)

Source: `@avtools/core-timing`. The sketch uses a narrow slice: `launch`, `branch`, `waitSec`, `isCanceled`, `progTime`, `handleCancel`.

## One root, many branches

```ts
const rootAnim = launch(async (ctx) => {
  while (true) {
    // do per-frame work
    await ctx.waitSec(1 / 60);
  }
});
rootAnim.catch((err) => {
  if ((err as Error)?.message !== "aborted") console.error(err);
});
```

- `launch(fn)` returns a `CancelablePromiseProxy`. `.cancel()` cancels the tree.
- Canceled waits reject with `Error("aborted")`. The catch above is **mandatory** in Deno — unhandled rejections are fatal.
- Root MUST tick ≥ 60 Hz (`waitSec(1/60)`). Branches launched via `ctx.branch` set their initial time to `root.mostRecentDescendentTime`; a slow root means branches start with accumulated `progTime`.

## Branches — fire-and-forget tasks

```ts
const handle = ctx.branch(async (branchCtx) => {
  while (!branchCtx.isCanceled && branchCtx.progTime < duration) {
    const t = branchCtx.progTime / duration;
    // … update shared state …
    await branchCtx.waitSec(1 / 60);
  }
  // normal completion
});

handle.handleCancel(() => {
  // cleanup on explicit cancel (not called if branch completed normally)
});
handle.cancel();          // cancel this branch's subtree
// handle.finally(fn)     // runs on both completion and cancel — AVOID in Deno, see below
```

**`handleCancel` vs `.finally`**: `.finally` on a canceled promise creates a new promise that rejects; Deno treats it as unhandled. Use `handleCancel` for cancel-only cleanup. If you need finally-semantics, catch explicitly.

## Context properties and methods you'll use

| member | meaning |
|---|---|
| `ctx.progTime` | seconds since this context started (use this, not `performance.now()`) |
| `ctx.time` | absolute logical time |
| `ctx.isCanceled` | check in every loop iteration |
| `ctx.waitSec(sec)` | drift-free sleep |
| `ctx.wait(beats)` | beat-time sleep (needs `ctx.setBpm()` if you care about tempo) |
| `ctx.branch(fn)` | spawn fire-and-forget child; parent time unaffected |
| `ctx.branchWait(fn)` | spawn child; await it joins back to parent time (rarely used in sketch) |
| `ctx.cancel()` | cancel this context + subtree |
| `ctx.random()` | deterministic [0,1) draw (use if you want reproducibility) |

## The actionQueue idiom (critical for this sketch)

UI callbacks (tweakpane buttons, animation-editor func-track firings) run **outside** the context tree. To launch a branch from them, queue a closure and drain inside the root loop:

```ts
const actionQueue: Array<(ctx: DateTimeContext) => void> = [];

function launchThing() {
  actionQueue.push((ctx) => {
    ctx.branch(async (bc) => { /* … */ });
  });
}

// inside the root loop:
while (actionQueue.length > 0) actionQueue.shift()!(ctx);
```

Why not call `rootCtx.branch` directly from the UI callback? Because the UI handler fires at an arbitrary moment; if the root hasn't ticked yet since the last scheduling boundary, `rootCtx` may be in a transitional state and the branch's initial time is wrong. Queueing makes the branch creation deterministic.

## Typical branch patterns

### Fixed-duration animation

```ts
ctx.branch(async (bc) => {
  const duration = 2;
  while (!bc.isCanceled && bc.progTime < duration) {
    const t = bc.progTime / duration;
    state.x = start + (end - start) * t;
    await bc.waitSec(1 / 60);
  }
});
```

### Unbounded loop (e.g., random walk)

```ts
ctx.branch(async (bc) => {
  while (!bc.isCanceled) {
    // tween to next target
    const dur = randomDur();
    const start = bc.progTime;
    while (!bc.isCanceled && bc.progTime - start < dur) {
      const t = Math.min(1, (bc.progTime - start) / dur);
      // lerp …
      await bc.waitSec(1 / 60);
    }
  }
});
```

### Branch that guards on shared state

```ts
ctx.branch(async (bc) => {
  while (!bc.isCanceled) {
    if (!condition()) { await bc.waitSec(1 / 30); continue; }
    // do the thing
    await bc.waitSec(1 / 60);
  }
});
```

## Gotchas

- **Don't await non-engine promises** inside a branch for timing (e.g., `fetch`, DOM events). They resume outside the scheduler.
- **Always check `bc.isCanceled`** in every loop iteration. A pending `waitSec` that's canceled throws; checking first avoids try/catch churn.
- **Initialize state before `.add(state)`** — there's a one-frame gap between branch creation and first branch-body execution where the render loop may read un-initialized state.
- **Root cancel cascades**. `rootAnim.cancel()` cancels all branches.
- **`branch` vs `branchWait`**: `branch` child times start at root's last descendant time and don't advance parent time. `branchWait` starts at parent time and joins. Use `branch` for independent animations (this sketch's default).
