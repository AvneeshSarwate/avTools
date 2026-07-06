// Reproducing tests for core-timing engine defects found during the
// 2026-07 stability review. See livecode/timeContextVisualizerPlans/stability-fix-plan.md.
//
// IMPORTANT: these tests assert the CURRENT (buggy) behavior so they pass
// against unmodified code and prove each defect is real. When a defect is
// fixed, flip the marked assertions so the test becomes a regression test.
//
// Run with:
//   deno test --allow-all livecode/tests/repro/engine_repro_test.ts

import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  awaitBarrier,
  type CancelablePromiseProxy,
  launch,
  resolveBarrier,
  startBarrier,
  TempoMap,
} from "@avtools/core-timing";
import { sleep } from "../test_helpers.ts";

/**
 * Collects unhandledrejection events and prevents them from killing the
 * process (which is exactly what they would do in the real server).
 */
function trapUnhandledRejections() {
  const events: unknown[] = [];
  const listener = (event: PromiseRejectionEvent) => {
    event.preventDefault();
    events.push(event.reason);
  };
  globalThis.addEventListener("unhandledrejection", listener);
  return {
    events,
    dispose: () =>
      globalThis.removeEventListener("unhandledrejection", listener),
  };
}

Deno.test({
  name:
    "BUG E1: cancelling a root context emits an unhandled rejection (fatal in Deno without a trap)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const trap = trapUnhandledRejections();
    try {
      // Root parked on an engine wait, like the server parent loop or any
      // launched module tree.
      const handle = launch(async (ctx) => {
        await ctx.waitSec(60);
      });
      await sleep(30);
      handle.cancel();
      // Give the rejection time to be reported.
      await sleep(150);

      assertEquals(trap.events.length, 0);
    } finally {
      trap.dispose();
    }
  },
});

Deno.test({
  name:
    "BUG E2: branch(...).finally(fn) emits an unhandled rejection when the branch is cancelled",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const trap = trapUnhandledRejections();
    try {
      let cleanupRan = false;
      const handle = launch(async (ctx) => {
        const branchHandle = ctx.branch(async (childCtx) => {
          await childCtx.waitSec(60);
        });
        // The obvious user API for cleanup-on-stop. The returned derived
        // promise is discarded, exactly as typical user code does.
        branchHandle.finally(() => {
          cleanupRan = true;
        });
        await ctx.waitSec(0.05);
        branchHandle.cancel();
        await ctx.waitSec(0.05);
      });
      await handle;
      await sleep(150);

      assert(cleanupRan, "finally callback itself does run");
      assertEquals(trap.events.length, 0);
    } finally {
      trap.dispose();
    }
  },
});

Deno.test({
  name:
    "BUG E3: cancelling a branchWait child rejects the awaiting parent block (parent dies too)",
  sanitizeOps: false,
  sanitizeResources: false,
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

      await sleep(50);
      const proxy = childProxy as CancelablePromiseProxy<void> | null;
      assert(proxy !== null);
      proxy.cancel(); // targeted stop of ONE sub-process
      await rootSettled;
      await sleep(100);

      // BUGGY BEHAVIOR: the parent block is torn down by the child's
      // cancellation instead of being notified in a catchable, typed way.
      assertEquals(parentReachedEnd, false);
      assert(
        rootRejection instanceof Error,
        "parent/root block rejected because its branchWait child was cancelled",
      );
    } finally {
      trap.dispose();
    }
  },
});

Deno.test({
  name:
    "E3 addendum (fixed): cancelSafe(value) settles the awaiting parent with the value instead of rejecting",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const trap = trapUnhandledRejections();
    try {
      let received = -1;
      let parentReachedEnd = false;
      let numberProxy: CancelablePromiseProxy<number> | null = null;
      let voidProxy: CancelablePromiseProxy<void> | null = null;
      let voidJoinCompleted = false;

      const handle = launch(async (ctx) => {
        numberProxy = ctx.branchWait<number>(async (childCtx) => {
          await childCtx.waitSec(60);
          return 1;
        });
        received = await numberProxy; // resolves via cancelSafe(42)

        voidProxy = ctx.branchWait(async (childCtx) => {
          await childCtx.waitSec(60);
        });
        await voidProxy; // resolves via argless cancelSafe()
        voidJoinCompleted = true;
        parentReachedEnd = true;
      });

      await sleep(50);
      (numberProxy as CancelablePromiseProxy<number> | null)!.cancelSafe(42);
      await sleep(50);
      (voidProxy as CancelablePromiseProxy<void> | null)!.cancelSafe();
      await handle;
      await sleep(100);

      assertEquals(received, 42, "parent received the cancelSafe value");
      assertEquals(voidJoinCompleted, true);
      assertEquals(parentReachedEnd, true, "parent kept running after both");
      assertEquals(
        trap.events.length,
        0,
        "no unhandled rejections from cancelSafe teardown",
      );
    } finally {
      trap.dispose();
    }
  },
});

