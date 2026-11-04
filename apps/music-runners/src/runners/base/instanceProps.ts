import type { Params } from "../runnerTypes";

/** Props every runner instance shape carries. Run state is not here. */
export interface RunnerInstanceProps {
  w: number;
  h: number;
  runnerType: string;
  bankId: string;
  midiOutputName: string;
  params: Params;
  queued: boolean;
  showSource: boolean;
  showGenerated: boolean;
  showPreview: boolean;
}

export const DEFAULT_INSTANCE_WIDTH = 760;
export const DEFAULT_INSTANCE_HEIGHT = 520;
