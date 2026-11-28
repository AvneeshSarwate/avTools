// Procedural reshaping of a stroke's control points (positions as x, y pairs).

/** Ease out, exponential: most of the move happens at once, then it settles. */
export function easeOutExpo(t: number) {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

export interface Frame {
  width: number;
  height: number;
}

const POINTS = 10; // picked per stroke (fewer if the stroke has fewer control points)
const MARGIN = 24; // px a picked point's target keeps from the frame's edges
const TRIES = 16; // random directions tried for a target inside the frame

/**
 * Scatter targets: pick POINTS points spread along the stroke (one at a random
 * spot in each equal stretch of its length), give each a random offset of
 * about `distance` px, and spread the offsets over the rest of the stroke with
 * a Catmull-Rom curve over arc length (constant past the first and last
 * picked points), so the stroke bends smoothly rather than kinking at the
 * picked points.
 *
 * Staying in `frame` (MARGIN px in): each picked point's direction is redrawn
 * until its own target lands inside (or, failing that, points roughly at the
 * centre). Points between picks inherit blended offsets that can still land
 * outside, so then the picks around them take the overshoot back (the whole
 * neighbourhood bends inward rather than being clamped), a few rounds.
 */
export function scatterTargets(xy: Float32Array, frame: Frame, distance = 80): Float32Array {
  const n = xy.length / 2;
  if (n === 0) return new Float32Array(xy);

  // Arc length at each point.
  const s = new Float32Array(n);
  for (let i = 1; i < n; i++) s[i] = s[i - 1] + Math.hypot(xy[2 * i] - xy[2 * i - 2], xy[2 * i + 1] - xy[2 * i - 1]);
  const total = s[n - 1];

  // Picks: a random spot in each of POINTS equal stretches, snapped to a
  // control point; duplicates (short strokes) collapse.
  const picked = new Set<number>();
  const k0 = Math.min(n, POINTS);
  for (let b = 0; b < k0; b++) {
    const target = total * (b + Math.random()) / k0;
    let i = 0;
    while (i < n - 1 && s[i + 1] <= target) i++;
    picked.add(target - s[i] > (s[Math.min(n - 1, i + 1)] - target) ? Math.min(n - 1, i + 1) : i);
  }
  const idx = [...picked].sort((a, b) => a - b);
  const k = idx.length;
  const at = idx.map((i) => s[i]);
  const dx = new Float32Array(k), dy = new Float32Array(k);
  for (let j = 0; j < k; j++) {
    const len = distance * (0.85 + 0.3 * Math.random());
    [dx[j], dy[j]] = offsetInside(xy[2 * idx[j]], xy[2 * idx[j] + 1], frame, len);
  }

  const out = new Float32Array(n * 2);
  const x0 = MARGIN, y0 = MARGIN, x1 = frame.width - MARGIN, y1 = frame.height - MARGIN;
  for (let round = 0; round < 4; round++) {
    apply(xy, s, at, dx, dy, out);
    // Per pick, the largest inward push any point it influences needs.
    const pushX = new Float32Array(k), pushY = new Float32Array(k);
    let outside = false;
    let j = 0;
    for (let i = 0; i < n; i++) {
      while (j < k - 1 && at[j + 1] <= s[i]) j++;
      // The pick nearest along the stroke influences this point most.
      const near = j < k - 1 && s[i] - at[j] > at[j + 1] - s[i] ? j + 1 : j;
      const x = out[2 * i], y = out[2 * i + 1];
      const px = x < x0 ? x0 - x : x > x1 ? x1 - x : 0;
      const py = y < y0 ? y0 - y : y > y1 ? y1 - y : 0;
      if (px !== 0 || py !== 0) outside = true;
      if (Math.abs(px) > Math.abs(pushX[near])) pushX[near] = px;
      if (Math.abs(py) > Math.abs(pushY[near])) pushY[near] = py;
    }
    if (!outside) break;
    for (let q = 0; q < k; q++) {
      dx[q] += pushX[q];
      dy[q] += pushY[q];
    }
  }
  return out;
}

// out = xy + offsets blended along arc length from the picks' offsets.
function apply(xy: Float32Array, s: Float32Array, at: number[], dx: Float32Array, dy: Float32Array, out: Float32Array) {
  const n = xy.length / 2, k = at.length;
  let j = 0;
  for (let i = 0; i < n; i++) {
    const si = s[i];
    let ox: number, oy: number;
    if (k === 1 || si <= at[0]) {
      ox = dx[0]; oy = dy[0];
    } else if (si >= at[k - 1]) {
      ox = dx[k - 1]; oy = dy[k - 1];
    } else {
      while (at[j + 1] < si) j++;
      const span = at[j + 1] - at[j];
      const t = span > 1e-6 ? (si - at[j]) / span : 0;
      const j0 = Math.max(0, j - 1), j3 = Math.min(k - 1, j + 2);
      ox = catmullRom(dx[j0], dx[j], dx[j + 1], dx[j3], t);
      oy = catmullRom(dy[j0], dy[j], dy[j + 1], dy[j3], t);
    }
    out[2 * i] = xy[2 * i] + ox;
    out[2 * i + 1] = xy[2 * i + 1] + oy;
  }
}

// A random offset of length `len` from (px, py) whose end stays inside the frame.
function offsetInside(px: number, py: number, frame: Frame, len: number): [number, number] {
  const x0 = MARGIN, y0 = MARGIN, x1 = frame.width - MARGIN, y1 = frame.height - MARGIN;
  for (let i = 0; i < TRIES; i++) {
    const a = Math.random() * 2 * Math.PI;
    const ox = Math.cos(a) * len, oy = Math.sin(a) * len;
    const tx = px + ox, ty = py + oy;
    if (tx >= x0 && tx <= x1 && ty >= y0 && ty <= y1) return [ox, oy];
  }
  // Nothing fit (a point near a corner, or a small frame): head for the
  // centre, give or take 30°.
  const a = Math.atan2(frame.height / 2 - py, frame.width / 2 - px) + (Math.random() - 0.5) * (Math.PI / 3);
  return [Math.cos(a) * len, Math.sin(a) * len];
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3);
}
