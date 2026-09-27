import type { TimeContext } from "@avtools/core-timing";
import { button, canvasParams } from "canvas-params";
import { pipelineDefaults } from "./pipeline.ts";
import { type MelodyName, melodyNames } from "./sources.ts";
import { ENCODER_MODES } from "./beatstep.ts";

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
    // Recording replaces this melody's source roll when it is switched off.
    record: false,
    takeLength: 0,
    recordStatus: "idle",
  }, {
    base: { ...chainMeta, spread: knob },
    delay: chainMeta,
    delayTime: knob,
    noteLength: knob,
    record: { label: "record into this bank" },
    takeLength: {
      label: "phrase beats (0 = original)",
      min: 0,
      max: 64,
      step: 0.25,
    },
    recordStatus: { label: "record status" },
  });
}
export type MelodyParams = ReturnType<typeof declare>;
export const melodies: Record<MelodyName, MelodyParams> = {
  dscale5: declare("dscale5"),
  dscale7: declare("dscale7"),
  d7mel: declare("d7mel"),
};

/** Input selectors list the ports visible now: "" is none. */
function inputOptions(inputNames: string[]) {
  const options: Record<string, string> = { "(none)": "" };
  for (const name of inputNames) options[name] = name;
  return options;
}

/**
 * Redeclared by the player whenever the visible MIDI inputs change, so a
 * hot-plugged device (or browser MIDI permission arriving late) shows up.
 * Redeclaring keeps the current values and replaces only the options.
 */
export function declareTransport(inputNames: string[]) {
  return canvasParams("sonar/transport", {
    bpm: 120,
    baseOutput: "IAC Driver Bus 1",
    delayOutput: "IAC Driver Bus 2",
    channel: 0,
    dryRun: false,
    recordInput: "",
    recordQuantize: 0,
  }, {
    bpm: { min: 20, max: 300 },
    channel: { min: 0, max: 15, step: 1 },
    recordInput: { label: "record input", options: inputOptions(inputNames) },
    recordQuantize: {
      label: "record quantize",
      options: { off: 0, "1/4": 1, "1/8": 0.5, "1/16": 0.25 },
    },
  });
}
export const transport = declareTransport([]);

export function declareBeatstep(inputNames: string[]) {
  const focusOptions: Record<string, string> = {};
  for (const name of melodyNames) focusOptions[name] = name;
  return canvasParams("sonar/beatstep", {
    device: "",
    focus: melodyNames[0] as string,
    followFocus: true,
    encoderMode: "delta" as string,
    status: "no device",
  }, {
    device: { label: "BeatStep input", options: inputOptions(inputNames) },
    focus: { label: "encoders edit", options: focusOptions },
    followFocus: { label: "switcher moves canvas focus" },
    encoderMode: { label: "encoder mode", options: ENCODER_MODES },
    status: { label: "status" },
  });
}
export const beatstep = declareBeatstep([]);

export default async function describe(ctx: TimeContext) {
  await ctx.waitSec(0.01);
}
