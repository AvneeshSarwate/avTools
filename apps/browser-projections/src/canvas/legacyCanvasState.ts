// The canvas state format that predates documents: Konva's own `toObject()`
// tree per tool (`layer`) plus the runtime records that tree did not carry
// (`strokes` with raw points and timing, `polygons`, `circles`). Old saves,
// snapshots, and the sketches' preset files still hold it; this converts one
// into a document without touching Konva, so nothing else needs to know it.
import type { DrawingDocument, DrawingLayer, DrawingNode, DrawingTransform } from '@avtools/drawing-document'
import { createEmptyDrawingDocument } from '@avtools/drawing-document'
import { uid } from './canvasUtils'

interface KonvaJson {
  attrs?: Record<string, unknown>
  className?: string
  children?: KonvaJson[]
}

interface LegacySection {
  layer?: KonvaJson
  strokes?: Array<[string, Record<string, unknown>]>
  strokeGroups?: unknown
  polygons?: Array<[string, Record<string, unknown>]>
  polygonGroups?: unknown
  circles?: Array<[string, Record<string, unknown>]>
}

const TRANSFORM_KEYS = ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'skewX', 'skewY', 'offsetX', 'offsetY'] as const

const number = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

const transformOf = (attrs: Record<string, unknown> = {}): DrawingTransform | undefined => {
  const transform: DrawingTransform = {}
  for (const key of TRANSFORM_KEYS) {
    const value = number(attrs[key])
    if (value !== undefined) transform[key] = value
  }
  return Object.keys(transform).length > 0 ? transform : undefined
}

const metadataOf = (attrs: Record<string, unknown> = {}): Record<string, unknown> | undefined =>
  attrs.metadata && typeof attrs.metadata === 'object' ? (attrs.metadata as Record<string, unknown>) : undefined

const withCommon = <T extends DrawingNode>(node: T, attrs: Record<string, unknown> = {}): T => {
  const transform = transformOf(attrs)
  const metadata = metadataOf(attrs)
  if (transform) node.transform = transform
  if (metadata) node.metadata = metadata
  return node
}

const numberArray = (value: unknown): number[] | undefined =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'number') ? (value as number[]) : undefined

/** A section may be stored inline or as its own JSON string. */
const section = (value: unknown): LegacySection | null => {
  if (!value) return null
  if (typeof value === 'string') {
    try { return JSON.parse(value) as LegacySection } catch { return null }
  }
  return typeof value === 'object' ? (value as LegacySection) : null
}

const entries = (list: Array<[string, Record<string, unknown>]> | undefined): Map<string, Record<string, unknown>> =>
  new Map(Array.isArray(list) ? list.filter((entry) => Array.isArray(entry) && typeof entry[0] === 'string') : [])

/** Whether a parsed payload is the pre-document format (any of its shapes). */
export const isLegacyCanvasState = (parsed: unknown): parsed is Record<string, unknown> => {
  if (!parsed || typeof parsed !== 'object') return false
  const record = parsed as Record<string, unknown>
  if ('layer' in record) return true
  return ['freehand', 'polygon', 'circle'].some((key) => section(record[key])?.layer !== undefined)
}

const convertFreehand = (data: LegacySection | null): DrawingLayer => {
  const strokes = entries(data?.strokes)
  const convert = (node: KonvaJson): DrawingNode | null => {
    const attrs = node.attrs ?? {}
    if (node.className === 'Path') {
      const id = typeof attrs.id === 'string' ? attrs.id : ''
      const record = strokes.get(id)
      const points = numberArray(record?.points)
      if (!record || !points) return null
      const timestamps = numberArray(record.timestamps) ?? new Array(points.length / 2).fill(0)
      return withCommon({
        type: 'stroke',
        id,
        points,
        timestamps,
        creationTime: number(record.creationTime) ?? 0,
        isFreehand: typeof record.isFreehand === 'boolean' ? record.isFreehand : timestamps.some((ts) => ts > 0)
      }, attrs)
    }
    if (node.className === 'Group') {
      const children = (node.children ?? []).map(convert).filter((child): child is DrawingNode => child !== null)
      return withCommon({ type: 'group', id: typeof attrs.id === 'string' && attrs.id ? attrs.id : uid('group_'), children }, attrs)
    }
    return null
  }
  const layer: DrawingLayer = {
    nodes: (data?.layer?.children ?? []).map(convert).filter((node): node is DrawingNode => node !== null)
  }
  const transform = transformOf(data?.layer?.attrs)
  if (transform) layer.transform = transform
  return layer
}

