/**
 * `@avtools/drawing-document`: the lossless, Konva-free form of a handwriting
 * canvas drawing, and the bake that turns it into the flattened render data
 * sketches consume.
 *
 * The BAKED render data (`FlattenedStroke` and friends, unchanged from
 * `apps/browser-projections/src/canvas/canvasState.ts`) is world-space
 * geometry with every transform applied. It is what modules read. It cannot
 * be loaded back into the canvas without loss: transforms are folded into
 * points, circle groups are gone, and stroke provenance is missing.
 *
 * The DOCUMENT keeps exactly what the canvas holds: per-node transforms in
 * Konva's vocabulary, group nesting on every layer, raw stroke points with
 * their timing, creation order, and per-node metadata. It is the value the
 * livecode `drawing` entity stores, the form the canvas hydrates from, and the
 * form code writes. `bakeDrawingDocument` derives the render data from it
 * without Konva, so a module can read a drawing no view has ever displayed.
 */

import {
  type AffineMatrix,
  applyMatrix,
  type DrawingTransform,
  multiplyMatrices,
  transformToMatrix,
} from "./transform.ts";

export type { AffineMatrix, DrawingTransform } from "./transform.ts";
export {
  applyMatrix,
  multiplyMatrices,
  transformToMatrix,
} from "./transform.ts";

export const DRAWING_DOCUMENT_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Document types
// ---------------------------------------------------------------------------

export interface DrawingNodeBase {
  /** Unique across the whole document; the canvas uses it as the Konva id. */
  id: string;
  /** Local transform; absent means identity. See `DrawingStrokeNode` for the stroke exception. */
  transform?: DrawingTransform;
  /** Free-form JSON the metadata editor shows; `metadata.name` also keys the baked group maps. */
  metadata?: Record<string, unknown>;
}

export interface DrawingStrokeNode extends DrawingNodeBase {
  type: "stroke";
  /**
   * Flat `[x0, y0, x1, y1, ...]` in the coordinates the stroke was drawn in.
   * The canvas positions a stroke at the minimum x/y of these points and draws
   * the points relative to that corner, so a stroke's `transform.x`/`y`
   * DEFAULT TO THAT MINIMUM rather than to zero; every other transform field
   * defaults as usual.
   */
  points: number[];
  /** Milliseconds since the stroke started, one entry per point pair. */
  timestamps: number[];
  /** Wall-clock creation time; orders strokes in timeline playback. */
  creationTime: number;
  /** True when the stroke has real drawing timing and takes part in playback. */
  isFreehand: boolean;
}

export interface DrawingGroupNode extends DrawingNodeBase {
  type: "group";
  children: DrawingNode[];
}

export interface DrawingPolygonNode extends DrawingNodeBase {
  type: "polygon";
  /** Flat `[x0, y0, ...]` in the node's local space. */
  points: number[];
  closed: boolean;
  creationTime: number;
}

export interface DrawingCircleNode extends DrawingNodeBase {
  type: "circle";
  /** Radius before the transform; an ellipse is a circle with unequal scales. */
  radius: number;
  creationTime: number;
}

export type DrawingNode =
  | DrawingStrokeNode
  | DrawingGroupNode
  | DrawingPolygonNode
  | DrawingCircleNode;

/**
 * One tool's layer. The layer container itself can carry a transform (the
 * canvas's rescale command scales the container rather than each node).
 */
export interface DrawingLayer {
  transform?: DrawingTransform;
  nodes: DrawingNode[];
}

export type DrawingLayerName = "freehand" | "polygon" | "circle";
export const DRAWING_LAYER_NAMES: readonly DrawingLayerName[] = [
  "freehand",
  "polygon",
  "circle",
];

/**
 * A whole drawing. `freehand` holds strokes and groups of strokes, `polygon`
 * holds polygons only (the canvas cannot group them), `circle` holds circles
 * and groups of circles.
 */
export interface DrawingDocument {
  version: typeof DRAWING_DOCUMENT_VERSION;
  freehand: DrawingLayer;
  polygon: DrawingLayer;
  circle: DrawingLayer;
}

// ---------------------------------------------------------------------------
// Baked render data (the sketch-facing format; identical to the canvas's own)
// ---------------------------------------------------------------------------

