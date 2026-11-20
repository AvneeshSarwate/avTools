// Parameter ids of the Six Sines engine and the translation from a manual
// patch (radians, seconds) to its 0..1 knob values. The id layout and the
// scalings come from packages/six-sines/ui/schema.json and the fork's
// matrix_node.h / op_source.h.
import type { Env, Patch } from "./patch";

export const SOURCE = (op: number) => 1500 + 250 * op;
export const FEEDBACK = (op: number) => 10000 + 100 * op;
export const MIXER = (op: number) => 20000 + 100 * op;
/** Matrix cells in schema order: 1>2, 1>3, 2>3, 1>4, ... (0-based operators here). */
export const EDGE_ORDER: [number, number][] = [];
for (let to = 1; to < 6; to++) for (let from = 0; from < to; from++) EDGE_ORDER.push([from, to]);
export const MATRIX = (from: number, to: number) =>
  30000 + 200 * EDGE_ORDER.findIndex(([f, t]) => f === from && t === to);

export const MAIN = { level: 500, delay: 502, attack: 503, hold: 504, decay: 505, sustain: 506, release: 507 };

/** Depth 1.0 on a phase-modulation cell swings the phase by two full cycles. */
export const RADIANS_PER_DEPTH = 4 * Math.PI;
/** Feedback level 1.0 is a quarter of a cycle. */
export const RADIANS_PER_FEEDBACK = Math.PI / 2;

export const WAVEFORMS = [
  "Sin", "Sin^5 x", "Squarish", "Sawish", "Triangle", "Sin(x^3)", "TX 2", "TX 3", "TX 4", "TX 5", "TX 6", "TX 7",
  "TX 8", "Spiky TX 2", "Spiky TX 4", "Spiky TX 6", "Spiky TX 8", "Hann", "Blackman Harris", "½ Blackman Harris",
  "Tukey", "Wavetable", "Audio In",
];
export const EXTENDED_MODES = ["", "Phase Map", "Resonant Sweep", "Noise"];
export const MATRIX_MODES = ["PM", "RM", "Linear FM", "Exp FM"];

// Envelope times: knob x in 0..1 maps to (exp(A + x (B - A)) + C) / D seconds,
// which runs from 0 to 25 s.
const A = 0.6931471824646;
const B = 10.12671184539795;
export const knobToSeconds = (x: number) => (Math.exp(A + x * (B - A)) - 2) / 1000;
export const secondsToKnob = (seconds: number) =>
  Math.max(0, Math.min(1, (Math.log(1000 * Math.max(seconds, 0) + 2) - A) / (B - A)));

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Envelope ids relative to a node's base. Matrix, feedback and mixer nodes all
 * place delay/attack/hold/decay/sustain/release at base+2..base+7.
 */
function writeEnv(out: Map<number, number>, base: number, e: Env | undefined) {
  const v = e ?? { a: 0, d: 0, s: 1, r: 0.15 };
  out.set(base + 2, 0);
  out.set(base + 3, secondsToKnob(v.a));
  out.set(base + 4, 0);
  out.set(base + 5, secondsToKnob(v.d));
  out.set(base + 6, clamp(v.s, 0, 1));
  out.set(base + 7, secondsToKnob(v.r));
}

/** True when every part of the patch has a Six Sines equivalent we translate. */
export function translatable(patch: Patch) {
  return patch.edges.every((e) => (e.mode ?? "pm") !== "fm" && !e.keyScale) && patch.ops.every((o) => !o.fixed);
}

/** The full parameter set for a patch, applied on top of the init preset. */
export function patchToSixSines(patch: Patch): Map<number, number> {
  const out = new Map<number, number>();
  let longestRelease = 0.15;
  for (let i = 0; i < 6; i++) {
    const o = patch.ops[i];
    out.set(SOURCE(i) + 1, o ? 1 : 0);
    out.set(SOURCE(i), o ? clamp(Math.log2(o.ratio), -5, 5) : 0);
    out.set(SOURCE(i) + 12, o?.hz ?? 0);
    out.set(SOURCE(i) + 5, 0);
    const audible = !!o && o.level > 0;
    out.set(MIXER(i) + 1, audible ? 1 : 0);
    out.set(MIXER(i), audible ? clamp(o.level, 0, 1) : 0);
    out.set(MIXER(i) + 15, o?.pan ?? 0);
    writeEnv(out, MIXER(i), o?.amp);
    if (audible) longestRelease = Math.max(longestRelease, o.amp?.r ?? 0.15);
    const fb = o?.feedback ?? 0;
    out.set(FEEDBACK(i) + 1, fb ? 1 : 0);
    out.set(FEEDBACK(i), clamp(fb / RADIANS_PER_FEEDBACK, -1, 1));
    writeEnv(out, FEEDBACK(i), o?.fbEnv);
  }
  for (const [from, to] of EDGE_ORDER) {
    const base = MATRIX(from, to);
    const e = patch.edges.find((x) => x.from === from && x.to === to);
    out.set(base + 1, e ? 1 : 0);
    const rm = e?.mode === "rm";
    out.set(base + 35, rm ? 1 : 0);
    out.set(base, e ? clamp(rm ? e.index : e.index / RADIANS_PER_DEPTH, 0, 1) : 0);
    writeEnv(out, base, e?.env);
    // Velocity into the cell's "Env Atten" target, slot 0.
    out.set(base + 70, e?.velocity ? 5000 : 0);
    out.set(base + 80, e?.velocity ? 20 : 0);
    out.set(base + 71, e?.velocity ?? 0);
  }
  // The main envelope only gates the voice; the operators carry the shapes.
  out.set(MAIN.attack, 0);
  out.set(MAIN.decay, 0);
  out.set(MAIN.sustain, 1);
  out.set(MAIN.release, secondsToKnob(longestRelease));
  out.set(MAIN.level, clamp((patch.gain ?? 0.5) * 1.4, 0, 1));
  return out;
}

