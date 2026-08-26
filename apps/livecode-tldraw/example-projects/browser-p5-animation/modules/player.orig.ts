import type { TimeContext } from "@avtools/core-timing";
import { animationTimeline } from "animation-timeline";
import { signal } from "canvas-signals";
import { circle } from "./state.ts";

/**
 * Loops the `p5-anim_xy` timeline: every tick it samples the x/y tracks into
 * the shared circle position and moves a playhead signal anchored to the
 * timeline, so the animation editor shows where playback is. Edit the curves
 * while this runs — the next sample picks them up. (The timeline name avoids
 * "/" so its saved data file needs no escape encoding.)
 */
const timeline = animationTimeline("p5-anim_xy");
const DURATION_SEC = 4;

export default async function (ctx: TimeContext) {
  const playhead = signal<number>("p5-anim/playhead");
  playhead.addAnchor({ type: "animationTimeline", name: "p5-anim_xy" });
  while (true) {
    const t = ctx.time % DURATION_SEC;
    playhead.set(t);
    const sample = timeline.sample(t).numbers;
    circle.x = sample.x ?? 0.5;
    circle.y = sample.y ?? 0.5;
    await ctx.waitSec(1 / 60);
  }
}