export interface FlattenedStroke {
  type: "stroke";
  id: string;
  points: { x: number; y: number; ts: number }[];
  metadata?: Record<string, unknown>;
}

export interface FlattenedStrokeGroup {
  type: "strokeGroup";
  id: string;
  children: (FlattenedStroke | FlattenedStrokeGroup)[];
  metadata?: Record<string, unknown>;
}

export type FreehandRenderData = FlattenedStrokeGroup[];

export interface FlattenedPolygon {
  type: "polygon";
  id: string;
  points: { x: number; y: number }[];
  metadata?: Record<string, unknown>;
}

export type PolygonRenderData = FlattenedPolygon[];

export interface FlattenedCircle {
  type: "circle";
  id: string;
  center: { x: number; y: number };
  /** Present only when the baked ellipse is a true circle. */
  r?: number;
  rx: number;
  ry: number;
  /** Radians; the world-space direction of the rx axis. */
  rotation: number;
  metadata?: Record<string, unknown>;
}

export type CircleRenderData = FlattenedCircle[];

/** Every layer's baked form plus the name/id keyed index maps the canvas emits. */
export interface DrawingRenderData {
  freehand: FreehandRenderData;
  freehandGroupMap: Record<string, number[]>;
  polygon: PolygonRenderData;
  circle: CircleRenderData;
  circleGroupMap: Record<string, number[]>;
}

// ---------------------------------------------------------------------------
// Construction helpers
// ---------------------------------------------------------------------------

export function createEmptyDrawingDocument(): DrawingDocument {
  return {
    version: DRAWING_DOCUMENT_VERSION,
    freehand: { nodes: [] },
    polygon: { nodes: [] },
    circle: { nodes: [] },
  };
}

function newId(prefix: string): string {
  return `${prefix}${crypto.randomUUID()}`;
}

export interface MakeStrokeNodeOptions {
  id?: string;
  points: number[];
  /** Defaults to zeros, which marks the stroke as having no drawing timing. */
  timestamps?: number[];
  creationTime?: number;
  transform?: DrawingTransform;
  metadata?: Record<string, unknown>;
}

export function makeStrokeNode(
  options: MakeStrokeNodeOptions,
): DrawingStrokeNode {
  const timestamps = options.timestamps ??
    new Array(Math.floor(options.points.length / 2)).fill(0);
  const node: DrawingStrokeNode = {
    type: "stroke",
    id: options.id ?? newId("stroke_"),
    points: [...options.points],
    timestamps: [...timestamps],
    creationTime: options.creationTime ?? Date.now(),
    isFreehand: timestamps.some((ts) => ts > 0),
  };
  if (options.transform) node.transform = { ...options.transform };
  if (options.metadata) node.metadata = { ...options.metadata };
  return node;
}

export interface MakePolygonNodeOptions {
  id?: string;
  points: number[];
  closed?: boolean;
  creationTime?: number;
  transform?: DrawingTransform;
  metadata?: Record<string, unknown>;
}

export function makePolygonNode(
  options: MakePolygonNodeOptions,
): DrawingPolygonNode {
  const node: DrawingPolygonNode = {
    type: "polygon",
    id: options.id ?? newId("poly_"),
    points: [...options.points],
    closed: options.closed ?? true,
    creationTime: options.creationTime ?? Date.now(),
  };
  if (options.transform) node.transform = { ...options.transform };
  if (options.metadata) node.metadata = { ...options.metadata };
  return node;
}

export interface MakeCircleNodeOptions {
  id?: string;
  /** Center, written into `transform.x`/`y`. */
  x: number;
  y: number;
  radius: number;
  creationTime?: number;
  /** Further transform fields (scales, rotation); `x`/`y` here override the center. */
  transform?: DrawingTransform;
  metadata?: Record<string, unknown>;
}

export function makeCircleNode(
  options: MakeCircleNodeOptions,
): DrawingCircleNode {
  const node: DrawingCircleNode = {
    type: "circle",
    id: options.id ?? newId("circle_"),
    radius: options.radius,
    creationTime: options.creationTime ?? Date.now(),
    transform: { x: options.x, y: options.y, ...options.transform },
  };
  if (options.metadata) node.metadata = { ...options.metadata };
  return node;
}

