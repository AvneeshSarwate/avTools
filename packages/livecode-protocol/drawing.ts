/**
 * Drawing entity wire types: the handwriting canvas's lossless document as a
 * named, revisioned engine entity, plus the `/drawing/set` request/result.
 *
 * The document and render-data types themselves live in
 * `@avtools/drawing-document` (imported relatively so this package stays free
 * of import-map dependencies); they are re-exported here so clients need only
 * the protocol package.
 */

import type { DrawingDocument } from "../drawing-document/mod.ts";

export type {
  CircleRenderData,
  DrawingCircleNode,
  DrawingDocument,
  DrawingGroupNode,
  DrawingLayer,
  DrawingLayerName,
  DrawingNode,
  DrawingPolygonNode,
  DrawingRenderData,
  DrawingStrokeNode,
  DrawingTransform,
  FlattenedCircle,
  FlattenedPolygon,
  FlattenedStroke,
  FlattenedStrokeGroup,
  FreehandRenderData,
  PolygonRenderData,
} from "../drawing-document/mod.ts";

export interface DrawingEntity {
  name: string;
  rev: number;
  data: DrawingDocument;
  updatedAt: number;
  updatedBy: string;
}

/** Whole-document replace with optional compare-and-set, like animation timelines. */
export interface SetDrawingRequest {
  name: string;
  data: DrawingDocument;
  originId?: string;
  expectedRev?: number;
}

export type DrawingSetResult =
  | { ok: true; drawing: DrawingEntity }
  | { ok: false; error: string; current?: DrawingEntity };
