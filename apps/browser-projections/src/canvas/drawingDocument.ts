// The canvas's lossless document form (`@avtools/drawing-document`, shared with
// the livecode engine): serialize the live Konva scene to a DrawingDocument and
// rebuild the scene from one. Unlike the baked render data, a round trip through
// the document is exact.

import Konva from 'konva'
import {
  createEmptyDrawingDocument,
  normalizeDrawingDocument,
  type DrawingCircleNode,
  type DrawingDocument,
  type DrawingGroupNode,
  type DrawingLayer,
  type DrawingLayerName,
  type DrawingNode,
  type DrawingPolygonNode,
  type DrawingStrokeNode,
  type DrawingTransform,
} from '@avtools/drawing-document'
import type { CanvasRuntimeState } from './canvasState'
import { createGroupItem } from './CanvasItem'
import * as selectionStore from './selectionStore'
import {
  attachHandlersRecursively,
  createStrokeShape,
  setStrokeGroupInState,
  setStrokeInState,
  updateBakedFreehandData,
  updateFreehandDraggableStates,
  updateTimelineState,
  type FreehandStroke
} from './freehandTool'
import { createPolygonNode, updateBakedPolygonData, updatePolygonControlPoints } from './polygonTool'
import { createCircleNode, updateBakedCircleData } from './circleTool'
import { getPointsBounds, uid } from './canvasUtils'

const TRANSFORM_ATTRS = ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'skewX', 'skewY', 'offsetX', 'offsetY'] as const

const IDENTITY_ATTRS: Required<DrawingTransform> = {
  x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, skewX: 0, skewY: 0, offsetX: 0, offsetY: 0
}

// Every transform attribute a node carries, defaults included. The canonical
// form (default fields dropped) is produced by normalizeDrawingDocument, so
// serialization can stay literal.
const readTransform = (node: Konva.Node): DrawingTransform => {
  const transform: DrawingTransform = {}
  for (const attr of TRANSFORM_ATTRS) {
    transform[attr] = node[attr]() as number
  }
  return transform
}

const applyTransform = (node: Konva.Node, transform: DrawingTransform | undefined, base: DrawingTransform = {}) => {
  node.setAttrs({ ...IDENTITY_ATTRS, ...base, ...transform })
}

const readMetadata = (node: Konva.Node): Record<string, unknown> | undefined => {
  const metadata = node.getAttr('metadata')
  return metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : undefined
}

const withMetadata = <T extends DrawingNode>(node: T, konvaNode: Konva.Node): T => {
  const metadata = readMetadata(konvaNode)
  if (metadata !== undefined) node.metadata = metadata
  return node
}

// ==================== serialize ====================

export const serializeDrawingDocument = (state: CanvasRuntimeState): DrawingDocument => {
  const doc = createEmptyDrawingDocument()
  doc.freehand = serializeLayer(state, 'freehand', state.groups.freehandShape)
  doc.polygon = serializeLayer(state, 'polygon', state.groups.polygonShapes)
  doc.circle = serializeLayer(state, 'circle', state.groups.circleShapes)
  return normalizeDrawingDocument(doc)
}

const serializeLayer = (state: CanvasRuntimeState, layer: DrawingLayerName, container?: Konva.Group): DrawingLayer => {
  if (!container) return { nodes: [] }
  const nodes: DrawingNode[] = []
  container.getChildren().forEach((child) => {
    const node = serializeNode(state, layer, child)
    if (node) nodes.push(node)
  })
  return { transform: readTransform(container), nodes }
}

// A node without a Konva id gets one here and keeps it: the document, the
// in-gesture previews, and the engine's node patches all address by id, so an
// id must not change between two serializations of the same node.
const stableId = (konvaNode: Konva.Node, prefix: string): string => {
  if (!konvaNode.id()) konvaNode.id(uid(prefix))
  return konvaNode.id()
}

