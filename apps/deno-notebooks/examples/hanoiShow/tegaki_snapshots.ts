// Full tegaki param snapshots: captured from the live pane ("Save snapshot"
// appends one JSON line per click), then eased through in order by the
// offline render.
//
// Timeline: a sequence of snapshots (file order, or a seeded shuffle that
// reshuffles each pass) built until it covers the render. The first holds;
// each next one is reached over a ramp (smoothstep, like the run-install
// loop) and then held. Ramp and hold are each a fixed time or a seeded random
// range per step. Numbers and #rrggbb colors interpolate; booleans and other
// strings switch at the start of the ramp.

export type ParamValue = number | boolean | string;
export type Params = Record<string, ParamValue>;

// One file per process run, named by its start time (local), e.g.
// snapshots/tegaki_2026-09-30_21-45-12.jsonl. Locked at module load so every
// save in a session lands in the same file.
const SESSION_START = new Date();
const pad = (n: number) => String(n).padStart(2, "0");
const SESSION_STAMP = `${SESSION_START.getFullYear()}-${pad(SESSION_START.getMonth() + 1)}-` +
  `${pad(SESSION_START.getDate())}_${pad(SESSION_START.getHours())}-` +
  `${pad(SESSION_START.getMinutes())}-${pad(SESSION_START.getSeconds())}`;
const SNAPSHOT_DIR = new URL("./snapshots/", import.meta.url);
export const SNAPSHOT_FILE = new URL(`tegaki_${SESSION_STAMP}.jsonl`, SNAPSHOT_DIR);

export async function appendSnapshot(params: Params): Promise<string> {
  const line = JSON.stringify(params);
  await Deno.mkdir(SNAPSHOT_DIR, { recursive: true });
  await Deno.writeTextFile(SNAPSHOT_FILE, line + "\n", { append: true });
  return line;
}

/** Reads a .jsonl file (one snapshot per line; blank and // lines skipped). */
export async function readSnapshots(
  path: string | URL,
  base: Params,
): Promise<Params[]> {
  const text = await Deno.readTextFile(path);
  const snapshots: Params[] = [];
  text.split("\n").forEach((rawLine, i) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("//")) return;
    const where = `${path}:${i + 1}`;
    const parsed = JSON.parse(line) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(`${where}: expected a JSON object`);
    }
    for (const [key, value] of Object.entries(parsed)) {
      if (!(key in base)) throw new Error(`${where}: unknown scene param "${key}"`);
      if (typeof value !== typeof base[key]) {
        throw new Error(
          `${where}: "${key}" should be a ${typeof base[key]}, got ${typeof value}`,
        );
      }
    }
    snapshots.push(parsed as Params);
  });
  if (snapshots.length === 0) throw new Error(`${path}: no snapshots`);
  return snapshots;
}

/** Seconds, fixed or a [min, max] range sampled per step. */
export type Span = number | [number, number];

export interface Segment {
  /** Index into the snapshot list. */
  snapshot: number;
  ramp: number;
  hold: number;
}

// Small seeded PRNG (cyrb53-style string hash -> mulberry32), so a given
// seed reproduces the same order and timings.
function seededRandom(seed: string): () => number {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  let a = (Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Snapshot order + per-step ramp/hold, extended until it covers `duration`
 *  (at least one full pass through the snapshots). */
export function buildSchedule(opts: {
  count: number;
  ramp: Span;
  hold: Span;
  shuffle: boolean;
  seed: string;
  duration?: number;
}): Segment[] {
  const rand = seededRandom(opts.seed);
  const sample = (span: Span) =>
    typeof span === "number" ? span : span[0] + rand() * (span[1] - span[0]);

  const nextPass = (prev: number | undefined): number[] => {
    const order = Array.from({ length: opts.count }, (_, i) => i);
    if (!opts.shuffle) return order;
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    // No back-to-back repeat across a pass boundary.
    if (order.length > 1 && order[0] === prev) {
      [order[0], order[1]] = [order[1]!, order[0]!];
    }
    return order;
  };

  const segments: Segment[] = [];
  let total = 0;
  let pass: number[] = [];
  while (segments.length < opts.count || total < (opts.duration ?? 0)) {
    if (pass.length === 0) pass = nextPass(segments.at(-1)?.snapshot);
    const ramp = segments.length === 0 ? 0 : sample(opts.ramp);
    const hold = sample(opts.hold);
    segments.push({ snapshot: pass.shift()!, ramp, hold });
    total += ramp + hold;
    if (opts.count === 1) break;
  }
  return segments;
}

export function scheduleDuration(segments: Segment[]): number {
  return segments.reduce((sum, seg) => sum + seg.ramp + seg.hold, 0);
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function lerpHex(from: string, to: string, u: number): string {
  const a = parseInt(from.slice(1), 16);
  const b = parseInt(to.slice(1), 16);
  let out = "#";
  for (const shift of [16, 8, 0]) {
    const ca = (a >> shift) & 255;
    const cb = (b >> shift) & 255;
    out += Math.round(ca + (cb - ca) * u).toString(16).padStart(2, "0");
  }
  return out;
}

function lerpParams(from: Params, to: Params, u: number): Params {
  const out: Params = { ...from };
  for (const [key, target] of Object.entries(to)) {
    const start = from[key];
    if (typeof target === "number" && typeof start === "number") {
      out[key] = start + (target - start) * u;
    } else if (
      typeof target === "string" && typeof start === "string" &&
      HEX_COLOR.test(target) && HEX_COLOR.test(start)
    ) {
      out[key] = lerpHex(start, target, u);
    } else {
      out[key] = target;
    }
  }
  return out;
}

/** Params at time `t` seconds. Each snapshot is layered over the previous
 *  resolved state, so a hand-trimmed snapshot carries the rest forward. */
export function paramsAt(
  snapshots: Params[],
  schedule: Segment[],
  base: Params,
  t: number,
): Params {
  let current: Params = { ...base, ...snapshots[schedule[0]!.snapshot] };
  let segmentStart = schedule[0]!.hold;
  for (let i = 1; i < schedule.length; i++) {
    const seg = schedule[i]!;
    const target = { ...current, ...snapshots[seg.snapshot] };
    if (t < segmentStart) return current;
    if (t < segmentStart + seg.ramp) {
      const u = (t - segmentStart) / seg.ramp;
      return lerpParams(current, target, u * u * (3 - 2 * u));
    }
    current = target;
    segmentStart += seg.ramp + seg.hold;
  }
  return current;
}
