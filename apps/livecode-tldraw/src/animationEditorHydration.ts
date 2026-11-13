import type { AnimationTimelineEntity } from "@avtools/livecode-protocol";

/** Whether accepted timeline truth needs to be pushed into the custom element. */
export function shouldHydrateAnimationEditor(
  entity: AnimationTimelineEntity,
  appliedRev: number | null,
  originId: string,
): boolean {
  if (entity.rev === appliedRev) return false;
  // A fresh element must hydrate even if this persistent view authored the
  // latest revision. A mounted element already contains its own accepted edit.
  return appliedRev === null || entity.updatedBy !== originId;
}
