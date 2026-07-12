// timing_tests.ts — consolidated test suite for offline_time_context.ts.
// Runner-agnostic: exports async functions that throw on failure. Executing
// this file directly (deno run / browser import) runs the whole suite.
//
// The suite has TWO sections:
//
// A) DETERMINISM cases (`makeTimingTestCases`): each scenario is run in BOTH
//    realtime (`launch`) and offline (`OfflineRunner`) mode and the logged
//    event sequences must match exactly. This encodes the engine's most
//    valuable invariant — realtime/offline parity plus stable re-run
//    ordering. It assumes user code "follows the rules":
//    1) Deterministic logical-time ordering across realtime vs offline
//       - same initial state
//       - no shared-state mutation outside scheduler-driven continuations
//       - avoid awaiting arbitrary (non-engine) Promises for timing/control flow
//    2) Deterministic tie-breaking for events at the same logical timestamp
//       - ordering is arbitrary but stable (defined by scheduler sequence numbers)
//    3) Seeded randomness:
//       - `launch/launchBrowser` and `OfflineRunner` accept a `seed`
//       - branches should use `ctx.random()` (not Math.random)
//       - RNG is forked per context by default (unless explicitly shared)
//    Because of these guarantees we compare event ORDER strictly (no windowed
//    order tolerance). We still keep a small time epsilon for safety.
//
// B) INVARIANT cases (`makeInvariantTestCases`): single-mode probes
//    consolidated from the 2026-07 stability review — originally written as
//    reproducing tests in
//    apps/deno-notebooks/livecode/tests/repro/engine_repro_test.ts (E1–E11)
//    plus ad-hoc scratchpad probes (the wait(0)-starvation check). They pin
//    down cancellation/rejection hygiene, resource-cleanup bounds, barrier
//    semantics decided by the project owner, and the zero-advance stall
//    guard. Several document INTENTIONAL semantics (marked "by design" /
//    "owner decision") so future refactors don't silently change them.
//    Also includes the tempo-modulation accuracy cases from the 2026-07
//    rubato analysis: engine event times under high-fps setBpm/rampBpmTo
//    modulation are checked against ANALYTIC ground truth computed outside
//    the engine (see the tempo-modulation helpers section).

/* ------------------------------------------------------------------------------------------------
 * Imports (change path as needed)
 * ------------------------------------------------------------------------------------------------ */

import {
  awaitBarrier,
  type CancelablePromiseProxy,
  launch,
  MAX_ZERO_ADVANCE_SLICES,
  OfflineRunner,
  resolveBarrier,
  startBarrier,
  TempoMap,
  type TimeContext,
  // If you exported RandomSeed, you can import it; otherwise keep local typing.
  // type RandomSeed,
} from "./offline_time_context.ts";

/* ------------------------------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------------------------------ */

export type LoggedEvent = {
  id: string; // stable unique label (deterministic)
  t: number; // ctx.time (logical seconds)
  rootT: number; // ctx.rootContext!.mostRecentDescendentTime at log time
  ctxId: number; // ctx.id (debug)
  wall: number; // wall time (debug only; not compared)
  note?: string; // optional metadata
  value?: number; // optional numeric payload (e.g., rng draw)
};

export type TestTolerances = {
  timeEpsSec?: number; // abs time diff allowed per event (offline vs realtime)
  valueEps?: number; // abs numeric payload diff allowed per event
};

export type TimingTestCase = {
  name: string;
  // Human-readable statement of what the case exercises and what a failure
  // means. Printed on failure by the runner.
  description?: string;
  bpm?: number;
  seed?: string | number; // same seed used for offline and realtime
  logicalDurationSec: number;

  // Optional: run each mode multiple times and ensure repeatability (same events each run).
  // Default: 1
  repeatRuns?: number;

  // Max realtime wall time for a single run. Must be <= 10s per your requirements.
  realtimeTimeoutMs?: number;

  tolerances?: TestTolerances;

  // Scenarios must not rely on waitFrame() for this suite.
  run: (
    ctx: TimeContext,
    log: (
      ctx: TimeContext,
      id: string,
      opts?: { note?: string; value?: number },
    ) => void,
  ) => Promise<void>;
};

export type TestResult = {
  name: string;
  offlineEvents: LoggedEvent[];
  realtimeEvents: LoggedEvent[];
};

type RandomCapableContext = TimeContext & {
  random?: () => number;
  rng?: () => number;
};

/* ------------------------------------------------------------------------------------------------
 * Minimal asserts
 * ------------------------------------------------------------------------------------------------ */

function fail(msg: string): never {
  throw new Error(msg);
}

function assert(cond: unknown, msg: string) {
  if (!cond) fail(msg);
}

function almostEq(a: number, b: number, eps: number) {
  return Math.abs(a - b) <= eps;
}

async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`Timeout (${ms}ms): ${label}`)),
      ms,
    );
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timeoutId != null) clearTimeout(timeoutId);
  }
}

/* ------------------------------------------------------------------------------------------------
 * Logging helpers
 * ------------------------------------------------------------------------------------------------ */

function makeLogger(events: LoggedEvent[]) {
  return (
    ctx: TimeContext,
    id: string,
    opts?: { note?: string; value?: number },
  ) => {
    const root = ctx.rootContext!;
    events.push({
      id,
      t: ctx.time,
      rootT: root.mostRecentDescendentTime,
      ctxId: ctx.id,
      wall: performance.now() / 1000,
      note: opts?.note,
      value: opts?.value,
    });
  };
}

function ensureUniqueIds(
  events: LoggedEvent[],
  mode: string,
  testName: string,
) {
  const seen = new Set<string>();
  for (const e of events) {
    if (seen.has(e.id)) {
      fail(`[${testName}] duplicate event id in ${mode}: ${e.id}`);
    }
    seen.add(e.id);
  }
}

function formatEvent(e: LoggedEvent) {
  const v = e.value !== undefined ? ` value=${e.value}` : "";
  const n = e.note ? ` note="${e.note}"` : "";
  return `${e.id}@t=${e.t.toFixed(6)} ctx=${e.ctxId} rootT=${
    e.rootT.toFixed(6)
  }${v}${n}`;
}

function drawRandom(ctx: TimeContext): number {
  const c = ctx as RandomCapableContext;
  if (typeof c.random === "function") return c.random();
  if (typeof c.rng === "function") return c.rng();
  throw new Error("TimeContext does not expose random() or rng()");
}

function diffSnippet(
  a: LoggedEvent[],
  b: LoggedEvent[],
  idx: number,
  radius = 5,
) {
  const start = Math.max(0, idx - radius);
  const end = Math.min(a.length, idx + radius + 1);

  const lines: string[] = [];
  lines.push(`First mismatch at index ${idx}:`);
  for (let i = start; i < end; i++) {
    const ae = a[i];
    const be = b[i];
    lines.push(
      `  [${i}] offline:  ${ae ? formatEvent(ae) : "<missing>"}\n` +
        `      realtime: ${be ? formatEvent(be) : "<missing>"}`,
    );
  }
  return lines.join("\n");
}

/* ------------------------------------------------------------------------------------------------
 * Deterministic comparison logic
 * ------------------------------------------------------------------------------------------------ */

export function compareDeterministicRuns(
  label: string,
  offlineEvents: LoggedEvent[],
  realtimeEvents: LoggedEvent[],
  tolerances?: TestTolerances,
) {
  const timeEps = tolerances?.timeEpsSec ?? 1e-6; // 1 microsecond default
  const valueEps = tolerances?.valueEps ?? 1e-12;

  ensureUniqueIds(offlineEvents, "offline", label);
  ensureUniqueIds(realtimeEvents, "realtime", label);

  if (offlineEvents.length !== realtimeEvents.length) {
    fail(
      `[${label}] event count mismatch: offline=${offlineEvents.length}, realtime=${realtimeEvents.length}`,
    );
  }

  // Strict sequence equality (IDs AND ordering)
  for (let i = 0; i < offlineEvents.length; i++) {
    const o = offlineEvents[i];
    const r = realtimeEvents[i];

    if (o.id !== r.id) {
      fail(
        `[${label}] event order mismatch.\n` +
          diffSnippet(offlineEvents, realtimeEvents, i),
      );
    }

    if (!almostEq(o.t, r.t, timeEps)) {
      fail(
        `[${label}] time mismatch for "${o.id}": offline=${
          o.t.toFixed(6)
        } realtime=${r.t.toFixed(6)} eps=${timeEps}`,
      );
    }

    // Root invariant: rootT should be >= ctx time at logging instant (it’s a max).
    assert(
      o.rootT + 1e-12 >= o.t,
      `[${label}] offline rootT < t at "${o.id}" (rootT=${o.rootT}, t=${o.t})`,
    );
    assert(
      r.rootT + 1e-12 >= r.t,
      `[${label}] realtime rootT < t at "${o.id}" (rootT=${r.rootT}, t=${r.t})`,
    );

    // Optional payload comparisons
    const ov = o.value;
    const rv = r.value;
    if (ov !== undefined || rv !== undefined) {
      assert(
        ov !== undefined && rv !== undefined,
        `[${label}] value presence mismatch at "${o.id}"`,
      );
      if (!almostEq(ov!, rv!, valueEps)) {
        fail(
          `[${label}] value mismatch for "${o.id}": offline=${ov} realtime=${rv} eps=${valueEps}`,
        );
      }
    }

    const on = o.note;
    const rn = r.note;
    if (on !== undefined || rn !== undefined) {
      assert(
        on === rn,
        `[${label}] note mismatch for "${o.id}": offline="${on}" realtime="${rn}"`,
      );
    }
  }
}

