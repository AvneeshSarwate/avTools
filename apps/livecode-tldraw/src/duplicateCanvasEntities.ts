import type { DurableEntityRef } from "@avtools/livecode-protocol";
import type { TLUiOverrides } from "tldraw";
import { entityRefForCanvasView, rebindCanvasViewEntity } from "./canvasViews";
import { duplicateEntity, ServerActionError } from "./serverRequests";

const entityKey = (ref: DurableEntityRef) =>
  JSON.stringify([ref.type, ref.name]);

// The engine checks names atomically. A sync snapshot alone cannot reserve a
// name against another client (or even the previous click before its sync tick).
async function duplicateVersion(server: string, ref: DurableEntityRef) {
  const match = /^(.*) v([2-9]\d*|1\d+)$/.exec(ref.name);
  const base = match?.[1] ?? ref.name;
  const first = match ? BigInt(match[2]) + 1n : 2n;
  for (let version = first; version < first + 1000n; version++) {
    const name = `${base} v${version}`;
    try {
      await duplicateEntity(server, ref.type, ref.name, name);
      return name;
    } catch (error) {
      if (!(error instanceof ServerActionError) || error.status !== 409) {
        throw error;
      }
    }
  }
  throw new Error(`Could not find an unused version name for "${ref.name}"`);
}

export function createEntityDuplicateOverrides(
  getServer: () => string,
): TLUiOverrides {
  let pending = false;
  return {
    actions(editor, actions, helpers) {
      const originalDuplicate = actions.duplicate.onSelect;
      return {
        ...actions,
        duplicate: {
          ...actions.duplicate,
          async onSelect(source) {
            if (pending) return;
            if (editor.getIsReadonly()) return;
            if (!editor.isIn("select")) {
              return originalDuplicate(source);
            }
            editor.complete();
            if (!editor.isIn("select.idle")) return;
            const selection = editor.getSelectedShapeIds();
            const duplicateProps = editor.getInstanceState().duplicateProps;
            const ids = (duplicateProps?.shapeIds ?? selection)
              .filter((id) => !editor.isShapeOrAncestorLocked(id));
            const shapeIds = [...editor.getShapeAndDescendantIds(ids)];
            const shapes = shapeIds
              .map((id) => editor.getShape(id)!);
            const refs = new Map<string, DurableEntityRef>();
            for (const shape of shapes) {
              const ref = entityRefForCanvasView(shape);
              if (ref) refs.set(entityKey(ref), ref);
            }
            if (!refs.size) return originalDuplicate(source);

            pending = true;
            const server = getServer();
            const pageId = editor.getCurrentPageId();
            const names = new Map<string, string>();
            const unchanged = () =>
              !editor.isDisposed &&
              getServer() === server && editor.getCurrentPageId() === pageId &&
              editor.isIn("select.idle") && !editor.getIsReadonly() &&
              JSON.stringify(editor.getSelectedShapeIds()) ===
                JSON.stringify(selection) &&
              editor.getInstanceState().duplicateProps === duplicateProps &&
              JSON.stringify([...editor.getShapeAndDescendantIds(ids)]) ===
                JSON.stringify(shapeIds) &&
              ids.every((id) => !editor.isShapeOrAncestorLocked(id)) &&
              shapes.every((shape) => editor.getShape(shape.id) === shape);
            try {
              for (const [key, ref] of refs) {
                if (!unchanged()) {
                  throw new Error("Selection changed while duplicating");
                }
                names.set(key, await duplicateVersion(server, ref));
              }
              if (!unchanged()) {
                throw new Error("Selection changed while duplicating");
              }

              // Scope this synchronous hook to the stock Duplicate action only.
              // Rebind before mounting so a copy never edits the original entity.
              // tldraw still owns placement, descendants, bindings and history.
              let created = false;
              const dispose = editor.sideEffects.registerBeforeCreateHandler(
                "shape",
                (shape) => {
                  const ref = entityRefForCanvasView(shape);
                  const name = ref && names.get(entityKey(ref));
                  if (!name) return shape;
                  created = true;
                  return rebindCanvasViewEntity(shape, name);
                },
              );
              try {
                // The stock 5.0.1 handler completes its document changes synchronously.
                void originalDuplicate(source);
              } finally {
                dispose();
              }
              if (!created) {
                throw new Error("tldraw could not create the duplicate views");
              }
            } catch (error) {
              const retained = [...names.values()];
              helpers.addToast({
                title: "Could not duplicate selection",
                description: `${
                  error instanceof Error ? error.message : String(error)
                }${
                  retained.length
                    ? `. Created entities remain available: ${
                      retained.join(", ")
                    }`
                    : ""
                }`,
                severity: "error",
              });
            } finally {
              pending = false;
            }
          },
        },
      };
    },
  };
}
