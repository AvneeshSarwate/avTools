export type CurveValue = {
  timeOffset: number;
  value: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  rooted?: boolean;
  metadata?: any;
};

export function createCurveValue(timeOffset: number, value: number, x1 = 0.5, y1 = 0.5, x2 = 0.5, y2 = 0.5): CurveValue {
  return { timeOffset, value, x1, y1, x2, y2 };
}

export function cloneCurveValue(cv: CurveValue): CurveValue {
  return { ...cv };
}
