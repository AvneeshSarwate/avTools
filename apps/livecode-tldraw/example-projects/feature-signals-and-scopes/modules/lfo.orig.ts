import type { TimeContext } from "@avtools/core-timing";
import { signal } from "canvas-signals";

/**
 * A plain numeric ephemeral signal for a scope: a slow sine published at
 * 20 Hz. No anchor — a scope binds by name alone. The transport samples at
 * 100 ms, so the scope trace shows the conflated ~10 Hz view by design.
 */
export default async function (ctx: TimeContext) {
  const lfo = signal<number>("signals/lfo");
  let phase = 0;
  while (true) {
    lfo.set(Math.sin(phase));
    phase += (2 * Math.PI * 0.2) / 20;
    await ctx.waitSec(1 / 20);
  }
}
