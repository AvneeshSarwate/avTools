import { assertEquals } from "jsr:@std/assert@1";
import {
  acknowledgeRunLaunch,
  beginRunLaunch,
  correlateRun,
  createRunCorrelation,
} from "../../../livecode-tldraw/src/runCorrelation.ts";

Deno.test("a launch acknowledgement selects the matching run across HTTP and sync", () => {
  let correlation = createRunCorrelation();
  correlation = beginRunLaunch();

  let decision = correlateRun(correlation, {
    state: "stopped",
    runToken: "old",
  });
  assertEquals(decision.apply, false);
  correlation = decision.next;

  correlation = acknowledgeRunLaunch("accepted");
  decision = correlateRun(correlation, {
    state: "stopped",
    runToken: "old",
  });
  assertEquals(decision.apply, false);
  correlation = decision.next;

  decision = correlateRun(correlation, {
    state: "error",
    runToken: "accepted",
  });
  assertEquals(decision.apply, true);
  assertEquals(decision.next, { phase: "observing" });
});

Deno.test("server run truth applies directly when no local launch is crossing transports", () => {
  const correlation = createRunCorrelation();
  const decision = correlateRun(correlation, {
    state: "error",
    runToken: "headless",
  });
  assertEquals(decision.apply, true);
  assertEquals(decision.next, correlation);
});
