/** Native .sxsnp XML plus current parameter overrides (no audio runtime). */
export interface SixSinesData {
  preset: string;
  values: Record<string, number>;
}
export interface SixSinesEntity {
  name: string;
  rev: number;
  updatedAt: number;
  updatedBy: string;
  data: SixSinesData;
}
export interface SixSinesWriteOptions {
  originId?: string;
  expectedRev?: number;
}
export interface SetSixSinesPresetRequest extends SixSinesWriteOptions {
  name: string;
  data: SixSinesData;
}
export type SixSinesWriteResult = import("./entities.ts").EntityPatchResult;
export interface SavedSixSinesEntity {
  type: "sixSines";
  name: string;
  savedAt: string;
  data: SixSinesData;
}

export interface SetSixSinesParametersRequest extends SixSinesWriteOptions {
  name: string;
  changes: Record<string, number>;
}
