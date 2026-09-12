import { assertEquals } from "jsr:@std/assert@1";
import type { AnimationTimelineEntity } from "@avtools/livecode-protocol";
import { shouldHydrateAnimationEditor } from "../../../livecode-tldraw/src/animationEditorHydration.ts";

function timeline(rev: number, updatedBy: string): AnimationTimelineEntity {
  return {
    name: "animation",
    rev,
    updatedBy,
    updatedAt: rev,
    data: { tracks: [], trackOrder: [] },
  };
}

Deno.test("animation editor hydrates accepted foreign truth once per revision", () => {
  const entity = timeline(4, "another-view");
  assertEquals(
    shouldHydrateAnimationEditor(entity, 3, "animation-editor-view:shape"),
    true,
  );
  assertEquals(
    shouldHydrateAnimationEditor(entity, 4, "animation-editor-view:shape"),
    false,
  );
});

Deno.test("animation editor skips its own sync echo after an accepted edit", () => {
  const originId = "animation-editor-view:shape";
  assertEquals(
    shouldHydrateAnimationEditor(timeline(5, originId), 4, originId),
    false,
  );
});

Deno.test("animation editor hydrates a recreated element from its own latest revision", () => {
  const originId = "animation-editor-view:shape";
  assertEquals(
    shouldHydrateAnimationEditor(timeline(5, originId), null, originId),
    true,
  );
});
