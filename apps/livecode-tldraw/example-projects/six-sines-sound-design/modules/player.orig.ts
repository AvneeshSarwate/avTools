import type { TimeContext } from "@avtools/core-timing";
import { getPianoRoll } from "piano-roll-store";
import {
  getControls,
  playPianoRollWithSixSines,
  stopSixSines,
} from "./instrument.ts";

export default async function play(ctx: TimeContext) {
  const controls = getControls();
  ctx.abortController.signal.addEventListener("abort", stopSixSines, {
    once: true,
  });
  try {
    while (true) {
      const phrase = getPianoRoll("sound-design/phrase");
      if (!phrase || !phrase.data.notes.length) {
        await ctx.waitSec(0.25);
        continue;
      }
      await playPianoRollWithSixSines(ctx, phrase, controls.playback);
    }
  } finally {
    ctx.abortController.signal.removeEventListener("abort", stopSixSines);
    stopSixSines();
  }
}
export function stop() {
  stopSixSines();
}