/* ------------------------------------------------------------------------------------------------
 * Mode runners
 * ------------------------------------------------------------------------------------------------ */

async function runOfflineOnce(tc: TimingTestCase): Promise<LoggedEvent[]> {
  const events: LoggedEvent[] = [];
  const log = makeLogger(events);

  const runner = new OfflineRunner(async (ctx) => {
    await tc.run(ctx, log);
  }, {
    bpm: tc.bpm ?? 60,
    fps: 60,
    seed: tc.seed ?? tc.name, // <-- deterministic default
  });

  // Single step should be sufficient under the new offline macrotask-yield semantics.
  await runner.stepSec(tc.logicalDurationSec + 0.2);
  await runner.promise;

  return events;
}

async function runRealtimeOnce(tc: TimingTestCase): Promise<LoggedEvent[]> {
  const events: LoggedEvent[] = [];
  const log = makeLogger(events);

  const timeoutMs = tc.realtimeTimeoutMs ??
    Math.min(9000, Math.ceil((tc.logicalDurationSec + 1.0) * 1000));

  const p = launch(async (ctx) => {
    await tc.run(ctx, log);
  }, {
    bpm: tc.bpm ?? 60,
    rate: 1,
    seed: tc.seed ?? tc.name, // <-- deterministic default
  });

  await withTimeout(p, timeoutMs, tc.name);

  return events;
}

async function runRepeated(
  modeLabel: string,
  runs: number,
  runOnce: () => Promise<LoggedEvent[]>,
  tolerances?: TestTolerances,
) {
  const first = await runOnce();
  for (let i = 1; i < runs; i++) {
    const next = await runOnce();
    compareDeterministicRuns(
      `${modeLabel} repeat ${i}`,
      first,
      next,
      tolerances,
    );
  }
  return first;
}

/* ------------------------------------------------------------------------------------------------
 * Test cases
 * ------------------------------------------------------------------------------------------------ */