export interface MakeGroupNodeOptions {
  id?: string;
  children: DrawingNode[];
  transform?: DrawingTransform;
  metadata?: Record<string, unknown>;
}

export function makeGroupNode(options: MakeGroupNodeOptions): DrawingGroupNode {
  const node: DrawingGroupNode = {
    type: "group",
    id: options.id ?? newId("group_"),
    children: [...options.children],
  };
  if (options.transform) node.transform = { ...options.transform };
  if (options.metadata) node.metadata = { ...options.metadata };
  return node;
}

/** Depth-first search over one layer or the whole document. */
export function findDrawingNode(
  scope: DrawingDocument | DrawingLayer | DrawingNode[],
  id: string,
): DrawingNode | undefined {
  const nodes = Array.isArray(scope)
    ? scope
    : "nodes" in scope
    ? scope.nodes
    : [...scope.freehand.nodes, ...scope.polygon.nodes, ...scope.circle.nodes];
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.type === "group") {
      const found = findDrawingNode(node.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Replace the node with `node.id` wherever it sits in the layer, or append it
 * at the top level when no such node exists. Returns true when it replaced.
 */
export function upsertDrawingNode(
  layer: DrawingLayer,
  node: DrawingNode,
): boolean {
  const replaced = replaceInList(layer.nodes, node);
  if (!replaced) layer.nodes.push(node);
  return replaced;
}

/** Remove the node with `id` from the layer, at any depth. */
export function removeDrawingNode(layer: DrawingLayer, id: string): boolean {
  return removeFromList(layer.nodes, id);
}

function replaceInList(nodes: DrawingNode[], node: DrawingNode): boolean {
  for (let index = 0; index < nodes.length; index += 1) {
    const candidate = nodes[index];
    if (candidate.id === node.id) {
      nodes[index] = node;
      return true;
    }
    if (candidate.type === "group" && replaceInList(candidate.children, node)) {
      return true;
    }
  }
  return false;
}

function removeFromList(nodes: DrawingNode[], id: string): boolean {
  for (let index = 0; index < nodes.length; index += 1) {
    const candidate = nodes[index];
    if (candidate.id === id) {
      nodes.splice(index, 1);
      return true;
    }
    if (candidate.type === "group" && removeFromList(candidate.children, id)) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Validation and canonical form
// ---------------------------------------------------------------------------

const LEAF_TYPE_BY_LAYER: Record<DrawingLayerName, DrawingNode["type"]> = {
  freehand: "stroke",
  polygon: "polygon",
  circle: "circle",
};

/** Layers whose nodes may be groups. Polygons cannot be grouped in the canvas. */
const GROUPABLE_LAYERS: ReadonlySet<DrawingLayerName> = new Set([
  "freehand",
  "circle",
]);

const TRANSFORM_FIELDS: ReadonlyArray<keyof DrawingTransform> = [
  "x",
  "y",
  "scaleX",
  "scaleY",
  "rotation",
  "skewX",
  "skewY",
  "offsetX",
  "offsetY",
];

function transformDefault(field: keyof DrawingTransform): number {
  return field === "scaleX" || field === "scaleY" ? 1 : 0;
}

/**
 * Validate an untrusted value as a drawing document and return a canonical
 * deep copy: fixed key order, default-valued transform fields dropped, every
 * number finite, ids unique across the document, layer/node types matched.
 * Throws with a path-qualified message on the first problem. The canonical
 * form is what makes two equal drawings serialize to equal JSON, which the
 * entity store relies on for no-op detection.
 */
export function normalizeDrawingDocument(
  input: unknown,
  label = "Drawing document",
): DrawingDocument {
  const doc = requireObject(input, label);
  if (doc.version !== undefined && doc.version !== DRAWING_DOCUMENT_VERSION) {
    throw new Error(
      `${label} version must be ${DRAWING_DOCUMENT_VERSION}, got ${
        JSON.stringify(doc.version)
      }`,
    );
  }
  const ids = new Set<string>();
  const normalizeLayer = (name: DrawingLayerName): DrawingLayer => {
    const raw = doc[name];
    if (raw === undefined) return { nodes: [] };
    const layer = requireObject(raw, `${label}.${name}`);
    const nodes = layer.nodes === undefined ? [] : layer.nodes;
    if (!Array.isArray(nodes)) {
      throw new Error(`${label}.${name}.nodes must be an array`);
    }
    const result: DrawingLayer = { nodes: [] };
    const transform = normalizeTransform(
      layer.transform,
      `${label}.${name}.transform`,
    );
    if (transform) result.transform = transform;
    result.nodes = nodes.map((node, index) =>
      normalizeNode(node, name, `${label}.${name}.nodes[${index}]`, ids)
    );
    return result;
  };
  return {
    version: DRAWING_DOCUMENT_VERSION,
    freehand: normalizeLayer("freehand"),
    polygon: normalizeLayer("polygon"),
    circle: normalizeLayer("circle"),
  };
}

function normalizeNode(
  input: unknown,
  layer: DrawingLayerName,
  path: string,
  ids: Set<string>,
): DrawingNode {
  const node = requireObject(input, path);
  const id = node.id;
  if (typeof id !== "string" || id.length === 0) {
    throw new Error(`${path}.id must be a non-empty string`);
  }
  if (ids.has(id)) throw new Error(`${path}.id "${id}" is used more than once`);
  ids.add(id);

  const type = node.type;
  const leafType = LEAF_TYPE_BY_LAYER[layer];
  if (type === "group") {
    if (!GROUPABLE_LAYERS.has(layer)) {
      throw new Error(`${path}: the ${layer} layer cannot contain groups`);
    }
  } else if (type !== leafType) {
    throw new Error(
      `${path}.type must be "${leafType}" or "group" on the ${layer} layer, got ${
        JSON.stringify(type)
      }`,
    );
  }

  const metadata = normalizeMetadata(node.metadata, `${path}.metadata`);

  if (type === "group") {
    if (!Array.isArray(node.children)) {
      throw new Error(`${path}.children must be an array`);
    }
    const result: DrawingGroupNode = { type: "group", id, children: [] };
    const transform = normalizeTransform(node.transform, `${path}.transform`);
    if (transform) result.transform = transform;
    if (metadata) result.metadata = metadata;
    result.children = node.children.map((child, index) =>
      normalizeNode(child, layer, `${path}.children[${index}]`, ids)
    );
    return result;
  }

  if (type === "stroke") {
    const points = requirePoints(node.points, `${path}.points`);
    const timestamps = requireNumberArray(
      node.timestamps,
      `${path}.timestamps`,
    );
    if (timestamps.length !== points.length / 2) {
      throw new Error(
        `${path}.timestamps must have one entry per point pair (${
          points.length / 2
        }), got ${timestamps.length}`,
      );
    }
    if (typeof node.isFreehand !== "boolean") {
      throw new Error(`${path}.isFreehand must be a boolean`);
    }
    const result: DrawingStrokeNode = {
      type: "stroke",
      id,
      points,
      timestamps,
      creationTime: requireFinite(node.creationTime, `${path}.creationTime`),
      isFreehand: node.isFreehand,
    };
    // A stroke sits at its points' minimum corner by construction, so that
    // position is the default and is dropped from the canonical form.
    const bounds = pointsMin(points);
    const transform = normalizeTransform(node.transform, `${path}.transform`, {
      x: bounds.x,
      y: bounds.y,
    });
    if (transform) result.transform = transform;
    if (metadata) result.metadata = metadata;
    return result;
  }

  if (type === "polygon") {
    if (typeof node.closed !== "boolean") {
      throw new Error(`${path}.closed must be a boolean`);
    }
    const result: DrawingPolygonNode = {
      type: "polygon",
      id,
      points: requirePoints(node.points, `${path}.points`),
      closed: node.closed,
      creationTime: requireFinite(node.creationTime, `${path}.creationTime`),
    };
    const transform = normalizeTransform(node.transform, `${path}.transform`);
    if (transform) result.transform = transform;
    if (metadata) result.metadata = metadata;
    return result;
  }

  const radius = requireFinite(node.radius, `${path}.radius`);
  if (radius <= 0) throw new Error(`${path}.radius must be positive`);
  const result: DrawingCircleNode = {
    type: "circle",
    id,
    radius,
    creationTime: requireFinite(node.creationTime, `${path}.creationTime`),
  };
  const transform = normalizeTransform(node.transform, `${path}.transform`);
  if (transform) result.transform = transform;
  if (metadata) result.metadata = metadata;
  return result;
}

function normalizeTransform(
  input: unknown,
  path: string,
  defaults: Partial<Record<keyof DrawingTransform, number>> = {},
): DrawingTransform | undefined {
  if (input === undefined || input === null) return undefined;
  const raw = requireObject(input, path);
  const result: DrawingTransform = {};
  for (const field of TRANSFORM_FIELDS) {
    const value = raw[field];
    if (value === undefined) continue;
    const number = requireFinite(value, `${path}.${field}`);
    if (number === (defaults[field] ?? transformDefault(field))) continue;
    result[field] = number;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeMetadata(
  input: unknown,
  path: string,
): Record<string, unknown> | undefined {
  if (input === undefined || input === null) return undefined;
  const metadata = requireObject(input, path);
  if (Object.keys(metadata).length === 0) return undefined;
  return JSON.parse(JSON.stringify(metadata)) as Record<string, unknown>;
}

function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function requireFinite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number`);
  }
  return value;
}

function requireNumberArray(value: unknown, path: string): number[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value.map((entry, index) => requireFinite(entry, `${path}[${index}]`));
}

function requirePoints(value: unknown, path: string): number[] {
  const points = requireNumberArray(value, path);
  if (points.length % 2 !== 0) {
    throw new Error(`${path} must hold x/y pairs (even length)`);
  }
  return points;
}

function pointsMin(points: number[]): { x: number; y: number } {
  let x = Infinity;
  let y = Infinity;
  for (let index = 0; index < points.length; index += 2) {
    x = Math.min(x, points[index]);
    y = Math.min(y, points[index + 1]);
  }
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
  };
}

// ---------------------------------------------------------------------------
// Bake: document -> world-space render data, without Konva
// ---------------------------------------------------------------------------

/**
 * Flatten a document into the render data the canvas emits, replicating the
 * canvas's own bake (transform composition, stroke normalization, group maps,
 * the single-stroke wrapper group) so the two agree to floating-point noise.
 * The input is not validated; pass a normalized document.
 */
export function bakeDrawingDocument(doc: DrawingDocument): DrawingRenderData {
  const freehand = bakeFreehand(doc.freehand);
  const circle = bakeCircles(doc.circle);
  return {
    freehand: freehand.data,
    freehandGroupMap: freehand.groupMap,
    polygon: bakePolygons(doc.polygon),
    circle: circle.data,
    circleGroupMap: circle.groupMap,
  };
}

function metadataName(node: DrawingNodeBase): string | undefined {
  const name = node.metadata?.name;
  return typeof name === "string" ? name : undefined;
}

/** The matrix a stroke's normalized points are drawn through: parent × local, with the corner default. */
function strokeMatrix(
  node: DrawingStrokeNode,
  parent: AffineMatrix,
): { matrix: AffineMatrix; corner: { x: number; y: number } } {
  const corner = pointsMin(node.points);
  const local = transformToMatrix({
    x: corner.x,
    y: corner.y,
    ...node.transform,
  });
  return { matrix: multiplyMatrices(parent, local), corner };
}

function bakeFreehand(
  layer: DrawingLayer,
): { data: FreehandRenderData; groupMap: Record<string, number[]> } {
  let strokeIndex = 0;
  const groupMap: Record<string, number[]> = {};

  const bakeNode = (
    node: DrawingNode,
    parent: AffineMatrix,
  ): FlattenedStroke | FlattenedStrokeGroup | null => {
    if (node.type === "stroke") {
      const { matrix, corner } = strokeMatrix(node, parent);
      const points: FlattenedStroke["points"] = [];
      for (let index = 0; index < node.points.length; index += 2) {
        const world = applyMatrix(
          matrix,
          node.points[index] - corner.x,
          node.points[index + 1] - corner.y,
        );
        points.push({
          x: world.x,
          y: world.y,
          ts: node.timestamps[index / 2] || 0,
        });
      }
      const name = metadataName(node);
      if (name) (groupMap[name] ??= []).push(strokeIndex);
      strokeIndex += 1;
      const flat: FlattenedStroke = { type: "stroke", id: node.id, points };
      if (node.metadata) flat.metadata = node.metadata;
      return flat;
    }
    if (node.type === "group") {
      const start = strokeIndex;
      const matrix = multiplyMatrices(
        parent,
        transformToMatrix(node.transform),
      );
      const children: (FlattenedStroke | FlattenedStrokeGroup)[] = [];
      for (const child of node.children) {
        const baked = bakeNode(child, matrix);
        if (baked) children.push(baked);
      }
      if (children.length === 0) return null;
      const indices: number[] = [];
      for (let index = start; index < strokeIndex; index += 1) {
        indices.push(index);
      }
      groupMap[metadataName(node) ?? node.id] = indices;
      const flat: FlattenedStrokeGroup = {
        type: "strokeGroup",
        id: node.id,
        children,
      };
      if (node.metadata) flat.metadata = node.metadata;
      return flat;
    }
    return null;
  };

  const layerMatrix = transformToMatrix(layer.transform);
  const data: FreehandRenderData = [];
  for (const node of layer.nodes) {
    const baked = bakeNode(node, layerMatrix);
    if (!baked) continue;
    // A top-level stroke is wrapped in a one-child group carrying its own id.
    data.push(
      baked.type === "stroke"
        ? { type: "strokeGroup", id: baked.id, children: [baked] }
        : baked,
    );
  }
  return { data, groupMap };
}

function bakePolygons(layer: DrawingLayer): PolygonRenderData {
  const layerMatrix = transformToMatrix(layer.transform);
  const data: PolygonRenderData = [];
  for (const node of layer.nodes) {
    if (node.type !== "polygon") continue;
    const matrix = multiplyMatrices(
      layerMatrix,
      transformToMatrix(node.transform),
    );
    const points: FlattenedPolygon["points"] = [];
    for (let index = 0; index < node.points.length; index += 2) {
      points.push(
        applyMatrix(matrix, node.points[index], node.points[index + 1]),
      );
    }
    const flat: FlattenedPolygon = { type: "polygon", id: node.id, points };
    if (node.metadata) flat.metadata = node.metadata;
    data.push(flat);
  }
  return data;
}

function bakeCircles(
  layer: DrawingLayer,
): { data: CircleRenderData; groupMap: Record<string, number[]> } {
  let circleIndex = 0;
  const groupMap: Record<string, number[]> = {};
  const data: CircleRenderData = [];

  const bakeNode = (node: DrawingNode, parent: AffineMatrix): void => {
    if (node.type === "circle") {
      const matrix = multiplyMatrices(
        parent,
        transformToMatrix(node.transform),
      );
      const c = applyMatrix(matrix, 0, 0);
      const ex = applyMatrix(matrix, node.radius, 0);
      const ey = applyMatrix(matrix, 0, node.radius);
      const rx = Math.hypot(ex.x - c.x, ex.y - c.y);
      const ry = Math.hypot(ey.x - c.x, ey.y - c.y);
      const rotation = Math.atan2(ex.y - c.y, ex.x - c.x);
      const name = metadataName(node);
      if (name) (groupMap[name] ??= []).push(circleIndex);
      circleIndex += 1;
      const flat: FlattenedCircle = {
        type: "circle",
        id: node.id,
        center: { x: c.x, y: c.y },
        r: Math.abs(rx - ry) < 1e-3 ? rx : undefined,
        rx,
        ry,
        rotation,
      };
      if (node.metadata) flat.metadata = node.metadata;
      data.push(flat);
      return;
    }
    if (node.type === "group") {
      const start = circleIndex;
      const matrix = multiplyMatrices(
        parent,
        transformToMatrix(node.transform),
      );
      for (const child of node.children) bakeNode(child, matrix);
      const indices: number[] = [];
      for (let index = start; index < circleIndex; index += 1) {
        indices.push(index);
      }
      groupMap[metadataName(node) ?? node.id] = indices;
    }
  };

  const layerMatrix = transformToMatrix(layer.transform);
  for (const node of layer.nodes) bakeNode(node, layerMatrix);
  return { data, groupMap };
}
