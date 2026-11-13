// In-gesture document previews: while a shape is dragged, transformed, or
// drawn, the changed nodes are serialized and emitted as `document-preview`
// batches (upserts and deletes by id), throttled to the engine's own sync
// tick. A host streams them to the drawing entity as node patches; the
// committed `document-update` at the end of the gesture is unchanged and
// remains the write of record. Previews never touch the command stack.
//
// Every gesture that changes geometry passes through here: Konva drag events
// bubble to the stage (strokes, groups, polygon control points), the
// transformer's own resize and rotate events are heard on the transformer,
// the select tool reports the nodes it moves itself, and the freehand and
// circle tools call in from their pointer handlers with a provisional node
// for the shape being drawn.
import Konva from 'konva'
import type { DrawingLayerName, DrawingNode } from '@avtools/drawing-document'
import type { CanvasRuntimeState } from './canvasState'
import { serializeNode } from './drawingDocument'

export interface DocumentPreview {
  upserts: Array<{ layer: DrawingLayerName; node: DrawingNode }>
  deletes: Array<{ layer: DrawingLayerName; id: string }>
}

export interface DocumentPreviewCallbacks {
  onPreview(preview: DocumentPreview): void
  /** Gesture edges: a host defers foreign rebuilds of the scene in between. */
  onInteraction(active: boolean): void
}

/** The engine batches sync every 33 ms; emitting faster is wasted work. */
const MIN_INTERVAL_MS = 33

export interface DocumentPreviewController {
  /** Queue a provisional node for the shape currently being drawn. */
  previewNode(layer: DrawingLayerName, node: DrawingNode): void
  /** Queue Konva nodes a tool moved itself, outside Konva's drag events. */
  previewKonvaNodes(nodes: Konva.Node[]): void
  /** A drawn shape that was discarded: retract its provisional node, if any was sent. */
  discard(layer: DrawingLayerName, id: string): void
  /**
   * Gesture end: queued upserts are dropped (the commit that ends a gesture
   * carries the final state and must be the last write on the lane), queued
   * deletes still go out, and the gesture is marked over.
   */
  finish(): void
  dispose(): void
}

export const installDocumentPreview = (
  state: CanvasRuntimeState,
  callbacks: DocumentPreviewCallbacks
): DocumentPreviewController => {
  const stage = state.stage
  if (!stage) throw new Error('installDocumentPreview needs a mounted stage')

  const upserts = new Map<string, { layer: DrawingLayerName; node: DrawingNode }>()
  const deletes = new Map<string, DrawingLayerName>()
  // Ids this gesture has streamed, so a discard only retracts what was sent.
  const streamed = new Set<string>()
  let raf: number | null = null
  let lastFlush = 0
  let interacting = false

  const flush = () => {
    raf = null
    if (upserts.size === 0 && deletes.size === 0) return
    lastFlush = performance.now()
    const preview: DocumentPreview = {
      upserts: [...upserts.values()],
      deletes: [...deletes].map(([id, layer]) => ({ layer, id }))
    }
    upserts.clear()
    deletes.clear()
    callbacks.onPreview(preview)
  }

  const schedule = () => {
    if (raf !== null) return
    const wait = Math.max(0, MIN_INTERVAL_MS - (performance.now() - lastFlush))
    raf = requestAnimationFrame(() => {
      if (wait > 0) {
        raf = null
        setTimeout(schedule, wait)
        return
      }
      flush()
    })
  }

  const begin = () => {
    if (interacting) return
    interacting = true
    callbacks.onInteraction(true)
  }

  const queue = (layer: DrawingLayerName, node: DrawingNode) => {
    begin()
    deletes.delete(node.id)
    upserts.set(node.id, { layer, node })
    streamed.add(node.id)
    schedule()
  }

  // The layer group a Konva node lives under, and its top-level node there:
  // a nested stroke streams as its whole top-level group, which is also how
  // the engine replaces it.
  const topLevelUnder = (node: Konva.Node): { layer: DrawingLayerName; top: Konva.Node } | null => {
    const layers: Array<[DrawingLayerName, Konva.Group | undefined]> = [
      ['freehand', state.groups.freehandShape],
      ['polygon', state.groups.polygonShapes],
      ['circle', state.groups.circleShapes]
    ]
    let current: Konva.Node | null = node
    while (current) {
      const parent = current.getParent()
      for (const [layer, group] of layers) {
        if (group && parent === group) return { layer, top: current }
      }
      current = parent
    }
    return null
  }

  const polygonOfControlPoint = (node: Konva.Node): Konva.Line | null => {
    if (node.getParent() !== state.groups.polygonControls) return null
    for (const polygon of state.polygon.shapes.values()) {
      if (polygon.controlPoints?.includes(node as Konva.Circle)) return polygon.konvaShape ?? null
    }
    return null
  }

  const queueKonvaNode = (node: Konva.Node) => {
    const target = polygonOfControlPoint(node) ?? node
    const found = topLevelUnder(target)
    if (!found) return
    const serialized = serializeNode(state, found.layer, found.top)
    if (serialized) queue(found.layer, serialized)
  }

  const onDragMove = (event: Konva.KonvaEventObject<DragEvent>) => queueKonvaNode(event.target)
  const onTransform = () => {
    for (const node of state.layers.transformer?.nodes() ?? []) queueKonvaNode(node)
  }
  const onEnd = () => controller.finish()

  // Drag events bubble to the stage. Transform events do not: Konva's
  // Transformer fires them on itself and on each node with the non-bubbling
  // `_fire`, for a resize and a rotation alike, so they are heard on the
  // transformer itself.
  const transformer = state.layers.transformer
  stage.on('dragstart.preview', begin)
  stage.on('dragmove.preview', onDragMove)
  stage.on('dragend.preview', onEnd)
  transformer?.on('transformstart.preview', begin)
  transformer?.on('transform.preview', onTransform)
  transformer?.on('transformend.preview', onEnd)

  const controller: DocumentPreviewController = {
    previewNode: queue,
    previewKonvaNodes(nodes) {
      for (const node of nodes) queueKonvaNode(node)
    },
    discard(layer, id) {
      upserts.delete(id)
      if (streamed.has(id)) {
        deletes.set(id, layer)
        schedule()
      }
    },
    finish() {
      if (raf !== null) cancelAnimationFrame(raf)
      raf = null
      upserts.clear()
      flush()
      streamed.clear()
      if (!interacting) return
      interacting = false
      callbacks.onInteraction(false)
    },
    dispose() {
      if (raf !== null) cancelAnimationFrame(raf)
      raf = null
      stage.off('.preview')
      transformer?.off('.preview')
    }
  }
  return controller
}