/** One Konva node (and, for a group, its subtree) as a document node; null for anything the layer does not hold. */
export const serializeNode = (state: CanvasRuntimeState, layer: DrawingLayerName, konvaNode: Konva.Node): DrawingNode | null => {
  if (konvaNode instanceof Konva.Group) {
    if (layer === 'polygon') return null
    const children: DrawingNode[] = []
    konvaNode.getChildren().forEach((child) => {
      const node = serializeNode(state, layer, child)
      if (node) children.push(node)
    })
    const group: DrawingGroupNode = {
      type: 'group',
      id: stableId(konvaNode, 'group_'),
      transform: readTransform(konvaNode),
      children
    }
    return withMetadata(group, konvaNode)
  }

  if (layer === 'freehand' && konvaNode instanceof Konva.Path) {
    const stroke = state.freehand.strokes.get(konvaNode.id())
    if (!stroke) return null
    const node: DrawingStrokeNode = {
      type: 'stroke',
      id: stroke.id,
      points: [...stroke.points],
      timestamps: [...stroke.timestamps],
      creationTime: stroke.creationTime,
      isFreehand: stroke.isFreehand,
      transform: readTransform(konvaNode)
    }
    return withMetadata(node, konvaNode)
  }

  if (layer === 'polygon' && konvaNode instanceof Konva.Line) {
    const runtime = state.polygon.shapes.get(konvaNode.id())
    const node: DrawingPolygonNode = {
      type: 'polygon',
      id: stableId(konvaNode, 'poly_'),
      points: [...konvaNode.points()],
      closed: konvaNode.closed(),
      ...(konvaNode.tension() !== 0 && { tension: konvaNode.tension() }),
      creationTime: runtime?.creationTime ?? 0,
      transform: readTransform(konvaNode)
    }
    return withMetadata(node, konvaNode)
  }

  if (layer === 'circle' && konvaNode instanceof Konva.Circle) {
    const runtime = state.circle.shapes.get(konvaNode.id())
    const node: DrawingCircleNode = {
      type: 'circle',
      id: stableId(konvaNode, 'circle_'),
      radius: konvaNode.radius(),
      creationTime: konvaNode.getAttr('creationTime') ?? runtime?.creationTime ?? 0,
      transform: readTransform(konvaNode)
    }
    return withMetadata(node, konvaNode)
  }

  return null
}

// ==================== reconcile ====================

const LAYER_NAMES: readonly DrawingLayerName[] = ['freehand', 'polygon', 'circle']

const layerGroup = (state: CanvasRuntimeState, layer: DrawingLayerName): Konva.Group | undefined =>
  layer === 'freehand' ? state.groups.freehandShape : layer === 'polygon' ? state.groups.polygonShapes : state.groups.circleShapes

const buildNode = (state: CanvasRuntimeState, layer: DrawingLayerName, node: DrawingNode, parent: Konva.Group) => {
  if (layer === 'freehand') buildFreehandNode(state, node, parent)
  else if (layer === 'polygon') { if (node.type === 'polygon') buildPolygonNode(state, node, parent) }
  else buildCircleNode(state, node, parent)
}

// Forget everything the runtime holds about a Konva subtree (stroke/shape
// records, canvas items, selection membership), then destroy it.
const forgetSubtree = (state: CanvasRuntimeState, layer: DrawingLayerName, root: Konva.Node) => {
  const visit = (node: Konva.Node) => {
    const id = node.id()
    const item = id ? state.canvasItems.get(id) : undefined
    if (item && state.selection.items.has(item)) selectionStore.remove(state, item)
    if (id) {
      state.canvasItems.delete(id)
      if (layer === 'freehand') {
        state.freehand.strokes.delete(id)
        state.freehand.strokeGroups.delete(id)
      } else if (layer === 'polygon') {
        state.polygon.shapes.delete(id)
      } else {
        state.circle.shapes.delete(id)
      }
    }
    if (node instanceof Konva.Container) node.getChildren().forEach(visit)
  }
  visit(root)
  root.destroy()
}

const isSelected = (state: CanvasRuntimeState, id: string): boolean => {
  const item = state.canvasItems.get(id)
  return item !== undefined && state.selection.items.has(item)
}

/**
 * Bring the scene to `input`, touching only what differs: each layer's
 * top-level nodes are compared by id and canonical JSON, and only changed
 * ones are rebuilt (a nested change rebuilds its top-level group). Untouched
 * Konva nodes keep their identity and selection; a rebuilt node that was
 * selected is reselected. Returns the layers that changed. Runs with
 * `state.hydrating` set, so nothing in here emits `document-update`. Throws
 * on an invalid document before touching the scene.
 */
