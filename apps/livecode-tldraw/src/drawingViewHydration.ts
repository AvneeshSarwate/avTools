import type {
  DrawingDocument,
  DrawingEntity,
} from "@avtools/livecode-protocol";

export interface AppliedDrawingView {
  drawingName: string;
  element: object;
  rev: number;
  documentJson: string;
}

export type DrawingHydrationDecision =
  | { kind: "ignore" }
  | { kind: "accept"; applied: AppliedDrawingView }
  | { kind: "hydrate"; applied: AppliedDrawingView };

/**
 * Keep hydration tied to the actual bound element, not just an entity rev.
 * Recreated/rebound elements need a baseline even when their rev matches the
 * previous binding. Once bound, metadata-only and accepted own writes advance
 * the baseline without rebuilding the canvas's local interaction state.
 */
export function decideDrawingHydration(
  applied: AppliedDrawingView | null,
  drawingName: string,
  element: object,
  entity: DrawingEntity,
  originId: string,
): DrawingHydrationDecision {
  if (
    applied && applied.drawingName === drawingName &&
    applied.element === element && applied.rev === entity.rev
  ) {
    return { kind: "ignore" };
  }

  const next: AppliedDrawingView = {
    drawingName,
    element,
    rev: entity.rev,
    documentJson: JSON.stringify(entity.data),
  };
  const sameBinding = applied?.drawingName === drawingName &&
    applied.element === element;
  if (
    sameBinding &&
    (entity.updatedBy === originId ||
      applied.documentJson === next.documentJson)
  ) {
    return { kind: "accept", applied: next };
  }
  return { kind: "hydrate", applied: next };
}

export function drawingDocumentJson(data: DrawingDocument): string {
  return JSON.stringify(data);
}
