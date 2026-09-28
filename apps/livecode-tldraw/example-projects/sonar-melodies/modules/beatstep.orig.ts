import type { TimeContext } from "@avtools/core-timing";
import type { LivecodeEvent } from "canvas-events";
import type { MidiInputEvent } from "midi-helpers";
import { type MelodyName, melodyNames } from "./sources.ts";
import type { MelodyParams } from "./controls.ts";

// Arturia BeatStep (the original, not the Pro) in its factory CNTRL preset:
// everything on the global channel (1 by default), pads in Note/Gate mode,
// encoders sending absolute CCs. Pads light when they receive a note-on for
// their own note and clear on a note-off (not a velocity-0 note-on), which is
// how the radio buttons and toggles show state. There is no local-control
// setting: a pad in Gate mode also lights itself while held. No SysEx is
// needed, so LEDs work on the browser engine too.

/** Factory pad notes, left to right. Pads 1-8 are the top row. */
export const TOP_ROW_NOTES = [44, 45, 46, 47, 48, 49, 50, 51];
/** Factory pad notes, left to right. Pads 9-16 are the bottom row. */
export const BOTTOM_ROW_NOTES = [36, 37, 38, 39, 40, 41, 42, 43];
/**
 * Encoder CCs, encoders 1-16 (1-8 top row, 9-16 bottom row). The factory
 * table, except encoder 1, which sends CC 10 on the unit this was mapped on.
 */
// deno-fmt-ignore
export const ENCODER_CCS = [
  10, 74, 71, 76, 77, 93, 73, 75,
  114, 18, 19, 16, 17, 91, 79, 72,
];

export type PadAction =
  | { kind: "launch"; melody: MelodyName; mode: "oneShot" | "gate" }
  | { kind: "stop"; melody: MelodyName }
  | { kind: "record"; melody: MelodyName }
  | { kind: "recordFocused" }
  | { kind: "focus"; melody: MelodyName }
  | { kind: "followFocus" };

/**
 * The pad layout, by note. Columns 1-3 are the LPD8 layout from the original
 * sketch, one column per melody: top one-shot, bottom gate. Columns 4-6 are
 * the same melodies' stop (top) and record (bottom), except bottom 6 (note
 * 41), which records into the focused melody. The focus switcher is the
 * three pads at the right: top 7, top 8, bottom 7 for melodies 1-3. Bottom 8
 * toggles whether switching also moves the tldraw camera. Edit here to move
 * anything; the rest of the code only reads this table.
 */
export const PAD_LAYOUT: ReadonlyMap<number, PadAction> = (() => {
  const layout = new Map<number, PadAction>();
  melodyNames.forEach((melody, i) => {
    layout.set(TOP_ROW_NOTES[i], { kind: "launch", melody, mode: "oneShot" });
    layout.set(BOTTOM_ROW_NOTES[i], { kind: "launch", melody, mode: "gate" });
    layout.set(TOP_ROW_NOTES[3 + i], { kind: "stop", melody });
    layout.set(BOTTOM_ROW_NOTES[3 + i], { kind: "record", melody });
  });
  const focusPads = [TOP_ROW_NOTES[6], TOP_ROW_NOTES[7], BOTTOM_ROW_NOTES[6]];
  melodyNames.forEach((melody, i) => {
    layout.set(focusPads[i], { kind: "focus", melody });
  });
  layout.set(BOTTOM_ROW_NOTES[7], { kind: "followFocus" });
  // Note 41 (bottom 6) records into whichever melody has focus.
  layout.set(41, { kind: "recordFocused" });
  return layout;
})();

type EncoderTarget =
  | readonly ["base" | "delay", string]
  | readonly ["noteLength" | "delayTime" | "delayEnabled"];

/**
 * Encoders edit the focused melody, mostly in the original sketch's slider
 * order: the top row is the base chain (s0-s5, then spread and the note-length
 * CC), the bottom row the echo chain (s8-s13), then delay time and delay
 * on/off.
 */
export const ENCODER_TARGETS: readonly EncoderTarget[] = [
  ["base", "transpose"],
  ["base", "stretch"],
  ["base", "rotate"],
  ["base", "reverse"],
  ["base", "ornament"],
  ["base", "easing"],
  ["base", "spread"],
  ["noteLength"],
  ["delay", "transpose"],
  ["delay", "stretch"],
  ["delay", "rotate"],
  ["delay", "reverse"],
  ["delay", "ornament"],
  ["delay", "easing"],
  ["delayTime"],
  ["delayEnabled"],
];

/**
 * How encoder values are read. `delta` works with the factory absolute
 * encoders without jumping when focus changes: each message moves the
 * parameter by the change since the previous one. Its limit is the device's
 * own 0-127 range; set the encoders to a relative mode in Arturia's MIDI
 * Control Center for endless turning. `absolute` sets the value directly.
 */
export const ENCODER_MODES = {
  "delta (factory absolute encoders)": "delta",
  "absolute (jumps on focus change)": "absolute",
  "relative #1 (64 ± n)": "relative1",
  "relative #2 (two's complement)": "relative2",
  "relative #3 (16 ± n)": "relative3",
} as const;
export type EncoderMode = typeof ENCODER_MODES[keyof typeof ENCODER_MODES];

export interface BeatstepSettings {
  focus: string;
  followFocus: boolean;
  encoderMode: string;
}