Deno.test({
  name:
    "BUG E4: no catch-up clamp — after an event-loop stall, overdue waits fire in a zero-delay burst",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const trap = trapUnhandledRejections();
    try {
      const stamps: number[] = [];
      const WAITS = 30;
      const STEP_SEC = 0.03;
      const handle = launch(async (ctx) => {
        for (let i = 0; i < WAITS; i++) {
          await ctx.waitSec(STEP_SEC);
          stamps.push(performance.now());
        }
      });

      // Let a few waits fire normally, then stall the event loop ~500ms
      // (stands in for a GC pause or heavy user code).
      await sleep(120);
      const stallStart = performance.now();
      while (performance.now() - stallStart < 500) {
        // busy-wait
      }
      await handle;

      // Count the longest run of consecutive inter-wait gaps under 15ms.
      // Nominal spacing is 30ms; a burst means the engine replayed overdue
      // slices back-to-back with zero wall delay.
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

      // BUGGY BEHAVIOR (for a live instrument): ~16 overdue waits replay as a
      // machine-gun burst. AFTER FIX (catch-up clamp/coalesce policy): expect
      // longestBurst to be small (e.g. < 4) or events to be dropped/merged.
      assert(
        longestBurst >= 8,
        `expected a catch-up burst of >=8 back-to-back waits, got ${longestBurst}`,
      );
    } finally {
      trap.dispose();
    }
  },
});

Deno.test({
  name:
    "BUG E5: global mostRecentDescendentTime floor — a module resuming from a non-engine await jumps forward",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const trap = trapUnhandledRejections();
    try {
      let bTimeBeforeWait = -1;
      let bTimeAfterWait = -1;

      const handle = launch(async (ctx) => {
        // Module A: keeps advancing global logical time.
        ctx.branch(async (a) => {
          for (let i = 0; i < 8; i++) {
            await a.waitSec(0.05);
          }
        });
        // Module B: suspends on a NON-engine await (e.g. fetch / fs / device
        // IO) for 300ms, then asks for a small engine wait.
        await ctx.branchWait(async (b) => {
          await sleep(300);
          bTimeBeforeWait = b.time;
          await b.waitSec(0.05);
          bTimeAfterWait = b.time;
        });
      });
      await handle;
      await sleep(250); // let branch A finish its remaining waits

      // B accumulated no logical time while suspended...
      assert(
        bTimeBeforeWait < 0.05,
        `B's logical time before its wait should be ~0, got ${bTimeBeforeWait}`,
      );
      // BUGGY/DEBATABLE BEHAVIOR: ...but its 0.05s wait lands relative to the
      // GLOBAL max (~0.3s), not its own timeline — a silent 0.25s jump.
      // If per-module baselines are adopted, flip this to assert
      // bTimeAfterWait is close to 0.05.
      assert(
        bTimeAfterWait > 0.25,
        `B's wait was rebased onto the global max; expected > 0.25, got ${bTimeAfterWait}`,
      );
    } finally {
      trap.dispose();
    }
  },
});

