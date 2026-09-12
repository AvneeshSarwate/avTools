export interface SignalPlayheadMarker {
  id: string;
  position: number;
}
export type SignalPlayheadMarkers = SignalPlayheadMarker[];
export interface SignalScopeSample {
  t: number;
  v: number;
}

/** Marker order is canonical by id, so a positional comparison is sufficient. */
export function equalSignalPlayheadMarkers(
  a: SignalPlayheadMarkers,
  b: SignalPlayheadMarkers,
): boolean {
  if (a.length !== b.length) return false;
  return a.every((marker, index) =>
    marker.id === b[index].id && marker.position === b[index].position
  );
}

/** Advance one scope history in place; callers decide whether time is active. */
export function advanceSignalScopeSamples(
  samples: SignalScopeSample[],
  nowMs: number,
  windowSec: number,
  value: number | null,
  maxSamples: number,
): boolean {
  let changed = false;
  if (value !== null) {
    samples.push({ t: nowMs, v: value });
    changed = true;
  }

  const cutoff = nowMs - windowSec * 1_000;
  let drop = 0;
  while (drop < samples.length && samples[drop].t < cutoff) drop += 1;
  if (drop > 0) {
    samples.splice(0, drop);
    changed = true;
  }
  if (samples.length > maxSamples) {
    samples.splice(0, samples.length - maxSamples);
    changed = true;
  }
  return changed;
}
