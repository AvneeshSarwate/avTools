/**
 * Durable data-file formats. One JSON file per saved entity under a project's
 * `data/<type>/<encoded-name>.json`, written by `/project/save` and read back
 * by `/project/open`.
 */

import type { PianoRollData } from "./piano_roll.ts";
import type { ParamsMeta, ParamsValues } from "./params.ts";
import type { AnimationTimelineData } from "./animation_timeline.ts";

/** File format of `data/pianoRoll/<encoded-name>.json`. */
export interface SavedPianoRollEntity {
  type: "pianoRoll";
  name: string;
  savedAt: string;
  data: PianoRollData;
}

/**
 * File format of `data/params/<encoded-name>.json`. `meta` is saved so a
 * freshly opened project renders correct panes before any module runs; a later
 * `canvasParams` declaration still wins through the normal reconcile.
 */
export interface SavedParamsEntity {
  type: "params";
  name: string;
  savedAt: string;
  values: ParamsValues;
  meta?: ParamsMeta;
}

export interface SavedAnimationTimelineEntity {
  type: "animationTimeline";
  name: string;
  savedAt: string;
  data: AnimationTimelineData;
}
