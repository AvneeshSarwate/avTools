// The patch format shared by the raw operator worklet and the Six Sines
// translation. Physical units throughout: index in radians, time in seconds.

export interface Env {
  a: number;
  d: number;
  /** Sustain as a fraction of the peak, 0..1. */
  s: number;
  r: number;
}

export interface Op {
  /** Frequency as a multiple of the played note. */
  ratio: number;
  /** Fixed offset in Hz added after the ratio (or the whole frequency when `fixed`). */
  hz?: number;
  fixed?: boolean;
  /** Level at the audio output, 0..1. 0 means the operator is only a modulator. */
  level: number;
  pan?: number;
  amp?: Env;
  /** Self-modulation in radians. */
  feedback?: number;
  fbEnv?: Env;
  label?: string;
}

export type EdgeMode = "pm" | "fm" | "rm";

export interface Edge {
  from: number;
  to: number;
  /** Peak index in radians (pm), peak deviation in Hz (fm), or depth 0..1 (rm). */
  index: number;
  env?: Env;
  mode?: EdgeMode;
  /** 0..1: how much of the index is removed at the softest velocity. */
  velocity?: number;
  /** Octaves of index lost per octave above middle C. */
  keyScale?: number;
}

export interface Patch {
  ops: Op[];
  edges: Edge[];
  gain?: number;
}

export const env = (a: number, d: number, s: number, r: number): Env => ({ a, d, s, r });
export const HOLD: Env = env(0.005, 0, 1, 0.15);

export const op = (ratio: number, level = 0, extra: Partial<Op> = {}): Op => ({ ratio, level, ...extra });
export const edge = (from: number, to: number, index: number, extra: Partial<Edge> = {}): Edge => ({
  from,
  to,
  index,
  ...extra,
});

export function clonePatch(patch: Patch): Patch {
  return JSON.parse(JSON.stringify(patch)) as Patch;
}

/** Read `ops.1.ratio`-style paths; the lesson controls are bound through these. */
export function getPath(target: unknown, path: string): number {
  let value = target as Record<string, unknown>;
  for (const key of path.split(".")) value = value?.[key] as Record<string, unknown>;
  return (value as unknown as number) ?? 0;
}

export function setPath<T>(target: T, path: string, next: number): T {
  const copy = JSON.parse(JSON.stringify(target)) as T;
  const keys = path.split(".");
  let value = copy as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) {
    if (value[key] === undefined) value[key] = {};
    value = value[key] as Record<string, unknown>;
  }
  value[keys[keys.length - 1]] = next;
  return copy;
}
