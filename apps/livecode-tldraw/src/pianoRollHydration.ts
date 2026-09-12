import type { PianoRollObject } from "@avtools/livecode-protocol";

export interface AppliedPianoRollView {
  rollName: string;
  element: object;
  entity: PianoRollObject;
}

export type PianoRollHydrationDecision =
  | { kind: "ignore" }
  | { kind: "accept"; applied: AppliedPianoRollView }
  | { kind: "hydrate"; applied: AppliedPianoRollView };

/** Decide whether accepted roll truth needs to be pushed into the element. */
export function decidePianoRollHydration(
  applied: AppliedPianoRollView | null,
  rollName: string,
  element: object,
  entity: PianoRollObject,
  originId: string,
): PianoRollHydrationDecision {
  const sameBinding = applied?.rollName === rollName &&
    applied.element === element;
  if (sameBinding && applied.entity === entity) return { kind: "ignore" };

  const next: AppliedPianoRollView = { rollName, element, entity };
  // A mounted element already holds its own note edit. Cursor-only updates
  // must also preserve the current note selection and viewport.
  if (
    sameBinding &&
    (entity.updatedBy === originId ||
      JSON.stringify(applied.entity.data.notes) ===
        JSON.stringify(entity.data.notes))
  ) {
    return { kind: "accept", applied: next };
  }
  return { kind: "hydrate", applied: next };
}
