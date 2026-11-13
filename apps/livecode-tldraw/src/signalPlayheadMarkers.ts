import type { SignalEntity } from '@avtools/livecode-protocol'

export function signalPlayheadMarkers(
  signals: Record<string, SignalEntity>,
  anchorType: string,
  anchorName: string,
): Array<{ id: string; position: number }> {
  const markers: Array<{ id: string; position: number }> = []
  for (const signal of Object.values(signals)) {
    if (signal.ended || signal.unserializable) continue
    if (!signal.anchors.some((anchor) =>
      anchor.type === anchorType && anchor.name === anchorName
    )) continue
    const position = readPosition(signal.value)
    if (position !== null) markers.push({ id: signal.name, position })
  }
  return markers.sort((a, b) => a.id.localeCompare(b.id))
}

function readPosition(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'object' || value === null) return null
  const position = (value as { position?: unknown }).position
  return typeof position === 'number' && Number.isFinite(position)
    ? position
    : null
}