const convertPolygon = (data: LegacySection | null): DrawingLayer => {
  const polygons = entries(data?.polygons)
  const nodes: DrawingNode[] = []
  // The polygon layer holds no groups; a legacy group's lines are flattened.
  const visit = (node: KonvaJson) => {
    const attrs = node.attrs ?? {}
    if (node.className === 'Line') {
      const points = numberArray(attrs.points)
      if (!points) return
      const id = typeof attrs.id === 'string' && attrs.id ? attrs.id : uid('poly_')
      const record = polygons.get(id)
      const tension = number(attrs.tension)
      nodes.push(withCommon({
        type: 'polygon',
        id,
        points,
        // Konva's JSON omits a default-valued attr, so a missing `closed` means false.
        closed: typeof record?.closed === 'boolean' ? record.closed : attrs.closed === true,
        ...(tension ? { tension } : {}),
        creationTime: number(record?.creationTime) ?? 0
      }, attrs))
    } else if (node.className === 'Group') {
      (node.children ?? []).forEach(visit)
    }
  }
  ;(data?.layer?.children ?? []).forEach(visit)
  const layer: DrawingLayer = { nodes }
  const transform = transformOf(data?.layer?.attrs)
  if (transform) layer.transform = transform
  return layer
}

const convertCircle = (data: LegacySection | null): DrawingLayer => {
  const circles = entries(data?.circles)
  const convert = (node: KonvaJson): DrawingNode | null => {
    const attrs = node.attrs ?? {}
    if (node.className === 'Circle') {
      const radius = number(attrs.radius)
      if (radius === undefined) return null
      const id = typeof attrs.id === 'string' && attrs.id ? attrs.id : uid('circle_')
      const record = circles.get(id)
      return withCommon({
        type: 'circle',
        id,
        radius,
        creationTime: number(attrs.creationTime) ?? number(record?.creationTime) ?? 0
      }, attrs)
    }
    if (node.className === 'Group') {
      const children = (node.children ?? []).map(convert).filter((child): child is DrawingNode => child !== null)
      return withCommon({ type: 'group', id: typeof attrs.id === 'string' && attrs.id ? attrs.id : uid('group_'), children }, attrs)
    }
    return null
  }
  const layer: DrawingLayer = {
    nodes: (data?.layer?.children ?? []).map(convert).filter((node): node is DrawingNode => node !== null)
  }
  const transform = transformOf(data?.layer?.attrs)
  if (transform) layer.transform = transform
  return layer
}

/**
 * Convert a legacy payload (the combined `{freehand, polygon, circle}` form,
 * or a single tool's section on its own) into a document. The result is not
 * yet normalized; reconciling it validates it.
 */
export const convertLegacyCanvasState = (parsed: Record<string, unknown>): DrawingDocument => {
  const doc = createEmptyDrawingDocument()
  if ('layer' in parsed) {
    const single = parsed as LegacySection
    if (single.strokes || single.strokeGroups) doc.freehand = convertFreehand(single)
    else if (single.polygons || single.polygonGroups) doc.polygon = convertPolygon(single)
    else if (single.circles) doc.circle = convertCircle(single)
    return doc
  }
  doc.freehand = convertFreehand(section(parsed.freehand))
  doc.polygon = convertPolygon(section(parsed.polygon))
  doc.circle = convertCircle(section(parsed.circle))
  return doc
}
