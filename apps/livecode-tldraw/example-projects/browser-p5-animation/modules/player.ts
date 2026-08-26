import { visualizedAwait as __tcvVisualizedAwait, visualizedPianoRollLookup as __tcvPianoRollLookup, visualizedOwnedSignal as __tcvOwnedSignal } from "/engine/runtime.js";
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

export async function runFunc (ctx: TimeContext) {
  const playhead = __tcvOwnedSignal("p5-anim/player", "da28cb29-34b4-495f-8ecd-2a867f1ec756", signal<number>("p5-anim/playhead"));
  playhead.addAnchor({ type: "animationTimeline", name: "p5-anim_xy" });
  while (true) {
    const t = ctx.time % DURATION_SEC;
    playhead.set(t);
    const sample = timeline.sample(t).numbers;
    circle.x = sample.x ?? 0.5;
    circle.y = sample.y ?? 0.5;
    await __tcvVisualizedAwait("p5-anim/player", "a44cd77a-0fba-4cc8-beb5-f6b150d65b58", ctx.waitSec(1 / 60));
  }
}

export default runFunc;