Deno.test({
  name:
    "BUG E6: tempo map segments grow unbounded — every setBpm appends a segment forever",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const trap = trapUnhandledRejections();
    try {
      let segsBefore = -1;
      let segsAfter = -1;
      let continuityError = "";
      const handle = launch(async (ctx) => {
        const tempoAny = ctx.tempo as unknown as {
          segs: Array<{
            t0: number;
            t1: number;
            beats0: number;
            beats1: number;
          }>;
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
            Math.abs(tempoAny.segs[i - 1].beats1 - tempoAny.segs[i].beats0) >=
              1e-9
          ) {
            continuityError = `tempo segment ${i} beat continuity broke`;
            break;
          }
        }
      });
      await handle;

      assertEquals(continuityError, "");
      // AFTER FIX: old history is compacted while recent history and future
      // beat continuity remain intact.
      assert(
        segsAfter - segsBefore <= 18,
        `expected bounded tempo history, got ${
          segsAfter - segsBefore
        } new segments`,
      );
    } finally {
      trap.dispose();
    }
  },
});

Deno.test("tempo compaction preserves post-boundary beat mapping", () => {
  const tempo = new TempoMap(120);
  for (let i = 1; i <= 24; i++) {
    tempo._setBpmAtTime(80 + i, i * 0.1);
  }

  const probeTime = 2.41;
  const beatsAtProbe = tempo.beatsAtTime(probeTime);
  tempo._setBpmAtTime(150, 2.5);

  assert(
    Math.abs(tempo.beatsAtTime(probeTime) - beatsAtProbe) < 1e-9,
    "compaction must preserve beat mapping for times after the retained boundary",
  );
});

Deno.test({
  name:
    "BUG E11 (fixed): long-lived branch progBeats stays continuous across tempo-history compaction",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const trap = trapUnhandledRejections();
    try {
      // Each sample pairs the long-lived branch's logical time with its progBeats.
      // Tying beats to elapsed time makes the check robust to scheduler catch-up:
      // beats can only accrue at the current tempo, so during the SLOW recording
      // window a legitimate step satisfies deltaBeats <= (slowBpm/60) * deltaTime.
      //
      // The tempo profile is deliberately FAST-before-branch, SLOW-after: the
      // branch's startTime lands in the fast region, so once history compaction
      // merges that region into a single averaged (much slower) segment, the
      // engine's OLD progBeats (which recomputed beatsAtTime(startTime) live)
      // saw beatsAtTime(startTime) collapse downward, inflating progBeats by
      // ~10x the physical beats for a step. The cached-startBeats fix freezes the
      // exact pre-compaction origin, so progBeats tracks elapsed beats exactly.
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

        // SLOW from here on, hammering setBpm to push the tempo history well past
        // the 16-segment compaction threshold. This moves the compaction boundary
        // past the branch's (fast-region) startTime mid-run.
        for (let i = 0; i < 55; i++) {
          ctx.setBpm(slowBpm);
          await ctx.waitSec(0.018);
        }

        await branch.finally(() => {});
      });

      await handle;

      assert(
        samples.length >= 30,
        `expected long-lived branch to record progBeats, got ${samples.length}`,
      );
      for (let i = 1; i < samples.length; i++) {
        const deltaBeats = samples[i].pb - samples[i - 1].pb;
        const deltaTime = samples[i].t - samples[i - 1].t;
        assert(
          deltaBeats >= -1e-9,
          `progBeats must be non-decreasing, saw ${deltaBeats} at step ${i}`,
        );
        // The whole recording window runs at slowBpm; allow 3x headroom for any
        // scheduler catch-up. The old compaction bug produced steps up to ~15x
        // this bound.
        const maxBeats = (slowBpm / 60) * Math.max(0, deltaTime) * 3 + 1e-6;
        assert(
          deltaBeats <= maxBeats,
          `progBeats delta ${deltaBeats} at step ${i} exceeds what ${deltaTime}s ` +
            `at bpm~${slowBpm} can produce (${maxBeats}) — compaction discontinuity`,
        );
      }
    } finally {
      trap.dispose();
    }
  },
});

Deno.test({
  name:
    "BUG E7: scheduler beatPQs map leaks one entry per cancelled cloned-tempo branch",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const trap = trapUnhandledRejections();
    try {
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
        // deno-lint-ignore no-explicit-any
        beatPQCount = (ctx.scheduler as any).beatPQs.size;
      });
      await handle;
      await sleep(100);

      // AFTER FIX: beatPQs entries for dead cloned tempoIds are deleted.
      assert(
        beatPQCount <= 1,
        `expected leaked beatPQ entries to be cleaned up, got ${beatPQCount}`,
      );
    } finally {
      trap.dispose();
    }
  },
});

