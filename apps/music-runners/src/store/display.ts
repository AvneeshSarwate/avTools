// Display settings shared by every roll, saved with the project.
import { proxy } from "valtio";

export type PitchLabelMode = "name" | "midi";

export const displayStore = proxy<{ pitchLabels: PitchLabelMode }>({ pitchLabels: "name" });

export function setPitchLabels(mode: PitchLabelMode): void {
  displayStore.pitchLabels = mode;
}
