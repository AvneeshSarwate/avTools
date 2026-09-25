import { restoreFreehandState } from './freehandTool'
import { restorePolygonState } from './polygonTool'
import { restoreCircleState } from './circleTool'
import type { CanvasRenderData, CanvasRuntimeState } from './canvasState'
import { reconcileDrawingDocument, serializeDrawingDocument } from './drawingDocument'

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

const normalizeParsedState = (parsed: any): NormalizedCanvasState => {
  if (!parsed || typeof parsed !== 'object') {
    return {}
  }

  if ('freehand' in parsed || 'polygon' in parsed || 'circle' in parsed) {
    const result: NormalizedCanvasState = {}

    if (parsed.freehand !== undefined) {
      result.freehand = typeof parsed.freehand === 'string'
        ? parsed.freehand
        : JSON.stringify(parsed.freehand)
    }

    if (parsed.polygon !== undefined) {
      result.polygon = typeof parsed.polygon === 'string'
        ? parsed.polygon
        : JSON.stringify(parsed.polygon)
    }

    if (parsed.circle !== undefined) {
      result.circle = typeof parsed.circle === 'string'
        ? parsed.circle
        : JSON.stringify(parsed.circle)
    }

    return result
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

export const collectCanvasRenderData = (state: CanvasRuntimeState): CanvasRenderData => ({
  freehand: state.freehand.bakedRenderData,
  polygon: state.polygon.bakedRenderData,
  circle: state.circle.bakedRenderData
})

/**
 * The canvas state as one opaque string: the drawing document as JSON. It is
 * what the undo stack, snapshots, downloads, and `getCanvasState()` hold.
 */
export const serializeCanvasState = (state: CanvasRuntimeState): string =>
  JSON.stringify(serializeDrawingDocument(state))

const isDocumentPayload = (parsed: any): boolean =>
  !!parsed && typeof parsed === 'object' && ['freehand', 'polygon', 'circle'].some(
    (layer) => parsed[layer] && typeof parsed[layer] === 'object' && Array.isArray(parsed[layer].nodes)
  )

/**
 * Restore a string from `serializeCanvasState`. Older strings (Konva's own
 * serialization per tool, the format before documents) are still accepted
 * and rebuilt whole through the legacy per-tool restore.
 */
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

  if (isDocumentPayload(parsed)) {
    const wasAnimating = canvasState.freehand.currentPlaybackTime.value > 0
    canvasState.freehand.currentPlaybackTime.value = 0
    canvasState.freehand.isAnimating.value = false
    try {
      reconcileDrawingDocument(canvasState, parsed)
    } catch (error) {
      console.warn('Failed to restore canvas state:', error)
      return false
    }
    if (wasAnimating) options.handleTimeUpdate?.(0)
    return true
  }

  const { freehand, polygon, circle } = normalizeParsedState(parsed)

  if (!freehand && !polygon && !circle) {
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
