// Baked render data derived from the document. The document is the element's
// truth, so its Konva-free bake (`@avtools/drawing-document`, the same code
// the livecode engine runs) is the baked form too; it is recomputed lazily,
// at most once per document change. The older Konva-walking bakes in the
// tool modules remain only to prove the two agree (`getKonvaRenderData`).
import {
  bakeDrawingDocument,
  listDrawingNodeIds,
  type DrawingDocument,
  type DrawingLayerName,
} from '@avtools/drawing-document'
import type { CanvasRenderData, CanvasRuntimeState, CanvasStateSnapshot, CanvasStateSnapshotBase } from './canvasState'
import { serializeDrawingDocument } from './drawingDocument'

const LAYERS: readonly DrawingLayerName[] = ['freehand', 'polygon', 'circle']

/** Something changed the scene; the next read re-bakes. */
export const markBakeDirty = (state: CanvasRuntimeState) => {
  state.bake.dirty = true
}

/**
 * Serialize and bake the document unless nothing changed since the last
 * time. Returns the canonical document and whether the bake was redone.
 */
export const ensureBaked = (state: CanvasRuntimeState): { document: DrawingDocument; json: string; rebaked: boolean } => {
  if (!state.bake.dirty && state.bake.document) {
    return { document: state.bake.document, json: state.bake.json, rebaked: false }
  }
  const document = serializeDrawingDocument(state)
  const json = JSON.stringify(document)
  state.bake.dirty = false
  if (state.bake.document && json === state.bake.json) {
    state.bake.document = document
    return { document, json, rebaked: false }
  }
  const baked = bakeDrawingDocument(document)
  state.freehand.bakedRenderData = baked.freehand
  state.freehand.bakedGroupMap = baked.freehandGroupMap
  state.polygon.bakedRenderData = baked.polygon
  state.circle.bakedRenderData = baked.circle
  state.circle.bakedGroupMap = baked.circleGroupMap
  state.bake.document = document
  state.bake.json = json
  return { document, json, rebaked: true }
}

export const collectCanvasRenderData = (state: CanvasRuntimeState): CanvasRenderData => {
  ensureBaked(state)
  return {
    freehand: state.freehand.bakedRenderData,
    polygon: state.polygon.bakedRenderData,
    circle: state.circle.bakedRenderData
  }
}

// ---- state-update snapshots (simple mode) ----

interface EmittedLayer {
  /** Canonical JSON per top-level node id, in document order. */
  nodeJson: Map<string, string>
  /** Every id in each top-level node's subtree (a circle group's circles are baked flat). */
  subtreeIds: Map<string, string[]>
}

export interface EmittedSnapshot {
  layers: Record<DrawingLayerName, EmittedLayer>
  base: CanvasStateSnapshotBase
}

const indexLayer = (document: DrawingDocument, layer: DrawingLayerName): EmittedLayer => {
  const nodeJson = new Map<string, string>()
  const subtreeIds = new Map<string, string[]>()
  for (const node of document[layer].nodes) {
    nodeJson.set(node.id, JSON.stringify(node))
    subtreeIds.set(node.id, [...listDrawingNodeIds([node])])
  }
  return { nodeJson, subtreeIds }
}

const emptyBase = (): CanvasStateSnapshotBase => ({
  freehand: { bakedRenderData: [], bakedGroupMap: {} },
  polygon: { bakedRenderData: [] },
  circle: { bakedRenderData: [], bakedGroupMap: {} }
})

const currentBase = (state: CanvasRuntimeState): CanvasStateSnapshotBase => ({
  freehand: {
    bakedRenderData: state.freehand.bakedRenderData,
    bakedGroupMap: state.freehand.bakedGroupMap
  },
  polygon: {
    bakedRenderData: state.polygon.bakedRenderData
  },
  circle: {
    bakedRenderData: state.circle.bakedRenderData,
    bakedGroupMap: state.circle.bakedGroupMap
  }
})

// The baked items a set of top-level nodes accounts for. Freehand and polygon
// bake one top-level item per node under the node's id; circles bake flat,
// so a group's circles are found through its subtree ids.
const bakedItemsFor = (layer: DrawingLayerName, ids: string[], index: EmittedLayer, base: CanvasStateSnapshotBase): any[] => {
  if (layer === 'circle') {
    const wanted = new Set(ids.flatMap((id) => index.subtreeIds.get(id) ?? [id]))
    return base.circle.bakedRenderData.filter((item) => wanted.has(item.id))
  }
  const wanted = new Set(ids)
  const items: Array<{ id: string }> = layer === 'freehand' ? base.freehand.bakedRenderData : base.polygon.bakedRenderData
  return items.filter((item) => wanted.has(item.id))
}

const pushItems = (target: CanvasStateSnapshotBase, layer: DrawingLayerName, items: any[]) => {
  if (layer === 'freehand') target.freehand.bakedRenderData.push(...items)
  else if (layer === 'polygon') target.polygon.bakedRenderData.push(...items)
  else target.circle.bakedRenderData.push(...items)
}

/**
 * The `state-update` payload: the baked render data plus which top-level
 * nodes were added, deleted, or changed since the previous emission,
 * decided by comparing canonical node JSON by id. `changed` is false when
 * nothing differs from what was last emitted, so a host can skip the event.
 */
export const createStateSnapshot = (
  state: CanvasRuntimeState,
  previous: EmittedSnapshot | null
): { snapshot: CanvasStateSnapshot; emitted: EmittedSnapshot; changed: boolean } => {
  const { document, json } = ensureBaked(state)
  const base = currentBase(state)
  const layers = {
    freehand: indexLayer(document, 'freehand'),
    polygon: indexLayer(document, 'polygon'),
    circle: indexLayer(document, 'circle')
  }
  const added = emptyBase()
  const deleted = emptyBase()
  const changed = emptyBase()
  let any = previous === null
  for (const layer of LAYERS) {
    const now = layers[layer]
    const before = previous?.layers[layer]
    const addedIds: string[] = []
    const changedIds: string[] = []
    const deletedIds: string[] = []
    for (const [id, json] of now.nodeJson) {
      const prior = before?.nodeJson.get(id)
      if (prior === undefined) addedIds.push(id)
      else if (prior !== json) changedIds.push(id)
    }
    if (before) for (const id of before.nodeJson.keys()) if (!now.nodeJson.has(id)) deletedIds.push(id)
    if (addedIds.length || changedIds.length || deletedIds.length) any = true
    pushItems(added, layer, bakedItemsFor(layer, addedIds, now, base))
    pushItems(changed, layer, bakedItemsFor(layer, changedIds, now, base))
    if (before && previous) pushItems(deleted, layer, bakedItemsFor(layer, deletedIds, before, previous.base))
  }
  return {
    snapshot: { ...base, added, deleted, changed, documentState: json },
    emitted: { layers, base },
    changed: any
  }
}
