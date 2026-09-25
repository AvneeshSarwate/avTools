import type { CanvasRuntimeState } from './canvasState'
import { reconcileDrawingDocument, serializeDrawingDocument } from './drawingDocument'
import { convertLegacyCanvasState, isLegacyCanvasState } from './legacyCanvasState'
export { collectCanvasRenderData } from './canvasBake'

export interface CanvasPersistenceOptions {
  handleTimeUpdate?: (time: number) => void
}

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
 * Restore a string from `serializeCanvasState`. The format that predates
 * documents (Konva's own serialization per tool) is converted on the way in.
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

  let document: unknown
  if (isDocumentPayload(parsed)) document = parsed
  else if (isLegacyCanvasState(parsed)) document = convertLegacyCanvasState(parsed)
  else {
    console.warn('Canvas state payload is neither a document nor a legacy canvas state')
    return false
  }

  const wasAnimating = canvasState.freehand.currentPlaybackTime.value > 0
  canvasState.freehand.currentPlaybackTime.value = 0
  canvasState.freehand.isAnimating.value = false
  try {
    reconcileDrawingDocument(canvasState, document as never)
  } catch (error) {
    console.warn('Failed to restore canvas state:', error)
    return false
  }
  if (wasAnimating) options.handleTimeUpdate?.(0)
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
