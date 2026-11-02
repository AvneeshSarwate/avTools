import {
  createEmptyDrawingDocument, normalizeDrawingDocument,
  type DrawingDocument, type DrawingLayerName, type DrawingNode,
} from '@avtools/drawing-document';

export {createEmptyDrawingDocument, normalizeDrawingDocument};
export type {DrawingDocument};
export interface Preview {
  upserts: Array<{layer: DrawingLayerName; node: DrawingNode}>;
  deletes: Array<{layer: DrawingLayerName; id: string}>;
}
export type DrawingMessage =
  | {type: 'snapshot'; revision: number; document: DrawingDocument}
  | {type: 'preview'; revision: number; base: number; preview: Preview};

export function applyPreview(document: DrawingDocument, preview: Preview): DrawingDocument {
  if (!preview || !Array.isArray(preview.upserts) || !Array.isArray(preview.deletes)) throw Error('Invalid preview');
  const next: DrawingDocument = {
    ...document,
    freehand: {...document.freehand, nodes: [...document.freehand.nodes]},
    polygon: {...document.polygon, nodes: [...document.polygon.nodes]},
    circle: {...document.circle, nodes: [...document.circle.nodes]},
  };
  const layer = (name: string) => {
    if (name !== 'freehand' && name !== 'polygon' && name !== 'circle') throw Error('Invalid drawing layer');
    return next[name];
  };
  for (const item of preview.deletes) {
    const target = layer(item.layer);
    target.nodes = target.nodes.filter(node => node.id !== item.id);
  }
  for (const item of preview.upserts) {
    const target = layer(item.layer);
    const index = target.nodes.findIndex(node => node.id === item.node?.id);
    if (index < 0) target.nodes.push(item.node);
    else target.nodes[index] = item.node;
  }
  // Canonical validation catches duplicate ids, invalid geometry and metadata.
  return normalizeDrawingDocument(next);
}
