/**
 * 2D affine transforms in Konva's matrix layout and composition order, so a
 * document baked without Konva matches what the handwriting canvas bakes from
 * its live nodes. The matrix is `[a, b, c, d, e, f]`; a point maps to
 * `(a*x + c*y + e, b*x + d*y + f)`.
 */

export type AffineMatrix = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
];

/**
 * One node's local transform, in Konva's attribute vocabulary. Every field is
 * optional and defaults to the identity value (`0`, or `1` for the scales).
 * `rotation` is in degrees, as Konva stores it.
 */
export interface DrawingTransform {
  x?: number;
  y?: number;
  scaleX?: number;
  scaleY?: number;
  rotation?: number;
  skewX?: number;
  skewY?: number;
  offsetX?: number;
  offsetY?: number;
}

export const IDENTITY_MATRIX: AffineMatrix = [1, 0, 0, 1, 0, 0];

/** `m × n`: apply `n` first, then `m`; Konva's `Transform.multiply`. */
export function multiplyMatrices(
  m: AffineMatrix,
  n: AffineMatrix,
): AffineMatrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/**
 * The matrix for one node's transform, composed exactly as
 * `Konva.Node.getTransform` does: translate, rotate, scale, skew, then the
 * negative offset.
 */
export function transformToMatrix(
  transform: DrawingTransform | undefined,
): AffineMatrix {
  const m: number[] = [1, 0, 0, 1, 0, 0];
  const x = transform?.x ?? 0;
  const y = transform?.y ?? 0;
  const scaleX = transform?.scaleX ?? 1;
  const scaleY = transform?.scaleY ?? 1;
  const rotation = transform?.rotation ?? 0;
  const skewX = transform?.skewX ?? 0;
  const skewY = transform?.skewY ?? 0;
  const offsetX = transform?.offsetX ?? 0;
  const offsetY = transform?.offsetY ?? 0;

  if (x !== 0 || y !== 0) translate(m, x, y);
  if (rotation !== 0) rotate(m, (rotation * Math.PI) / 180);
  if (scaleX !== 1 || scaleY !== 1) scale(m, scaleX, scaleY);
  if (skewX !== 0 || skewY !== 0) skew(m, skewX, skewY);
  if (offsetX !== 0 || offsetY !== 0) translate(m, -offsetX, -offsetY);
  return [m[0], m[1], m[2], m[3], m[4], m[5]];
}

export function applyMatrix(
  m: AffineMatrix,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: m[0] * x + m[2] * y + m[4],
    y: m[1] * x + m[3] * y + m[5],
  };
}

function translate(m: number[], x: number, y: number): void {
  m[4] += m[0] * x + m[2] * y;
  m[5] += m[1] * x + m[3] * y;
}

function rotate(m: number[], rad: number): void {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const m11 = m[0] * c + m[2] * s;
  const m12 = m[1] * c + m[3] * s;
  const m21 = m[0] * -s + m[2] * c;
  const m22 = m[1] * -s + m[3] * c;
  m[0] = m11;
  m[1] = m12;
  m[2] = m21;
  m[3] = m22;
}

function scale(m: number[], sx: number, sy: number): void {
  m[0] *= sx;
  m[1] *= sx;
  m[2] *= sy;
  m[3] *= sy;
}

function skew(m: number[], sx: number, sy: number): void {
  const m11 = m[0] + m[2] * sy;
  const m12 = m[1] + m[3] * sy;
  const m21 = m[0] * sx + m[2];
  const m22 = m[1] * sx + m[3];
  m[0] = m11;
  m[1] = m12;
  m[2] = m21;
  m[3] = m22;
}
