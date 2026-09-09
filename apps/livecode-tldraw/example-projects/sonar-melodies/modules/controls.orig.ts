import type { TimeContext } from "@avtools/core-timing";
import { button, canvasParams } from "canvas-params";
import { pipelineDefaults } from "./pipeline.ts";
import { type MelodyName } from "./sources.ts";

const knob = { min: 0, max: 1, step: 0.001 };
const chainMeta = {
  transpose: knob,
  stretch: knob,
  rotate: knob,
  reverse: knob,
  ornament: knob,
  easing: knob,
};
function declare(name: MelodyName) {
  return canvasParams(`sonar/${name}`, {
    ...pipelineDefaults(),
    // s6 was controlled by the Ableton rack, rather than the transform chain.
    noteLength: 0.5,
    oneShot: button({
      type: "sonar/trigger",
      body: { melody: name, mode: "oneShot" },
    }),
    gate: button({
      type: "sonar/trigger",
      body: { melody: name, mode: "gate" },
    }),
    stop: button({ type: "sonar/stop", body: { melody: name } }),
  }, {
    base: { ...chainMeta, spread: knob },
    delay: chainMeta,
    delayTime: knob,
    noteLength: knob,
  });
}
export const melodies = {
  dscale5: declare("dscale5"),
  dscale7: declare("dscale7"),
  d7mel: declare("d7mel"),
};
export const transport = canvasParams("sonar/transport", {
  bpm: 120,
  baseOutput: "IAC Driver Bus 1",
  delayOutput: "IAC Driver Bus 2",
  channel: 0,
  dryRun: false,
}, { bpm: { min: 20, max: 300 }, channel: { min: 0, max: 15, step: 1 } });

export default async function describe(ctx: TimeContext) {
  await ctx.waitSec(0.01);
}
