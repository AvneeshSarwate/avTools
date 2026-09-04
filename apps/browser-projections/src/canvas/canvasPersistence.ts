import { getCurrentFreehandStateString, restoreFreehandState } from './freehandTool'
import { getCurrentPolygonStateString, restorePolygonState } from './polygonTool'
import { getCurrentCircleStateString, restoreCircleState } from './circleTool'
import type { CanvasRenderData, CanvasRuntimeState } from './canvasState'

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
// undefined when the section carries none. A `CanvasStateSnapshotBase` section
// contributes its `serializedState`; the baked render data beside it is
// derived output and is never loaded from.
const normalizeSection = (section: any): string | undefined => {
  if (section === undefined || section === null) return undefined
  if (typeof section === 'string') return section || undefined
  if (typeof section !== 'object' || Array.isArray(section)) return undefined
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

/** The current baked render data of every tool. Read-only output; load with a DrawingDocument instead. */
export const collectCanvasRenderData = (state: CanvasRuntimeState): CanvasRenderData => ({
  freehand: state.freehand.bakedRenderData,
  polygon: state.polygon.bakedRenderData,
  circle: state.circle.bakedRenderData
})

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
