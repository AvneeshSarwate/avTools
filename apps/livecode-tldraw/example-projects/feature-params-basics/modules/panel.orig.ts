import type { TimeContext } from "@avtools/core-timing";
import { canvasParams } from "canvas-params";

/**
 * Shared params declaration. `canvasParams` returns the live store value:
 * plain property reads/writes on `panel` are the whole API. Both automation
 * and reader import this module, so all three code shapes address one entity.
 *
 * Nested objects become tweakpane folders; meta leaves refine one binding
 * each. `monitor.level` opts into the readonly graph row (bounds declared so
 * the graph has a readable range).
 */
export const panel = canvasParams(
  "params-basics/panel",
  {
    osc: { freq: 1.5, amp: 0.6 },
    mix: { gain: 0.5, muted: false },
    monitor: { level: 0 },
  },
  {
    osc: {
      freq: { label: "frequency (Hz)", min: 0.1, max: 8, step: 0.1 },
      amp: { label: "amplitude", min: 0, max: 1, step: 0.01 },
    },
    mix: {
      gain: { label: "gain", min: 0, max: 1, step: 0.01 },
      muted: { label: "muted" },
    },
    monitor: {
      level: { label: "lfo level", min: -1, max: 1, graph: true },
    },
  },
);

export default async function (_ctx: TimeContext) {
  // Data-only module: the declaration above is the payload.
}
