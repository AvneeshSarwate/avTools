// Browser-engine slice fixture: one instrumented wait loop publishing one
// signal, so the E2E can observe run lifecycle, wait callsites, and signal
// samples through the BroadcastChannel sync host.
import type { TimeContext } from "@avtools/core-timing";
import { signal } from "canvas-signals";

export default async function run(ctx: TimeContext) {
  const heartbeat = signal("slice/heartbeat");
  let beat = 0;
  while (true) {
    heartbeat.set(beat++);
    await ctx.waitSec(0.05);
  }
}
