// A duplicated or pasted runner instance gets its own copy of its bank, so
// the copy can diverge from the original. Only these two editor entry points
// are wrapped (right-click Duplicate, Cmd-D and Alt-drag cloning go through
// duplicateShapes; pasting copied shapes through putContentOntoCurrentPage):
// "+ instance" in the bank sidebar, project loading and undo still create
// instances that share a bank on purpose.
import type { Editor, TLShapeId } from "tldraw";
import { duplicateBank } from "../store/banks";
import type { RunnerInstanceProps } from "../runners/base/instanceProps";
import { isRunnerShapeType } from "./index";

export function installBankCopyOnDuplicate(editor: Editor): () => void {
  const originalDuplicate = editor.duplicateShapes;
  const originalPut = editor.putContentOntoCurrentPage;

  const giveNewInstancesTheirOwnBanks = (before: Set<TLShapeId>) => {
    for (const shape of editor.getCurrentPageShapes()) {
      if (before.has(shape.id) || !isRunnerShapeType(shape.type)) continue;
      // A bank missing here (pasted from another project) stays as it is
      const copy = duplicateBank((shape.props as unknown as RunnerInstanceProps).bankId);
      if (copy) editor.updateShape({ id: shape.id, type: shape.type, props: { bankId: copy.id } as never });
    }
  };
  // One history step with the duplicate itself (the bank lives outside the
  // store: undoing leaves the copied bank in the sidebar, unused)
  const wrap = (run: () => void) => {
    editor.run(() => {
      const before = new Set(editor.getCurrentPageShapeIds());
      run();
      giveNewInstancesTheirOwnBanks(before);
    });
    return editor;
  };

  editor.duplicateShapes = ((shapes, offset) => wrap(() => originalDuplicate.call(editor, shapes, offset))) as Editor["duplicateShapes"];
  editor.putContentOntoCurrentPage = ((content, opts) => wrap(() => originalPut.call(editor, content, opts))) as Editor["putContentOntoCurrentPage"];
  return () => {
    editor.duplicateShapes = originalDuplicate;
    editor.putContentOntoCurrentPage = originalPut;
  };
}
