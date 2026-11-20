// What a running instance says is playing right now, Strudel-style: text
// ranges in its params (the mini-notation element that produced the note)
// and the source-roll notes it is sounding (api.setHighlights). Changes at
// note events, not per frame. The pattern field subscribes to it; the source
// roll reads it on the shape's playhead tick (imperative handle).
export type TextRange = [from: number, to: number];

export interface Highlights {
  /** Param key -> character ranges in its text value. */
  params: Record<string, TextRange[]>;
  /** Source-roll note ids. */
  notes: string[];
}

/** Fill for highlighted notes and text: its own colour (not play/run/rec/selection). */
export const HIGHLIGHT_COLOR = "#2fd4b8";

const EMPTY: Highlights = { params: {}, notes: [] };
const NO_RANGES: TextRange[] = [];
const current = new Map<string, Highlights>();
const listeners = new Set<() => void>();

export function setHighlights(shapeId: string, next: Partial<Highlights> | null): void {
  const value: Highlights = next ? { params: next.params ?? {}, notes: next.notes ?? [] } : EMPTY;
  const before = current.get(shapeId) ?? EMPTY;
  if (JSON.stringify(before) === JSON.stringify(value)) return;
  if (value === EMPTY) current.delete(shapeId);
  else current.set(shapeId, value);
  for (const listener of listeners) listener();
}

export function highlightsFor(shapeId: string): Highlights {
  return current.get(shapeId) ?? EMPTY;
}

/** The highlighted ranges of one param (a stable empty array when none). */
export function paramHighlights(shapeId: string, key: string): TextRange[] {
  return current.get(shapeId)?.params[key] ?? NO_RANGES;
}

export function subscribeHighlights(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
