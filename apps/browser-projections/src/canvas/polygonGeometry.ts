import { evaluateCurveSegment, polygonCurveSegments, sampleCurveSegments } from '@avtools/drawing-document'

export type Point = { x: number; y: number }


const SAMPLES_PER_CURVED_SPAN = 16

const lineToPointDistance = (p1: Point, p2: Point, point: Point): number => {
  const vx = p2.x - p1.x
  const vy = p2.y - p1.y
  const wx = point.x - p1.x
  const wy = point.y - p1.y

  const c1 = vx * wx + vy * wy
  if (c1 <= 0) return Math.hypot(wx, wy) // point is before p1

  const c2 = vx * vx + vy * vy
  if (c2 <= c1) return Math.hypot(point.x - p2.x, point.y - p2.y) // point is after p2

  const b = c1 / c2 // projection falls on segment
  const pbx = p1.x + b * vx
  const pby = p1.y + b * vy
  return Math.hypot(point.x - pbx, point.y - pby)
}

const spanCount = (points: number[], closed: boolean) => {
  const vertices = points.length / 2
  if (vertices < 2) return 0
  return closed ? vertices : vertices - 1
}

// Konva's curve has one segment per edge, except for degenerate input (a
// vertex whose neighbours coincide), where it drops control points. Fall back
// to straight edges there rather than misattribute segments to edges.
const edgeCurve = (points: number[], tension: number, closed: boolean) => {
  const curve = polygonCurveSegments(points, tension, closed)
  return curve && curve.length === spanCount(points, closed) ? curve : null
}

const vertex = (points: number[], index: number): Point => {
  const wrapped = index % (points.length / 2)
  return { x: points[wrapped * 2], y: points[wrapped * 2 + 1] }
}

/**
 * The edges a polygon draws, in the same space as `points`: edge `i` runs from
 * vertex `i` to vertex `i + 1`, straight edges as two-point polylines, curved
 * ones sampled. An open polygon has no closing edge.
 */
export function polygonSpans(points: number[], tension: number, closed: boolean): Point[][] {
  const curve = edgeCurve(points, tension, closed)
  if (curve) return curve.map((segment) => sampleCurveSegments([segment], SAMPLES_PER_CURVED_SPAN))
  const spans: Point[][] = []
  for (let i = 0; i < spanCount(points, closed); i++) {
    spans.push([vertex(points, i), vertex(points, i + 1)])
  }
  return spans
}

/** The point halfway along edge `spanIndex` (curve parameter 0.5 for a curved edge), in the space of `points`. */
export function polygonSpanMidpoint(points: number[], tension: number, closed: boolean, spanIndex: number): Point {
  const curve = edgeCurve(points, tension, closed)
  if (curve) return evaluateCurveSegment(curve[spanIndex], 0.5)
  const a = vertex(points, spanIndex)
  const b = vertex(points, spanIndex + 1)
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/** The nearest edge among polygons given as `polygonSpans` output. */
export function findClosestPolygonLineAtPoint(
  polygons: Point[][][],
  point: Point
): { polygonIndex: number; lineIndex: number; distance: number } {
  let closestPolygonIndex = -1
  let closestLineIndex = -1
  let closestDistance = Infinity
  for (let i = 0; i < polygons.length; i++) {
    const spans = polygons[i]
    for (let j = 0; j < spans.length; j++) {
      const span = spans[j]
      for (let k = 0; k < span.length - 1; k++) {
        const distance = lineToPointDistance(span[k], span[k + 1], point)
        if (distance < closestDistance) {
          closestDistance = distance
          closestPolygonIndex = i
          closestLineIndex = j
        }
      }
    }
  }
  return { polygonIndex: closestPolygonIndex, lineIndex: closestLineIndex, distance: closestDistance }
}
