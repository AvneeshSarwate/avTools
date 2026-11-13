import type { TimeContext } from "@avtools/core-timing";
import { state } from "./state.ts";

export default async function (ctx: TimeContext) {
  state.count += 1;
  state.lastUpdatedBy = "increment module";
  console.log(`[basic-multi-module] count is now ${state.count}`);
  await ctx.waitSec(0.25);
}
