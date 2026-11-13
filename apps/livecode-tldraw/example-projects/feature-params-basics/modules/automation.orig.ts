import type { TimeContext } from "@avtools/core-timing";
import { panel } from "./panel.ts";

/**
 * Code-driven automation: writes the shared params object at ~30 Hz. The
 * server sampler adopts changed values (`updatedBy: "code"`), so the pane's
 * `monitor.level` graph row animates while this runs. `osc.freq` and
 * `osc.amp` are read back at the same loop rate, so pane edits to them
 * reshape the sine immediately.
 */
export default async function (ctx: TimeContext) {
  let phase = 0;
  while (true) {
    if (!panel.mix.muted) {
      panel.monitor.level = Math.sin(phase) * panel.osc.amp;
    }
    phase += (2 * Math.PI * panel.osc.freq) / 30;
    await ctx.waitSec(1 / 30);
  }
}