// ---- reading factory presets ----

export interface DecodedOp {
  index: number;
  ratio: number;
  waveform: string;
  extended: string;
  keytrack: boolean;
  offsetHz: number;
  level: number;
  pan: number;
  feedback: number;
  feedbackOverdrive: boolean;
}

export interface DecodedEdge {
  from: number;
  to: number;
  depth: number;
  mode: string;
  overdrive: boolean;
  /** Additive envelope amount; non-zero when the cell's envelope adds to the depth. */
  envAdd: number;
  /** Peak index in radians for PM cells. */
  radians: number;
}

export interface DecodedPreset {
  name: string;
  author: string;
  ops: DecodedOp[];
  edges: DecodedEdge[];
  values: Map<number, number>;
}

export function decodePreset(xml: string): DecodedPreset {
  const values = new Map<number, number>();
  for (const m of xml.matchAll(/<p id="(\d+)" v="([-\d.e]+)"/g)) values.set(Number(m[1]), Number(m[2]));
  const get = (id: number, fallback: number) => values.get(id) ?? fallback;
  const ops: DecodedOp[] = [];
  const live = new Set<number>();
  for (let i = 0; i < 6; i++) {
    const s = SOURCE(i);
    if (get(s + 1, i === 0 ? 1 : 0) < 0.5) continue;
    live.add(i);
    const mixerOn = get(MIXER(i) + 1, i === 0 ? 1 : 0) > 0.5;
    const fbOn = get(FEEDBACK(i) + 1, 0) > 0.5;
    // Some presets leave the mixer level at zero and raise it from a macro or
    // velocity through a modulation slot aimed at Amplitude (target 10).
    let modulatedLevel = 0;
    for (let slot = 0; slot < 3; slot++) {
      const hasSource = get(MIXER(i) + 50 + 2 * slot, 0) > 0;
      if (hasSource && Math.round(get(MIXER(i) + 60 + slot, 0)) === 10)
        modulatedLevel = Math.max(modulatedLevel, get(MIXER(i) + 51 + 2 * slot, 0));
    }
    ops.push({
      index: i,
      ratio: Math.pow(2, get(s, 0)),
      waveform: WAVEFORMS[Math.round(get(s + 5, 0))] ?? "Sin",
      extended: EXTENDED_MODES[Math.round(get(s + 175, 0))] ?? "",
      keytrack: get(s + 6, 1) > 0.5,
      offsetHz: get(s + 12, 0),
      level: mixerOn ? Math.max(get(MIXER(i), i === 0 ? 1 : 0), modulatedLevel) : 0,
      pan: get(MIXER(i) + 15, 0),
      feedback: fbOn ? get(FEEDBACK(i), 0) : 0,
      feedbackOverdrive: fbOn && get(FEEDBACK(i) + 28, 0) > 0.5,
    });
  }
  const edges: DecodedEdge[] = [];
  for (const [from, to] of EDGE_ORDER) {
    const base = MATRIX(from, to);
    if (get(base + 1, 0) < 0.5 || !live.has(from) || !live.has(to)) continue;
    const depth = get(base, 0);
    const additive = get(base + 13, 1) < 0.5;
    const envAdd = additive ? get(base + 27, 1) : 0;
    const overdrive = get(base + 28, 0) > 0.5;
    const mode = MATRIX_MODES[Math.round(get(base + 35, 0))] ?? "PM";
    const peak = Math.max(depth, depth + envAdd);
    if (peak < 0.004) continue; // a cell that is switched on but contributes nothing audible
    edges.push({
      from, to, depth, mode, overdrive, envAdd,
      radians: peak * RADIANS_PER_DEPTH * (overdrive ? 10 : 1),
    });
  }
  const name = /name="([^"]*)"/.exec(xml)?.[1] ?? "";
  const author = /author="([^"]*)"/.exec(xml)?.[1] ?? "";
  return { name, author, ops, edges, values };
}
