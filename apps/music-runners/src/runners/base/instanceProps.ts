import { DEFAULT_BEND_RANGE, DEFAULT_ROOT_TOLERANCE_CENTS } from "../../model/mpe";
import { defaultParams, type Params, type RunnerDefinition } from "../runnerTypes";

/** Props every runner instance shape carries. Run state is not here. */
export interface RunnerInstanceProps {
  w: number;
  h: number;
  runnerType: string;
  /** Shown in the title bar and the sidebar; unique per project when made in the app. */
  name: string;
  midiOutputName: string;
  /** Live input for monitoring and recording; "" for none. */
  midiInputName: string;
  /** Echo the input to the instance's output (transpose applied). */
  midiThru: boolean;
  /** Each played note on its own member channel with its expression. */
  mpe: boolean;
  /** Semitones at full pitch bend, for recorded input and MPE output. */
  bendRange: number;
  /** Mark recorded pitch-curve points near a semitone as rooted. */
  autoRoot: boolean;
  /** How near, in cents. */
  rootToleranceCents: number;
  params: Params;
  queued: boolean;
  showSource: boolean;
  showGenerated: boolean;
  showPreview: boolean;
}

/** Shape meta key for the source roll's cursor (beats), saved outside undo like the view. */
export const CURSOR_META_KEY = "cursor";

export function cursorFromMeta(meta: unknown): number {
  const value = (meta as Record<string, unknown> | undefined)?.[CURSOR_META_KEY];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export const DEFAULT_INSTANCE_WIDTH = 1040;
export const DEFAULT_INSTANCE_HEIGHT = 520;

/** A new instance's props: `createInstance` fills in its name and output. */
export function defaultInstanceProps(def: RunnerDefinition): RunnerInstanceProps {
  return {
    w: DEFAULT_INSTANCE_WIDTH,
    h: DEFAULT_INSTANCE_HEIGHT,
    runnerType: def.type,
    name: def.type,
    midiOutputName: "",
    midiInputName: "",
    midiThru: true,
    mpe: false,
    bendRange: DEFAULT_BEND_RANGE,
    autoRoot: true,
    rootToleranceCents: DEFAULT_ROOT_TOLERANCE_CENTS,
    params: defaultParams(def),
    queued: false,
    showSource: true,
    showGenerated: true,
    showPreview: false,
  };
}
