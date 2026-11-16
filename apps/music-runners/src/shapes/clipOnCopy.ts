// A duplicated or pasted runner instance gets its own copy of the clip, so
// the copy can diverge from the original.
//
// - Copying (Cmd-C, Cmd-X, moving to another page) goes through
//   getContentFromCurrentPage; the wrapper puts a snapshot of each
//   instance's clip into the copied record's meta, so pasting carries the
//   notes as they were when copied, also into another project or tab.
// - Duplicating (right-click Duplicate, Cmd-D, Alt-drag) copies the record
//   directly; its meta still names the original's id (CLIP_OWNER_META), and
//   the original's clip is copied.
// - A copy whose name is taken (always, for a duplicate) gets the next
//   number; a cut-and-paste keeps its name.
// - Undo and redo restore records whose meta names themselves: their clip is
//   still in memory and is kept.
import type { Editor, TLShape } from "tldraw";
import type { Clip } from "../model/types";
import { copyClip, getClip, setClip } from "../store/clips";
import type { RunnerInstanceProps } from "../runners/base/instanceProps";
import { CLIP_OWNER_META, isNameTaken, isRunnerShapeType, nextInstanceName } from "./index";

/** Meta key for the clip snapshot carried by copied content (removed on paste). */
const CLIP_SNAPSHOT_META = "clip";

export function installClipCopyRules(editor: Editor): () => void {
  // Several instances pasted at once are named before any is in the store.
  let namedThisBatch = new Set<string>();
  let clearQueued = false;

  const removeHandler = editor.sideEffects.registerBeforeCreateHandler("shape", (shape: TLShape) => {
    if (!isRunnerShapeType(shape.type)) return shape;
    const { [CLIP_SNAPSHOT_META]: snapshot, [CLIP_OWNER_META]: owner, ...meta } = shape.meta as Record<string, unknown>;
    // Moving to another page keeps the id (and the clip); a paste or a
    // duplicate gets a new id, so its meta names another shape.
    const isCopy = typeof owner === "string" && owner !== shape.id;
    if (!getClip(shape.id)) {
      const source = (snapshot as Clip | undefined) ?? (typeof owner === "string" ? getClip(owner) : undefined);
      setClip(shape.id, source);
    }
    let props = shape.props;
    if (isCopy) {
      // A duplicate's name is taken by its original; a cut-and-paste keeps its own.
      const current = (props as unknown as RunnerInstanceProps).name;
      const name = isNameTaken(editor, current, namedThisBatch) ? nextInstanceName(editor, current, { copy: true, extra: namedThisBatch }) : current;
      namedThisBatch.add(name);
      if (!clearQueued) {
        clearQueued = true;
        queueMicrotask(() => {
          namedThisBatch = new Set();
          clearQueued = false;
        });
      }
      props = { ...props, name } as typeof props;
    }
    return { ...shape, props, meta: { ...meta, [CLIP_OWNER_META]: shape.id } } as TLShape;
  });

  const originalGetContent = editor.getContentFromCurrentPage;
  editor.getContentFromCurrentPage = ((shapes) => {
    const content = originalGetContent.call(editor, shapes);
    if (!content) return content;
    return {
      ...content,
      shapes: content.shapes.map((shape) => {
        const clip = isRunnerShapeType(shape.type) ? getClip(shape.id) : undefined;
        return clip ? { ...shape, meta: { ...shape.meta, [CLIP_SNAPSHOT_META]: copyClip(clip) as never } } : shape;
      }),
    };
  }) as Editor["getContentFromCurrentPage"];

  return () => {
    removeHandler();
    editor.getContentFromCurrentPage = originalGetContent;
  };
}
