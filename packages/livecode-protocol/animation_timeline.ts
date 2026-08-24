export type AnimationTrackType = "number" | "enum" | "func";

export interface AnimationFunctionValue {
  funcName: string;
  args: unknown[];
}

export interface AnimationNumberElement {
  id: string;
  time: number;
  value: number;
}

export interface AnimationEnumElement {
  id: string;
  time: number;
  value: string;
}

export interface AnimationFunctionElement {
  id: string;
  time: number;
  value: AnimationFunctionValue;
}

interface AnimationTrackBase {
  id: string;
  name: string;
  low: number;
  high: number;
  enumOptions?: string[];
}

export interface AnimationNumberTrack extends AnimationTrackBase {
  fieldType: "number";
  elementData: AnimationNumberElement[];
}

export interface AnimationEnumTrack extends AnimationTrackBase {
  fieldType: "enum";
  elementData: AnimationEnumElement[];
}

export interface AnimationFunctionTrack extends AnimationTrackBase {
  fieldType: "func";
  elementData: AnimationFunctionElement[];
}

export type AnimationTrack =
  | AnimationNumberTrack
  | AnimationEnumTrack
  | AnimationFunctionTrack;

export interface AnimationTimelineData {
  tracks: AnimationTrack[];
  trackOrder: string[];
}

export interface AnimationTimelineEntity {
  name: string;
  rev: number;
  data: AnimationTimelineData;
  updatedAt: number;
  updatedBy: string;
}

export interface SetAnimationTimelineRequest {
  name: string;
  data: AnimationTimelineData;
  originId?: string;
  expectedRev?: number;
}

export type AnimationTimelineSetResult =
  | { ok: true; timeline: AnimationTimelineEntity }
  | { ok: false; error: string; current?: AnimationTimelineEntity };

export interface AnimationSample {
  numbers: Record<string, number>;
  enums: Record<string, string>;
}

export interface AnimationFunctionHit extends AnimationFunctionValue {
  trackName: string;
  time: number;
}
