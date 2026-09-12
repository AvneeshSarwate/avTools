import type { TimeContext } from "@avtools/core-timing";
import { getControls, soundState } from "./instrument.ts";

export default async function panLfos(ctx: TimeContext) {
  const controls = getControls();
  const sound = soundState();
  const toggles = ["op1", "op2", "op3", "op4", "op5", "op6"] as const;
  const centers = new Map<number, number>();
  const restore = () => {
    for (const [id, center] of centers) sound.values[id] = center;
    centers.clear();
  };
  ctx.abortController.signal.addEventListener("abort", restore, { once: true });
  try {
    while (true) {
      for (let i = 0; i < toggles.length; i++) {
        const id = 20015 + 100 * i; // Native operator mixer-pan parameter IDs.
        if (controls.pan[toggles[i]!]) {
          if (!centers.has(id)) centers.set(id, sound.values[id] ?? 0);
          const phase = ctx.time * controls.pan.rateHz * (1 + i * 0.2) + i / 6;
          sound.values[id] = Math.max(
            -1,
            Math.min(
              1,
              centers.get(id)! +
                controls.pan.depth * Math.sin(2 * Math.PI * phase),
            ),
          );
        } else if (centers.has(id)) {
          sound.values[id] = centers.get(id)!;
          centers.delete(id);
        }
      }
      await ctx.waitSec(1 / 60);
    }
  } finally {
    ctx.abortController.signal.removeEventListener("abort", restore);
    restore();
  }
}
