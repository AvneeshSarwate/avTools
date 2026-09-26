/**
 * Per-shape light material, read from a drawing node's free-form `metadata`.
 * Platform-agnostic.
 *
 * Keys (all optional):
 * - `strokeWidth`: outline width in stage pixels (default 4).
 * - `emission`: `[r, g, b]` radiance, HDR and unbounded (default black).
 * - `transmittance`: `[r, g, b]` or one number, 0..1 per channel; 0 is opaque,
 *   1 is clear, in between is tinted glass (default opaque).
 * - `albedo`: `[r, g, b]` 0..1, how much incoming light bounces back off the
 *   outline (default 0.5 grey).
 *
 * Transmittance and emission are per pixel of ray travel: a ray crossing a
 * clear emitter picks up `emission` for every pixel it spends inside the
 * outline, and loses `1 - transmittance` of its light per pixel.
 */

export type Rgb = readonly [number, number, number];

export interface ShapeMaterial {
  strokeWidth: number;
  emission: Rgb;
  transmittance: Rgb;
  albedo: Rgb;
}

export const DEFAULT_MATERIAL: ShapeMaterial = {
  strokeWidth: 4,
  emission: [0, 0, 0],
  transmittance: [0, 0, 0],
  albedo: [0.5, 0.5, 0.5],
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function rgbOf(value: unknown, fallback: Rgb): Rgb {
  if (isFiniteNumber(value)) return [value, value, value];
  if (
    Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber)
  ) {
    return [value[0], value[1], value[2]];
  }
  return fallback;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function materialOf(
  metadata: Record<string, unknown> | undefined,
  defaults: ShapeMaterial = DEFAULT_MATERIAL,
): ShapeMaterial {
  const strokeWidth = metadata?.strokeWidth;
  const transmittance = rgbOf(metadata?.transmittance, defaults.transmittance);
  const albedo = rgbOf(metadata?.albedo, defaults.albedo);
  const emission = rgbOf(metadata?.emission, defaults.emission);
  return {
    strokeWidth: isFiniteNumber(strokeWidth) && strokeWidth > 0
      ? strokeWidth
      : defaults.strokeWidth,
    emission: [
      Math.max(0, emission[0]),
      Math.max(0, emission[1]),
      Math.max(0, emission[2]),
    ],
    transmittance: [
      clamp01(transmittance[0]),
      clamp01(transmittance[1]),
      clamp01(transmittance[2]),
    ],
    albedo: [clamp01(albedo[0]), clamp01(albedo[1]), clamp01(albedo[2])],
  };
}
