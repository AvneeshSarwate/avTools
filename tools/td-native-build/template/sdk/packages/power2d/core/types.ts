export type Point2D = readonly [number, number];

export interface StrokeMeshData {
  positions: Float32Array;
  uvs: Float32Array;
  normals: Float32Array;
  sides: Float32Array;
  arcLengths: Float32Array;
  normalizedArcs: Float32Array;
  miterFactors: Float32Array;
  indices: Uint32Array;
  totalArcLength: number;
}