export function makeTimingTestCases(): TimingTestCase[] {
  return [
    {
      name: "sequential_waitSec_basic",
      description:
        "Baseline: a single context doing back-to-back waitSec calls lands each " +
        "continuation at the exact accumulated logical time (0.05, 0.15, 0.35), " +
        "identically in realtime and offline mode.",
      logicalDurationSec: 0.5,
      run: async (ctx, log) => {
        log(ctx, "start");
        await ctx.waitSec(0.05);
        log(ctx, "t=0.05");
        await ctx.waitSec(0.10);
        log(ctx, "t=0.15");
        await ctx.waitSec(0.20);
        log(ctx, "t=0.35");
      },
    },

    {
      name: "parallel_branchWait_ordering",
      description:
        "Two branchWait children with different durations interleave by logical " +
        "deadline (B ends at 0.10 before A at 0.20) and Promise.all + wait(0) is " +
        "a valid deterministic join point for the parent.",
      logicalDurationSec: 0.4,
      run: async (ctx, log) => {
        log(ctx, "start");

        const a = ctx.branchWait(async (c) => {
          log(c, "A_start");
          await c.waitSec(0.20);
          log(c, "A_end");
        }, "A");

        const b = ctx.branchWait(async (c) => {
          log(c, "B_start");
          await c.waitSec(0.10);
          log(c, "B_end");
        }, "B");

        await Promise.all([a, b]);
        await ctx.wait(0);
        log(ctx, "joined");
      },
    },

    {
      // NEW: Explicitly tests deterministic tie-breaking for same-deadline waits.
      // With deterministic scheduler sequence ordering:
      // - A is spawned before B
      // - A schedules its wait before B
      // => A_end must occur before B_end (both at t=0.10).
      name: "deterministic_tie_break_same_deadline_is_stable",
      description:
        "Two waits landing at the SAME logical instant (t=0.10) resolve in spawn " +
        "order (A before B) because ties break on scheduler sequence numbers, " +
        "never on wall-clock arrival — the foundation of re-run determinism.",
      logicalDurationSec: 0.25,
      run: async (root, log) => {
        log(root, "start");

        const shared: string[] = [];

        const a = root.branchWait(async (c) => {
          log(c, "A_start");
          await c.waitSec(0.10);
          shared.push("A");
          log(c, "A_end");
        }, "A");

        const b = root.branchWait(async (c) => {
          log(c, "B_start");
          await c.waitSec(0.10);
          shared.push("B");
          log(c, "B_end");
        }, "B");

        await Promise.all([a, b]);
        await root.wait(0);
        log(root, "joined", { note: shared.join("") });

        // Explicit guarantee check (not just offline vs realtime equality):
        if (shared.join("") !== "AB") {
          throw new Error(
            `Expected shared order "AB" but got "${shared.join("")}"`,
          );
        }
      },
    },

    {
      name: "many_branchWaits_stress_join",
      description:
        "Fan-out stress: 20 concurrent branchWait children with staggered " +
        "durations (0.02..0.40s) all start, end, and join in a fully " +
        "deterministic order across modes.",
      logicalDurationSec: 1.0,
      run: async (ctx, log) => {
        const durations = Array.from({ length: 20 }, (_, i) => 0.02 * (i + 1)); // 0.02..0.40
        log(ctx, "start");

        const ps = durations.map((d, i) =>
          ctx.branchWait(async (c) => {
            log(c, `task${i}_start`);
            await c.waitSec(d);
            log(c, `task${i}_end`);
          }, `task${i}`)
        );

        await Promise.all(ps);
        await ctx.wait(0);
        log(ctx, "joined");
      },
    },

    {
      name: "microtask_yield_intermediate_scheduling",
      description:
        "A branch that re-waits mid-flight (A at 0.10 then again at 0.15) " +
        "interleaves correctly with a sibling whose deadline (B at 0.12) falls " +
        "BETWEEN those two waits — exercises re-scheduling between timeslices.",
      logicalDurationSec: 0.4,
      run: async (ctx, log) => {
        const a = ctx.branchWait(async (c) => {
          await c.waitSec(0.10);
          log(c, "A@0.10");

          await c.waitSec(0.05);
          log(c, "A@0.15");
        }, "A");

        const b = ctx.branchWait(async (c) => {
          await c.waitSec(0.12);
          log(c, "B@0.12");
        }, "B");

        await Promise.all([a, b]);
        await ctx.wait(0);
        log(ctx, "done");
      },
    },

    {
      name: "cancel_cascades_to_children_and_stops_ticks",
      description:
        "handle.cancel() on a branch cascades to its grandchildren: both tick " +
        "loops stop producing events after the cancel instant, and the parent " +
        "keeps running undisturbed.",
      logicalDurationSec: 0.8,
      run: async (root, log) => {
        log(root, "start");

        let childTicks = 0;
        let grandTicks = 0;

        const handle = root.branch(async (child) => {
          child.branch(async (grand) => {
            for (let i = 0; i < 10_000; i++) {
              log(grand, `grand_tick_${grandTicks++}`);
              await grand.waitSec(0.05);
            }
          }, "grand");

          for (let i = 0; i < 10_000; i++) {
            log(child, `child_tick_${childTicks++}`);
            await child.waitSec(0.05);
          }
        }, "child");

        await root.waitSec(0.23);
        log(root, "cancel");
        handle.cancel();

        await root.waitSec(0.25);
        log(root, "after_cancel_wait");
      },
    },

    {
      name: "barrier_loop_sync_melodyA_waits_for_melodyB",
      description:
        "The canonical barrier use-case: two looping generative voices with " +
        "different phrase lengths (A: 0.20s, B: 0.30s) stay cycle-locked because " +
        "A awaits the barrier B start/resolves each cycle. Voices sync WITHOUT " +
        "being aligned to downbeats.",
      logicalDurationSec: 1.2,
      run: async (root, log) => {
        const key = "barrier_loop_sync_melodyA_waits_for_melodyB";

        root.branch(async (b) => {
          for (let cycle = 0; cycle < 3; cycle++) {
            startBarrier(key, b);
            log(b, `B_start_${cycle}`);
            await b.waitSec(0.30);
            log(b, `B_end_${cycle}`);
            resolveBarrier(key, b);
          }
        }, "melodyB");

        await root.branchWait(async (a) => {
          for (let cycle = 0; cycle < 3; cycle++) {
            log(a, `A_start_${cycle}`);
            await a.waitSec(0.20);
            log(a, `A_end_${cycle}`);
            await awaitBarrier(key, a);
            log(a, `A_synced_${cycle}`);
          }
        }, "melodyA");
      },
    },

    {
      name: "barrier_race_resolve_then_immediate_restart",
      description:
        "resolveBarrier immediately followed by startBarrier at the SAME logical " +
        "instant: a consumer arriving at that instant must be released by the " +
        "resolve (not captured by the restarted cycle), deterministically in " +
        "both modes.",
      logicalDurationSec: 0.6,
      run: async (root, log) => {
        const key = "barrier_race_resolve_then_immediate_restart";

        root.branch(async (b) => {
          startBarrier(key, b);
          await b.waitSec(0.10);
          resolveBarrier(key, b);
          log(b, "B_resolved_0.10");

          startBarrier(key, b);
          log(b, "B_restarted_0.10");

          await b.waitSec(0.10);
          resolveBarrier(key, b);
          log(b, "B_resolved_0.20");
        }, "producer");

        await root.branchWait(async (a) => {
          await a.waitSec(0.10);
          log(a, "A_before_await_0.10");
          await awaitBarrier(key, a);
          log(a, "A_after_await_0.10");

          await a.waitSec(0.10);
          log(a, "A_before_await_0.20");
          await awaitBarrier(key, a);
          log(a, "A_after_await_0.20");
        }, "consumer");
      },
    },

    {
      name: "tempo_change_shared_retimes_beat_wait",
      description:
        "A beat-space wait already in flight is RETIMED when the shared tempo " +
        "changes mid-wait: wait(4 beats) at 240bpm becomes 480bpm at t=0.50, so " +
        "it completes at t≈0.75 (2 beats at each tempo) instead of t=1.0.",
      bpm: 240, // 4 beats/sec
      logicalDurationSec: 1.2,
      run: async (root, log) => {
        root.branch(async (ctl) => {
          await ctl.waitSec(0.50);
          root.setBpm(480);
          log(ctl, "tempo_set_480@0.50");
        }, "tempoCtl");

        await root.wait(4);
        log(root, "wait4beats_done"); // expect t≈0.75
      },
    },

    {
      name: "tempo_clone_child_isolated_from_root_changes",
      description:
        "A branch created with { tempo: 'cloned' } keeps its own tempo map: the " +
        "root's setBpm(480) at t=0.50 must NOT retime the child's in-flight " +
        "4-beat wait (child completes at t=1.0, per its cloned 240bpm).",
      bpm: 240,
      logicalDurationSec: 1.5,
      run: async (root, log) => {
        root.branch(async (ctl) => {
          await ctl.waitSec(0.50);
          root.setBpm(480);
          log(ctl, "root_tempo_set_480@0.50");
        }, "tempoCtl");

        await root.branchWait(
          async (child) => {
            log(child, "child_start");
            await child.wait(4);
            log(child, "child_done");
          },
          "child",
          { tempo: "cloned" },
        );
      },
    },

    {
      name: "tempo_modulation_60fps_staircase_parity",
      description:
        "The programmatic-rubato pattern: a 60fps control branch calls " +
        "setBpm(curve(t)) every tick while a melody voice does chained " +
        "beat-space wait(0.25) calls. Every note must land at identical " +
        "logical times AND beat positions in realtime and offline mode — " +
        "60 tempo edits per second must not introduce mode-dependent drift " +
        "or reordering.",
      bpm: 120, // == curve(0)
      logicalDurationSec: 1.4,
      run: async (root, log) => {
        const curve = (t: number) => 120 + 60 * Math.sin(Math.PI * t);

        root.branch(async (mod) => {
          while (!mod.isCanceled && mod.time < 1.0) {
            mod.setBpm(curve(mod.time));
            await mod.waitSec(1 / 60);
          }
        }, "tempoModulator");

        await root.branchWait(async (c) => {
          for (let i = 0; i < 10; i++) {
            await c.wait(0.25);
            log(c, `note_${i}`, { value: c.tempo.beatsAtTime(c.time) });
          }
        }, "melody");

        await root.waitSec(0.2); // outlive the modulator so the tree ends quiet
        log(root, "done");
      },
    },

    {
      name: "tempo_modulation_ramp_chase_parity",
      description:
        "Smooth rubato via the ramp-chase idiom: every tick the modulator " +
        "calls rampBpmTo(curve(t + dt), dt), making the tempo map a " +
        "piecewise-LINEAR interpolant of the curve (~80x closer to the " +
        "continuous ideal than the setBpm staircase — see improvements.md). " +
        "Note times and beat positions must match exactly across realtime " +
        "and offline.",
      bpm: 120, // == curve(0)
      logicalDurationSec: 1.4,
      run: async (root, log) => {
        const curve = (t: number) => 120 + 60 * Math.sin(Math.PI * t);
        const dt = 1 / 60;

        root.branch(async (mod) => {
          while (!mod.isCanceled && mod.time < 1.0) {
            mod.rampBpmTo(curve(mod.time + dt), dt);
            await mod.waitSec(dt);
          }
        }, "tempoModulator");

        await root.branchWait(async (c) => {
          for (let i = 0; i < 10; i++) {
            await c.wait(0.25);
            log(c, `note_${i}`, { value: c.tempo.beatsAtTime(c.time) });
          }
        }, "melody");

        await root.waitSec(0.2);
        log(root, "done");
      },
    },

    {
      name: "wait0_is_valid_sync_point",
      description:
        "OCCASIONAL wait(0) is a legal, deterministic re-entry point into the " +
        "scheduler after joining non-engine promises (Promise.all): it does not " +
        "advance logical time but yields a stable ordering slot. (A wait(0) HOT " +
        "LOOP is user error — see the zero-advance stall-guard invariant test.)",
      logicalDurationSec: 0.6,
      run: async (root, log) => {
        const p1 = root.branchWait(async (c) => {
          await c.waitSec(0.10);
          log(c, "p1_done");
        }, "p1");

        const p2 = root.branchWait(async (c) => {
          await c.waitSec(0.20);
          log(c, "p2_done");
        }, "p2");

        await Promise.all([p1, p2]);
        log(root, "after_all_immediate");
        await root.wait(0);
        log(root, "after_all_after_wait0");
      },
    },

    {
      name: "frame_like_loop_waitSec_60fpsish",
      description:
        "A 60fps-style render loop built from waitSec(1/60) accumulates NO " +
        "drift: frame N lands at exactly N/60 logical seconds in both modes " +
        "(the engine schedules against absolute targets, not per-wait deltas).",
      logicalDurationSec: 1.0,
      run: async (root, log) => {
        log(root, "start");
        const dt = 1 / 60;

        for (let i = 0; i < 30; i++) {
          await root.waitSec(dt);
          log(root, `frame_${i}`);
        }
        log(root, "done");
      },
    },

    {
      name: "noteoff_handleCancel_guaranteed_on_cancel",
      description:
        "The MIDI note-off pattern: handleCancel(fn) fires when its branch is " +
        "cancelled mid-note, while a branch that runs to completion fires its " +
        "in-branch note-off instead. Use handleCancel — NOT Promise.finally — " +
        "for cancel-only cleanup (see the engine header for the Chrome/Deno " +
        "divergence that motivates this).",
      logicalDurationSec: 1.2,
      run: async (root, log) => {
        log(root, "note1_on");
        const note1 = root.branch(async (c) => {
          await c.waitSec(0.30);
          log(c, "note1_off_in_branch");
        }, "note1");
        note1.handleCancel(() => log(root, "note1_off_handleCancel"));

        await root.waitSec(0.05);
        log(root, "note2_on");
        const note2 = root.branch(async (c) => {
          await c.waitSec(0.30);
          log(c, "note2_off_in_branch");
        }, "note2");
        note2.handleCancel(() => log(root, "note2_off_handleCancel"));

        await root.waitSec(0.15);
        log(root, "cancel_note2");
        note2.cancel();

        await root.waitSec(0.25);
        log(root, "done");
      },
    },

    {
      name: "waitSec_negative_and_NaN_are_safe",
      description:
        "Garbage wait durations (negative, NaN) from live-coded expressions " +
        "must not corrupt the timeline or hang: they clamp to a no-op and " +
        "subsequent waits land at the correct absolute times.",
      logicalDurationSec: 0.4,
      run: async (root, log) => {
        log(root, "start");

        await root.waitSec(-0.10);
        log(root, "after_neg_wait");

        await root.waitSec(NaN);
        log(root, "after_nan_wait");

        await root.waitSec(0.10);
        log(root, "after_0.10");
      },
    },

    /* ----------------------------- NEW: RNG determinism tests ----------------------------- */

    {
      name: "seeded_rng_forked_branches_repeatable",
      description:
        "Per-branch FORKED RNG streams: with a fixed seed, each branch's " +
        "ctx.random() draws are bit-identical across repeat runs and across " +
        "realtime/offline — one branch's draw count cannot perturb another's " +
        "stream.",
      seed: "rng_forked_demo_seed",
      repeatRuns: 2, // explicitly test repeatability (within each mode + across modes)
      logicalDurationSec: 0.4,
      tolerances: { valueEps: 1e-15 },
      run: async (root, log) => {
        log(root, "start");

        const a = root.branchWait(async (c) => {
          await c.waitSec(0.05);
          log(c, "A_r0", { value: drawRandom(c) }); // prefer ctx.random()
          await c.waitSec(0.05);
          log(c, "A_r1", { value: drawRandom(c) });
          await c.waitSec(0.05);
          log(c, "A_r2", { value: drawRandom(c) });
        }, "A");

        const b = root.branchWait(async (c) => {
          await c.waitSec(0.10);
          log(c, "B_r0", { value: drawRandom(c) });
          await c.waitSec(0.05);
          log(c, "B_r1", { value: drawRandom(c) });
        }, "B");

        await Promise.all([a, b]);
        await root.wait(0);
        log(root, "joined");
      },
    },

    {
      name: "seeded_rng_shared_stream_deterministic_under_tie_break",
      description:
        "SHARED RNG stream ({ rng: 'shared' }) stays deterministic even when " +
        "two branches draw at the same logical instant, because same-deadline " +
        "tie-breaking is stable (spawn order) — so the draw interleaving is " +
        "reproducible.",
      seed: "rng_shared_demo_seed",
      repeatRuns: 2,
      logicalDurationSec: 0.3,
      tolerances: { valueEps: 1e-15 },
      run: async (root, log) => {
        log(root, "start");

        // If your engine supports BranchOptions.rng, this test forces shared RNG.
        const a = root.branchWait(
          async (c) => {
            await c.waitSec(0.05);
            log(c, "A_draw", { value: drawRandom(c) });
          },
          "A",
          { rng: "shared" },
        );

        const b = root.branchWait(
          async (c) => {
            await c.waitSec(0.05);
            log(c, "B_draw", { value: drawRandom(c) });
          },
          "B",
          { rng: "shared" },
        );

        await Promise.all([a, b]);
        await root.wait(0);
        log(root, "joined");

        // Deterministic ordering expectation: A_draw then B_draw (same t=0.05) because A is spawned first.
        // The strict event-order comparator enforces this across offline+realtime.
      },
    },

    /* ------------------ NEW (2026-07 stability review): barrier + cancelSafe semantics ------------------ */

    {
      name: "barrier_start_adopts_in_progress_cycle",
      description:
        "OWNER DECISION (2026-07): startBarrier on an already-in-progress cycle " +
        "ADOPTS it — it must NOT force-release parked waiters. Only an explicit " +
        "resolveBarrier releases them. This is what makes producer-module " +
        "relaunch safe: the new producer instance re-calls startBarrier without " +
        "spuriously releasing consumers mid-cycle. (A producer that WANTS " +
        "release-on-restart calls resolveBarrier at the top of its loop.)",
      logicalDurationSec: 0.5,
      run: async (root, log) => {
        const key = "barrier_start_adopts_in_progress_cycle";

        startBarrier(key, root);
        log(root, "first_start");

        root.branch(async (c) => {
          log(c, "waiter_parked");
          await awaitBarrier(key, c);
          log(c, "waiter_released"); // must come only after explicit resolve
        }, "waiter");

        await root.waitSec(0.10);
        // Simulates a relaunched producer: same key, cycle still in progress.
        startBarrier(key, root);
        log(root, "second_start_adopts");

        await root.waitSec(0.10);
        log(root, "before_resolve"); // waiter_released must NOT precede this
        resolveBarrier(key, root);

        await root.waitSec(0.05);
        log(root, "done");
      },
    },

    {
      name: "barrier_await_on_never_started_key_free_runs",
      description:
        "BY DESIGN: awaitBarrier on a key no producer has started resolves " +
        "immediately at the caller's current logical time — barriers are an " +
        "optional sync overlay, and a missing producer imposes no constraint " +
        "(consumers free-run until a producer exists). Typo'd names / dead " +
        "producers are a runtime-visibility concern, not an engine error.",
      logicalDurationSec: 0.3,
      run: async (root, log) => {
        await root.waitSec(0.05);
        log(root, "before_await");
        await awaitBarrier("barrier_key_nobody_ever_starts", root);
        log(root, "after_await_immediate"); // same logical instant as before_await
        await root.waitSec(0.05);
        log(root, "done");
      },
    },

    {
      name: "cancelSafe_settles_awaiting_parent_with_value",
      description:
        "cancelSafe(value) is the graceful counterpart to cancel(): it settles " +
        "the proxy's join promise with the given value BEFORE cancelling the " +
        "subtree, so a parent awaiting a branchWait child resumes normally with " +
        "that value instead of being torn down (plain cancel() rejects the " +
        "awaiting parent — see the invariant test for that default).",
      logicalDurationSec: 0.4,
      run: async (root, log) => {
        let proxy: CancelablePromiseProxy<number> | null = null;

        root.branch(async (killer) => {
          await killer.waitSec(0.05);
          log(killer, "cancelSafe_fired");
          proxy!.cancelSafe(42);
        }, "killer");

        proxy = root.branchWait<number>(async (c) => {
          log(c, "child_start");
          await c.waitSec(60); // would run far past the test window
          return 1;
        }, "child");

        const value = await proxy;
        log(root, "parent_resumed", { value });
        await root.wait(0);
        log(root, "parent_continues_after_wait0");
      },
    },
  ];
}

