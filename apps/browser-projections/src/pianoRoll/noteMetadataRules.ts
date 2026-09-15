// Typed rules for known metadata keys. Everything else is free-form JSON.
import type { Path } from './metadataGroupEdit'

export const HEX_COLOR = /^#[0-9a-f]{6}$/i

export const isHexColor = (value: unknown): value is string =>
  typeof value === 'string' && HEX_COLOR.test(value)

/** An error message for a value at a path, or null when the value is allowed. */
export const validateMetadataValue = (path: Path, value: unknown): string | null => {
  if (path.length === 1 && path[0] === 'color' && !isHexColor(value)) {
    return 'must be a hex color like "#ababab"'
  }
  return null
}

/** The fill for a note: its metadata color when valid, else the default. */
export const noteFillColor = (metadata: unknown, fallback: string): string => {
  const color = typeof metadata === 'object' && metadata !== null
    ? (metadata as { color?: unknown }).color
    : undefined
  return isHexColor(color) ? color.toLowerCase() : fallback
}

/** Black or white text for legibility on a fill. */
export const labelColorFor = (fill: string): string => {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(fill)
  if (!match) return '#000'
  const [r, g, b] = match.slice(1).map((hex) => parseInt(hex, 16) / 255) as [number, number, number]
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > 0.55 ? '#000' : '#fff'
}
