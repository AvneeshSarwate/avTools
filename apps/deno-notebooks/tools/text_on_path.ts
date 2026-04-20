/**
 * Text-on-path layout for p5-like renderers.
 *
 * Uses only the public p5 drawing API (push/pop/translate/rotate/text/textAlign
 * and a width-measurement function) so it works with both Deno P5GPU and
 * browser p5.js.
 */

// ── Types ─────────────────────────────────────────────────────────

export interface Point {
  x: number;
  y: number;
}

export interface PathSample {
  x: number;
  y: number;
  angle: number; // tangent angle in radians
}

export interface TextOnPathOptions {
  /** Starting offset along path in pixels (default: 0) */
  offset?: number;
  /** How to align the text block along the path (default: "left") */
  align?: "left" | "center" | "right";
  /** Extra spacing between letters in pixels (default: 0) */
  letterSpacing?: number;
  /**
   * Tangent finite-difference half-width in *polyline points*. 1 (default)
   * reproduces the current atan2(next - prev-adjacent) behavior exactly.
   * Larger values widen the stencil so local kinks (e.g. contour artifacts
   * from hair) don't swing the rotation of letters placed near them.
   */
  tangentStencil?: number;
  /**
   * Whether the path is closed (e.g. a circle). When true, character positions
   * wrap around using modulo so text scrolls smoothly past the seam, and the
   * tangent stencil wraps at the seam too.
   * Auto-detected if omitted (first ≈ last point within 1px).
   */
  closed?: boolean;
  /**
   * Repeat text to fill the entire path length.
   *
   * - `"clip"`: Repeat to fill the path, truncate at path length. Scroll
   *   offset wraps modulo path length (phase looping). The truncation point
   *   rotates with the scroll.
   *
   * - `"wrap"`: Infinite seamless scroll. Offset wraps modulo one-copy width
   *   so the text pattern repeats without gaps. On a closed path there is
   *   still a seam where the path joins — it's up to the caller to construct
   *   text that tiles perfectly if that matters.
   *
   * - `false` (default): no repetition.
   */
  fill?: "clip" | "wrap" | false;
  /** Separator inserted between repetitions when fill is active (default: "   ") */
  fillSeparator?: string;
}

/**
 * Minimal p5-like interface required for text-on-path rendering.
 *
 * - P5GPU (Deno): has `fontWidth()` which returns the font-design advance width.
 * - p5.js (browser): has `textWidth()` which returns the advance width.
 *
 * Provide at least one of them.
 */
