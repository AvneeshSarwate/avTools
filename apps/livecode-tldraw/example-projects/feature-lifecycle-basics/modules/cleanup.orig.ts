import type { TimeContext } from "@avtools/core-timing";
import { canvasParams } from "canvas-params";

const status = canvasParams(
  "lifecycle/cleanup",
  { ticks: 0, stops: 0, lastStop: "never" },
  {
    ticks: { label: "ticks while running" },
    stops: { label: "graceful stops seen" },
    lastStop: { label: "last stop at" },
  },
);

export default async function (ctx: TimeContext) {
  while (true) {
    status.ticks += 1;
    await ctx.waitSec(0.25);
  }
}

/**
 * Graceful-stop hook: the server runs it on Stop, Replace, stop-all, and
 * server close (not panic), with a two-second budget. Its effect lands in the
 * `lifecycle/cleanup` pane — `stops` increments and `lastStop` gets a
 * timestamp — because the params entity outlives the run that declared it.
 */
export function stop() {
  status.stops += 1;
  status.lastStop = new Date().toISOString();
  console.log("[lifecycle-basics] cleanup stop() ran");
}
