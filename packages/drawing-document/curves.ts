/**
 * Curved polygons: the Bézier segments a Konva `Line` draws when its `tension`
 * is non-zero, computed without Konva.
 *
 * Konva's curve is not a textbook spline. At each vertex the tangent runs
 * parallel to the chord between its neighbours (as in Catmull-Rom), but the two
 * handle lengths split `tension` by the lengths of the adjacent edges. Open
 * lines start and end with quadratic segments; closed lines wrap and use
 * cubics throughout. Because the handle split depends on edge lengths, the
 * curve is not preserved by non-uniform scale or skew: control points must be
 * computed from a node's local points and then transformed, never recomputed
 * from world-space vertices. Bézier segments themselves transform exactly, so
 * baked segments can be drawn as-is with any renderer's Bézier calls.
 *
 * `konvaTensionPoints` and `tensionPointsToSegments` are literal ports of
 * `Konva.Line#_getTensionPoints` and `Konva.Line#_sceneFunc` (konva 9.3),
 * including the skipped control points of a vertex whose neighbours coincide.
 * `apps/browser-projections/tests/canvasDrawingDocument.smoke.mjs` compares
 * the port against the canvas's real Konva output.
 */

export interface CurvePoint {
  x: number;
  y: number;
}

export type PolygonCurveSegment =
  | { type: "quadratic"; from: CurvePoint; control: CurvePoint; to: CurvePoint }
  | {
    type: "cubic";
    from: CurvePoint;
    control1: CurvePoint;
    control2: CurvePoint;
    to: CurvePoint;
  };

/** Whether Konva draws these points as a curve rather than straight edges. */
export function isCurvedPolygon(points: number[], tension: number): boolean {
  return tension !== 0 && points.length > 4;
}

function getControlPoints(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  t: number,
): number[] {
  const d01 = Math.sqrt(Math.pow(x1 - x0, 2) + Math.pow(y1 - y0, 2));
  const d12 = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
  const fa = (t * d01) / (d01 + d12);
  const fb = (t * d12) / (d01 + d12);
  return [
    x1 - fa * (x2 - x0),
    y1 - fa * (y2 - y0),
    x1 + fb * (x2 - x0),
    y1 + fb * (y2 - y0),
  ];
}

function expandPoints(p: number[], tension: number): number[] {
  const all: number[] = [];
  for (let n = 2; n < p.length - 2; n += 2) {
    const cp = getControlPoints(
      p[n - 2],
      p[n - 1],
      p[n],
      p[n + 1],
      p[n + 2],
      p[n + 3],
      tension,
    );
    if (isNaN(cp[0])) continue;
    all.push(cp[0], cp[1], p[n], p[n + 1], cp[2], cp[3]);
  }
  return all;
}

/** Konva's flat tension-point array for a line (`Line#getTensionPoints`). */
export function konvaTensionPoints(
  points: number[],
  tension: number,
  closed: boolean,
): number[] {
  if (!closed) return expandPoints(points, tension);
  const p = points;
  const len = p.length;
  const first = getControlPoints(
    p[len - 2],
    p[len - 1],
    p[0],
    p[1],
    p[2],
    p[3],
    tension,
  );
  const last = getControlPoints(
    p[len - 4],
    p[len - 3],
    p[len - 2],
    p[len - 1],
    p[0],
    p[1],
    tension,
  );
  return [
    first[2],
    first[3],
    ...expandPoints(p, tension),
    last[0],
    last[1],
    p[len - 2],
    p[len - 1],
    last[2],
    last[3],
    first[0],
    first[1],
    p[0],
    p[1],
  ];
}

/**
 * Walk a tension-point array the way Konva's scene function draws it, as
 * segments in the same (local) space as `points`.
 */
export function tensionPointsToSegments(
  points: number[],
  tp: number[],
  closed: boolean,
): PolygonCurveSegment[] {
  const segments: PolygonCurveSegment[] = [];
  const at = (index: number): CurvePoint => ({
    x: tp[index],
    y: tp[index + 1],
  });
  let from: CurvePoint = { x: points[0], y: points[1] };
  const len = tp.length;
  let n = closed ? 0 : 4;
  if (!closed) {
    const to = at(2);
    segments.push({ type: "quadratic", from, control: at(0), to });
    from = to;
  }
  while (n < len - 2) {
    const to = at(n + 4);
    segments.push({
      type: "cubic",
      from,
      control1: at(n),
      control2: at(n + 2),
      to,
    });
    from = to;
    n += 6;
  }
  if (!closed) {
    segments.push({
      type: "quadratic",
      from,
      control: at(len - 2),
      to: { x: points[points.length - 2], y: points[points.length - 1] },
    });
  }
  return segments;
}

/**
 * The segments Konva draws for a polygon, in the points' own space, or `null`
 * when it draws straight edges (zero tension or fewer than three points).
 */
export function polygonCurveSegments(
  points: number[],
  tension: number,
  closed: boolean,
): PolygonCurveSegment[] | null {
  if (!isCurvedPolygon(points, tension)) return null;
  return tensionPointsToSegments(
    points,
    konvaTensionPoints(points, tension, closed),
    closed,
  );
}

/** Map every point of a segment, e.g. through a transform. */
export function mapCurveSegment(
  segment: PolygonCurveSegment,
  map: (point: CurvePoint) => CurvePoint,
): PolygonCurveSegment {
  if (segment.type === "quadratic") {
    return {
      type: "quadratic",
      from: map(segment.from),
      control: map(segment.control),
      to: map(segment.to),
    };
  }
  return {
    type: "cubic",
    from: map(segment.from),
    control1: map(segment.control1),
    control2: map(segment.control2),
    to: map(segment.to),
  };
}

/** The point at parameter `t` in [0, 1] along one segment. */
export function evaluateCurveSegment(
  segment: PolygonCurveSegment,
  t: number,
): CurvePoint {
  const u = 1 - t;
  if (segment.type === "quadratic") {
    const { from: a, control: b, to: c } = segment;
    return {
      x: u * u * a.x + 2 * u * t * b.x + t * t * c.x,
      y: u * u * a.y + 2 * u * t * b.y + t * t * c.y,
    };
  }
  const { from: a, control1: b, control2: c, to: d } = segment;
  const uu = u * u;
  const tt = t * t;
  return {
    x: uu * u * a.x + 3 * uu * t * b.x + 3 * u * tt * c.x + tt * t * d.x,
    y: uu * u * a.y + 3 * uu * t * b.y + 3 * u * tt * c.y + tt * t * d.y,
  };
}

/**
 * Sample segments into one polyline: the first segment's start, then
 * `stepsPerSegment` evenly spaced parameter steps along each segment.
 */
export function sampleCurveSegments(
  segments: PolygonCurveSegment[],
  stepsPerSegment = 16,
): CurvePoint[] {
  if (segments.length === 0) return [];
  const steps = Math.max(1, Math.floor(stepsPerSegment));
  const out: CurvePoint[] = [{ ...segments[0].from }];
  for (const segment of segments) {
    for (let step = 1; step <= steps; step += 1) {
      out.push(evaluateCurveSegment(segment, step / steps));
    }
  }
  return out;
}
