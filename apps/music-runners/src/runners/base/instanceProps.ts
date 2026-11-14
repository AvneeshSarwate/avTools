import { DEFAULT_BEND_RANGE } from "../../model/mpe";
import type { Params } from "../runnerTypes";

/** Props every runner instance shape carries. Run state is not here. */
export interface RunnerInstanceProps {
  w: number;
  h: number;
  runnerType: string;
  bankId: string;
  midiOutputName: string;
  /** Live input for monitoring and recording; "" for none. */
  midiInputName: string;
  /** Echo the input to the instance's output (transpose applied). */
  midiThru: boolean;
  /** Each played note on its own member channel with its expression. */
  mpe: boolean;
  /** Semitones at full pitch bend, for recorded input and MPE output. */
  bendRange: number;
  params: Params;
  queued: boolean;
  showSource: boolean;
  showGenerated: boolean;
  showPreview: boolean;
}

export const DEFAULT_INSTANCE_WIDTH = 760;
export const DEFAULT_INSTANCE_HEIGHT = 520;

/** Defaults for the live-input props, also used by the shape migration. */
export const DEFAULT_INPUT_PROPS = {
  midiInputName: "",
  midiThru: true,
  mpe: false,
  bendRange: DEFAULT_BEND_RANGE,
} satisfies Partial<RunnerInstanceProps>;
