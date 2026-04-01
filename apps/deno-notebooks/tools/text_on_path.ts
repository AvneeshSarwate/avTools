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
   * Whether the path is closed (e.g. a circle). When true, character positions
   * wrap around using modulo so text scrolls smoothly past the seam.
   * Auto-detected if omitted (first ≈ last point within 1px).
   */
  closed?: boolean;
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

/** Sample a polyline at a given arc-length distance → position + tangent. */
export function samplePolyline(
  pts: Point[],
  cumDists: number[],
  dist: number,
): PathSample {
  const total = cumDists[cumDists.length - 1];

  // Clamp to endpoints
  if (dist <= 0) {
    return {
      ...pts[0],
      angle: Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x),
    };
  }
  if (dist >= total) {
    const n = pts.length;
    return {
      ...pts[n - 1],
      angle: Math.atan2(
        pts[n - 1].y - pts[n - 2].y,
        pts[n - 1].x - pts[n - 2].x,
      ),
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

  return {
    x: a.x + t * (b.x - a.x),
    y: a.y + t * (b.y - a.y),
    angle: Math.atan2(b.y - a.y, b.x - a.x),
  };
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

  const { offset = 0, align = "left", letterSpacing = 0 } = opts;
  const widthFn = getWidthFn(p5);

  const cumDists = polylineCumDists(path);
  const totalPathLen = cumDists[cumDists.length - 1];
  const advances = measureCharAdvances(widthFn, str);
  const totalTextLen =
    advances.reduce((s, a) => s + a, 0) +
    letterSpacing * Math.max(0, str.length - 1);

  // Auto-detect closed path (first ≈ last point within 1px)
  const closed =
    opts.closed ??
    (Math.abs(path[0].x - path[path.length - 1].x) < 1 &&
      Math.abs(path[0].y - path[path.length - 1].y) < 1);

  // Starting offset based on alignment
  let startOffset = offset;
  if (align === "center") startOffset += (totalPathLen - totalTextLen) / 2;
  else if (align === "right") startOffset += totalPathLen - totalTextLen;

  // Place each character at the centre of its advance, rotated to the tangent
  let cursor = startOffset;
  for (let i = 0; i < str.length; i++) {
    const adv = advances[i];
    let centerDist = cursor + adv / 2;

    // Wrap around for closed paths so text scrolls past the seam cleanly
    if (closed) {
      centerDist = ((centerDist % totalPathLen) + totalPathLen) % totalPathLen;
    }

    const sample = samplePolyline(path, cumDists, centerDist);

    p5.push();
    p5.translate(sample.x, sample.y);
    p5.rotate(sample.angle);
    p5.textAlign("center", "alphabetic");
    p5.text(str[i], 0, 0);
    p5.pop();

    cursor += adv + letterSpacing;
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
