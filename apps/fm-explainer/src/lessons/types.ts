import type { ReactNode } from "react";
import type { NativeFmParams } from "../audio/engine";
import type { Patch } from "../audio/patch";
import type { Partial } from "../viz/bessel";

export type ClipTuple = [pitch: number, position: number, duration: number, velocity?: number];

export interface Clip {
  notes: ClipTuple[];
  loop: number;
  bpm?: number;
}

export interface Control {
  label: string;
  /** Path into the patch or the native parameters, e.g. `edges.0.index`. */
  path: string;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  /** Logarithmic slider travel, for frequencies and times. */
  log?: boolean;
  /** Quick-set buttons under the slider. */
  marks?: number[];
}

/** A control on a raw Six Sines parameter, shown when that engine is selected. */
export interface SixControl {
  label: string;
  id: number;
  initial: number;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
}

export interface Predict {
  question: string;
  options: string[];
  answer: number;
  explain: ReactNode;
}

export type Source =
  | { kind: "native"; params: NativeFmParams }
  | { kind: "operators"; patch: Patch; engine?: "raw" | "six" }
  | { kind: "preset"; path: string };

export interface Step {
  title: string;
  body: ReactNode;
  source: Source;
  controls?: Control[];
  sixControls?: SixControl[];
  clip: Clip;
  predict?: Predict;
  /** Right edge of the spectrum, in multiples of the played note. */
  maxRatio?: number;
  /** Theoretical partials to overlay, from the current parameter state. */
  predicted?: (state: unknown) => Partial[];
  /** Source excerpt shown under the bench. */
  code?: string;
  tryThis?: ReactNode[];
}

export interface Lesson {
  id: string;
  number: string;
  part: string;
  title: string;
  steps: Step[];
  refs?: string[];
}
