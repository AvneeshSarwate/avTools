/**
 * Turns a drawing's baked render data into the stroke scene the GPU
 * rasterizes: every outline as line segments, every shape as one material.
 * Platform-agnostic; the drawing helpers come from the engine's
 * `canvas-drawing` alias.
 */

import { sampleCurveSegments } from "canvas-drawing";
import type {
  DrawingRenderData,
  FlattenedStroke,
  FlattenedStrokeGroup,
} from "canvas-drawing";
import { materialOf, type ShapeMaterial } from "./materials.ts";

/** Bytes per segment in `segmentData`: a.xy, b.xy (f32), shape (u32), pad. */
export const SEGMENT_STRIDE = 24;
/** Floats per material: emission.rgb + halfWidth, transmittance.rgb + 0, albedo.rgb + 0. */
export const MATERIAL_FLOATS = 12;

export interface StrokeScene {
  segmentCount: number;
  shapeCount: number;
  /** `segmentCount` entries of `SEGMENT_STRIDE` bytes, at least one entry. */
  segmentData: ArrayBuffer;
  /** `shapeCount` entries of `MATERIAL_FLOATS` floats, at least one entry. */
  materialData: Float32Array;
}

export interface StrokeSceneOptions {
  /** Multiplies stage coordinates and stroke widths (render px per stage px). */
  scale?: number;
  /** Polyline steps per Bézier segment of a curved polygon. */
  curveSteps?: number;
  /** Polyline steps around an ellipse. */
  ellipseSteps?: number;
  /**
   * Smallest half width in render pixels. Below ~0.75 a diagonal outline
   * rasterizes as a chain of corner-touching pixels that rays slip between.
   */
  minHalfWidth?: number;
  defaults?: ShapeMaterial;
}

interface Point {
  x: number;
  y: number;
}

interface Outline {
  points: Point[];
  closed: boolean;
  material: ShapeMaterial;
}

function* strokesOf(
  groups: (FlattenedStroke | FlattenedStrokeGroup)[],
): Generator<FlattenedStroke> {
  for (const node of groups) {
    if (node.type === "stroke") yield node;
    else yield* strokesOf(node.children);
  }
}

function outlinesOf(
  render: DrawingRenderData,
  options: StrokeSceneOptions,
): Outline[] {
  const outlines: Outline[] = [];
  const curveSteps = options.curveSteps ?? 12;
  const ellipseSteps = options.ellipseSteps ?? 64;
  for (const polygon of render.polygon) {
    const points = polygon.segments
      ? sampleCurveSegments(polygon.segments, curveSteps)
      : polygon.points;
    if (points.length >= 2) {
      outlines.push({
        points,
        closed: true,
        material: materialOf(polygon.metadata, options.defaults),
      });
    }
  }
  for (const circle of render.circle) {
    const cos = Math.cos(circle.rotation);
    const sin = Math.sin(circle.rotation);
    const points: Point[] = [];
    for (let i = 0; i < ellipseSteps; i++) {
      const a = (i / ellipseSteps) * Math.PI * 2;
      const x = Math.cos(a) * circle.rx;
      const y = Math.sin(a) * circle.ry;
      points.push({
        x: circle.center.x + x * cos - y * sin,
        y: circle.center.y + x * sin + y * cos,
      });
    }
    outlines.push({
      points,
      closed: true,
      material: materialOf(circle.metadata, options.defaults),
    });
  }
  for (const stroke of strokesOf(render.freehand)) {
    if (stroke.points.length >= 1) {
      outlines.push({
        points: stroke.points,
        closed: false,
        material: materialOf(stroke.metadata, options.defaults),
      });
    }
  }
  return outlines;
}

export function buildStrokeScene(
  render: DrawingRenderData,
  options: StrokeSceneOptions = {},
): StrokeScene {
  const scale = options.scale ?? 1;
  const minHalfWidth = options.minHalfWidth ?? 0.75;
  const outlines = outlinesOf(render, options);
  let segmentCount = 0;
  for (const outline of outlines) {
    // A single point still draws as a dot: one zero-length segment.
    segmentCount += Math.max(
      1,
      outline.points.length - 1 + (outline.closed ? 1 : 0),
    );
  }
  const segmentData = new ArrayBuffer(
    Math.max(1, segmentCount) * SEGMENT_STRIDE,
  );
  const segmentFloats = new Float32Array(segmentData);
  const segmentInts = new Uint32Array(segmentData);
  const materialData = new Float32Array(
    Math.max(1, outlines.length) * MATERIAL_FLOATS,
  );
  let segment = 0;
  outlines.forEach((outline, shape) => {
    const m = outline.material;
    materialData.set(
      [
        ...m.emission,
        Math.max(minHalfWidth, (m.strokeWidth * scale) / 2),
        ...m.transmittance,
        0,
        ...m.albedo,
        0,
      ],
      shape * MATERIAL_FLOATS,
    );
    const points = outline.points;
    const edges = Math.max(1, points.length - 1 + (outline.closed ? 1 : 0));
    for (let i = 0; i < edges; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const base = segment * 6;
      segmentFloats[base] = a.x * scale;
      segmentFloats[base + 1] = a.y * scale;
      segmentFloats[base + 2] = b.x * scale;
      segmentFloats[base + 3] = b.y * scale;
      segmentInts[base + 4] = shape;
      segmentInts[base + 5] = 0;
      segment++;
    }
  });
  return {
    segmentCount,
    shapeCount: outlines.length,
    segmentData,
    materialData,
  };
}
