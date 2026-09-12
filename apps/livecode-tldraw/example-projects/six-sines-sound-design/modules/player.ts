import { visualizedAwait as __tcvVisualizedAwait, visualizedPianoRollLookup as __tcvPianoRollLookup, visualizedOwnedSignal as __tcvOwnedSignal } from "/engine/runtime.js";
import type { TimeContext } from "@avtools/core-timing";
import { getPianoRoll } from "piano-roll-store";
import {
  getControls,
  playPianoRollWithSixSines,
  stopSixSines,
} from "./instrument.ts";

export async function runFunc(ctx: TimeContext) {
  const controls = getControls();
  ctx.abortController.signal.addEventListener("abort", stopSixSines, {
    once: true,
  });
  try {
    while (true) {
      const phrase = getPianoRoll(__tcvPianoRollLookup("sound-design/player", "a9254339-3abe-4ad2-966b-cb9f7a11973b", "sound-design/phrase"));
      if (!phrase || !phrase.data.notes.length) {
        await __tcvVisualizedAwait("sound-design/player", "1a3e52bd-9282-439b-86d7-59642d9b6cc4", ctx.waitSec(0.25));
        continue;
      }
      await __tcvVisualizedAwait("sound-design/player", "2bab6479-a74d-45e7-9a89-95f12d61c4bd", playPianoRollWithSixSines(ctx, phrase, controls.playback));
    }
  } finally {
    ctx.abortController.signal.removeEventListener("abort", stopSixSines);
    stopSixSines();
  }
}
const play = runFunc;

export function stop() {
  stopSixSines();
}

export default runFunc;