/* ------------------------------------------------------------------------------------------------
 * Invariant test cases (single-mode probes)
 *
 * Consolidated from the 2026-07 stability review: the E1–E11 reproducing tests
 * in apps/deno-notebooks/livecode/tests/repro/engine_repro_test.ts and the
 * ad-hoc wait(0)-starvation scratchpad probe. Unlike the determinism cases
 * above these run in ONE mode (mostly realtime `launch`) because they exercise
 * cancellation, unhandled-rejection hygiene, wall-clock stalls, or engine
 * internals rather than offline/realtime parity.
 * ------------------------------------------------------------------------------------------------ */

export type InvariantTestCase = {
  name: string;
  // What the case pins down and what a failure means. Cases marked
  // "BY DESIGN" / "OWNER DECISION" document intentional semantics — do not
  // "fix" the engine to make them fail without explicit owner sign-off.
  description: string;
  fn: () => Promise<void>;
};

function sleepWall(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Collects unhandledrejection events and prevents them from killing the
 * process (which is exactly what an untrapped one would do to the live Deno
 * server mid-performance).
 */
function trapUnhandledRejections() {
  const events: unknown[] = [];
  const listener = ((event: Event & { reason?: unknown }) => {
    event.preventDefault();
    events.push(event.reason);
  }) as EventListener;
  globalThis.addEventListener("unhandledrejection", listener);
  return {
    events,
    dispose: () =>
      globalThis.removeEventListener("unhandledrejection", listener),
  };
}

/* ------------------------------------------------------------------------------------------------
 * Tempo-modulation helpers (analytic ground truth for the rubato invariant cases)
 *
 * These pin the 2026-07 tempo-modulation analysis: a high-fps control thread
 * modulating tempo while melody threads do beat-space waits ("programmatic
 * rubato"). Ground truth is computed OUTSIDE the engine so a retiming bug
 * cannot hide by being self-consistent.
 * ------------------------------------------------------------------------------------------------ */

// The rubato curve used across the modulation cases: 120 +/- 60 bpm, 2s period.
function rubatoBpm(t: number): number {
  return 120 + 60 * Math.sin(Math.PI * t);
}

// Melody event times under the piecewise-constant tempo "staircase" produced by
// calling setBpm(curve(tau_k)) at tick times tau_k (float-accumulated exactly
// like the engine's waitSec(dt) loop). Mirrors engine semantics: the next
// note's base beat position is re-read at each resolve time.
function staircaseEventTimes(
  fps: number,
  curve: (t: number) => number,
  noteBeats: number,
  dur: number,
): number[] {
  const dt = 1 / fps;
  const stamps: Array<{ t: number; bpm: number }> = [];
  let tau = 0;
  while (tau < dur) {
    stamps.push({ t: tau, bpm: curve(tau) });
    tau = tau + dt;
  }
  const beatsAt: number[] = [0];
  for (let i = 1; i < stamps.length; i++) {
    beatsAt.push(
      beatsAt[i - 1] + (stamps[i].t - stamps[i - 1].t) * stamps[i - 1].bpm / 60,
    );
  }
  const timeAtBeats = (b: number): number => {
    let lo = 0;
    while (lo + 1 < stamps.length && beatsAt[lo + 1] < b) lo++;
    return stamps[lo].t + (b - beatsAt[lo]) * 60 / stamps[lo].bpm;
  };
  const beatsAtTime = (t: number): number => {
    let lo = 0;
    while (lo + 1 < stamps.length && stamps[lo + 1].t <= t) lo++;
    return beatsAt[lo] + (t - stamps[lo].t) * stamps[lo].bpm / 60;
  };

  const events: number[] = [];
  let target = noteBeats;
  while (true) {
    const t = timeAtBeats(target);
    if (t > dur) break;
    events.push(t);
    target = beatsAtTime(t) + noteBeats;
  }
  return events;
}

// Time at which `targetBeats` accumulate under the staircase (for a single
// long in-flight wait).
function staircaseTimeAtBeats(
  fps: number,
  curve: (t: number) => number,
  targetBeats: number,
): number {
  const dt = 1 / fps;
  let tau = 0;
  let beats = 0;
  while (true) {
    const bpm = curve(tau);
    const next = beats + dt * bpm / 60;
    if (next >= targetBeats) return tau + (targetBeats - beats) * 60 / bpm;
    tau = tau + dt;
    beats = next;
  }
}

// Melody event times under the CONTINUOUS ideal curve (fine numeric integration).
function continuousEventTimes(
  curve: (t: number) => number,
  noteBeats: number,
  dur: number,
): number[] {
  const step = 1e-5;
  const events: number[] = [];
  let beats = 0;
  let target = noteBeats;
  let t = 0;
  while (t < dur) {
    const b2 = beats + step * curve(t + step / 2) / 60;
    if (b2 >= target) {
      events.push(t + ((target - beats) / (b2 - beats)) * step);
      target += noteBeats;
    }
    beats = b2;
    t += step;
  }
  return events;
}

type ModEvent = { t: number; beats: number };

// Shared scenario driver (offline): a modulator branch ticking at `fps` calls
// `applyTempo` each tick; `voices` melody branches do chained wait(noteBeats).
// Each event records the beat position read IMMEDIATELY at resolve time — that
// read is exact even under history compaction (the boundary trails current
// time), whereas re-reading old times after the run could see approximations.
async function runModulationScenario(opts: {
  fps: number;
  dur: number;
  noteBeats: number;
  voices: number;
  applyTempo: (mod: TimeContext, dt: number) => void;
}): Promise<ModEvent[][]> {
  const { fps, dur, noteBeats, voices } = opts;
  const dt = 1 / fps;
  const out: ModEvent[][] = Array.from({ length: voices }, () => []);

  const runner = new OfflineRunner(async (ctx) => {
    ctx.branch(async (mod) => {
      while (!mod.isCanceled && mod.time < dur) {
        opts.applyTempo(mod, dt);
        await mod.waitSec(dt);
      }
    }, "modulator");

    await Promise.all(
      out.map((events, v) =>
        ctx.branchWait(async (c) => {
          while (c.time < dur - 0.5) {
            await c.wait(noteBeats);
            events.push({ t: c.time, beats: c.tempo.beatsAtTime(c.time) });
          }
        }, `voice${v}`)
      ),
    );
  }, { bpm: rubatoBpm(0), seed: "tempo-modulation" });

  await runner.stepSec(dur + 1);
  await runner.promise;
  return out;
}

function maxBeatDeltaError(events: ModEvent[], noteBeats: number): number {
  let m = 0;
  for (let i = 1; i < events.length; i++) {
    m = Math.max(
      m,
      Math.abs(events[i].beats - events[i - 1].beats - noteBeats),
    );
  }
  return m;
}

export function makeInvariantTestCases(): InvariantTestCase[] {
  return [
    {
      name: "root_cancel_emits_no_unhandled_rejection",
      description:
        "(was BUG E1) Cancelling a root context parked on an engine wait — the " +
        "server's stop path for every launched module tree — must not emit an " +
        "unhandledrejection. Untrapped, that event is process-fatal in Deno: " +
        "one module stop would kill an hours-long live set.",
      fn: async () => {
        const trap = trapUnhandledRejections();
        try {
          const handle = launch(async (ctx) => {
            await ctx.waitSec(60);
          });
          await sleepWall(30);
          handle.cancel();
          await sleepWall(150); // give any rejection time to be reported
          assert(
            trap.events.length === 0,
            `root cancel leaked ${trap.events.length} unhandled rejection(s)`,
          );
        } finally {
          trap.dispose();
        }
      },
    },

    {
      name: "branch_handle_finally_on_cancel_emits_no_unhandled_rejection",
      description:
        "(was BUG E2) branch(...).finally(fn) is the obvious user API for " +
        "cleanup-on-stop, and the derived promise it returns is typically " +
        "discarded. Cancelling the branch must still run the callback AND not " +
        "leak an unhandled rejection through that discarded derived promise.",
      fn: async () => {
        const trap = trapUnhandledRejections();
        try {
          let cleanupRan = false;
          const handle = launch(async (ctx) => {
            const branchHandle = ctx.branch(async (childCtx) => {
              await childCtx.waitSec(60);
            });
            branchHandle.finally(() => {
              cleanupRan = true;
            });
            await ctx.waitSec(0.05);
            branchHandle.cancel();
            await ctx.waitSec(0.05);
          });
          await handle;
          await sleepWall(150);

          assert(cleanupRan, "finally callback must run on cancel");
          assert(
            trap.events.length === 0,
            `branch finally leaked ${trap.events.length} unhandled rejection(s)`,
          );
        } finally {
          trap.dispose();
        }
      },
    },

    {
      name: "branchWait_child_cancel_rejects_awaiting_parent_by_default",
      description:
        "OWNER DECISION (2026-07, was BUG E3): plain cancel() on a branchWait " +
        "child REJECTS the awaiting parent — a hard cancel is allowed to tear " +
        "down the join. The graceful alternative is cancelSafe(value) (see the " +
        "determinism case). This test pins the default so it can't silently " +
        "drift toward swallowing cancels.",
      fn: async () => {
        const trap = trapUnhandledRejections();
        try {
          let parentReachedEnd = false;
          let childProxy: CancelablePromiseProxy<void> | null = null;
          let rootRejection: unknown = null;

          const handle = launch(async (ctx) => {
            childProxy = ctx.branchWait(async (childCtx) => {
              await childCtx.waitSec(60);
            });
            await childProxy; // no user try/catch — the common case
            parentReachedEnd = true;
          });
          const rootSettled = handle.catch((error) => {
            rootRejection = error;
          });

          await sleepWall(50);
          const proxy = childProxy as CancelablePromiseProxy<void> | null;
          assert(proxy !== null, "child proxy captured");
          proxy!.cancel();
          await rootSettled;
          await sleepWall(100);

          assert(!parentReachedEnd, "parent block must not continue past join");
          assert(
            rootRejection instanceof Error,
            "root must reject (catchably) when an awaited child is cancelled",
          );
          assert(
            trap.events.length === 0,
            `cancel teardown leaked ${trap.events.length} unhandled rejection(s)`,
          );
        } finally {
          trap.dispose();
        }
      },
    },

    {
      name: "overdue_waits_replay_as_burst_after_event_loop_stall",
      description:
        "OWNER DECISION (2026-07, was BUG E4): after a wall-clock event-loop " +
        "stall (GC pause, heavy synchronous work), overdue waits replay " +
        "back-to-back with zero wall delay — the engine catches logical time up " +
        "rather than dropping or diluting events, preserving re-run " +
        "determinism. A catch-up clamp was deliberately REJECTED; the " +
        "mitigation is keeping heavy work (e.g. ts-morph transforms) off the " +
        "engine thread entirely (worker + pre-warm). This test documents the " +
        "burst so the tradeoff stays visible.",
      fn: async () => {
        const stamps: number[] = [];
        const WAITS = 30;
        const STEP_SEC = 0.03;
        const handle = launch(async (ctx) => {
          for (let i = 0; i < WAITS; i++) {
            await ctx.waitSec(STEP_SEC);
            stamps.push(performance.now());
          }
        });

        // Let a few waits fire normally, then stall the event loop ~500ms.
        await sleepWall(120);
        const stallStart = performance.now();
        while (performance.now() - stallStart < 500) {
          // busy-wait
        }
        await handle;

        // Longest run of consecutive inter-wait gaps under 15ms (nominal
        // spacing is 30ms) = how many overdue slices replayed as a burst.
        let longestBurst = 0;
        let current = 0;
        for (let i = 1; i < stamps.length; i++) {
          if (stamps[i] - stamps[i - 1] < 15) {
            current += 1;
            longestBurst = Math.max(longestBurst, current);
          } else {
            current = 0;
          }
        }
        assert(
          longestBurst >= 8,
          `expected a catch-up burst of >=8 back-to-back waits, got ${longestBurst}`,
        );
      },
    },

    {
      name: "non_engine_await_rebases_onto_global_time_floor",
      description:
        "OWNER DECISION (2026-07, was BUG E5): timing/control flow through " +
        "non-engine awaits (fetch, fs, device IO) is USER ERROR, and the engine " +
        "does not change semantics to recover from it. A context resuming from " +
        "a non-engine await schedules its next wait relative to the GLOBAL " +
        "logical-time floor (mostRecentDescendentTime), not its own stale " +
        "timeline — so it silently jumps forward. The remedy is UI warnings " +
        "(analysis flags non-engine awaits), not engine changes.",
      fn: async () => {
        let bTimeBeforeWait = -1;
        let bTimeAfterWait = -1;

        const handle = launch(async (ctx) => {
          // Branch A keeps advancing global logical time.
          ctx.branch(async (a) => {
            for (let i = 0; i < 8; i++) {
              await a.waitSec(0.05);
            }
          });
          // Branch B suspends on a NON-engine await for 300ms, then asks for
          // a small engine wait.
          await ctx.branchWait(async (b) => {
            await sleepWall(300);
            bTimeBeforeWait = b.time;
            await b.waitSec(0.05);
            bTimeAfterWait = b.time;
          });
        });
        await handle;
        await sleepWall(250); // let branch A finish its remaining waits

        assert(
          bTimeBeforeWait < 0.05,
          `B accrues no logical time while suspended (got ${bTimeBeforeWait})`,
        );
        assert(
          bTimeAfterWait > 0.25,
          `B's wait rebases onto the global floor (~0.3s); got ${bTimeAfterWait}`,
        );
      },
    },

    {
      name: "tempo_history_stays_bounded_under_setBpm_hammering",
      description:
        "(was BUG E6) Hammering setBpm from a live-coded control loop must not " +
        "grow the tempo map without bound: old segments compact while time/beat " +
        "continuity at every retained boundary stays exact. Unbounded growth " +
        "made every beat computation slower over an hours-long set.",
      fn: async () => {
        let segsBefore = -1;
        let segsAfter = -1;
        let continuityError = "";
        const handle = launch(async (ctx) => {
          const tempoAny = ctx.tempo as unknown as {
            segs: Array<
              { t0: number; t1: number; beats0: number; beats1: number }
            >;
          };
          segsBefore = tempoAny.segs.length;
          for (let i = 0; i < 100; i++) {
            ctx.setBpm(100 + (i % 7));
            await ctx.waitSec(0.001);
          }
          segsAfter = tempoAny.segs.length;
          for (let i = 1; i < tempoAny.segs.length; i++) {
            if (tempoAny.segs[i - 1].t1 !== tempoAny.segs[i].t0) {
              continuityError = `tempo segment ${i} time continuity broke`;
              break;
            }
            if (
              Math.abs(
                tempoAny.segs[i - 1].beats1 - tempoAny.segs[i].beats0,
              ) >= 1e-9
            ) {
              continuityError = `tempo segment ${i} beat continuity broke`;
              break;
            }
          }
        });
        await handle;

        assert(continuityError === "", continuityError);
        assert(
          segsAfter - segsBefore <= 18,
          `expected bounded tempo history, got ${
            segsAfter - segsBefore
          } new segments`,
        );
      },
    },

    {
      name: "tempo_compaction_preserves_post_boundary_beat_mapping",
      description:
        "Pure TempoMap unit check: compacting old tempo history (triggered by " +
        "the 25th change here) must not move beatsAtTime() for any time after " +
        "the retained boundary — compaction may only forget resolution BEFORE " +
        "the boundary, never redefine the present.",
      fn: async () => {
        const tempo = new TempoMap(120);
        for (let i = 1; i <= 24; i++) {
          tempo._setBpmAtTime(80 + i, i * 0.1);
        }
        const probeTime = 2.41;
        const beatsAtProbe = tempo.beatsAtTime(probeTime);
        tempo._setBpmAtTime(150, 2.5);
        assert(
          Math.abs(tempo.beatsAtTime(probeTime) - beatsAtProbe) < 1e-9,
          "compaction must preserve beat mapping after the retained boundary",
        );
      },
    },

    {
      name: "long_lived_branch_progBeats_continuous_across_compaction",
      description:
        "(was BUG E11) A long-lived branch's progBeats must stay continuous " +
        "when tempo-history compaction sweeps past the branch's startTime. " +
        "Contexts cache startBeats at creation; the old code recomputed " +
        "beatsAtTime(startTime) live, so compaction averaging a fast history " +
        "region collapsed that origin and progBeats jumped ~10x in one step. " +
        "Profile: FAST before the branch spawns, SLOW after — so during the " +
        "recording window a legitimate step obeys deltaBeats <= slow-tempo " +
        "beats for its deltaTime.",
      fn: async () => {
        const samples: Array<{ t: number; pb: number }> = [];
        const fastBpm = 240;
        const slowBpm = 20;
        const branchStep = 0.025;

        const handle = launch(async (ctx) => {
          // FAST history before branching so startTime falls in the fast region.
          for (let i = 0; i < 10; i++) {
            ctx.setBpm(fastBpm);
            await ctx.waitSec(0.025);
          }

          const branch = ctx.branch(async (c) => {
            for (let i = 0; i < 40; i++) {
              await c.waitSec(branchStep);
              samples.push({ t: c.time, pb: c.progBeats });
            }
          }, "long-lived-voice");

          // SLOW from here on, hammering setBpm to push tempo history past the
          // compaction threshold — moving the boundary past the branch's
          // (fast-region) startTime mid-run.
          for (let i = 0; i < 55; i++) {
            ctx.setBpm(slowBpm);
            await ctx.waitSec(0.018);
          }

          await branch.finally(() => {});
        });
        await handle;

        assert(
          samples.length >= 30,
          `expected >=30 progBeats samples, got ${samples.length}`,
        );
        for (let i = 1; i < samples.length; i++) {
          const deltaBeats = samples[i].pb - samples[i - 1].pb;
          const deltaTime = samples[i].t - samples[i - 1].t;
          assert(
            deltaBeats >= -1e-9,
            `progBeats must be non-decreasing, saw ${deltaBeats} at step ${i}`,
          );
          // Whole recording window runs at slowBpm; 3x headroom for scheduler
          // catch-up. The old bug produced steps ~15x this bound.
          const maxBeats = (slowBpm / 60) * Math.max(0, deltaTime) * 3 + 1e-6;
          assert(
            deltaBeats <= maxBeats,
            `progBeats delta ${deltaBeats} at step ${i} exceeds what ` +
              `${deltaTime}s at ~${slowBpm}bpm can produce (${maxBeats}) — ` +
              "compaction discontinuity",
          );
        }
      },
    },

    /* ------------------ tempo-modulation accuracy (2026-07 rubato analysis) ------------------ */

    {
      name: "tempo_modulation_matches_analytic_staircase",
      description:
        "Programmatic-rubato correctness: a 60fps branch calling " +
        "setBpm(curve(t)) every tick produces a piecewise-constant tempo " +
        "staircase, and every chained wait(0.25) of a melody voice must " +
        "resolve at EXACTLY the analytically computed staircase times. " +
        "Repeated head-retiming of in-flight beat waits (60 edits/sec, " +
        "~180 edits over the run) must not accumulate any error.",
      fn: async () => {
        const [voice] = await runModulationScenario({
          fps: 60,
          dur: 3,
          noteBeats: 0.25,
          voices: 1,
          applyTempo: (mod) => mod.setBpm(rubatoBpm(mod.time)),
        });
        const truth = staircaseEventTimes(60, rubatoBpm, 0.25, 3);

        assert(voice.length >= 15, `expected >=15 events, got ${voice.length}`);
        for (let i = 0; i < voice.length; i++) {
          assert(
            truth[i] !== undefined && almostEq(voice[i].t, truth[i], 1e-9),
            `event ${i}: engine=${voice[i].t} analytic=${truth[i]}`,
          );
        }
      },
    },

    {
      name: "tempo_modulation_keeps_parallel_voices_beat_locked",
      description:
        "Two melody voices sharing the modulated tempo map and playing the " +
        "same wait(0.25) pattern must resolve at IDENTICAL logical times " +
        "(same slice), and each voice's beat position must advance by " +
        "exactly 0.25 per note — the cross-thread synchronization guarantee " +
        "that makes rubato safe across parallel voices.",
      fn: async () => {
        const [a, b] = await runModulationScenario({
          fps: 60,
          dur: 3,
          noteBeats: 0.25,
          voices: 2,
          applyTempo: (mod) => mod.setBpm(rubatoBpm(mod.time)),
        });

        assert(
          a.length >= 15 && a.length === b.length,
          `voice event counts differ: ${a.length} vs ${b.length}`,
        );
        for (let i = 0; i < a.length; i++) {
          assert(
            a[i].t === b[i].t,
            `voices diverged at event ${i}: ${a[i].t} vs ${b[i].t}`,
          );
        }
        assert(
          maxBeatDeltaError(a, 0.25) < 1e-9,
          `voice A beat integral drifted by ${maxBeatDeltaError(a, 0.25)}`,
        );
        assert(
          maxBeatDeltaError(b, 0.25) < 1e-9,
          `voice B beat integral drifted by ${maxBeatDeltaError(b, 0.25)}`,
        );
      },
    },

    {
      name: "extreme_per_tick_tempo_jumps_keep_beat_integral_exact",
      description:
        "Worst-case modulation: setBpm alternates 30 <-> 300 bpm on EVERY " +
        "60fps tick (a 10x jump 60 times per second). The beat integral of a " +
        "melody voice must still advance by exactly 0.25 per note — retiming " +
        "must be exact under discontinuous tempo, not just smooth curves.",
      fn: async () => {
        let flip = false;
        const [voice] = await runModulationScenario({
          fps: 60,
          dur: 3,
          noteBeats: 0.25,
          voices: 1,
          applyTempo: (mod) => {
            mod.setBpm(flip ? 300 : 30);
            flip = !flip;
          },
        });

        assert(voice.length >= 12, `expected >=12 events, got ${voice.length}`);
        assert(
          maxBeatDeltaError(voice, 0.25) < 1e-9,
          `beat integral drifted by ${maxBeatDeltaError(voice, 0.25)}`,
        );
      },
    },

    {
      name: "rampBpmTo_retimes_inflight_beat_wait",
      description:
        "A beat wait in flight when rampBpmTo starts must resolve mid-ramp " +
        "at the analytic quadratic solution: wait(4) at 240bpm, then " +
        "rampBpmTo(480, 0.5) stamped at t=0.5 -> 2 beats remain, solved " +
        "inside the accelerating ramp at t = 0.5 + (sqrt(3)-1)/2 ~= 0.866. " +
        "Exercises TempoMap.timeAtBeats's quadratic root selection on a live " +
        "ramp segment (previously untested).",
      fn: async () => {
        let resolvedAt = -1;
        const runner = new OfflineRunner(async (ctx) => {
          ctx.branch(async (ctl) => {
            await ctl.waitSec(0.5);
            ctx.rampBpmTo(480, 0.5);
          }, "ctl");

          await ctx.wait(4);
          resolvedAt = ctx.time;
        }, { bpm: 240, seed: "ramp-retime" });

        await runner.stepSec(2);
        await runner.promise;

        const expected = 0.5 + (Math.sqrt(3) - 1) / 2;
        assert(
          almostEq(resolvedAt, expected, 1e-9),
          `resolved=${resolvedAt} expected=${expected}`,
        );
      },
    },

    {
      name: "rampBpmTo_chase_tracks_continuous_curve",
      description:
        "The smooth-rubato idiom (see improvements.md): each 60fps tick, " +
        "rampBpmTo(curve(t + dt), dt) chases the curve, making the tempo map " +
        "a piecewise-linear interpolant. Melody events must land within " +
        "0.5ms of the CONTINUOUS ideal curve (the setBpm staircase at the " +
        "same fps deviates ~8ms), with the beat integral still exact.",
      fn: async () => {
        const [voice] = await runModulationScenario({
          fps: 60,
          dur: 3,
          noteBeats: 0.25,
          voices: 1,
          applyTempo: (mod, dt) => mod.rampBpmTo(rubatoBpm(mod.time + dt), dt),
        });
        const truth = continuousEventTimes(rubatoBpm, 0.25, 3);

        assert(voice.length >= 15, `expected >=15 events, got ${voice.length}`);
        let maxDev = 0;
        for (let i = 0; i < voice.length && i < truth.length; i++) {
          maxDev = Math.max(maxDev, Math.abs(voice[i].t - truth[i]));
        }
        assert(
          maxDev < 5e-4,
          `max deviation from continuous curve ${maxDev}s exceeds 0.5ms`,
        );
        assert(
          maxBeatDeltaError(voice, 0.25) < 1e-9,
          `beat integral drifted by ${maxBeatDeltaError(voice, 0.25)}`,
        );
      },
    },

    {
      name: "long_beat_wait_exact_under_120fps_modulation_and_compaction",
      description:
        "A single long wait(8) (~4s) stays in flight while a 120fps " +
        "modulator makes ~480 setBpm edits — so the wait is head-retimed " +
        "hundreds of times AND tempo-history compaction sweeps far past its " +
        "schedule time. It must resolve at the analytic staircase time " +
        "(compaction only approximates times strictly inside the merged " +
        "historic region; an in-flight waiter's due time never is), and the " +
        "segment count must stay bounded.",
      fn: async () => {
        let resolvedAt = -1;
        let segCount = -1;
        const runner = new OfflineRunner(async (ctx) => {
          ctx.branch(async (mod) => {
            while (!mod.isCanceled && mod.time < 6) {
              mod.setBpm(rubatoBpm(mod.time));
              await mod.waitSec(1 / 120);
            }
          }, "modulator");

          await ctx.branchWait(async (c) => {
            await c.wait(8);
            resolvedAt = c.time;
            segCount = (c.tempo as unknown as { segs: unknown[] }).segs.length;
          }, "longNote");
        }, { bpm: rubatoBpm(0), seed: "long-wait" });

        await runner.stepSec(7);
        await runner.promise;

        const truth = staircaseTimeAtBeats(120, rubatoBpm, 8);
        assert(
          almostEq(resolvedAt, truth, 1e-6),
          `resolved=${resolvedAt} analytic=${truth}`,
        );
        assert(
          segCount > 0 && segCount <= 20,
          `expected bounded tempo segments under hammering, got ${segCount}`,
        );
      },
    },

    {
      name: "cloned_tempo_modulated_cross_thread_stays_isolated",
      description:
        "Per-voice rubato: a modulator branch drives TWO cloned tempo maps " +
        "from OUTSIDE those voices' threads (via captured ctx refs — the " +
        "current idiom, see improvements.md) with different curves. Each " +
        "cloned voice's beat integral stays exact, the two voices genuinely " +
        "diverge, and a third voice on the ROOT tempo map keeps constant " +
        "120bpm intervals — cloned-map edits must never leak across maps.",
      fn: async () => {
        const curveB = (t: number) => 90 + 30 * Math.sin(Math.PI * t / 0.75 + 1);
        const DUR = 3;
        const evA: ModEvent[] = [];
        const evB: ModEvent[] = [];
        const evRoot: number[] = [];

        const runner = new OfflineRunner(async (ctx) => {
          let ctxA: TimeContext | undefined;
          let ctxB: TimeContext | undefined;

          const a = ctx.branchWait(async (c) => {
            ctxA = c; // captured for external modulation
            while (c.time < DUR) {
              await c.wait(0.25);
              evA.push({ t: c.time, beats: c.tempo.beatsAtTime(c.time) });
            }
          }, "voiceA", { tempo: "cloned" });

          const b = ctx.branchWait(async (c) => {
            ctxB = c;
            while (c.time < DUR) {
              await c.wait(0.25);
              evB.push({ t: c.time, beats: c.tempo.beatsAtTime(c.time) });
            }
          }, "voiceB", { tempo: "cloned" });

          const r = ctx.branchWait(async (c) => {
            while (c.time < DUR) {
              await c.wait(0.25);
              evRoot.push(c.time);
            }
          }, "voiceRoot");

          ctx.branch(async (mod) => {
            while (!mod.isCanceled && mod.time < DUR + 0.5) {
              ctxA!.setBpm(rubatoBpm(mod.time));
              ctxB!.setBpm(curveB(mod.time));
              await mod.waitSec(1 / 60);
            }
          }, "modulator");

          await Promise.all([a, b, r]);
        }, { bpm: 120, seed: "cloned-modulation" });

        await runner.stepSec(DUR + 1);
        await runner.promise;

        assert(
          evA.length > 10 && maxBeatDeltaError(evA, 0.25) < 1e-9,
          `voice A: ${evA.length} events, beat drift ${
            maxBeatDeltaError(evA, 0.25)
          }`,
        );
        assert(
          evB.length > 10 && maxBeatDeltaError(evB, 0.25) < 1e-9,
          `voice B: ${evB.length} events, beat drift ${
            maxBeatDeltaError(evB, 0.25)
          }`,
        );

        // root voice: constant 120bpm -> 0.25 beats == 0.125s per note, exactly
        assert(evRoot.length > 10, `root voice events: ${evRoot.length}`);
        for (let i = 1; i < evRoot.length; i++) {
          assert(
            almostEq(evRoot[i] - evRoot[i - 1], 0.125, 1e-9),
            `root voice interval ${i} = ${
              evRoot[i] - evRoot[i - 1]
            }, expected 0.125 — cloned-map modulation leaked into root map`,
          );
        }

        // sanity: the two modulated voices actually followed different curves
        const diverged = evA.some(
          (e, i) => evB[i] && Math.abs(e.t - evB[i].t) > 1e-3,
        );
        assert(diverged, "voices A and B never diverged — modulation inert?");
      },
    },

    {
      name: "tempomap_ramp_segment_roundtrip_and_midramp_truncation",
      description:
        "Pure TempoMap unit check for ramp segments (previously untested): " +
        "timeAtBeats must invert beatsAtTime exactly through a linear ramp " +
        "(quadratic solve), and a setBpm landing MID-ramp must truncate the " +
        "ramp continuously — bpm and beats agree at the cut, with the new " +
        "constant rate applying after.",
      fn: async () => {
        const tempo = new TempoMap(120);
        tempo._rampToBpmAtTime(240, 2, 1); // ramp 120 -> 240 over [1, 3]

        // round-trip through pre-ramp, ramp interior, and post-ramp segments
        for (const t of [0.5, 1.25, 1.5, 2.0, 2.75, 3.5]) {
          const b = tempo.beatsAtTime(t);
          assert(
            almostEq(tempo.timeAtBeats(b), t, 1e-9),
            `roundtrip at t=${t}: timeAtBeats(beatsAtTime(t))=${
              tempo.timeAtBeats(b)
            }`,
          );
        }

        // cut the ramp at its midpoint t=2 (interpolated bpm there is 180)
        assert(
          almostEq(tempo.bpmAtTime(2), 180, 1e-9),
          `bpm mid-ramp = ${tempo.bpmAtTime(2)}, expected 180`,
        );
        const beatsAtCut = tempo.beatsAtTime(2);
        tempo._setBpmAtTime(90, 2);
        assert(
          almostEq(tempo.beatsAtTime(2), beatsAtCut, 1e-9),
          "beat continuity broke at mid-ramp cut",
        );
        assert(
          almostEq(tempo.beatsAtTime(3) - beatsAtCut, 90 / 60, 1e-9),
          `post-cut rate wrong: ${
            tempo.beatsAtTime(3) - beatsAtCut
          } beats over 1s, expected 1.5`,
        );
      },
    },

    {
      name: "cancelled_cloned_tempo_branches_do_not_leak_beatPQs",
      description:
        "(was BUG E7) Every { tempo: 'cloned' } branch gets a fresh tempoId, " +
        "and a beat-space wait registers a per-tempoId priority queue on the " +
        "scheduler. Cancelling the branch must delete its (now-empty) queue — " +
        "the spawn/cancel-in-a-loop live pattern leaked one map entry per " +
        "cycle, degrading every scheduler pass over a long set.",
      fn: async () => {
        let beatPQCount = -1;
        const CYCLES = 25;
        const handle = launch(async (ctx) => {
          for (let i = 0; i < CYCLES; i++) {
            const branchHandle = ctx.branch(
              async (c) => {
                await c.wait(1000); // beat-space wait registers a beat PQ
              },
              `leak-${i}`,
              { tempo: "cloned" }, // fresh tempoId per branch
            );
            await ctx.waitSec(0.004);
            branchHandle.cancel();
          }
          await ctx.waitSec(0.02);
          const scheduler = ctx.scheduler as unknown as {
            beatPQs: Map<unknown, unknown>;
          };
          beatPQCount = scheduler.beatPQs.size;
        });
        await handle;
        await sleepWall(100);

        assert(
          beatPQCount <= 1,
          `expected beatPQ entries for dead tempoIds to be cleaned, got ${beatPQCount}`,
        );
      },
    },

    {
      name: "bounded_wait0_loop_is_legal_and_advances_no_logical_time",
      description:
        "BY DESIGN (was BUG E8's benign half): wait(0) resolves without " +
        "advancing logical time — a BOUNDED wait(0) loop is legal, fast, and " +
        "ends at t=0. Zero-advance is the defined meaning of wait(0), which is " +
        "exactly why an UNBOUNDED loop is 'infinite work at one logical " +
        "instant' and must be guarded (next case) rather than reordered around " +
        "— fairness fixes would make ordering depend on wall-clock arrival and " +
        "break realtime/offline parity.",
      fn: async () => {
        let iterations = 0;
        let finalLogicalTime = -1;
        const started = performance.now();
        const handle = launch(async (ctx) => {
          for (let i = 0; i < 300; i++) {
            await ctx.wait(0);
            iterations += 1;
          }
          finalLogicalTime = ctx.time;
        });
        await handle;
        const wallMs = performance.now() - started;

        assert(
          iterations === 300,
          `expected 300 iterations, got ${iterations}`,
        );
        assert(
          finalLogicalTime === 0,
          `wait(0) must not advance logical time, ended at ${finalLogicalTime}`,
        );
        assert(
          wallMs < 5000,
          `bounded wait(0) loop should complete fast, took ${wallMs}ms`,
        );
      },
    },

    {
      name: "wait0_hot_loop_trips_stall_guard_while_sibling_timing_continues",
      description:
        "(was BUG E8 + the wait(0)-starvation scratchpad probe, which " +
        "empirically hung: a wait(0) hot loop starved a sibling's 8 waitSec " +
        "calls indefinitely.) The zero-advance stall guard rejects the spinner " +
        "with 'Logical time stalled' after MAX_ZERO_ADVANCE_SLICES consecutive " +
        "slices at one logical instant — the realtime analog of the offline " +
        "MAX_TIMESLICES throw — and the sibling's ordinary waits then all fire. " +
        "Errors over silent no-ops: the spinning voice dies loudly, the rest " +
        "of the set keeps playing.",
      fn: async () => {
        const trap = trapUnhandledRejections();
        try {
          let spinError: unknown = null;
          let spinIterations = 0;
          const siblingStamps: number[] = [];

          const handle = launch(async (ctx) => {
            ctx.branch(async (a) => {
              try {
                while (true) {
                  await a.wait(0);
                  spinIterations++;
                }
              } catch (error) {
                spinError = error;
              }
            });
            await ctx.branchWait(async (b) => {
              for (let i = 0; i < 5; i++) {
                await b.waitSec(0.02);
                siblingStamps.push(performance.now());
              }
            });
          });
          await handle;
          await sleepWall(100);

          assert(
            spinError instanceof Error &&
              spinError.message.includes("Logical time stalled"),
            `expected zero-advance stall error, got: ${String(spinError)}`,
          );
          assert(
            spinIterations >= MAX_ZERO_ADVANCE_SLICES - 1_000,
            `spinner should run up to the guard threshold ` +
              `(${MAX_ZERO_ADVANCE_SLICES}), got ${spinIterations}`,
          );
          assert(
            siblingStamps.length === 5,
            `sibling waits must all fire after the stall teardown, got ${siblingStamps.length}`,
          );
          assert(
            trap.events.length === 0,
            `stall teardown leaked ${trap.events.length} unhandled rejection(s)`,
          );
        } finally {
          trap.dispose();
        }
      },
    },
  ];
}

export async function runAllInvariantTests(
  cases: InvariantTestCase[] = makeInvariantTestCases(),
): Promise<void> {
  const failures: { name: string; description: string; err: unknown }[] = [];
  for (const tc of cases) {
    try {
      console.log(`[TimingTests][invariant] Running: ${tc.name}`);
      await tc.fn();
      console.log(`[TimingTests][invariant] PASS: ${tc.name}`);
    } catch (err) {
      failures.push({ name: tc.name, description: tc.description, err });
      console.error(`[TimingTests][invariant] FAIL: ${tc.name}`, err);
      console.error(`  what this case pins down: ${tc.description}`);
    }
  }
  if (failures.length) {
    const msg =
      `Invariant tests failed (${failures.length}/${cases.length}):\n` +
      failures.map((f) => {
        const message = f.err instanceof Error ? f.err.message : String(f.err);
        return `- ${f.name}: ${message}`;
      }).join("\n");
    throw new Error(msg);
  }
}

/* ------------------------------------------------------------------------------------------------
 * Public test runner functions
 * ------------------------------------------------------------------------------------------------ */

export async function runTimingTestCaseBothModes(
  tc: TimingTestCase,
): Promise<TestResult> {
  const repeats = Math.max(1, Math.floor(tc.repeatRuns ?? 1));

  const realtimeEvents = await runRepeated(
    `[TimingTests][realtime] ${tc.name}`,
    repeats,
    () => runRealtimeOnce(tc),
    tc.tolerances,
  );

  const offlineEvents = await runRepeated(
    `[TimingTests][offline] ${tc.name}`,
    repeats,
    () => runOfflineOnce(tc),
    tc.tolerances,
  );

  compareDeterministicRuns(
    tc.name,
    offlineEvents,
    realtimeEvents,
    tc.tolerances,
  );
  return { name: tc.name, offlineEvents, realtimeEvents };
}

/**
 * Runs all default test cases. Throws aggregated error on any failure.
 * Returns results for optional debugging/inspection.
 */
export async function runAllTimingTests(
  cases: TimingTestCase[] = makeTimingTestCases(),
): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const failures: { name: string; err: unknown }[] = [];

  for (const tc of cases) {
    try {
      console.log(`[TimingTests] Running test case: ${tc.name}`);
      results.push(await runTimingTestCaseBothModes(tc));
      console.log(`[TimingTests] PASS: ${tc.name}`);
    } catch (err) {
      failures.push({ name: tc.name, err });
      console.error(`[TimingTests] FAIL: ${tc.name}`, err);
      if (tc.description) {
        console.error(`  what this case pins down: ${tc.description}`);
      }
    }
  }

  if (failures.length) {
    const msg =
      `Timing engine tests failed (${failures.length}/${cases.length}):\n` +
      failures.map((f) => {
        const message = f.err instanceof Error ? f.err.message : String(f.err);
        return `- ${f.name}: ${message}`;
      }).join("\n");
    throw new Error(msg);
  }

  return results;
}

export async function runTimingTestsGuarded() {
  console.log("Running timing tests...");
  try {
    await runAllTimingTests();
  } catch (err) {
    console.error(err);
  }
  try {
    await runAllInvariantTests();
  } catch (err) {
    console.error(err);
  }
  console.log("Timing tests completed");
}

runTimingTestsGuarded();
