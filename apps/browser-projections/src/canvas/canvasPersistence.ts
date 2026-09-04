import { buildFreehandFromRenderData, getCurrentFreehandStateString, restoreFreehandState } from './freehandTool'
import { buildPolygonsFromRenderData, getCurrentPolygonStateString, restorePolygonState } from './polygonTool'
import { buildCirclesFromRenderData, getCurrentCircleStateString, restoreCircleState } from './circleTool'
import type {
  CanvasRenderData,
  CanvasRuntimeState,
  CircleRenderData,
  FreehandRenderData,
  PolygonRenderData
} from './canvasState'

export interface CanvasPersistenceOptions {
  handleTimeUpdate?: (time: number) => void
}

interface NormalizedCanvasState {
  freehand?: string
  polygon?: string
  circle?: string
}

const parseStateString = (stateString: string | null | undefined) => {
  if (!stateString) return null
  try {
    return JSON.parse(stateString)
  } catch (error) {
    console.warn('Failed to parse state string:', error)
    return null
  }
}

// One tool's section of a payload as a serialized (Konva) state string, or
// undefined when the section carries no serialized state. Bare render-data
// arrays and `{ bakedRenderData }` sections without a serialized string are
// left for `extractRenderData`.
const normalizeSection = (section: any): string | undefined => {
  if (section === undefined || section === null) return undefined
  if (typeof section === 'string') return section || undefined
  if (Array.isArray(section)) return undefined
  if (typeof section !== 'object') return undefined
  if ('serializedState' in section || 'bakedRenderData' in section) {
    return typeof section.serializedState === 'string' && section.serializedState
      ? section.serializedState
      : undefined
  }
  return JSON.stringify(section)
}

const normalizeParsedState = (parsed: any): NormalizedCanvasState => {
  if (!parsed || typeof parsed !== 'object') {
    return {}
  }

  if ('freehand' in parsed || 'polygon' in parsed || 'circle' in parsed) {
    return {
      freehand: normalizeSection(parsed.freehand),
      polygon: normalizeSection(parsed.polygon),
      circle: normalizeSection(parsed.circle)
    }
  }

  if ('layer' in parsed && (parsed.strokes || parsed.strokeGroups)) {
    return { freehand: JSON.stringify(parsed) }
  }

  if ('layer' in parsed && (parsed.polygons || parsed.polygonGroups)) {
    return { polygon: JSON.stringify(parsed) }
  }

  if ('layer' in parsed && parsed.circles) {
    return { circle: JSON.stringify(parsed) }
  }

  return {}
}

// Baked render data found in a parsed payload. Each tool section may be a bare
// array (`CanvasRenderData`) or a `{ bakedRenderData }` object
// (`CanvasStateSnapshotBase`).
const extractRenderData = (parsed: any): CanvasRenderData | null => {
  if (!parsed || typeof parsed !== 'object') return null

  const pick = <T,>(section: any): T[] | undefined => {
    if (Array.isArray(section)) return section as T[]
    if (section && typeof section === 'object' && Array.isArray(section.bakedRenderData)) {
      return section.bakedRenderData as T[]
    }
    return undefined
  }

  const freehand = pick<FreehandRenderData[number]>(parsed.freehand)
  const polygon = pick<PolygonRenderData[number]>(parsed.polygon)
  const circle = pick<CircleRenderData[number]>(parsed.circle)
  if (!freehand && !polygon && !circle) return null
  return { freehand, polygon, circle }
}

/** The current baked render data of every tool, in the shape `deserializeCanvasRenderData` accepts. */
export const collectCanvasRenderData = (state: CanvasRuntimeState): CanvasRenderData => ({
  freehand: state.freehand.bakedRenderData,
  polygon: state.polygon.bakedRenderData,
  circle: state.circle.bakedRenderData
})

/**
 * Load the canvas from baked render data instead of serialized Konva state.
 * Only the tools present in `data` are replaced. Returns false when `data`
 * carries nothing to load.
 *
 * What the baked form preserves: geometry in world space, per-shape metadata
 * and ids, freehand grouping and stroke timing, and creation order. What it
 * does not: the original transform stack (folded into the points), circle
 * groups, and any Konva styling beyond the canvas defaults.
 */
