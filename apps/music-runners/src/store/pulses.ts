// Send-time pulses for connection arrows. Ephemeral and outside the tldraw
// store: nothing here is saved or undoable, and only the canvas layer that
// draws pulses listens (src/ui/ConnectionLayer.tsx).
import type { TLShapeId } from "tldraw";

type PulseListener = (arrowId: TLShapeId) => void;

const listeners = new Set<PulseListener>();

export function pulseArrow(arrowId: TLShapeId): void {
  for (const listener of listeners) listener(arrowId);
}

export function onPulse(listener: PulseListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