export const reconcileDrawingDocument = (state: CanvasRuntimeState, input: DrawingDocument): Set<DrawingLayerName> => {
  const doc = normalizeDrawingDocument(input)
  const stage = state.stage
  if (!stage || !state.groups.freehandShape || !state.groups.polygonShapes || !state.groups.circleShapes) {
    throw new Error('Cannot hydrate a drawing before the canvas has mounted')
  }
  const current = serializeDrawingDocument(state)
  const changedLayers = new Set<DrawingLayerName>()

  state.hydrating = true
  try {
    for (const layer of LAYER_NAMES) {
      const group = layerGroup(state, layer)!
      let changed = false
      const currentJson = new Map(current[layer].nodes.map((node) => [node.id, JSON.stringify(node)]))
      const nextIds = new Set(doc[layer].nodes.map((node) => node.id))
      const children = new Map<string, Konva.Node>()
      group.getChildren().forEach((child) => {
        // serializeDrawingDocument named any id-less top-level node; find it again by that name.
        if (child.id()) children.set(child.id(), child)
      })

      for (const [id, child] of children) {
        if (!nextIds.has(id)) {
          forgetSubtree(state, layer, child)
          changed = true
        }
      }
      for (const node of doc[layer].nodes) {
        if (currentJson.get(node.id) === JSON.stringify(node)) continue
        const existing = children.get(node.id)
        const wasSelected = existing !== undefined && isSelected(state, node.id)
        if (existing) forgetSubtree(state, layer, existing)
        buildNode(state, layer, node, group)
        if (layer === 'freehand' && node.type === 'group') {
          const built = group.findOne(`#${node.id}`)
          if (built instanceof Konva.Group) attachHandlersRecursively(state, built)
        }
        changed = true
        if (wasSelected) {
          const item = state.canvasItems.get(node.id)
          if (item) selectionStore.add(state, item, true)
        }
      }
      if (JSON.stringify(current[layer].transform) !== JSON.stringify(doc[layer].transform)) {
        applyTransform(group, doc[layer].transform)
        changed = true
      }
      const order = doc[layer].nodes.map((node) => node.id)
      const actual = group.getChildren().map((child) => child.id())
      if (order.some((id, index) => actual[index] !== id)) {
        order.forEach((id, index) => group.findOne(`#${id}`)?.zIndex(index))
        changed = true
      }
      if (!changed) continue
      changedLayers.add(layer)
      if (layer === 'freehand') {
        updateFreehandDraggableStates(state)
        updateTimelineState(state)
      } else if (layer === 'polygon') {
        state.groups.polygonControls?.destroyChildren()
        if (state.activeTool.value === 'polygon' && state.polygon.mode.value === 'edit') {
          updatePolygonControlPoints(state)
        }
      }
    }
    if (changedLayers.size > 0) {
      stage.batchDraw()
      // The bake callbacks emit state-update (sketches rely on it) but, while
      // hydrating, not document-update.
      if (changedLayers.has('freehand')) updateBakedFreehandData(state)
      if (changedLayers.has('polygon')) updateBakedPolygonData(state)
      if (changedLayers.has('circle')) updateBakedCircleData(state)
    }
  } finally {
    state.hydrating = false
  }
  return changedLayers
}

const buildFreehandNode = (state: CanvasRuntimeState, node: DrawingNode, parent: Konva.Container) => {
  if (node.type === 'group') {
    const group = new Konva.Group({ id: node.id, draggable: false })
    applyTransform(group, node.transform)
    if (node.metadata) group.setAttr('metadata', node.metadata)
    parent.add(group)
    for (const child of node.children) buildFreehandNode(state, child, group)
    createGroupItem(state, group)
    setStrokeGroupInState(state, node.id, {
      id: node.id,
      strokeIds: group.find('Path').map((path) => path.id()),
      group
    })
    return
  }
  if (node.type !== 'stroke') {
    throw new Error(`Unexpected ${node.type} node on the freehand layer`)
  }
  // createStrokeShape places the path at the points' minimum corner; a stored
  // transform overrides that position.
  const shape = createStrokeShape(state, node.points, node.id)
  const bounds = getPointsBounds(node.points)
  applyTransform(shape, node.transform, { x: bounds.minX, y: bounds.minY })
  if (node.metadata) shape.setAttr('metadata', node.metadata)
  parent.add(shape)
  const stroke: FreehandStroke = {
    id: node.id,
    points: [...node.points],
    timestamps: [...node.timestamps],
    originalPath: shape.data(),
    creationTime: node.creationTime,
    isFreehand: node.isFreehand,
    shape
  }
  setStrokeInState(state, node.id, stroke)
}

const buildPolygonNode = (state: CanvasRuntimeState, node: DrawingPolygonNode, parent: Konva.Container) => {
  const line = createPolygonNode(state, node.id, [...node.points], node.creationTime, parent, node.tension ?? 0)
  if (!node.closed) {
    line.closed(false)
    const runtime = state.polygon.shapes.get(node.id)
    if (runtime) runtime.closed = false
  }
  applyTransform(line, node.transform)
  if (node.metadata) line.setAttr('metadata', node.metadata)
}

const buildCircleNode = (state: CanvasRuntimeState, node: DrawingNode, parent: Konva.Container) => {
  if (node.type === 'group') {
    const group = new Konva.Group({ id: node.id, draggable: false })
    applyTransform(group, node.transform)
    if (node.metadata) group.setAttr('metadata', node.metadata)
    parent.add(group)
    for (const child of node.children) buildCircleNode(state, child, group)
    createGroupItem(state, group)
    return
  }
  if (node.type !== 'circle') {
    throw new Error(`Unexpected ${node.type} node on the circle layer`)
  }
  const shape = createCircleNode(state, node.id, {
    x: node.transform?.x ?? 0,
    y: node.transform?.y ?? 0,
    radius: node.radius,
    creationTime: node.creationTime,
    parent
  })
  applyTransform(shape, node.transform)
  if (node.metadata) shape.setAttr('metadata', node.metadata)
}