export interface P5Like {
  push(): void;
  pop(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  text(str: unknown, x: number, y: number): void;
  textAlign(h: string, v: string): void;
  fontWidth?(str: unknown): number;
  textWidth?(str: unknown): number;
}

// ── Internal helpers ──────────────────────────────────────────────

function getWidthFn(p5: P5Like): (s: string) => number {
  if (typeof p5.fontWidth === "function") return (s) => p5.fontWidth!(s);
  if (typeof p5.textWidth === "function") return (s) => p5.textWidth!(s);
  throw new Error("p5 instance must expose fontWidth() or textWidth()");
}

// ── Polyline utilities ────────────────────────────────────────────

/** Compute cumulative arc-length distances along a polyline. */
export function polylineCumDists(pts: Point[]): number[] {
  const d = [0];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    d.push(d[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  return d;
}

/**
 * Sample a polyline at a given arc-length distance → position + tangent.
 *
 * `stencil` (default 1) is the tangent finite-difference half-width in
 * polyline-index units. `stencil = 1` is byte-identical to the original
 * behavior (atan2 of the two endpoints of the containing segment).
 * `stencil > 1` computes the tangent from points further away, smoothing
 * out local kinks. When `closed` is true, the stencil wraps across the seam.
 */
export function samplePolyline(
  pts: Point[],
  cumDists: number[],
  dist: number,
  stencil: number = 1,
  closed: boolean = false,
): PathSample {
  const total = cumDists[cumDists.length - 1];
  const n = pts.length;
  const s = Math.max(1, Math.floor(stencil));

  const idx = (i: number): number => {
    if (closed) return ((i % n) + n) % n;
    if (i < 0) return 0;
    if (i >= n) return n - 1;
    return i;
  };

  // Clamp to endpoints
  if (dist <= 0) {
    const a = pts[idx(0)];
    const b = pts[idx(s)];
    return {
      ...pts[0],
      angle: Math.atan2(b.y - a.y, b.x - a.x),
    };
  }
  if (dist >= total) {
    const a = pts[idx(n - 1 - s)];
    const b = pts[idx(n - 1)];
    return {
      ...pts[n - 1],
      angle: Math.atan2(b.y - a.y, b.x - a.x),
    };
  }

  // Binary search for the segment containing `dist`
  let lo = 0;
  let hi = cumDists.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cumDists[mid] <= dist) lo = mid;
    else hi = mid;
  }

  const segLen = cumDists[hi] - cumDists[lo];
  const t = segLen > 0 ? (dist - cumDists[lo]) / segLen : 0;
  const a = pts[lo];
  const b = pts[hi];

  // Widened tangent: finite difference across ±(s-1) extra points around
  // the containing segment. s = 1 reduces to atan2(pts[hi] - pts[lo]).
  const ta = pts[idx(lo - s + 1)];
  const tb = pts[idx(hi + s - 1)];

  return {
    x: a.x + t * (b.x - a.x),
    y: a.y + t * (b.y - a.y),
    angle: Math.atan2(tb.y - ta.y, tb.x - ta.x),
  };
}

/**
 * Apply a [1,2,1]/4 binomial smoothing kernel to a polyline, `passes` times.
 *
 * `passes = 0` returns the input array unchanged (reference-equal). Each pass
 * is one application of the kernel, which is roughly equivalent to a Gaussian
 * with σ ≈ √(passes / 2) measured in points.
 *
 * When `closed` is true, the kernel wraps around the seam (pts[0]↔pts[n-1]);
 * otherwise endpoints are replicated (clamp boundary).
 */
export function smoothPolyline(
  pts: Point[],
  passes: number,
  closed: boolean = false,
): Point[] {
  if (passes <= 0 || pts.length < 3) return pts;
  const n = pts.length;
  let current: Point[] = pts;
  for (let p = 0; p < passes; p++) {
    const next: Point[] = new Array(n);
    for (let i = 0; i < n; i++) {
      let iPrev: number;
      let iNext: number;
      if (closed) {
        iPrev = (i - 1 + n) % n;
        iNext = (i + 1) % n;
      } else {
        iPrev = i > 0 ? i - 1 : 0;
        iNext = i < n - 1 ? i + 1 : n - 1;
      }
      const a = current[iPrev];
      const b = current[i];
      const c = current[iNext];
      next[i] = {
        x: 0.25 * a.x + 0.5 * b.x + 0.25 * c.x,
        y: 0.25 * a.y + 0.5 * b.y + 0.25 * c.y,
      };
    }
    current = next;
  }
  return current;
}

// ── Character measurement ─────────────────────────────────────────

/**
 * Measure per-character advance widths using progressive width calls.
 * Because the native layout engine shapes the full substring, this captures
 * real kerning (e.g. "AV" is narrower than "A" + "V").
 */
export function measureCharAdvances(
  widthFn: (s: string) => number,
  text: string,
): number[] {
  const advances: number[] = [];
  let prev = 0;
  for (let i = 0; i < text.length; i++) {
    const w = widthFn(text.substring(0, i + 1));
    advances.push(w - prev);
    prev = w;
  }
  return advances;
}

// ── Core: render text along a polyline ────────────────────────────

/**
 * Render a string along a polyline path.
 *
 * Each character is placed at the correct arc-length position and rotated to
 * match the local tangent. On a closed path (e.g. a circle) letters at the
 * "bottom" will naturally be upside-down — this is correct text-on-path
 * winding behaviour.
 *
 * **Important:** the caller is responsible for setting textFont, textSize,
 * fill, and stroke *before* calling this function. textAlign is overridden
 * per-character internally.
 */
export function textOnPath(
  p5: P5Like,
  str: string,
  path: Point[],
  opts: TextOnPathOptions = {},
): void {
  if (str.length === 0 || path.length < 2) return;

  const {
    offset = 0,
    align = "left",
    letterSpacing = 0,
    tangentStencil = 1,
    fill = false,
    fillSeparator = "   ",
  } = opts;
  const widthFn = getWidthFn(p5);

  const cumDists = polylineCumDists(path);
  const totalPathLen = cumDists[cumDists.length - 1];

  // Auto-detect closed path (first ≈ last point within 1px)
  const closed =
    opts.closed ??
    (Math.abs(path[0].x - path[path.length - 1].x) < 1 &&
      Math.abs(path[0].y - path[path.length - 1].y) < 1);

  // ── Helpers ────────────────────────────────────────────────────

  /** Place a character at an exact path distance (no wrapping). */
  function emitChar(ch: string, d: number): void {
    if (d < 0 || d > totalPathLen) return;
    const sample = samplePolyline(path, cumDists, d, tangentStencil, closed);
    p5.push();
    p5.translate(sample.x, sample.y);
    p5.rotate(sample.angle);
    p5.textAlign("center", "alphabetic");
    p5.text(ch, 0, 0);
    p5.pop();
  }

  /** Positive-modulo helper. */
  const mod = (a: number, m: number) => ((a % m) + m) % m;

  if (fill === "wrap") {
    // ── Wrap: infinite seamless scroll ──────────────────────────
    // One repeating unit = text + separator.
    // Offset wraps modulo unitWidth so the pattern tiles seamlessly.
    // We fill exactly one path-length of characters — no overlap.
    const unit = str + fillSeparator;
    const unitAdvances = measureCharAdvances(widthFn, unit);
    const unitWidth =
      unitAdvances.reduce((s, a) => s + a, 0) +
      letterSpacing * unit.length;

    const wrappedOff = mod(offset, unitWidth);

    // cursor = position on the path (left edge of current char).
    // Starts negative so the first partially-visible char is included.
    let cursor = -wrappedOff;
    let charIdx = 0;
    const maxChars = unit.length * (Math.ceil(totalPathLen / unitWidth) + 2);
    while (cursor < totalPathLen && charIdx < maxChars) {
      const i = charIdx % unit.length;
      const adv = unitAdvances[i];
      const center = cursor + adv / 2;
      // Only emit if the center falls within [0, pathLen)
      if (center >= 0 && center < totalPathLen) {
        emitChar(unit[i], center);
      }
      cursor += adv + letterSpacing;
      charIdx++;
    }
  } else if (fill === "clip") {
    // ── Clip: repeat to fill, scroll wraps mod pathLength ───────
    // Characters fill exactly one path-length. On closed paths the
    // scroll offset rotates the filled text (phase looping).
    const unit = str + fillSeparator;
    const unitAdvances = measureCharAdvances(widthFn, unit);
    const unitWidth =
      unitAdvances.reduce((s, a) => s + a, 0) +
      letterSpacing * unit.length;

    const scrollOff = closed ? mod(offset, totalPathLen) : offset;

    // Walk through the repeating pattern, placing one path-length
    let cursor = 0; // distance placed so far
    let charIdx = 0;
    const maxChars = unit.length * (Math.ceil(totalPathLen / unitWidth) + 1);
    while (cursor < totalPathLen && charIdx < maxChars) {
      const i = charIdx % unit.length;
      const adv = unitAdvances[i];
      const rawCenter = scrollOff + cursor + adv / 2;
      // On closed paths, wrap the raw distance back onto the path
      const center = closed ? mod(rawCenter, totalPathLen) : rawCenter;
      if (center >= 0 && center <= totalPathLen) {
        emitChar(unit[i], center);
      }
      cursor += adv + letterSpacing;
      charIdx++;
    }
  } else {
    // ── Single (no fill) ────────────────────────────────────────
    const advances = measureCharAdvances(widthFn, str);
    const totalTextLen =
      advances.reduce((s, a) => s + a, 0) +
      letterSpacing * Math.max(0, str.length - 1);

    let startOffset = offset;
    if (align === "center") startOffset += (totalPathLen - totalTextLen) / 2;
    else if (align === "right") startOffset += totalPathLen - totalTextLen;

    let cursor = startOffset;
    for (let i = 0; i < str.length; i++) {
      const adv = advances[i];
      let center = cursor + adv / 2;
      if (closed) center = mod(center, totalPathLen);
      else if (center < 0 || center > totalPathLen) {
        cursor += adv + letterSpacing;
        continue;
      }
      emitChar(str[i], center);
      cursor += adv + letterSpacing;
    }
  }
}

/**
 * Convenience: returns the total advance width of `str` including any extra
 * `letterSpacing`, without rendering anything.
 */
export function measureTextOnPath(
  p5: P5Like,
  str: string,
  letterSpacing = 0,
): number {
  if (str.length === 0) return 0;
  const widthFn = getWidthFn(p5);
  const advances = measureCharAdvances(widthFn, str);
  return (
    advances.reduce((s, a) => s + a, 0) +
    letterSpacing * Math.max(0, str.length - 1)
  );
}

// ── Path generators ───────────────────────────────────────────────

/** Circle as a dense polyline (starts at 3-o'clock, CCW). */
export function circlePath(
  cx: number,
  cy: number,
  r: number,
  segments = 128,
): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

/** Sine-wave path. */
export function sinePath(
  x0: number,
  y0: number,
  w: number,
  amp: number,
  periods = 1,
  segments = 200,
): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    pts.push({
      x: x0 + t * w,
      y: y0 + Math.sin(t * Math.PI * 2 * periods) * amp,
    });
  }
  return pts;
}

