// Copied from apps/browser-projections/src/rendering/logisticSigmoid.ts.
// A logistic sigmoid normalized to pass through (0,0) and (1,1). `sharpness`
// runs 0..1: near 0 it is almost linear, near 1 almost a step.
export function logisticSigmoid(x: number, sharpness: number): number {
  let a = sharpness;
  const epsilon = 0.0001;
  const minParamA = 0.0 + epsilon;
  const maxParamA = 1.0 - epsilon;
  a = Math.max(minParamA, Math.min(maxParamA, a));
  a = 1.0 / (1.0 - a) - 1.0;
  const A = 1.0 / (1.0 + Math.exp(0.0 - (x - 0.5) * a * 2.0));
  const B = 1.0 / (1.0 + Math.exp(a));
  const C = 1.0 / (1.0 + Math.exp(0.0 - a));
  return (A - B) / (C - B);
}
