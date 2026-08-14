import { assertEquals } from "jsr:@std/assert@1";
import {
  claimRun,
  createRunDedupeMemory,
  observeActiveRun,
  releaseRunClaim,
  type RunDedupeRun,
  seedRehydratedRun,
  shouldApplyTerminalRun,
} from "../../../livecode-tldraw/src/runDedupe.ts";

// The tldraw client's terminal-run dedupe. It lives in the client because only
// the client knows what IT claimed, but the orderings that break it are
// transport orderings — a superseded run's terminal straddling a replacement, a
// launch conflated with an instant error inside one 33 ms tick — and neither is
// reproducible on demand through a browser. The rule is a pure, import-free
// module for exactly this reason: it is testable at the ordering level here,
// and the browser E2E covers the user-visible outcomes on top.

const run = (state: RunDedupeRun["state"], runToken: string): RunDedupeRun => ({
  state,
  runToken,
});

Deno.test("a run's own terminal applies after the client watched it go active", () => {
  const memory = createRunDedupeMemory();
  claimRun(memory);
  observeActiveRun(memory, run("launching", "t1"));
  observeActiveRun(memory, run("running", "t1"));
  assertEquals(shouldApplyTerminalRun(memory, run("stopped", "t1")), true);
});

Deno.test("an edit drops the claim without forgetting the run still out there", () => {
  // The natural-completion case: the module is edited mid-run, so the claim on
  // the running build goes, but that run is still going and its terminal is the
  // only thing that will ever move this module off `running`.
  const memory = createRunDedupeMemory();
  claimRun(memory);
  observeActiveRun(memory, run("running", "t1"));
  releaseRunClaim(memory);
  assertEquals(shouldApplyTerminalRun(memory, run("stopped", "t1")), true);
});

Deno.test("the straddle: a superseded run's terminal never retires its replacement", () => {
  const memory = createRunDedupeMemory();
  claimRun(memory);
  observeActiveRun(memory, run("running", "t1"));

  // Replace: the claim is staked BEFORE the post, so everything watched go
  // active up to this instant belongs to the run being replaced.
  claimRun(memory);

  // The server stops the old run and starts the new one. The old terminal and
  // the new `launching` can arrive in either order, and neither ordering may
  // leave the module reading `stopped` while the replacement runs.
  assertEquals(
    shouldApplyTerminalRun(memory, run("stopped", "t1")),
    false,
    "the replaced run's terminal is old news",
  );
  observeActiveRun(memory, run("launching", "t2"));
  assertEquals(shouldApplyTerminalRun(memory, run("stopped", "t1")), false);
  assertEquals(
    shouldApplyTerminalRun(memory, run("stopped", "t2")),
    true,
    "the replacement's own terminal still applies",
  );

  // `generatedRunId` could not do this job: a relaunch of an unchanged build
  // reuses it, so both runs would look identical. Two replacements deep, the
  // first run's late terminal is still suppressed.
  claimRun(memory);
  observeActiveRun(memory, run("running", "t3"));
  assertEquals(shouldApplyTerminalRun(memory, run("stopped", "t1")), false);
  assertEquals(shouldApplyTerminalRun(memory, run("stopped", "t2")), false);
});

Deno.test("the instant failure: a launch conflated with an error still applies", () => {
  // Tick coalescing is real — `launching` can be skipped entirely when the next
  // state lands inside the same 33 ms tick. A module that throws immediately
  // therefore reaches the client as ONE terminal under a token nothing ever saw
  // active. Swallowing it would leave the module at `running` forever.
  const memory = createRunDedupeMemory();
  claimRun(memory);
  assertEquals(shouldApplyTerminalRun(memory, run("error", "t1")), true);

  // Same shape after a replacement: the old run is suppressed, the conflated
  // new one is not.
  const replaced = createRunDedupeMemory();
  claimRun(replaced);
  observeActiveRun(replaced, run("running", "old"));
  claimRun(replaced);
  assertEquals(shouldApplyTerminalRun(replaced, run("stopped", "old")), false);
  assertEquals(shouldApplyTerminalRun(replaced, run("error", "new")), true);
});

Deno.test("with a claim already seen active, a stranger's terminal is suppressed", () => {
  const memory = createRunDedupeMemory();
  claimRun(memory);
  observeActiveRun(memory, run("running", "t1"));
  assertEquals(
    shouldApplyTerminalRun(memory, run("stopped", "unrelated")),
    false,
  );
});

Deno.test("with no claim at all, a terminal is server truth", () => {
  const memory = createRunDedupeMemory();
  assertEquals(shouldApplyTerminalRun(memory, run("stopped", "t1")), true);
  assertEquals(shouldApplyTerminalRun(memory, run("error", "whatever")), true);
});

Deno.test("rehydration seeds the memory an active run's terminal needs", () => {
  // A reload leaves the client having watched nothing go active. `/runtime/state`
  // carries the token so the running run is adopted, and a Replace over it
  // suppresses its terminal exactly as if the client had watched it start.
  const memory = createRunDedupeMemory();
  seedRehydratedRun(memory, run("running", "t1"));
  assertEquals(shouldApplyTerminalRun(memory, run("stopped", "t1")), true);

  claimRun(memory);
  assertEquals(shouldApplyTerminalRun(memory, run("stopped", "t1")), false);
  observeActiveRun(memory, run("running", "t2"));
  assertEquals(shouldApplyTerminalRun(memory, run("stopped", "t2")), true);
});

Deno.test("rehydrating an already-terminal run cannot retire a later claim", () => {
  const memory = createRunDedupeMemory();
  seedRehydratedRun(memory, run("stopped", "t1"));
  claimRun(memory);
  assertEquals(
    shouldApplyTerminalRun(memory, run("stopped", "t1")),
    false,
    "a run that had already ended at rehydration is superseded by construction",
  );
  assertEquals(
    shouldApplyTerminalRun(memory, run("error", "t2")),
    true,
    "the new claim's own conflated failure still applies",
  );
});

Deno.test("a superseded run reporting itself active is not re-adopted", () => {
  // Between a Replace post and the old branch actually unwinding, the server can
  // still publish the old run as `running`. Re-adopting its token there would
  // make its own terminal applicable again and undo the whole guard.
  const memory = createRunDedupeMemory();
  claimRun(memory);
  observeActiveRun(memory, run("running", "t1"));
  claimRun(memory);
  observeActiveRun(memory, run("running", "t1"));
  assertEquals(shouldApplyTerminalRun(memory, run("stopped", "t1")), false);
});