const unit = (n: number) => Math.max(0, Math.min(1, n));

export function createBeatstepController(deps: {
  melodies: Record<MelodyName, MelodyParams>;
  settings: BeatstepSettings;
  /** `sonar/trigger` and `sonar/stop` events, as the canvas buttons send. */
  trigger: (event: LivecodeEvent) => void;
  /** Light or clear one pad. */
  setLed: (note: number, on: boolean, channel: number) => void;
  /** Called on a focus press while `followFocus` is on. */
  focusCanvas: (melody: MelodyName) => void;
}) {
  const { melodies, settings } = deps;
  const lastAbsolute = new Map<number, number>();
  const ledState = new Map<number, boolean>();
  let channel = 0;

  const focused = (): MelodyName =>
    (melodyNames as readonly string[]).includes(settings.focus)
      ? settings.focus as MelodyName
      : melodyNames[0];

  function wantsLed(action: PadAction): boolean {
    switch (action.kind) {
      case "focus":
        return action.melody === focused();
      case "followFocus":
        return settings.followFocus;
      case "record":
        return melodies[action.melody].record;
      case "recordFocused":
        return melodies[focused()].record;
      default:
        return false;
    }
  }

  /**
   * Send only LEDs whose wanted state differs from what was last sent. A
   * released pad (`released`) was just turned off by the BeatStep itself, so
   * it is relit if it should be on; one that should be off needs nothing.
   */
  function refreshLeds(released?: number) {
    if (released !== undefined) ledState.set(released, false);
    for (const [note, action] of PAD_LAYOUT) {
      const want = wantsLed(action);
      if (ledState.get(note) === want) continue;
      ledState.set(note, want);
      deps.setLed(note, want, channel);
    }
  }

  function allLedsOff() {
    for (const note of PAD_LAYOUT.keys()) {
      if (ledState.get(note) === false) continue;
      ledState.set(note, false);
      deps.setLed(note, false, channel);
    }
  }

  function pad(action: PadAction, down: boolean) {
    const state = down ? "down" : "up";
    switch (action.kind) {
      case "launch":
        deps.trigger({
          type: "sonar/trigger",
          body: {
            melody: action.melody,
            mode: action.mode,
            state,
            origin: "beatstep",
          },
        });
        return;
      case "stop":
        if (down) {
          deps.trigger({
            type: "sonar/stop",
            body: { melody: action.melody, state },
          });
        }
        return;
      case "record":
        if (down) {
          melodies[action.melody].record = !melodies[action.melody].record;
        }
        return;
      case "recordFocused":
        if (down) melodies[focused()].record = !melodies[focused()].record;
        return;
      case "focus":
        if (!down) return;
        settings.focus = action.melody;
        // New focus, new encoder baselines: no jump on the first turn.
        lastAbsolute.clear();
        if (settings.followFocus) deps.focusCanvas(action.melody);
        return;
      case "followFocus":
        if (down) settings.followFocus = !settings.followFocus;
        return;
    }
  }

  /** The amount one encoder message moves a 0-1 parameter, or an absolute value. */
  function encoderChange(
    controller: number,
    value: number,
  ): { delta: number } | { value: number } | null {
    const mode = settings.encoderMode as EncoderMode;
    if (mode === "absolute") return { value: value / 127 };
    if (mode === "relative1") return { delta: (value - 64) / 127 };
    if (mode === "relative2") {
      return { delta: (value < 64 ? value : value - 128) / 127 };
    }
    if (mode === "relative3") return { delta: (value - 16) / 127 };
    const previous = lastAbsolute.get(controller);
    lastAbsolute.set(controller, value);
    if (previous === undefined) return null;
    return { delta: (value - previous) / 127 };
  }

  function encoder(index: number, controller: number, value: number) {
    const change = encoderChange(controller, value);
    if (!change) return;
    const params = melodies[focused()];
    const target = ENCODER_TARGETS[index];
    if (target[0] === "delayEnabled") {
      params.delayEnabled = "value" in change
        ? change.value >= 0.5
        : change.delta > 0
        ? true
        : change.delta < 0
        ? false
        : params.delayEnabled;
      return;
    }
    const apply = (current: number) =>
      "value" in change ? unit(change.value) : unit(current + change.delta);
    if (target.length === 2) {
      const chain = params[target[0]] as Record<string, number>;
      chain[target[1]] = apply(chain[target[1]]);
    } else {
      params[target[0]] = apply(params[target[0]]);
    }
  }

  return {
    /** Feed every event from the BeatStep's input. */
    handle(event: MidiInputEvent) {
      if (event.type === "noteOn" || event.type === "noteOff") {
        const action = PAD_LAYOUT.get(event.note);
        if (!action) return;
        channel = event.channel;
        const down = event.type === "noteOn";
        pad(action, down);
        refreshLeds(down ? undefined : event.note);
        return;
      }
      if (event.type === "cc") {
        const index = ENCODER_CCS.indexOf(event.controller);
        if (index >= 0) encoder(index, event.controller, event.value);
      }
    },
    refreshLeds: () => refreshLeds(),
    /** Resend every LED, e.g. after the device reconnects. */
    resendLeds() {
      ledState.clear();
      refreshLeds();
    },
    allLedsOff,
    focused,
  };
}

export default async function describe(ctx: TimeContext) {
  await ctx.waitSec(0.01);
}
