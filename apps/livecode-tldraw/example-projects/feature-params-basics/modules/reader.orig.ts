import type { TimeContext } from "@avtools/core-timing";
import { signal } from "canvas-signals";
import { panel } from "./panel.ts";

/**
 * Loop-rate reader: derives a value from the shared params on every tick and
 * publishes it as a plain numeric ephemeral signal. The checked-in scope view
 * watches it; muting the pane's `mix.muted` checkbox pins it to exactly 0.
 * Declaring the signal inside the root re-clears `ended` on every (re)launch.
 */
export default async function (ctx: TimeContext) {
  const derived = signal<number>("params-basics/derived");
  while (true) {
    const value = panel.mix.muted ? 0 : panel.monitor.level * panel.mix.gain;
    derived.set(value);
    await ctx.waitSec(1 / 20);
  }
}
