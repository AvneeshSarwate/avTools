// Module-facing entry for the drawing entity: declare a drawing, read its
// baked render data every frame, and write shapes into it from code. The
// document format and node constructors come from `@avtools/drawing-document`.
export {
  drawing,
  type DrawingHandle,
  type DrawingWriteOptions,
} from "@avtools/livecode-engine/drawing_store.ts";
export {
  bakeDrawingDocument,
  createEmptyDrawingDocument,
  findDrawingNode,
  makeCircleNode,
  makeGroupNode,
  makePolygonNode,
  makeStrokeNode,
  removeDrawingNode,
  upsertDrawingNode,
} from "@avtools/drawing-document";
export type {
  CircleRenderData,
  DrawingCircleNode,
  DrawingDocument,
  DrawingEntity,
  DrawingGroupNode,
  DrawingLayer,
  DrawingNode,
  DrawingPolygonNode,
  DrawingRenderData,
  DrawingSetResult,
  DrawingStrokeNode,
  DrawingTransform,
  FlattenedCircle,
  FlattenedPolygon,
  FlattenedStroke,
  FlattenedStrokeGroup,
  FreehandRenderData,
  PolygonRenderData,
} from "@avtools/livecode-protocol";
