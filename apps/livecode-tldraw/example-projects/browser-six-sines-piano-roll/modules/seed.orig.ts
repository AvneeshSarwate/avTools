import type { TimeContext } from "@avtools/core-timing";
import { setPianoRollClip } from "piano-roll-helpers";

/** Create an editable four-beat phrase for the AudioWorklet synth player. */
export default async function seedSixSinesLoop(ctx: TimeContext) {
  setPianoRollClip("six-sines/loop", {
    notes: [
      { id: "sine-1", pitch: 48, position: 0, duration: 0.9, velocity: 112 },
      { id: "sine-2", pitch: 55, position: 1, duration: 0.75, velocity: 96 },
      { id: "sine-3", pitch: 58, position: 2, duration: 0.75, velocity: 100 },
      { id: "sine-4", pitch: 63, position: 3, duration: 0.9, velocity: 108 },
    ],
  });
  console.log("[six-sines] seeded six-sines/loop");
  await ctx.waitSec(0.1);
}