Deno.test({
  name:
    "BUG E8: wait(0) resolves without advancing logical time — a wait(0) loop spins the CPU forever",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const trap = trapUnhandledRejections();
    try {
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

      assertEquals(iterations, 300);
      // The core hazard: 300 awaited waits, zero logical progress. In user
      // code, `while (true) { await ctx.wait(0) }` never terminates logically
      // and starves the scheduler.
      assertEquals(finalLogicalTime, 0);
      assert(
        wallMs < 5000,
        `wait(0) loop should complete fast (unthrottled), took ${wallMs}ms`,
      );
    } finally {
      trap.dispose();
    }
  },
});

Deno.test({
  name:
    "E8 guard (fixed): a wait(0) hot loop errors out via the zero-advance stall guard while sibling timing continues",
  sanitizeOps: false,
  sanitizeResources: false,
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
      await sleep(100);

      // The spinner is rejected with the stall error once it exceeds
      // MAX_ZERO_ADVANCE_SLICES consecutive zero-advance slices...
      assert(
        spinError instanceof Error &&
          spinError.message.includes("Logical time stalled"),
        `expected zero-advance stall error, got: ${String(spinError)}`,
      );
      assert(
        spinIterations >= 9_000,
        `spinner should run up to the guard threshold, got ${spinIterations}`,
      );
      // ...and the sibling's ordinary waits all fire (previously they were
      // starved forever — a 100ms schedule never completed).
      assertEquals(siblingStamps.length, 5);
      assertEquals(
        trap.events.length,
        0,
        "no unhandled rejections from the stall teardown",
      );
    } finally {
      trap.dispose();
    }
  },
});

Deno.test({
  name:
    "E9 (by design): awaitBarrier on a never-started barrier releases immediately (barriers are an optional sync overlay)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const trap = trapUnhandledRejections();
    try {
      let elapsedMs = -1;
      const handle = launch(async (ctx) => {
        const t0 = performance.now();
        await awaitBarrier("repro-never-started", ctx);
        elapsedMs = performance.now() - t0;
      });
      await handle;

      // INTENDED BEHAVIOR (owner decision, 2026-07): a barrier that no
      // producer has started imposes no sync constraint — consumers free-run
      // until a producer exists, then sync engages on their next await. The
      // typo'd-name / dead-producer case should be surfaced via runtime
      // visualization (barrier state in snapshots), not by changing this.
      assert(
        elapsedMs >= 0 && elapsedMs < 50,
        `awaitBarrier on a missing barrier should release immediately (${elapsedMs}ms)`,
      );
    } finally {
      trap.dispose();
    }
  },
});

Deno.test({
  name:
    "E10 (fixed): startBarrier adopts an in-progress cycle; only resolveBarrier releases waiters",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const trap = trapUnhandledRejections();
    try {
      let releasedAfterSecondStart = false;
      let releasedAfterResolve = false;
      let releasedBeforeSecondStart = true;
      const handle = launch(async (ctx) => {
        startBarrier("repro-cycle", ctx);
        let released = false;
        ctx.branch(async (c) => {
          await awaitBarrier("repro-cycle", c);
          released = true;
        });
        await ctx.waitSec(0.05);
        releasedBeforeSecondStart = released; // should still be parked

        // A replaced/relaunched producer module calls startBarrier again while
        // the previous cycle is still in progress. It must ADOPT the cycle,
        // not force-release the parked waiters.
        startBarrier("repro-cycle", ctx);
        await ctx.waitSec(0.05);
        releasedAfterSecondStart = released;

        // Only an explicit resolveBarrier releases them.
        resolveBarrier("repro-cycle", ctx);
        await ctx.waitSec(0.05);
        releasedAfterResolve = released;
      });
      await handle;

      assertEquals(
        releasedBeforeSecondStart,
        false,
        "waiter is parked before the second startBarrier",
      );
      assertEquals(
        releasedAfterSecondStart,
        false,
        "startBarrier on an in-progress cycle adopts it instead of releasing waiters",
      );
      assertEquals(
        releasedAfterResolve,
        true,
        "explicit resolveBarrier releases the adopted cycle's waiters",
      );
    } finally {
      trap.dispose();
    }
  },
});
