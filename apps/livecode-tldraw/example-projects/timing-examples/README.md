# timing-examples

A gallery of the timing library's control topologies (`@avtools/core-timing`),
meant to be baked into a single static page: each example is one independent
module whose animation is drawn into a named `canvasSurface` and mirrored by a
canvas view shape next to its code. The five examples are distilled from the
library's own test suite (`packages/core-timing/timing_tests.ts`):

| Module | Shows | Test cases it distills |
| --- | --- | --- |
| `sequence` | `waitSec` sleeps to an absolute logical deadline, so wall-clock jitter never accumulates; a chained `setTimeout` on the same rhythm drifts. | `sequential_waitSec_basic`, `frame_like_loop_waitSec_60fpsish`, `overdue_waits_replay_as_burst_after_event_loop_stall` |
| `branches` | `branchWait` fan-out with staggered durations, children finishing in deadline order (ties in spawn order), `Promise.all` + `wait(0)` as the join, and the parent's time advancing to the longest child. | `parallel_branchWait_ordering`, `deterministic_tie_break_same_deadline_is_stable`, `many_branchWaits_stress_join` |
| `cancel` | `handle.cancel()` cascades from a child to its grandchildren; no tick lands after the cancel instant; `handleCancel` cleanup runs once; the parent's heartbeat is untouched. | `cancel_cascades_to_children_and_stops_ticks`, `noteoff_handleCancel_guaranteed_on_cancel` |
| `barrier` | Two loops of different phrase lengths stay cycle-locked through `startBarrier` / `resolveBarrier` / `awaitBarrier`, with no shared grid. | `barrier_loop_sync_melodyA_waits_for_melodyB`, `barrier_start_adopts_in_progress_cycle` |
| `tempo` | `wait(beats)` retimes in flight under `setBpm`; a `{ tempo: "cloned" }` branch is isolated from those edits; `rampBpmTo` chased at 60 fps gives smooth rubato with exact beat integrals. | `tempo_change_shared_retimes_beat_wait`, `tempo_clone_child_isolated_from_root_changes`, `rampBpmTo_chase_tracks_continuous_curve` |

Every module has a `running` toggle in its params pane. A bake auto-launches
all modules once and cannot start, stop, or relaunch them afterwards, and it
infers no start order, so the examples share nothing and each one owns its
start/stop: `running` off cancels the example's scene branch, `running` on
starts a fresh one. The other params (step length, voice count, phrase
lengths, bpm, rubato) are live.

## Bake and open

From `apps/livecode-tldraw`, `npm run build` once (the bake copies `dist/`).
Then from `apps/deno-notebooks`:

```sh
deno run --allow-all livecode/browser_host/bake_project.ts \
  --project ../livecode-tldraw/example-projects/timing-examples \
  --out /tmp/timing-examples-bake
npx --yes serve /tmp/timing-examples-bake   # any static file server
```

Open the served root URL: one tab boots the engine, launches the five
modules, and the canvas views animate beside the code shapes.

## Automated check

`apps/deno-notebooks/livecode/tests/timing_examples.e2e.mjs` bakes this
project, opens the root URL headless, and asserts that all five modules run,
every canvas view draws, and params writes pause one example and retime
another. It is part of `deno task test:livecode:topologies`.

## Develop it live (optional)

With a server in `--engine remote` mode and `npm run dev`, open
`http://localhost:5173/?serverBaseUrl=http://localhost:7777&projectPath=<abs path>&engine=inprocess`
and run modules from their shapes. Reloading restarts the engine.

## Manual verification

1. **sequence**: both rows step in time. The engine row's "wall − logical"
   stays within a few ms and its sparkline is flat; the setTimeout row's grows
   without bound (faster with a small step). Setting `running` off freezes
   both; on restarts them from zero.
2. **branches**: bars fill at different rates and finish in duration order,
   numbered `#1`…`#N`; after the last one the footer reports the parent's
   time advanced by the longest duration, then a new cycle starts. Change
   `voices` or `longestSec`: the next cycle uses them.
3. **cancel**: two dots orbit for `lifetimeSec`, vanish on cancel, "ticks
   after cancel" stays 0, "handleCancel ran" increments once per family, and
   the parent heartbeat never pauses.
4. **barrier**: A's bar fills, then shows hatching while B finishes; A's next
   start lines up with B's next start (the reported gap is ~0 ms). Make A
   longer than B: A then never waits, and B's cycles pass under it.
5. **tempo**: the shared voice's pulse rate follows the `bpm` slider at once,
   the cloned voice keeps its spawn tempo. Turn on `rubato`: the shared voice
   breathes around the slider value while the cloned one is steady. Toggle
   `running` off and on with a different `bpm`: the cloned voice now freezes
   at the new value.