export const deserializeCanvasRenderData = (
  canvasState: CanvasRuntimeState,
  data: CanvasRenderData,
  options: CanvasPersistenceOptions = {}
): boolean => {
  const { freehand, polygon, circle } = data
  if (!freehand && !polygon && !circle) return false

  if (freehand) {
    // Mirror restoreFreehandState: stop playback before the strokes it animates go away.
    const wasAnimating = canvasState.freehand.currentPlaybackTime.value > 0
    canvasState.freehand.currentPlaybackTime.value = 0
    canvasState.freehand.isAnimating.value = false
    buildFreehandFromRenderData(canvasState, freehand)
    if (wasAnimating) options.handleTimeUpdate?.(0)
  }

  if (polygon) {
    buildPolygonsFromRenderData(canvasState, polygon)
  }

  if (circle) {
    buildCirclesFromRenderData(canvasState, circle)
  }

  return true
}

export const serializeCanvasState = (state: CanvasRuntimeState): string => {
  const freehandString = getCurrentFreehandStateString(state)
  const polygonString = getCurrentPolygonStateString(state)
  const circleString = getCurrentCircleStateString(state)

  const freehand = parseStateString(freehandString)
  const polygon = parseStateString(polygonString)
  const circle = parseStateString(circleString)

  const payload = {
    version: 1,
    freehand,
    polygon,
    circle
  }

  return JSON.stringify(payload)
}

export const deserializeCanvasState = (
  canvasState: CanvasRuntimeState,
  serialized: string,
  options: CanvasPersistenceOptions = {}
): boolean => {
  if (!serialized) return false

  let parsed: any
  try {
    parsed = JSON.parse(serialized)
  } catch (error) {
    console.warn('Failed to parse canvas state JSON:', error)
    return false
  }

  const { freehand, polygon, circle } = normalizeParsedState(parsed)

  // A section with no serialized Konva state can still be rebuilt from its
  // baked render data, so a `CanvasStateSnapshotBase` or bare render data is
  // an acceptable payload too. Serialized state wins where both exist.
  const render = extractRenderData(parsed)
  const renderFallback: CanvasRenderData = {
    freehand: freehand ? undefined : render?.freehand,
    polygon: polygon ? undefined : render?.polygon,
    circle: circle ? undefined : render?.circle
  }
  const hasRenderFallback = Boolean(renderFallback.freehand || renderFallback.polygon || renderFallback.circle)

  if (!freehand && !polygon && !circle && !hasRenderFallback) {
    console.warn('Canvas state payload missing freehand, polygon, and circle data')
    return false
  }

  if (freehand) {
    restoreFreehandState(canvasState, freehand, { handleTimeUpdate: options.handleTimeUpdate })
  }

  if (polygon) {
    restorePolygonState(canvasState, polygon)
  }

  if (circle) {
    restoreCircleState(canvasState, circle)
  }

  if (hasRenderFallback) {
    deserializeCanvasRenderData(canvasState, renderFallback, options)
  }

  return true
}

const downloadBlob = (content: string, filename: string) => {
  const blob = new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export const downloadCanvasState = (state: CanvasRuntimeState) => {
  const serialized = serializeCanvasState(state)
  if (!serialized) {
    console.warn('No canvas state available to download')
    return
  }

  let pretty = serialized
  try {
    pretty = JSON.stringify(JSON.parse(serialized), null, 2)
  } catch (error) {
    console.warn('Failed to pretty-print canvas state JSON:', error)
  }

  const timestamp = new Date().toISOString().slice(0, 16).replace(/:/g, '-')
  downloadBlob(pretty, `canvas_state_${timestamp}.json`)
}

export const uploadCanvasState = (
  canvasState: CanvasRuntimeState,
  options: CanvasPersistenceOptions = {}
) => {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json'

  input.onchange = async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0]
    if (!file) return

    try {
      const content = await file.text()
      const success = deserializeCanvasState(canvasState, content, options)
      if (!success) {
        alert('Invalid canvas state file. Please upload a valid JSON export.')
        return
      }
      console.log('Canvas state restored from file:', file.name)
    } catch (error) {
      console.error('Failed to restore canvas state from file:', error)
      alert('Failed to load canvas state. Please check the console for details.')
    }
  }

  input.click()
}