/** Uniform Catmull-Rom spline through control points → dense polyline. */
export function catmullRomPath(
  controlPts: Point[],
  segsPerSpan = 30,
): Point[] {
  const n = controlPts.length;
  if (n < 2) return [...controlPts];

  // Reflect first/last points to create phantom endpoints
  const pts = [
    {
      x: 2 * controlPts[0].x - controlPts[1].x,
      y: 2 * controlPts[0].y - controlPts[1].y,
    },
    ...controlPts,
    {
      x: 2 * controlPts[n - 1].x - controlPts[n - 2].x,
      y: 2 * controlPts[n - 1].y - controlPts[n - 2].y,
    },
  ];

  const result: Point[] = [];
  for (let i = 1; i < pts.length - 2; i++) {
    const p0 = pts[i - 1],
      p1 = pts[i],
      p2 = pts[i + 1],
      p3 = pts[i + 2];
    const last = i === pts.length - 3;
    const steps = last ? segsPerSpan + 1 : segsPerSpan;

    for (let j = 0; j < steps; j++) {
      const t = j / segsPerSpan;
      const t2 = t * t;
      const t3 = t2 * t;
      // Standard Catmull-Rom matrix form
      result.push({
        x:
          0.5 *
          (2 * p1.x +
            (-p0.x + p2.x) * t +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y:
          0.5 *
          (2 * p1.y +
            (-p0.y + p2.y) * t +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  return result;
}

/** Straight-line path between two points. */
export function linePath(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Point[] {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y1 },
  ];
}
