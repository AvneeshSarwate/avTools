import type { TimeContext } from "@avtools/core-timing";

/**
 * Ends on its own after four counted beats: watch the run status go
 * running → stopped with no Stop click, while the active-wait highlight
 * walks the loop. Run it again freely — every run is a fresh two-second pass.
 */
export default async function (ctx: TimeContext) {
  for (let beat = 1; beat <= 4; beat++) {
    console.log(`[lifecycle-basics] beat ${beat}/4`);
    await ctx.waitSec(0.5);
  }
  console.log("[lifecycle-basics] finite module done");
}
