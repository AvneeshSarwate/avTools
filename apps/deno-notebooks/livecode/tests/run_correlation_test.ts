import { assertEquals } from "jsr:@std/assert@1";
import {
  acknowledgeRunLaunch,
  beginRunLaunch,
  createRunCorrelation,
  shouldApplyRun,
} from "../../../livecode-tldraw/src/runCorrelation.ts";

Deno.test("a launch acknowledgement selects the matching run across HTTP and sync", () => {
  const correlation = createRunCorrelation();
  beginRunLaunch(correlation);

  assertEquals(
    shouldApplyRun(correlation, { state: "stopped", runToken: "old" }),
    false,
  );

  acknowledgeRunLaunch(correlation, "accepted");
  assertEquals(
    shouldApplyRun(correlation, { state: "stopped", runToken: "old" }),
    false,
  );
  assertEquals(
    shouldApplyRun(correlation, { state: "error", runToken: "accepted" }),
    true,
  );
});

Deno.test("server run truth applies directly when no local launch is crossing transports", () => {
  const correlation = createRunCorrelation();
  assertEquals(
    shouldApplyRun(correlation, { state: "error", runToken: "headless" }),
    true,
  );
});
