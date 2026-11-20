// Bessel functions of the first kind, J_n(x), by the integral form. Accurate
// enough for drawing predicted sideband heights.
export function besselJ(n: number, x: number): number {
  const steps = 200;
  let sum = 0;
  for (let i = 0; i <= steps; i++) {
    const t = (Math.PI * i) / steps;
    const w = i === 0 || i === steps ? 0.5 : 1;
    sum += w * Math.cos(n * t - x * Math.sin(t));
  }
  return sum / steps;
}

export interface Partial {
  /** Frequency as a multiple of the played note. */
  ratio: number;
  amplitude: number;
}

function collect(raw: Map<number, number>): Partial[] {
  return [...raw]
    .map(([key, amplitude]) => ({ ratio: key / 1000, amplitude: Math.abs(amplitude) }))
    .filter((p) => p.amplitude > 0.003 && p.ratio > 0.001)
    .sort((a, b) => a.ratio - b.ratio);
}

function add(raw: Map<number, number>, ratio: number, amplitude: number) {
  // A component at a negative frequency is the same sine with its sign flipped.
  const signed = ratio < 0 ? -amplitude : amplitude;
  const key = Math.round(Math.abs(ratio) * 1000);
  raw.set(key, (raw.get(key) ?? 0) + signed);
}

/** One sine modulator on one sine carrier: components at c + k m with weight J_k(I). */
export function simplePair(carrier: number, modulator: number, index: number): Partial[] {
  const raw = new Map<number, number>();
  const kMax = Math.ceil(index + 6);
  for (let k = -kMax; k <= kMax; k++) add(raw, carrier + k * modulator, besselJ(k, index));
  return collect(raw);
}

/** Two sine modulators on one carrier: c + k m1 + l m2 with weight J_k(I1) J_l(I2). */
export function parallelPair(carrier: number, m1: number, i1: number, m2: number, i2: number): Partial[] {
  const raw = new Map<number, number>();
  const kMax = Math.ceil(i1 + 5);
  const lMax = Math.ceil(i2 + 5);
  for (let k = -kMax; k <= kMax; k++) {
    const jk = besselJ(k, i1);
    if (Math.abs(jk) < 1e-4) continue;
    for (let l = -lMax; l <= lMax; l++) add(raw, carrier + k * m1 + l * m2, jk * besselJ(l, i2));
  }
  return collect(raw);
}
