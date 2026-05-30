export const DEFAULT_LIVECODE_SOURCE = `import type { TimeContext } from "@avtools/core-timing";

async function logWait(ctx: TimeContext, label: string, seconds: number) {
  console.log("[livecode]", label, "start");
  await ctx.waitSec(seconds);
  console.log("[livecode]", label, "done");
}

export default async function(ctx: TimeContext) {
  console.log("[livecode] root start");
  await logWait(ctx, "first", 0.4);
  await ctx.waitSec(0.25);
  await logWait(ctx, "second", 0.4);
  console.log("[livecode] root done");
}
`
