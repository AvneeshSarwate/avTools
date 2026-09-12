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
      const phrase = getPianoRoll(__tcvPianoRollLookup("sound-design/player", "ff3062f0-47cf-4596-ae6f-0151363322a0", "sound-design/phrase"));
      if (!phrase || !phrase.data.notes.length) {
        await __tcvVisualizedAwait("sound-design/player", "f01d4453-e69a-4e35-98c5-59fc168a2d83", ctx.waitSec(0.25));
        continue;
      }
      await __tcvVisualizedAwait("sound-design/player", "c3496e54-464d-4467-b23f-6e39a539d355", playPianoRollWithSixSines(ctx, phrase, controls.playback));
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
