import type { TimeContext } from "@avtools/core-timing";
import { canvasParams } from "canvas-params";

/**
 * Infinite heartbeat for Replace testing. The params entity survives a
 * relaunch — declaration reattaches instead of resetting — so `heartbeat`
 * keeps counting across a Replace while `lastLaunch` stamps each new run.
 */
const status = canvasParams(
  "lifecycle/steady",
  { heartbeat: 0, lastLaunch: "never" },
  {
    heartbeat: { label: "heartbeat (survives Replace)" },
    lastLaunch: { label: "last launch" },
  },
);

export default async function (ctx: TimeContext) {
  status.lastLaunch = new Date().toISOString();
  while (true) {
    status.heartbeat += 1;
    await ctx.waitSec(0.25);
  }
}
