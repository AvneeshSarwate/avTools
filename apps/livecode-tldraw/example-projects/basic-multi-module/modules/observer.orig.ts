import type { TimeContext } from "@avtools/core-timing";
import { state } from "./state.ts";

export default async function (ctx: TimeContext) {
  while (true) {
    console.log(
      `[basic-multi-module] observed ${state.count} from ${state.lastUpdatedBy}`,
    );
    await ctx.waitSec(1);
  }
}
