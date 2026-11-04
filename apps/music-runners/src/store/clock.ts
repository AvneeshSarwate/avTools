// One shared root TimeContext for the whole page. Every running instance is a
// branch of it, so they share one tempo map and one logical timeline. The root
// heartbeats so that a branch started after a quiet spell begins at "now"
// rather than at the last processed logical time (branches start at
// root.mostRecentDescendentTime, and logical time only advances on waits).
import { type BrowserTimeContext, launchBrowser, type TimeContext } from "@avtools/core-timing";
import { proxy } from "valtio";
import { DEFAULT_BPM } from "../model/types";

export const clockStore = proxy<{ bpm: number; started: boolean }>({ bpm: DEFAULT_BPM, started: false });

let root: BrowserTimeContext | null = null;

export function getRootContext(): TimeContext {
  if (root) return root;
  launchBrowser(async (ctx) => {
    root = ctx;
    while (true) await ctx.waitSec(1 / 60);
  }, { bpm: clockStore.bpm, debugName: "music-runners-root" });
  if (!root) throw new Error("launchBrowser did not start synchronously");
  clockStore.started = true;
  return root;
}

export function setBpm(bpm: number): void {
  if (!Number.isFinite(bpm) || bpm <= 0) return;
  clockStore.bpm = bpm;
  root?.setBpm(bpm);
}

/** Current beat position of the shared clock on the wall-synced scheduler clock. */
export function nowBeats(): number {
  if (!root) return 0;
  return root.tempo.beatsAtTime(root.scheduler.now());
}
