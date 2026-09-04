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
  clearStrokesInState,
  createStrokeShape,
  getCurrentFreehandState,
  setStrokeGroupInState,
  setStrokeInState,
  updateBakedFreehandData,
  updateFreehandDraggableStates,
  updateTimelineState,
  type FreehandStroke
} from './freehandTool'
import { createPolygonNode, getCurrentPolygonState, updateBakedPolygonData, updatePolygonControlPoints } from './polygonTool'
import { createCircleNode, getCurrentCircleState, updateBakedCircleData } from './circleTool'
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

const serializeNode = (state: CanvasRuntimeState, layer: DrawingLayerName, konvaNode: Konva.Node): DrawingNode | null => {
  if (konvaNode instanceof Konva.Group) {
    if (layer === 'polygon') return null
    const children: DrawingNode[] = []
    konvaNode.getChildren().forEach((child) => {
      const node = serializeNode(state, layer, child)
      if (node) children.push(node)
    })
    const group: DrawingGroupNode = {
      type: 'group',
      id: konvaNode.id() || uid('group_'),
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
      id: konvaNode.id() || uid('poly_'),
      points: [...konvaNode.points()],
      closed: konvaNode.closed(),
      creationTime: runtime?.creationTime ?? 0,
      transform: readTransform(konvaNode)
    }
    return withMetadata(node, konvaNode)
  }

  if (layer === 'circle' && konvaNode instanceof Konva.Circle) {
    const runtime = state.circle.shapes.get(konvaNode.id())
    const node: DrawingCircleNode = {
      type: 'circle',
      id: konvaNode.id() || uid('circle_'),
      radius: konvaNode.radius(),
      creationTime: konvaNode.getAttr('creationTime') ?? runtime?.creationTime ?? 0,
      transform: readTransform(konvaNode)
    }
    return withMetadata(node, konvaNode)
  }

  return null
}

// ==================== hydrate ====================

/**
 * Replace the whole scene with `input`. `state.hydrating` suppresses
 * `document-update` for the duration, so a document pushed in by a host is never
 * echoed back as an edit. Throws on an invalid document, leaving the scene
 * untouched.
 */
export const hydrateDrawingDocument = (state: CanvasRuntimeState, input: DrawingDocument) => {
  const doc = normalizeDrawingDocument(input)
  const stage = state.stage
  const freehandGroup = state.groups.freehandShape
  const polygonGroup = state.groups.polygonShapes
  const circleGroup = state.groups.circleShapes
  if (!stage || !freehandGroup || !polygonGroup || !circleGroup) {
    throw new Error('Cannot hydrate a drawing before the canvas has mounted')
  }

  state.hydrating = true
  try {
    freehandGroup.destroyChildren()
    clearStrokesInState(state)
    selectionStore.clear(state)
    applyTransform(freehandGroup, doc.freehand.transform)
    for (const node of doc.freehand.nodes) buildFreehandNode(state, node, freehandGroup)
    freehandGroup.getChildren().forEach((child) => {
      if (child instanceof Konva.Group) attachHandlersRecursively(state, child)
    })
    updateFreehandDraggableStates(state)
    updateTimelineState(state)

    polygonGroup.destroyChildren()
    state.polygon.shapes.clear()
    state.polygon.groups.clear()
    applyTransform(polygonGroup, doc.polygon.transform)
    for (const node of doc.polygon.nodes) {
      if (node.type === 'polygon') buildPolygonNode(state, node, polygonGroup)
    }
    state.groups.polygonControls?.destroyChildren()
    if (state.activeTool.value === 'polygon' && state.polygon.mode.value === 'edit') {
      updatePolygonControlPoints(state)
    }

    circleGroup.destroyChildren()
    state.circle.shapes.clear()
    applyTransform(circleGroup, doc.circle.transform)
    for (const node of doc.circle.nodes) buildCircleNode(state, node, circleGroup)

    stage.batchDraw()

    // The bake callbacks emit state-update (sketches rely on it) but, while
    // hydrating, not document-update.
    const freehandSnapshot = getCurrentFreehandState(state)
    if (freehandSnapshot) state.freehand.serializedState = JSON.stringify(freehandSnapshot)
    const polygonSnapshot = getCurrentPolygonState(state)
    if (polygonSnapshot) state.polygon.serializedState = JSON.stringify(polygonSnapshot)
    const circleSnapshot = getCurrentCircleState(state)
    if (circleSnapshot) state.circle.serializedState = JSON.stringify(circleSnapshot)
    updateBakedFreehandData(state)
    updateBakedPolygonData(state)
    updateBakedCircleData(state)
  } finally {
    state.hydrating = false
  }
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
  const line = createPolygonNode(state, node.id, [...node.points], node.creationTime, parent)
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
