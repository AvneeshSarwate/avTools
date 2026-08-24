import type { TimeContext } from "@avtools/core-timing";
import { animationTimeline } from "animation-timeline";
import { signal } from "canvas-signals";

const timeline = animationTimeline("animation-fixture/timeline");

export default async function (ctx: TimeContext) {
  const gain = signal<number>("animation-fixture/gain");
  while (true) {
    const phase = ctx.time % 4;
    gain.set(timeline.sample(phase).numbers.gain ?? 0);
    await ctx.waitSec(1 / 30);
  }
}
