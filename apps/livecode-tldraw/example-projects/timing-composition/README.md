# timing-composition

The follow-up to [`timing-examples`](../timing-examples/): that gallery shows
the timing library's primitives, this one shows how they organize into
programs, and how the params pane turns each program into an instrument. The
one idea underneath every example is that a timed behavior is an ordinary
async function taking the context it runs on, so behaviors compose the way
functions do: chosen with `if/else`, reused with arguments, passed to
higher-order combinators, held in variables as branch handles.

| Module | Shows | Pane interaction |
| --- | --- | --- |
| `phrases` | `glide`/`hold` building blocks composed into `sweep`/`zigzag`/`spiral` phrases; the scene loop is an `if/else` that awaits one phrase per cycle. | `pattern` picks the next phrase; `phraseSec` and `restSec` are read when a phrase starts. |
| `reuse` | One `bounce(c, voice)` function running in three branches, each pointed at its own params folder. | Nested folders per voice; `period` and `height` apply at the next half-bounce. |
| `triggers` | A boolean as a momentary control: the loop consumes `fire`, launches a `burst` branch per event, and writes `false` back so the pane clears itself. Bursts overlap, each on its own timeline. | Tick `fire` repeatedly; `burstSec`; `autoFireSec` (0 = manual only). |
| `combinators` | `seq`, `repeat`, `par` as higher-order functions over `(c) => Promise<void>`; `par` joins branchWait children; a score rebuilt each cycle, drawn as a lane timeline. | `repeats`, `verseSec`, `melodySec`, `drumsSec` reshape the score live. |
| `modes` | Long-running `orbit`/`wave`/`rain` behaviors held as a branch handle; a manager awaits `fadeTo(0)`, cancels, starts the next with `if/else`, awaits `fadeTo(1)`. | `mode` switches behaviors; `fadeSec` and `speed` are live. |

Read them in order: composing sequential phrases, reusing one behavior across
voices, turning pane values into events, abstracting structure into
combinators, and finally managing concurrent behaviors as state.

Every module has a `running` toggle, for the reason explained in
`timing-examples`: a bake cannot start or stop modules, so each example owns
its restart. Two analyzer constraints shape the code and are worth knowing
when writing your own: inside any function with a `TimeContext` parameter,
every `await` must be a direct call that either is a context method or
receives the context (`await phrase(c, …)`), and a helper that awaits
`Promise.all` takes the context under a structural type so its body stays
outside those scopes (`joinAll` in `combinators`).

## Bake and open

From `apps/livecode-tldraw`, `npm run build` once. Then from
`apps/deno-notebooks`:

```sh
deno run --allow-all livecode/browser_host/bake_project.ts \
  --project ../livecode-tldraw/example-projects/timing-composition \
  --out /tmp/timing-composition-bake
npx --yes serve /tmp/timing-composition-bake
```

## Automated check

`apps/deno-notebooks/livecode/tests/timing_examples.e2e.mjs timing-composition`
bakes this project and asserts all five modules run, every canvas view
draws, and a pane write pauses and resumes one example. Part of
`deno task test:livecode:topologies`.

## Manual verification

1. **phrases**: the dot sweeps left and right. Set `pattern` to 1 mid-sweep:
   the sweep finishes, then the zigzag plays, and the "played" breadcrumb
   grows. Set 2 for the spiral.
2. **reuse**: three balls bounce at different rates. Open the `voices › a`
   folder and drag `period`: A changes rhythm at its next apex or floor while
   B and C keep theirs.
3. **triggers**: rings expand and fade on the auto-fire timer. Tick `fire`:
   a ring appears and the box unticks by itself. Tick it several times fast:
   the rings overlap. Set `autoFireSec` to 0 and it only fires by hand.
4. **combinators**: the timeline scrolls right to left: intro, N verses, then
   melody and drums stacked in two lanes, then outro exactly when the longer
   of the two ends. Change `repeats` or the section lengths: the next cycle
   has the new shape.
5. **modes**: the orbit fades out, then the wave fades in when `mode` goes
   to 1; `switches` increments once per change. With `fadeSec` at 0 the
   swap is instant.
